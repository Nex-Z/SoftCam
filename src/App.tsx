import { useEffect, useRef, useState } from "react";
import {
  Video as VideoIcon,
  Camera,
  Archive,
  Settings2,
  Monitor,
  Scan,
  ChevronRight,
  FolderOpen,
  Play,
  Minus,
  X,
  ArrowUpRight,
  Check,
  Download,
  Command,
  AlertCircle,
} from "lucide-react";
import {
  api,
  Settings,
  Video,
  Shot,
  size,
  duration,
  basename,
  shortcutLabel,
} from "./api";
import Editor from "./Editor";
type Page = "record" | "screenshot" | "compress" | "settings";
const initial: Settings = {
  closeBehavior: "quit",
  outputDirectory: "",
  codec: "h264",
  fps: 30,
  quality: "balanced",
  cursor: true,
  recordShortcut: "Control+Shift+F9",
  shotShortcut: "Control+Shift+F10",
};
export default function App() {
  const [page, setPage] = useState<Page>("record"),
    [settings, setSettings] = useState(initial),
    [initialized, setInitialized] = useState(false),
    [caps, setCaps] = useState<{
      encoders: string[][];
      microphones: { id: string; title: string }[];
    }>({ encoders: [], microphones: [] }),
    [state, setState] = useState("idle"),
    [seconds, setSeconds] = useState(0),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [shot, setShot] = useState<Shot | null>(null),
    [last, setLast] = useState<{ path: string; url: string } | null>(null),
    [video, setVideo] = useState<Video | null>(null),
    [quality, setQuality] = useState("balanced"),
    [codec, setCodec] = useState("h264"),
    [estimate, setEstimate] = useState<any>(null),
    [progress, setProgress] = useState(0),
    [recovery, setRecovery] = useState<string[]>([]);
  const actions = useRef({ record: () => {}, screenshot: () => {} }),
    mounted = useRef(true);
  const active = ["starting", "recording", "paused", "saving"].includes(state),
    locked = !initialized || active || !!busy;
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (s: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(s);
    noticeTimer.current = setTimeout(() => setNotice(""), 4500);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const captureShortcut = (
    key: "recordShortcut" | "shotShortcut",
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    if (!e.ctrlKey && !e.altKey) {
      notify("快捷键请包含 Ctrl 或 Alt");
      return;
    }
    const value = [
      e.ctrlKey ? "CommandOrControl" : "",
      e.altKey ? "Alt" : "",
      e.shiftKey ? "Shift" : "",
      e.key.length === 1 ? e.key.toUpperCase() : e.key,
    ]
      .filter(Boolean)
      .join("+");
    setSettings({ ...settings, [key]: value });
  };
  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      notify((e as Error).message || String(e));
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    mounted.current = true;
    api("init")
      .then((init) => {
        if (!mounted.current) return;
        setSettings(init.settings);
        setInitialized(true);
        setCaps(init.capabilities);
        setRecovery(init.recovery);
        if (init.capabilities.error) notify(init.capabilities.error);
      })
      .catch((e) => notify(String(e)));
    const off = window.softcam.on((m) => {
      if (m.event === "captureShot") setShot(m.data);
      if (m.event === "recording") {
        setState(m.data.state);
        if (m.data.path && m.data.state === "completed") {
          setLast(m.data);
          notify("录制已保存");
        }
        if (m.data.message || m.data.reason)
          notify(m.data.message || m.data.reason);
      }
      if (m.event === "tick") setSeconds(m.data.seconds);
      if (m.event === "warning" || m.event === "engineError")
        notify(m.data.message);
      if (m.event === "engineError") setState("error");
      if (m.event === "compressionProgress") setProgress(m.data.seconds);
      if (m.event === "shortcut") {
        if (m.data.action === "record") actions.current.record();
        else actions.current.screenshot();
      }
    });
    return () => {
      mounted.current = false;
      off();
    };
  }, []);
  useEffect(() => {
    setEstimate(null);
  }, [quality, codec, video?.path]);
  const saveSettings = async (s: Settings) => {
    const result = await api("settings", s);
    setSettings(result.settings);
    if (result.conflicts.length)
      notify(`快捷键已被占用：${result.conflicts.join("、")}`);
  };
  const openCapture = (action = "screenshot") => {
    if (!locked) run("准备捕获", () => api("captureOpen", { action }));
  };
  actions.current = {
    record: () => openCapture("record"),
    screenshot: () => openCapture("screenshot"),
  };
  const importVideo = () =>
    run("读取视频", async () => {
      const v = await api("chooseVideo");
      if (v) setVideo(v);
    });
  const useLast = () =>
    run("读取视频", async () => {
      if (last) {
        setVideo(await api("probe", { path: last.path }));
        setPage("compress");
      }
    });
  const compress = () =>
    run("正在压缩", async () => {
      setProgress(0);
      const r = await api("compress", { input: video!.path, quality, codec });
      if (r) {
        setLast(r);
        notify(`压缩完成 · ${size(r.size)}`);
      }
    });
  const makeEstimate = () =>
    run("正在抽样预览", async () => {
      setProgress(0);
      setEstimate(
        await api("estimate", { input: video!.path, quality, codec }),
      );
    });
  const nav = [
    ["record", Scan, "捕获"],
    ["compress", Archive, "压缩"],
    ["settings", Settings2, "设置"],
  ] as const;
  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-icon">
            <VideoIcon size={19} />
          </span>
          <strong>SoftCam</strong>
          <span className="brand-caption">录屏 · 截图 · 压缩</span>
        </div>
        <div className="window-controls">
          <button title="最小化" onClick={() => api("minimize")}>
            <Minus size={16} />
          </button>
          <button
            title={
              settings.closeBehavior === "tray" ? "收起到托盘" : "退出程序"
            }
            onClick={() => api("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside>
          <nav>
            {nav.map(([key, Icon, label]) => (
              <button
                key={key}
                className={page === key ? "active" : ""}
                onClick={() => setPage(key)}
              >
                <Icon size={19} />
                {label}
                {page === key && <span className="nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="local-dot" />
            本地运行<span className="version">v0.1.4</span>
          </div>
        </aside>
        <main>
          {(page === "record" || page === "screenshot") && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">CAPTURE</div>
                  <h1>屏幕捕获</h1>
                  <p>截图与录屏，从这里开始。</p>
                </div>
              </div>
              <section className="capture-launcher">
                <div className="capture-illustration">
                  <div className="mini-toolbar">
                    <Camera size={19} />
                    <VideoIcon size={19} />
                    <span />
                    <Scan size={18} />
                    <Monitor size={18} />
                  </div>
                  <div className="mini-selection">
                    <span>选择你的画面</span>
                  </div>
                </div>
                <h2>点击，选择，捕获</h2>
                <p>主窗口自动隐藏，在冻结桌面上选择范围、截图或录屏。</p>
                {active ? (
                  <div className="launch-active">
                    <strong>
                      {state === "paused"
                        ? "已暂停"
                        : state === "saving"
                          ? "正在保存"
                          : "正在录制"}{" "}
                      · {duration(seconds)}
                    </strong>
                    <button className="primary" onClick={() => api("stop")}>
                      停止并保存
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary capture-launch-button"
                    disabled={locked}
                    onClick={() => openCapture()}
                  >
                    <Scan size={22} />
                    开始捕获
                  </button>
                )}
                <div className="capture-shortcuts">
                  <span>
                    截图 <kbd>{shortcutLabel(settings.shotShortcut)}</kbd>
                  </span>
                  <span>
                    录屏 <kbd>{shortcutLabel(settings.recordShortcut)}</kbd>
                  </span>
                </div>
              </section>
              {last && (
                <div className="recent-result">
                  <span className="success-icon">
                    <Check size={17} />
                  </span>
                  <div>
                    <strong>文件已保存</strong>
                    <span>{basename(last.path)}</span>
                  </div>
                  <span className="spacer" />
                  <button
                    className="text-button"
                    onClick={() =>
                      api("open", last).catch((e) => notify(String(e)))
                    }
                  >
                    打开
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    className="text-button"
                    onClick={() => api("reveal", last)}
                  >
                    文件夹
                  </button>
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={useLast}
                  >
                    去压缩
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
          {page === "compress" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">VIDEO COMPRESSION</div>
                  <h1>视频压缩</h1>
                  <p>预览画质，再决定如何保存。</p>
                </div>
              </div>
              {!video ? (
                <div className="import-empty">
                  <span className="empty-symbol">
                    <Archive size={38} />
                  </span>
                  <h2>选择要压缩的视频</h2>
                  <p>选择本地视频，或压缩刚刚完成的录制。</p>
                  <button
                    disabled={locked}
                    className="primary"
                    onClick={importVideo}
                  >
                    <FolderOpen size={18} />
                    选择视频
                  </button>
                  {last && (
                    <button
                      disabled={locked}
                      className="text-button"
                      onClick={useLast}
                    >
                      使用上次录制
                      <ChevronRight size={16} />
                    </button>
                  )}
                  <span className="muted">MP4 · MKV · MOV · WebM · AVI</span>
                </div>
              ) : (
                <>
                  <div className="video-file">
                    <span className="file-icon">
                      <VideoIcon size={22} />
                    </span>
                    <div>
                      <strong>{basename(video.path)}</strong>
                      <span>
                        {duration(video.duration)}
                        <i /> {size(video.size)}
                        <i />
                        {video.width} × {video.height}
                      </span>
                    </div>
                  </div>
                  <button
                    className="text-button"
                    disabled={locked}
                    onClick={importVideo}
                  >
                    <FolderOpen size={17} />
                    更换视频
                  </button>
                  <div className="compare-grid">
                    <section>
                      <div className="section-title">
                        <h2>原始视频</h2>
                        <span className="muted">{size(video.size)}</span>
                      </div>
                      <video controls src={video.url} preload="metadata" />
                    </section>
                    <section>
                      <div className="section-title">
                        <h2>压缩预览</h2>
                        <span className="blue">
                          {estimate
                            ? `约 ${size(estimate.estimatedSize)}`
                            : "等待抽样"}
                        </span>
                      </div>
                      {estimate ? (
                        <video
                          controls
                          src={estimate.previewUrls[0]}
                          preload="metadata"
                        />
                      ) : (
                        <div className="preview-placeholder">
                          <Play size={28} />
                          <span>生成片段，先看看效果</span>
                          <button
                            disabled={locked}
                            className="text-button"
                            onClick={makeEstimate}
                          >
                            生成预览
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="compression-options">
                    <div>
                      <h2>压缩设置</h2>
                      <div className="inline-fields">
                        <label>
                          编码
                          <select
                            disabled={locked}
                            value={codec}
                            onChange={(e) => setCodec(e.target.value)}
                          >
                            {caps.encoders.map(([c]) => (
                              <option value={c} key={c}>
                                {c.toUpperCase()}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          画质档位
                          <select
                            disabled={locked}
                            value={quality}
                            onChange={(e) => setQuality(e.target.value)}
                          >
                            <option value="high">高画质</option>
                            <option value="balanced">均衡</option>
                            <option value="small">小体积</option>
                          </select>
                        </label>
                      </div>
                      <p className="muted">
                        保留原分辨率与帧率，压缩后另存为新文件。
                      </p>
                    </div>
                    <div className="estimate-summary">
                      <span>预计输出大小</span>
                      <strong>
                        {estimate ? `约 ${size(estimate.estimatedSize)}` : "—"}
                      </strong>
                      <span>
                        {estimate
                          ? estimate.saving > 0
                            ? `预计节省 ${(estimate.saving * 100).toFixed(0)}% 空间`
                            : "此档位可能无法减小文件"
                          : "从多个时间点抽样估算"}
                      </span>
                      <small>实际大小会随画面复杂程度变化</small>
                    </div>
                  </div>
                  {busy && (
                    <div className="job-progress">
                      <span>{busy}</span>
                      {busy === "正在压缩" && (
                        <>
                          <progress value={progress} max={video.duration} />
                          <span>
                            {Math.min(
                              99,
                              Math.round((progress / video.duration) * 100),
                            )}
                            %
                          </span>
                        </>
                      )}
                      <button onClick={() => api("cancel")}>取消</button>
                    </div>
                  )}
                  <div className="action-bar">
                    <span className="muted">原始文件始终保留</span>
                    <span className="spacer" />
                    <button disabled={locked} onClick={makeEstimate}>
                      <Play size={17} />
                      更新预览
                    </button>
                    <button
                      className="primary"
                      disabled={locked}
                      onClick={compress}
                    >
                      <Archive size={18} />
                      开始压缩
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">PREFERENCES</div>
                  <h1>偏好设置</h1>
                  <p>管理保存位置和快捷键，设置保存在本地。</p>
                </div>
              </div>
              <section className="settings-section">
                <h2>
                  <Settings2 size={19} />
                  窗口行为
                </h2>
                <div className="settings-row">
                  <div>
                    <strong>关闭窗口时</strong>
                    <p>选择点击右上角 × 后的行为，修改后立即保存。</p>
                  </div>
                  <select
                    aria-label="关闭窗口时"
                    disabled={locked}
                    value={settings.closeBehavior}
                    onChange={(e) =>
                      run("保存设置", () =>
                        saveSettings({
                          ...settings,
                          closeBehavior: e.target.value as "quit" | "tray",
                        }),
                      )
                    }
                  >
                    <option value="quit">退出程序（默认）</option>
                    <option value="tray">收起到托盘</option>
                  </select>
                </div>
              </section>
              <section className="settings-section">
                <h2>
                  <FolderOpen size={19} />
                  文件保存
                </h2>
                <label className="field-label">输出目录</label>
                <div className="directory-field">
                  <input readOnly value={settings.outputDirectory} />
                  <button
                    className="primary"
                    disabled={locked}
                    onClick={() =>
                      run("选择目录", async () => {
                        const d = await api("chooseDirectory");
                        if (d)
                          await saveSettings({
                            ...settings,
                            outputDirectory: d,
                          });
                      })
                    }
                  >
                    更改目录
                  </button>
                </div>
              </section>
              <section className="settings-section">
                <h2>
                  <Command size={19} />
                  全局快捷键
                </h2>
                <div className="settings-row">
                  <div>
                    <strong>开始 / 停止录制</strong>
                    <p>打开捕获工具栏，选择范围与声音后开始录制</p>
                  </div>
                  <input
                    disabled={locked}
                    aria-label="录制快捷键"
                    onFocus={() => api("shortcutEditing", { active: true })}
                    onBlur={() => api("shortcutEditing", { active: false })}
                    title="点击后按下新的快捷键"
                    readOnly
                    value={shortcutLabel(settings.recordShortcut)}
                    onKeyDown={(e) => captureShortcut("recordShortcut", e)}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>截取画面</strong>
                    <p>使用当前所选范围截图</p>
                  </div>
                  <input
                    disabled={locked}
                    aria-label="截图快捷键"
                    onFocus={() => api("shortcutEditing", { active: true })}
                    onBlur={() => api("shortcutEditing", { active: false })}
                    title="点击后按下新的快捷键"
                    readOnly
                    value={shortcutLabel(settings.shotShortcut)}
                    onKeyDown={(e) => captureShortcut("shotShortcut", e)}
                  />
                </div>
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() =>
                    run("保存设置", async () => {
                      await saveSettings(settings);
                      notify("设置已保存");
                    })
                  }
                >
                  <Check size={17} />
                  保存快捷键
                </button>
              </section>
              <section className="settings-section">
                <h2>
                  <Monitor size={19} />
                  运行环境
                </h2>
                <div className="environment-info">
                  <span>Windows 11 · x64</span>
                  <span>
                    {caps.encoders.find(([c]) => c === "h264")?.[1] ||
                      "检测编码器中"}
                  </span>
                  <span>本地处理 · 无需账户</span>
                </div>
              </section>
            </>
          )}
          {!!recovery.length && (
            <div className="recovery">
              <AlertCircle size={19} />
              <div>
                <strong>发现未完成的录制</strong>
                <span>{recovery.length} 个文件可尝试恢复</span>
              </div>
              <button
                disabled={locked}
                onClick={() =>
                  run("正在恢复", async () => {
                    const r = await api("recover", { path: recovery[0] });
                    setLast(r);
                    setRecovery(recovery.slice(1));
                    notify("恢复完成，已另存为 MP4");
                  })
                }
              >
                恢复文件
              </button>
            </div>
          )}
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <AlertCircle size={18} />
          <span>{notice}</span>
          <button
            className="icon"
            title="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {busy && !["正在压缩", "正在抽样预览"].includes(busy) && (
        <div className="busy-indicator">
          <span className="spinner" />
          {busy}
        </div>
      )}
      {shot && (
        <Editor shot={shot} close={() => setShot(null)} notify={notify} />
      )}
    </div>
  );
}
