# Architecture and protocol

The Electron renderer never receives raw recording frames or PCM. It calls an allowlisted preload API; the main process owns file dialogs, media URL tokens, tray, shortcuts, windows and the Rust process. Node integration is disabled and renderer sandbox/context isolation are enabled. Runtime files stay in the selected data directory.

The Rust process reads one JSON object per stdin line, writes response/event JSONL to stdout and reserves stderr for diagnostics. Version 1 requests have `v`, `id`, `method`, `params`; responses echo `v` and `id` with either `result` or `error: {code, message}`. Events have `v`, `event`, `data`. Calls can overlap for pause, stop and cancellation, while recording, screenshot and compression acquire a shared task slot.

| Method | Parameters | Result |
| --- | --- | --- |
| capabilities | none | platform, tested codec/encoder pairs, microphones |
| sources | none | monitors with physical dimensions/origins, windows with HWND/PID/title |
| start | source, output, fps, codec, quality, audio, pid?, microphone?, cursor | acknowledgement; state via events |
| pause / resume / stop | none | acknowledgement; stop returns output path |
| screenshot | source, output | PNG path and dimensions |
| probe | path | duration, size, dimensions, codec, frame rate |
| estimate | input, codec, quality, tempDir | estimated size, saving fraction, sample paths |
| compress | input, output, codec, quality | path and size |
| cancel | none | cancellation requested |
| recover | input, output | remuxed file path |

`source` contains `kind: window|monitor`, numeric native `id`, optional `crop: {x,y,width,height}`. Crops use physical pixels relative to the capture item, never virtual desktop DIP coordinates. Region selection is restricted to one monitor, whose full-screen overlay coordinates are scaled to physical dimensions. `audio` is exactly one of `none`, `system`, `application`; `microphone` is a separate optional endpoint ID or `default`.

Events are `recording` (starting/recording/paused/saving/completed/error), `tick` (active seconds, frames, paused), `compressionProgress` (encoded seconds), and `warning`. Electron adds engine failure and shortcut events. The recording state progresses from idle to starting, recording, optionally paused, saving and completed/error. A task cannot start while another owns the slot. Failed output remains recoverable where possible.

## Capture, audio and encoding boundaries

`capture` owns Windows Graphics Capture and exposes capture sessions, source enumeration and screenshots. A capture session holds at most one latest RGBA frame; encoder scheduling duplicates a static frame at the requested FPS. The encoding input dimensions remain fixed when a captured window resizes. Region buffers are validated before copying; odd dimensions are scaled down to even output dimensions.

`audio` owns WASAPI loopback and microphone endpoints. Each 48 kHz stereo float packet carries its placement on the active recording timeline, derived from WASAPI QPC timestamps. The mixer fills gaps with silence, clips summed samples and retains a bounded packet queue. Audio output waits briefly for device delivery, without shifting media timestamps; both streams use the same pause-aware timeline. On pause, device packets are drained and discarded.

`media` owns FFmpeg/ffprobe invocation, capability probes, codec-specific quality arguments, output protection and remuxing. `record` connects the capture/audio backends to an FFmpeg child via stdin and a loopback TCP audio stream; no shell command interpolation is used. Input queues are bounded. Recording writes MKV first; successful finalization remuxes to MP4. `compress` runs cancellable transcodes and estimates from three samples while preserving input files.

These module APIs are the platform boundary: future macOS/Linux implementations replace capture and audio while keeping the protocol, UI and media jobs. No non-Windows backend is advertised by this version.

## Failure behavior

- Invalid sources, unsupported encoders, microphone startup failures and output collisions return explicit errors.
- Each hardware encoder is actually initialized during capability discovery and tested at recording dimensions; H.264 falls back to libx264 if initialization fails.
- A minimized target pauses; a closed target or disconnected monitor ends recording. Recoverable temporary recordings are retained after encoding/remux errors.
- Compression cancellation terminates only its own FFmpeg child and removes only that job's incomplete output.
- File/media access uses main-process-granted opaque URLs. Screenshot canvas export uses CORS-enabled tokenized local media; renderer callers cannot use the protocol to read arbitrary paths.

Implementation limits: screen/window capture uses SDR RGBA CPU readback, not a zero-copy GPU pipeline. Throughput depends on capture dimensions, FPS and encoder availability. Pause/resume is controlled explicitly after a minimized window is restored. A full clean-OS, unplug and protected-content matrix requires additional machines or a VM.

## 统一冻结捕获会话

`desktop/capture-session.cjs` 管理一次捕获会话。主窗口隐藏后，Rust 顺序保存各显示器的全分辨率 PNG（引擎单任务约束），所有快照完成后才创建不进入捕获画面的全屏窗口。`src/Capture.tsx` 通过受限 `captureInit/Ready/Cancel/Confirm` 接口操作自己的显示器；主进程按发送窗口确定来源，使用原生图像裁剪冻结快照。录制确认关闭全部遮罩后调用原录制管线。原始帧不经过 JSONL；冻结 PNG 经带令牌的本地协议供渲染显示。

窗口坐标来自原生 GetWindowRect，换算到各显示器局部物理坐标后匹配 CSS 选择范围。窗口截图只截取当前屏幕上的可见部分，窗口录制仍使用 HWND。取消会话或窗口关闭时统一销毁其他遮罩，恢复主窗口。
