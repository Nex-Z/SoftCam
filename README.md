# SoftCam

Windows 11 x64 上的便携录屏、截图标注和视频压缩工具。

[下载最新版本](https://github.com/Nex-Z/SoftCam/releases/latest) · [查看发布记录](https://github.com/Nex-Z/SoftCam/releases)

## 直接运行

1. 解压 `SoftCam-0.1.6-win-x64.zip`，保留整个文件夹。
2. 双击 `SoftCam.exe`。不需要安装 Node.js、Rust、FFmpeg 或 WebView2。
3. 点击“开始捕获”，主窗口自动隐藏，桌面变为冻结画面。使用屏幕顶部工具栏选择截图／录屏和范围；Esc 取消。

默认配置和浏览器运行数据位于程序旁的 `data` 目录，视频默认保存到 Windows 系统“下载”文件夹（使用系统实际路径，支持重定向）；截图和压缩的保存对话框也默认使用该目录。已保存的自定义输出目录继续保留。目录不可写时会提示选择可写目录。

## 使用

- **统一捕获**：在要捕获的显示器上操作顶部工具栏。区域模式可反复拖动框选；窗口模式可点击识别或从列表选择；屏幕模式捕获当前单屏。所有屏幕先保存静止画面，再显示工具栏。
- **录屏**：顶部切换“录屏”，点击配置图标选择声音、麦克风、帧率、画质、编码与光标。默认确认后立即开始，配置中可选择倒计时 3 秒。冻结遮罩退出后捕获真实动态内容；录制浮条位于当前屏幕顶部中央，准备时显示状态，录制后提供计时、暂停、继续和停止。
- **冻结截图**：点击“完成截图”后进入标注编辑器，使用进入捕获时保存的画面。窗口截图截取当前显示器上的可见区域，窗口录屏则跟随整个窗口。
- **录制范围提示**：区域、窗口和屏幕录制均显示置顶红框，鼠标可穿透，红框不进入成片。窗口红框跟随移动和缩放，最小化时隐藏、恢复后重新显示；暂停时保留，停止或启动失败后清除。整屏红框向内留出 4 个逻辑像素以避开系统边框，实际仍录制完整屏幕。
- **窗口行为**：目标最小化时自动暂停；恢复目标窗口后点击继续。目标关闭或显示器断开后保存已有片段。窗口尺寸变化时保持输出尺寸，对后续画面缩放。
- **截图**：截图后可画矩形、箭头、文字、马赛克，支持撤销和重做。复制图片或保存 PNG；关闭编辑器会结束当前编辑会话。
- **压缩**：选择视频，选择编码与画质。生成预览会从多个时间点抽取片段，估算大小；最终大小不保证与估算一致。开始压缩时另存为新文件，源文件不会被替换。
- **快捷键**：默认 `Ctrl + Shift + F9` 开始/停止录制，`Ctrl + Shift + F10` 截图。可在设置中修改，注册冲突会提示。
- **关闭行为**：默认点击右上角 × 直接退出程序，停止并保存当前录制、取消压缩并退出相关后台进程。在“设置 → 窗口行为 → 关闭窗口时”可改为“收起到托盘”，修改后立即保存；右键托盘图标可打开主界面、停止录制或退出。旧配置未指定关闭行为时也默认退出。
- **异常恢复**：录制先写入 `.recording.mkv`，结束后无重编码封装为 MP4。下次启动发现临时录制时可尝试另存恢复。损坏到没有有效媒体数据的文件可能无法恢复；恢复操作保留临时源文件。

录制和压缩每次只运行一个任务。首版为 SDR 录制，不提供 HDR 色调映射、摄像头叠加、视频剪辑、多屏合成、OCR 或长截图。指定应用音频捕获包含所选进程及其子进程，受保护内容无法保证捕获。

## 开发

需要 Windows 11、Node.js 22.12+、Rust 1.88+、MSVC 构建工具与 Windows SDK。FFmpeg 和 ffprobe 放在 PATH，或设置 `SOFTCAM_FFMPEG`、`SOFTCAM_FFPROBE`。

```powershell
npm ci
npm run build
npm start
```

`npm run dev` 启动前端开发服务器和 Electron；需要先运行 `npm run build:engine`。

```powershell
npm test
node scripts/smoke-engine.cjs
node scripts/matrix.cjs
node scripts/ui-smoke.cjs
node scripts/capture-workflow.cjs
node scripts/soak.cjs
```

真实捕获测试会创建测试窗口或录制当前桌面，结果只保存在本机 `artifacts`。长测默认实际录制 1800 秒，`SOFTCAM_SOAK_SECONDS` 可用于短时排错。测试报告见 `VALIDATION.md`。

## 打包

```powershell
node scripts/icon.mjs
npm run package
```

输出在 `release`，包含便携文件夹、ZIP 和 SHA-256 校验文件。打包器使用当前锁定的 Electron、编译后的 Rust 引擎及所选 FFmpeg 发行包；需要 FFmpeg 发行目录内的 `LICENSE` 文件。Rust 引擎静态链接 MSVC CRT，Electron、FFmpeg 与 ffprobe 均随包提供。

## 工程结构

- `src`：React 界面、截图编辑、区域遮罩与浮条。
- `desktop`：Electron 主进程、受限 preload 接口、引擎客户端。
- `engine`：Windows 捕获、WASAPI 音频、时钟、编码和压缩。
- `scripts`、`tests`：打包、界面验证、媒体验证和长时间测试。

开发接口和平台边界见 `ARCHITECTURE.md`，第三方信息见 `THIRD_PARTY.md`。
