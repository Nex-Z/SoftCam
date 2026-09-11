import { useEffect, useState, useRef } from "react";
import {
  Camera,
  Video,
  Scan,
  Monitor,
  AppWindow,
  X,
  Settings2,
  Check,
} from "lucide-react";
import { api } from "./api";
type Rect = { x: number; y: number; width: number; height: number };
export function Capture() {
  const [data, setData] = useState<any>(null),
    [action, setAction] = useState("screenshot"),
    [mode, setMode] = useState("region");
  const [rect, setRect] = useState<Rect | null>(null),
    [windowId, setWindowId] = useState<number | null>(null),
    [options, setOptions] = useState(false);
  const [audio, setAudio] = useState("system"),
    [pid, setPid] = useState(""),
    [mic, setMic] = useState(""),
    [fps, setFps] = useState(30),
    [quality, setQuality] = useState("balanced"),
    [codec, setCodec] = useState("h264"),
    [cursor, setCursor] = useState(true);
  const [error, setError] = useState(""),
    [count, setCount] = useState<number | null>(null),
    [delay, setDelay] = useState(0),
    [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null),
    cancelled = useRef(false),
    submitting = useRef(false);
  useEffect(() => {
    api("captureInit")
      .then((d) => {
        setData(d);
        setAction(d.action);
        setFps(d.settings.fps);
        setQuality(d.settings.quality);
        setCodec(d.settings.codec);
        setCursor(d.settings.cursor);
      })
      .catch((e) => setError(String(e)));
  }, []);
  const cancel = () => {
    cancelled.current = true;
    api("captureCancel").catch(() => {});
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const windowRect = (w: any): Rect | null => {
    if (!data) return null;
    const s = data.source,
      sx = innerWidth / s.width,
      sy = innerHeight / s.height;
    const left = Math.max(0, w.x - s.x),
      top = Math.max(0, w.y - s.y);
    const right = Math.min(s.width, w.x - s.x + w.width),
      bottom = Math.min(s.height, w.y - s.y + w.height);
    return right > left && bottom > top
      ? {
          x: left * sx,
          y: top * sy,
          width: (right - left) * sx,
          height: (bottom - top) * sy,
        }
      : null;
  };
  const chooseWindow = (id: number) => {
    const w = data.windows.find((w: any) => w.id === id);
    setWindowId(id);
    setRect(w ? windowRect(w) : null);
  };
  const confirm = async () => {
    if (submitting.current || !data) return;
    if (mode !== "monitor" && (!rect || rect.width < 2 || rect.height < 2)) {
      setError("请先选择捕获范围");
      return;
    }
    if (action === "record" && audio === "application" && !pid) {
      setOptions(true);
      setError("请选择声音来源应用");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "record")
        for (let n = delay; n > 0; n--) {
          setCount(n);
          await new Promise((r) => setTimeout(r, 1000));
          if (cancelled.current) return;
        }
      await api("captureConfirm", {
        action,
        mode,
        rect,
        windowId,
        view: { width: innerWidth, height: innerHeight },
        audio,
        pid: pid ? Number(pid) : undefined,
        microphone: mic || null,
        fps,
        quality,
        codec,
        cursor,
      });
    } catch (e) {
      setError(String(e));
      setBusy(false);
      submitting.current = false;
      setCount(null);
    }
  };
  const selectMode = (value: string) => {
    setMode(value);
    setRect(null);
    setWindowId(null);
    setError("");
  };
  return (
    <div className="capture-desktop">
      {data && (
        <img
          className="frozen-desktop"
          crossOrigin="anonymous"
          src={data.shot.url}
          onLoad={() => api("captureReady")}
          onError={() => setError("冻结画面加载失败，请按 Esc 重试")}
          draggable={false}
        />
      )}
      <div
        className="capture-surface"
        onPointerDown={(e) => {
          if (busy || mode !== "region") return;
          drag.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
          setRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
        }}
        onPointerMove={(e) => {
          if (busy) return;
          const start = drag.current;
          if (start) {
            setRect({
              x: Math.min(start.x, e.clientX),
              y: Math.min(start.y, e.clientY),
              width: Math.abs(e.clientX - start.x),
              height: Math.abs(e.clientY - start.y),
            });
          } else if (mode === "window" && !windowId) {
            const w = data?.windows.find((w: any) => {
              const r = windowRect(w);
              return (
                r &&
                e.clientX >= r.x &&
                e.clientX <= r.x + r.width &&
                e.clientY >= r.y &&
                e.clientY <= r.y + r.height
              );
            });
            setRect(w ? windowRect(w) : null);
          }
        }}
        onPointerUp={(e) => {
          drag.current = null;
          if (mode === "window" && !busy) {
            const w = data?.windows.find((w: any) => {
              const r = windowRect(w);
              return (
                r &&
                e.clientX >= r.x &&
                e.clientX <= r.x + r.width &&
                e.clientY >= r.y &&
                e.clientY <= r.y + r.height
              );
            });
            if (w) chooseWindow(w.id);
          }
        }}
      />
      {rect && mode !== "monitor" && (
        <div
          className="capture-selection"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span>
            {Math.round(
              (rect.width * (data?.source.width || innerWidth)) / innerWidth,
            )}{" "}
            ×{" "}
            {Math.round(
              (rect.height * (data?.source.height || innerHeight)) /
                innerHeight,
            )}
          </span>
        </div>
      )}
      <div className="capture-toolbar" role="toolbar" aria-label="捕获工具栏">
        <strong className="capture-brand">SoftCam</strong>
        <i />
        <button
          disabled={busy}
          className={action === "screenshot" ? "selected" : ""}
          onClick={() => setAction("screenshot")}
        >
          <Camera size={18} />
          截图
        </button>
        <button
          disabled={busy}
          className={action === "record" ? "selected" : ""}
          onClick={() => setAction("record")}
        >
          <Video size={18} />
          录屏
        </button>
        <i />
        {(
          [
            ["region", Scan, "区域"],
            ["window", AppWindow, "窗口"],
            ["monitor", Monitor, "屏幕"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            disabled={busy}
            className={mode === value ? "selected" : ""}
            onClick={() => selectMode(value)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
        {action === "record" && (
          <button
            disabled={busy}
            className={options ? "selected" : ""}
            onClick={() => setOptions(!options)}
            title="录制配置"
          >
            <Settings2 size={18} />
          </button>
        )}
        <i />
        <button
          className="capture-confirm"
          disabled={busy || !data}
          onClick={confirm}
        >
          <Check size={18} />
          {action === "record" ? "开始录制" : "完成截图"}
        </button>
        <button title="取消捕获 (Esc)" onClick={cancel}>
          <X size={19} />
        </button>
      </div>
      {mode === "window" && data && (
        <div className="capture-window-picker">
          <select
            aria-label="选择窗口"
            disabled={busy}
            value={windowId || ""}
            onChange={(e) => chooseWindow(Number(e.target.value))}
          >
            <option value="">点击画面识别窗口，或在此选择</option>
            {data.windows
              .filter((w: any) => windowRect(w))
              .map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
          </select>
          <small>
            {action === "screenshot"
              ? "截图截取该窗口在此屏幕上的可见区域"
              : "录制整个窗口，窗口移动后仍会跟随"}
          </small>
        </div>
      )}
      {action === "record" && options && data && (
        <div className="capture-options">
          <h3>录制配置</h3>
          <label>
            开始延时
            <select
              aria-label="开始延时"
              value={delay}
              onChange={(e) => setDelay(Number(e.target.value))}
            >
              <option value={0}>立即开始</option>
              <option value={3}>倒计时 3 秒</option>
            </select>
          </label>
          <label>
            声音
            <select
              aria-label="声音"
              value={audio}
              onChange={(e) => setAudio(e.target.value)}
            >
              <option value="none">无声</option>
              <option value="system">全部系统声音</option>
              <option value="application">指定应用声音</option>
            </select>
          </label>
          {audio === "application" && (
            <label>
              应用
              <select
                aria-label="声音应用"
                value={pid}
                onChange={(e) => setPid(e.target.value)}
              >
                <option value="">选择应用</option>
                {data.windows.map((w: any) => (
                  <option key={w.id} value={w.pid}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            麦克风
            <select
              aria-label="麦克风"
              value={mic}
              onChange={(e) => setMic(e.target.value)}
            >
              <option value="">关闭</option>
              <option value="default">默认麦克风</option>
              {data.capabilities.microphones?.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            帧率
            <select
              aria-label="帧率"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            >
              <option value={30}>30 FPS</option>
              <option value={60}>60 FPS</option>
            </select>
          </label>
          <label>
            画质
            <select
              aria-label="画质"
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
            >
              <option value="high">高画质</option>
              <option value="balanced">均衡</option>
              <option value="small">小体积</option>
            </select>
          </label>
          <label>
            编码
            <select
              aria-label="编码"
              value={codec}
              onChange={(e) => setCodec(e.target.value)}
            >
              {["h264", "hevc", "av1"]
                .filter(
                  (c) =>
                    c === "h264" ||
                    data.capabilities.encoders?.some(
                      (v: string[]) => v[0] === c,
                    ),
                )
                .map((c) => (
                  <option key={c} value={c}>
                    {c.toUpperCase()}
                  </option>
                ))}
            </select>
          </label>
          <label>
            显示光标
            <input
              type="checkbox"
              checked={cursor}
              onChange={(e) => setCursor(e.target.checked)}
            />
          </label>
        </div>
      )}
      <div className="capture-help">
        {error ||
          (mode === "region"
            ? "拖动框选范围，可重新拖动调整"
            : mode === "window"
              ? "点击选择窗口，再确认捕获"
              : "捕获当前整块屏幕")}
        <span>桌面画面已冻结 · Esc 取消</span>
      </div>
      {count !== null && (
        <div className="capture-countdown">
          <strong>{count}</strong>
          <span>即将录制动态画面 · Esc 取消</span>
        </div>
      )}
    </div>
  );
}
