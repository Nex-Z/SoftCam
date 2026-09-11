import { useEffect, useState } from "react";
import { Pause, Play, Square, X, Video } from "lucide-react";
import { api, duration } from "./api";
export function Float() {
  const [seconds, setSeconds] = useState(0),
    [state, setState] = useState("starting"),
    [error, setError] = useState("");
  useEffect(() => {
    let changed = false,
      alive = true;
    const off = window.softcam.on((m) => {
      if (m.event === "tick") {
        changed = true;
        setSeconds(m.data.seconds);
        setState(m.data.paused ? "paused" : "recording");
      }
      if (m.event === "recording") {
        changed = true;
        setState(m.data.state);
        if (m.data.state === "starting") {
          setSeconds(0);
          setError("");
        }
      }
    });
    api("recordingStatus")
      .then((r) => {
        if (alive && !changed) setState(r.state);
      })
      .catch((e) => setError(String(e)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const paused = state === "paused",
    ready = state === "recording" || paused;
  return (
    <div className="float-bar" title={error}>
      <span
        className={ready ? "live-dot " + (paused ? "paused" : "") : "spinner"}
      />
      <strong>{state === "starting" ? "正在准备…" : duration(seconds)}</strong>
      <span className="spacer" />
      <button
        disabled={!ready}
        title={paused ? "继续" : "暂停"}
        onClick={() =>
          api(paused ? "resume" : "pause").catch((e) => setError(String(e)))
        }
      >
        {paused ? <Play size={17} /> : <Pause size={17} />}
      </button>
      <button
        disabled={!ready}
        title="停止并保存"
        className="stop"
        onClick={() => api("stop").catch((e) => setError(String(e)))}
      >
        <Square size={16} fill="currentColor" />
      </button>
    </div>
  );
}
export function Region() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null),
    [end, setEnd] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") api("regionDone", { cancel: true });
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);
  const rect =
    start && end
      ? {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          width: Math.abs(end.x - start.x),
          height: Math.abs(end.y - start.y),
        }
      : null;
  return (
    <div
      className="region-overlay"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setStart({ x: e.clientX, y: e.clientY });
        setEnd({ x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        if (start) setEnd({ x: e.clientX, y: e.clientY });
      }}
      onPointerUp={(e) => {
        if (start) {
          const r = {
            x: Math.min(start.x, e.clientX),
            y: Math.min(start.y, e.clientY),
            width: Math.abs(e.clientX - start.x),
            height: Math.abs(e.clientY - start.y),
          };
          if (r.width > 2 && r.height > 2)
            api("regionDone", {
              rect: r,
              view: { width: innerWidth, height: innerHeight },
            });
          else {
            setStart(null);
            setEnd(null);
          }
        }
      }}
    >
      <div className="region-hint">
        <Video size={18} />
        拖动选择区域<span>Esc 取消</span>
        <X size={16} />
      </div>
      {rect && (
        <div
          className="region-box"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          }}
        >
          <span>
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </span>
        </div>
      )}
    </div>
  );
}
