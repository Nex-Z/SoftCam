import { useEffect, useRef, useState } from "react";
import {
  Square,
  MoveUpRight,
  Type,
  Grid2X2,
  Undo2,
  Redo2,
  Copy,
  Download,
  X,
} from "lucide-react";
import { api, Shot } from "./api";
type Tool = "rect" | "arrow" | "text" | "mosaic";
type Mark = {
  tool: Tool;
  x: number;
  y: number;
  ex: number;
  ey: number;
  color: string;
  text?: string;
};
export default function Editor({
  shot,
  close,
  notify,
}: {
  shot: Shot;
  close: () => void;
  notify: (s: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]),
    [redo, setRedo] = useState<Mark[]>([]),
    [draft, setDraft] = useState<Mark | null>(null),
    [tool, setTool] = useState<Tool>("rect"),
    [color, setColor] = useState("#1677ff"),
    [text, setText] = useState(""),
    [writing, setWriting] = useState<Mark | null>(null),
    [ready, setReady] = useState(false);
  const paint = () => {
    const c = canvas.current;
    if (!c || !image.current) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(image.current, 0, 0);
    const line = Math.max(3, shot.width / 500);
    for (const m of [...marks, ...(draft ? [draft] : [])]) {
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.lineWidth = line;
      ctx.lineCap = "round";
      const x = Math.min(m.x, m.ex),
        y = Math.min(m.y, m.ey),
        w = Math.abs(m.ex - m.x),
        h = Math.abs(m.ey - m.y);
      if (m.tool === "rect") ctx.strokeRect(x, y, w, h);
      if (m.tool === "arrow") {
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.ex, m.ey);
        const a = Math.atan2(m.ey - m.y, m.ex - m.x),
          r = line * 5;
        ctx.moveTo(
          m.ex - r * Math.cos(a - 0.55),
          m.ey - r * Math.sin(a - 0.55),
        );
        ctx.lineTo(m.ex, m.ey);
        ctx.lineTo(
          m.ex - r * Math.cos(a + 0.55),
          m.ey - r * Math.sin(a + 0.55),
        );
        ctx.stroke();
      }
      if (m.tool === "text") {
        ctx.font = `600 ${Math.max(22, shot.width / 60)}px "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = "top";
        ctx.fillText(m.text || "", m.x, m.y);
      }
      if (m.tool === "mosaic" && w > 0 && h > 0) {
        const temp = document.createElement("canvas");
        temp.width = Math.max(1, Math.ceil(w / 14));
        temp.height = Math.max(1, Math.ceil(h / 14));
        temp
          .getContext("2d")!
          .drawImage(c, x, y, w, h, 0, 0, temp.width, temp.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(temp, 0, 0, temp.width, temp.height, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
      }
    }
  };
  useEffect(() => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => {
      image.current = i;
      setReady(true);
      paint();
    };
    i.src = shot.url;
    return () => {
      image.current = null;
    };
  }, [shot.url]);
  useEffect(paint, [marks, draft, ready]);
  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(shot.width, ((e.clientX - r.left) * shot.width) / r.width),
      ),
      y: Math.max(
        0,
        Math.min(shot.height, ((e.clientY - r.top) * shot.height) / r.height),
      ),
    };
  };
  const finish = () => {
    if (draft) {
      setMarks([...marks, draft]);
      setRedo([]);
      setDraft(null);
    }
  };
  const exportImage = async (method: string) => {
    try {
      const r = await api(method, {
        data: canvas.current!.toDataURL("image/png"),
      });
      if (r)
        notify(method === "copyScreenshot" ? "已复制到剪贴板" : "截图已保存");
    } catch (e) {
      notify(String(e));
    }
  };
  return (
    <div className="editor-overlay">
      <header>
        <div>
          <strong>编辑截图</strong>
          <span>
            {shot.width} × {shot.height}
          </span>
        </div>
        <button className="icon" onClick={close} title="关闭编辑器">
          <X size={20} />
        </button>
      </header>
      <div className="editor-tools">
        {(
          [
            ["rect", Square, "矩形"],
            ["arrow", MoveUpRight, "箭头"],
            ["text", Type, "文字"],
            ["mosaic", Grid2X2, "马赛克"],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            className={tool === key ? "selected" : ""}
            onClick={() => setTool(key)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
        <input
          aria-label="标注颜色"
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
        <span className="spacer" />
        <button
          disabled={!marks.length}
          onClick={() => {
            setRedo([...redo, marks[marks.length - 1]]);
            setMarks(marks.slice(0, -1));
          }}
          title="撤销"
        >
          <Undo2 size={18} />
        </button>
        <button
          disabled={!redo.length}
          onClick={() => {
            setMarks([...marks, redo[redo.length - 1]]);
            setRedo(redo.slice(0, -1));
          }}
          title="重做"
        >
          <Redo2 size={18} />
        </button>
      </div>
      <div className="canvas-area">
        <canvas
          ref={canvas}
          width={shot.width}
          height={shot.height}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = point(e);
            const m = { tool, ...p, ex: p.x, ey: p.y, color };
            if (tool === "text") {
              setWriting(m);
              setText("");
            } else setDraft(m);
          }}
          onPointerMove={(e) => {
            if (draft) {
              const p = point(e);
              setDraft({ ...draft, ex: p.x, ey: p.y });
            }
          }}
          onPointerUp={finish}
          onPointerCancel={() => setDraft(null)}
        />
      </div>
      {writing && (
        <form
          className="text-entry"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) {
              setMarks([...marks, { ...writing, text }]);
              setRedo([]);
            }
            setWriting(null);
          }}
        >
          <input
            autoFocus
            placeholder="输入标注文字"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="primary">添加文字</button>
          <button type="button" onClick={() => setWriting(null)}>
            取消
          </button>
        </form>
      )}
      <footer>
        <span>标注只应用于本次截图</span>
        <button disabled={!ready} onClick={() => exportImage("copyScreenshot")}>
          <Copy size={17} />
          复制图片
        </button>
        <button
          disabled={!ready}
          className="primary"
          onClick={() => exportImage("saveScreenshot")}
        >
          <Download size={17} />
          保存 PNG
        </button>
      </footer>
    </div>
  );
}
