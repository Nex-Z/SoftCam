const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  screen,
  dialog,
  shell,
  clipboard,
  ClipboardItem,
  nativeImage,
  Tray,
  Menu,
  globalShortcut,
  protocol,
  net,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { Engine } = require("./engine.cjs");
const { physicalCrop, within } = require("./policy.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "softcam",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let main,
  float,
  region,
  tray,
  engine,
  dataDir,
  previewDir,
  settings,
  recordState = "idle",
  quitting = false,
  job = false,
  regionPending = null,
  capabilities;
const files = new Map(),
  allowed = new Set();
let cachedSources = [];
const base = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "..");
try {
  const profile = path.join(base, "data", "chromium");
  fs.mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
} catch {
  /* A writable folder is selected by initData before windows are created. */
}
const defaults = {
  closeBehavior: "quit",
  outputDirectory: "",
  codec: "h264",
  fps: 30,
  quality: "balanced",
  cursor: true,
  recordShortcut: "CommandOrControl+Shift+F9",
  shotShortcut: "CommandOrControl+Shift+F10",
};
function grant(file) {
  const absolute = path.resolve(file);
  allowed.add(absolute);
  const token = randomUUID();
  files.set(token, absolute);
  return `softcam://media/${token}`;
}
function requireFile(file) {
  if (typeof file !== "string" || !allowed.has(path.resolve(file)))
    throw new Error("请先选择文件");
  return path.resolve(file);
}
function event(event, data) {
  for (const w of [main, float])
    if (w && !w.isDestroyed())
      w.webContents.send("softcam:event", { event, data });
}
function windowOptions(extra = {}) {
  return {
    width: 1100,
    height: 790,
    minWidth: 900,
    minHeight: 660,
    backgroundColor: "#f8fafc",
    icon: path.join(
      app.getAppPath(),
      app.isPackaged ? "icon.png" : "resources/icon.png",
    ),
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...extra,
  };
}
function load(w, hash = "") {
  if (process.env.SOFTCAM_DEV_URL)
    w.loadURL(process.env.SOFTCAM_DEV_URL + hash);
  else
    w.loadFile(path.join(__dirname, "../dist/index.html"), {
      hash: hash.replace("#", ""),
    });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
}
function showMain() {
  if (!main || main.isDestroyed() || quitting) return;
  main.show();
  main.focus();
}
async function ensureWritable(dir) {
  await fsp.mkdir(dir, { recursive: true });
  const test = path.join(dir, `.write-test-${randomUUID()}`);
  await fsp.writeFile(test, "");
  await fsp.unlink(test);
}
async function initData() {
  dataDir = path.join(base, "data");
  try {
    await ensureWritable(dataDir);
  } catch {
    dialog.showMessageBoxSync({
      type: "info",
      message: "程序目录不可写，请选择 SoftCam 数据目录",
    });
    const r = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) throw new Error("未选择可写目录");
    dataDir = path.join(r.filePaths[0], "SoftCam-data");
    await ensureWritable(dataDir);
  }
  try {
    settings = {
      ...defaults,
      ...JSON.parse(
        await fsp.readFile(path.join(dataDir, "settings.json"), "utf8"),
      ),
    };
  } catch {
    settings = { ...defaults };
  }
  if (!["quit", "tray"].includes(settings.closeBehavior))
    settings.closeBehavior = "quit";
  if (!settings.outputDirectory)
    settings.outputDirectory = app.getPath("downloads");
  await ensureWritable(settings.outputDirectory);
  previewDir = path.join(dataDir, "previews", randomUUID());
  await fsp.mkdir(previewDir, { recursive: true });
}
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [key, action] of [
    [
      settings.recordShortcut,
      () => {
        if (["recording", "paused"].includes(recordState))
          stopRecording().catch(report);
        else {
          showMain();
          event("shortcut", { action: "record" });
        }
      },
    ],
    [
      settings.shotShortcut,
      () => {
        showMain();
        event("shortcut", { action: "screenshot" });
      },
    ],
  ]) {
    try {
      if (!globalShortcut.register(key, action)) failed.push(key);
    } catch {
      failed.push(key);
    }
  }
  if (failed.length)
    event("warning", { message: `快捷键被占用：${failed.join("、")}` });
  return failed;
}
function report(e) {
  event("warning", { message: e.message || String(e) });
}
function filename(ext, prefix = "SoftCam") {
  return path.join(
    settings.outputDirectory,
    `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`,
  );
}
async function sources() {
  const [native, thumbs] = await Promise.all([
    engine.call("sources"),
    desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 640, height: 360 },
      fetchWindowIcons: true,
    }),
  ]);
  const displays = screen.getAllDisplays();
  const monitors = native.monitors.map((m, i) => {
    const d =
      displays.find((d) => {
        const p = screen.dipToScreenPoint({ x: d.bounds.x, y: d.bounds.y });
        return m.x === p.x && m.y === p.y;
      }) || displays[i];
    const t = thumbs.find((t) => t.display_id === String(d?.id));
    return {
      ...m,
      title: `屏幕 ${i + 1} · ${d?.label || m.title} (${m.width} × ${m.height})`,
      displayId: d?.id,
      bounds: d?.bounds,
      thumbnail: t?.thumbnail.toDataURL(),
    };
  });
  const windows = native.windows
    .map((w) => {
      const t = thumbs.find((t) => t.id.startsWith(`window:${w.id}:`));
      return {
        ...w,
        thumbnail: t?.thumbnail.toDataURL(),
        icon: t?.appIcon?.toDataURL(),
      };
    })
    .filter((w) => w.thumbnail);
  cachedSources = [...monitors, ...windows];
  return { monitors, windows };
}
function selectedSource(s) {
  const known = cachedSources.find((x) => x.kind === s?.kind && x.id === s?.id);
  if (!known) throw new Error("录制来源已失效，请刷新后重新选择");
  return {
    kind: known.kind,
    id: known.id,
    ...(s.crop ? { crop: s.crop } : {}),
  };
}
async function stopRecording() {
  if (!["recording", "paused"].includes(recordState)) return;
  recordState = "saving";
  event("recording", { state: "saving" });
  float?.hide();
  return engine.call("stop");
}
let floatReady = null;
async function createFloat(displayId, visible = true) {
  if (!float || float.isDestroyed()) {
    float = new BrowserWindow(
      windowOptions({
        width: 350,
        height: 66,
        minWidth: 350,
        minHeight: 66,
        resizable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        title: "SoftCam · 录制控制",
      }),
    );
    const window = float;
    window.setContentProtection(true);
    floatReady = new Promise((resolve, reject) => {
      window.webContents.once("did-finish-load", resolve);
      window.webContents.once("did-fail-load", (_, code, description) =>
        reject(new Error(description)),
      );
    });
    window.on("closed", () => {
      if (float === window) {
        float = null;
        floatReady = null;
      }
    });
    load(window, "#float");
  }
  const window = float;
  await floatReady;
  if (window.isDestroyed() || !visible) return;
  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) ||
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  window.setPosition(Math.round(area.x + (area.width - 350) / 2), area.y + 16);
  event("recording", { state: recordState });
  window.showInactive();
}
async function selectRegion(s) {
  if (regionPending) throw new Error("正在选择区域");
  const selected = cachedSources.find(
    (x) => x.id === s.id && x.kind === "monitor",
  );
  if (!selected) throw new Error("请选择显示器");
  const display = screen
    .getAllDisplays()
    .find((d) => d.id === selected.displayId);
  if (!display) throw new Error("显示器已断开");
  main.hide();
  return new Promise((resolve, reject) => {
    regionPending = { resolve, reject, selected };
    region = new BrowserWindow(
      windowOptions({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        minWidth: 1,
        minHeight: 1,
        transparent: true,
        backgroundColor: "#00000000",
        fullscreen: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        title: "SoftCam · 选择区域",
      }),
    );
    load(region, "#region");
    region.once("ready-to-show", () => region.show());
    region.on("closed", () => {
      region = null;
      if (regionPending) {
        regionPending.resolve(null);
        regionPending = null;
      }
      showMain();
    });
  });
}
async function screenshot(s) {
  main.hide();
  float?.hide();
  await new Promise((r) => setTimeout(r, 220));
  try {
    const output = path.join(previewDir, `${randomUUID()}.png`);
    const result = await engine.call("screenshot", {
      source: selectedSource(s),
      output,
    });
    return { ...result, url: grant(result.path) };
  } finally {
    showMain();
  }
}
async function recoveryFiles() {
  const entries = await fsp.readdir(settings.outputDirectory);
  let recovered = {};
  try {
    recovered = JSON.parse(
      await fsp.readFile(path.join(dataDir, "recovered.json"), "utf8"),
    );
  } catch {}
  const candidates = entries
    .filter((n) => n.endsWith(".recording.mkv"))
    .map((n) => {
      const file = path.join(settings.outputDirectory, n);
      grant(file);
      return file;
    });
  const result = [];
  for (const file of candidates) {
    const stat = await fsp.stat(file);
    const previous = recovered[file];
    if (previous?.size === stat.size && previous?.mtime === stat.mtimeMs)
      continue;
    result.push(file);
  }
  return result;
}
const capture = require("./capture-session.cjs")({
  checkIdle() {
    if (
      job ||
      ["recording", "paused", "starting", "saving"].includes(recordState)
    )
      throw new Error("请先结束当前任务");
  },
  hide() {
    main.hide();
    float?.hide();
  },
  show: showMain,
  sources,
  capabilities: () => capabilities,
  previewDir: () => previewDir,
  engine: () => engine,
  grant,
  options: windowOptions,
  load,
  settings: () => settings,
  record: (p) => dispatch("record", p),
  event,
});
function closeMain() {
  if (quitting) return;
  if (settings.closeBehavior === "tray") main.hide();
  else app.quit();
}
async function dispatch(method, p = {}) {
  switch (method) {
    case "captureOpen":
      createFloat(undefined, false).catch(report);
      return capture.open(p.action);
    case "recordingStatus":
      return { state: recordState };
    case "init":
      return {
        settings,
        capabilities: await capabilities,
        recovery: await recoveryFiles(),
        version: app.getVersion(),
      };
    case "sources":
      return sources();
    case "shortcutEditing":
      if (p.active) globalShortcut.unregisterAll();
      else registerShortcuts();
      return null;
    case "settings": {
      const next = { ...settings, ...p };
      if (
        !["quit", "tray"].includes(next.closeBehavior) ||
        ![30, 60].includes(next.fps) ||
        !["h264", "hevc", "av1"].includes(next.codec) ||
        !["high", "balanced", "small"].includes(next.quality)
      )
        throw new Error("设置无效");
      for (const key of ["recordShortcut", "shotShortcut"])
        if (typeof next[key] !== "string" || next[key].length > 100)
          throw new Error("快捷键无效");
      if (next.recordShortcut.toLowerCase() === next.shotShortcut.toLowerCase())
        throw new Error("录制与截图不能使用同一个快捷键");
      await ensureWritable(next.outputDirectory);
      settings = next;
      await fsp.writeFile(
        path.join(dataDir, "settings.json"),
        JSON.stringify(settings, null, 2),
      );
      return { settings, conflicts: registerShortcuts() };
    }
    case "chooseDirectory": {
      const r = await dialog.showOpenDialog(main, {
        properties: ["openDirectory", "createDirectory"],
      });
      return r.canceled ? null : r.filePaths[0];
    }
    case "record": {
      if (job || !["idle", "completed", "error"].includes(recordState))
        throw new Error("已有任务正在进行");
      recordState = "starting";
      try {
        await createFloat(p.displayId);
        main.hide();
        const result = await engine.call("start", {
          ...settings,
          ...p,
          source: selectedSource(p.source),
          output: filename("mp4"),
        });

        return result;
      } catch (e) {
        recordState = "idle";
        float?.hide();
        showMain();
        event("recording", { state: "error", message: String(e) });
        throw e;
      }
    }
    case "pause":
      return engine.call("pause");
    case "resume":
      return engine.call("resume");
    case "stop":
      return stopRecording();
    case "selectRegion":
      return selectRegion(p);
    case "regionDone": {
      if (!regionPending) return null;
      const pending = regionPending;
      regionPending = null;
      try {
        const crop = p.cancel
          ? null
          : physicalCrop(p.rect, pending.selected, p.view);
        pending.resolve(crop);
      } catch (e) {
        pending.reject(e);
      }
      region.close();
      return null;
    }
    case "screenshot":
      if (
        job ||
        ["recording", "paused", "starting", "saving"].includes(recordState)
      )
        throw new Error("请先结束当前任务");
      return screenshot(p);
    case "saveScreenshot":
    case "copyScreenshot": {
      if (
        typeof p.data !== "string" ||
        !p.data.startsWith("data:image/png;base64,") ||
        p.data.length > 150000000
      )
        throw new Error("图片格式无效");
      const image = nativeImage.createFromDataURL(p.data);
      if (image.isEmpty()) throw new Error("图片为空");
      if (method === "copyScreenshot") {
        await clipboard.write([
          new ClipboardItem({
            "image/png": new Blob([image.toPNG()], { type: "image/png" }),
          }),
        ]);
        return {};
      }
      const r = await dialog.showSaveDialog(main, {
        defaultPath: filename("png"),
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
      });
      if (r.canceled) return null;
      await fsp.writeFile(r.filePath, image.toPNG());
      return { path: r.filePath, url: grant(r.filePath) };
    }
    case "chooseVideo": {
      const r = await dialog.showOpenDialog(main, {
        properties: ["openFile"],
        filters: [
          { name: "视频", extensions: ["mp4", "mkv", "mov", "webm", "avi"] },
        ],
      });
      if (r.canceled) return null;
      const file = r.filePaths[0];
      const url = grant(file);
      return { ...(await engine.call("probe", { path: file })), url };
    }
    case "probe": {
      const file = requireFile(p.path);
      return {
        ...(await engine.call("probe", { path: file })),
        url: grant(file),
      };
    }
    case "estimate":
    case "compress": {
      if (
        job ||
        ["recording", "paused", "starting", "saving"].includes(recordState)
      )
        throw new Error("已有任务正在进行");
      const input = requireFile(p.input);
      let output;
      if (method === "compress") {
        const r = await dialog.showSaveDialog(main, {
          defaultPath: filename("mp4", "SoftCam-compressed"),
          filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
        });
        if (r.canceled) return null;
        output = r.filePath;
        if (fs.existsSync(output))
          throw new Error("为保护现有文件，请选择一个新的文件名");
      }
      job = true;
      try {
        const result = await engine.call(method, {
          input,
          output,
          codec: p.codec,
          quality: p.quality,
          tempDir: previewDir,
        });
        if (result.previews) result.previewUrls = result.previews.map(grant);
        if (result.path) result.url = grant(result.path);
        return result;
      } finally {
        job = false;
      }
    }
    case "cancel":
      return engine.call("cancel");
    case "recover": {
      const input = requireFile(p.path);
      const output = filename("mp4", "SoftCam-recovered");
      const r = await engine.call("recover", { input, output });
      const ledger = path.join(dataDir, "recovered.json");
      let recovered = {};
      try {
        recovered = JSON.parse(await fsp.readFile(ledger, "utf8"));
      } catch {}
      const stat = await fsp.stat(input);
      recovered[input] = { size: stat.size, mtime: stat.mtimeMs, output };
      await fsp.writeFile(ledger, JSON.stringify(recovered, null, 2));
      return { ...r, url: grant(r.path) };
    }
    case "open":
      return shell.openPath(requireFile(p.path));
    case "reveal":
      shell.showItemInFolder(requireFile(p.path));
      return null;
    case "minimize":
      main.minimize();
      return null;
    case "close":
      closeMain();
      return null;
    default:
      throw new Error("未知操作");
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => main && showMain());
  app
    .whenReady()
    .then(async () => {
      await initData();
      app.setPath("userData", path.join(dataDir, "chromium"));
      protocol.handle("softcam", async (request) => {
        const u = new URL(request.url);
        const file = files.get(u.pathname.slice(1));
        if (!file) return new Response("Not found", { status: 404 });
        const response = await net.fetch(pathToFileURL(file).toString(), {
          headers: request.headers,
        });
        const headers = new Headers(response.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      });
      const bin = app.isPackaged
        ? path.join(process.resourcesPath, "bin")
        : path.join(base, "resources/bin");
      const enginePath = app.isPackaged
        ? path.join(bin, "softcam-engine.exe")
        : process.env.SOFTCAM_ENGINE ||
          path.join(base, "engine/target/release/softcam-engine.exe");
      engine = new Engine(enginePath, {
        SOFTCAM_FFMPEG: fs.existsSync(path.join(bin, "ffmpeg.exe"))
          ? path.join(bin, "ffmpeg.exe")
          : process.env.SOFTCAM_FFMPEG || "ffmpeg.exe",
        SOFTCAM_FFPROBE: fs.existsSync(path.join(bin, "ffprobe.exe"))
          ? path.join(bin, "ffprobe.exe")
          : process.env.SOFTCAM_FFPROBE || "ffprobe.exe",
      });
      engine.on("log", (s) =>
        fsp.appendFile(path.join(dataDir, "engine.log"), s).catch(() => {}),
      );
      engine.on("event", (m) => {
        if (m.event === "recording") {
          recordState = m.data.state;
          if (m.data.path) {
            m.data.url = grant(m.data.path);
          }
          if (["completed", "error"].includes(recordState)) {
            float?.hide();
            showMain();
          }
        }
        event(m.event, m.data);
      });
      capabilities = engine
        .call("capabilities")
        .catch((e) => ({ encoders: [], microphones: [], error: e.message }));
      main = new BrowserWindow(windowOptions({ title: "SoftCam" }));
      main.setContentProtection(true);
      load(main);
      main.once("ready-to-show", () => {
        showMain();
        registerShortcuts();
      });
      main.on("close", (e) => {
        if (!quitting) {
          e.preventDefault();
          closeMain();
        }
      });
      const icon = nativeImage
        .createFromPath(
          path.join(
            app.getAppPath(),
            app.isPackaged ? "icon.png" : "resources/icon.png",
          ),
        )
        .resize({ width: 24, height: 24 });
      tray = new Tray(icon);
      tray.setToolTip("SoftCam");
      tray.on("double-click", showMain);
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开 SoftCam", click: showMain },
          { label: "停止录制", click: () => stopRecording().catch(report) },
          { type: "separator" },
          { label: "退出", click: () => app.quit() },
        ]),
      );
      ipcMain.handle("softcam:call", async (e, method, p) => {
        if (capture.owns(e.sender)) return capture.call(e.sender, method, p);
        const trusted = [main, float, region]
          .filter(Boolean)
          .some((w) => !w.isDestroyed() && e.sender === w.webContents);
        if (!trusted) throw new Error("无效调用来源");
        if (
          region &&
          !region.isDestroyed() &&
          e.sender === region.webContents &&
          method !== "regionDone"
        )
          throw new Error("无效区域操作");
        return dispatch(method, p);
      });
    })
    .catch((e) => {
      dialog.showErrorBox("SoftCam 启动失败", String(e));
      app.exit(1);
    });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    capture.close();
    (async () => {
      try {
        if (["recording", "paused"].includes(recordState))
          await stopRecording();
        if (job) await engine.call("cancel");
        await engine?.close();
        if (previewDir && within(path.join(dataDir, "previews"), previewDir))
          await fsp
            .rm(previewDir, { recursive: true, force: true })
            .catch(() => {});
      } finally {
        globalShortcut.unregisterAll();
        app.quit();
      }
    })();
  });
}
