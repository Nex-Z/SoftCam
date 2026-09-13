const path = require("node:path");

// Convert monitor-local capture pixels to desktop DIP coordinates, including
// negative monitor origins and independent horizontal/vertical scaling.
function borderBounds(source, display) {
  const crop = source.crop || {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  };
  const b = display.bounds;
  return {
    x: b.x + (crop.x * b.width) / source.width,
    y: b.y + (crop.y * b.height) / source.height,
    width: (crop.width * b.width) / source.width,
    height: (crop.height * b.height) / source.height,
  };
}

function recordingBorder({ BrowserWindow, screen }) {
  let window;
  function close() {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }
  return {
    close,
    async show(source) {
      close();
      // Window capture already uses the native Windows capture indicator.
      if (source.kind !== "monitor") return;
      const display = screen
        .getAllDisplays()
        .find((d) => d.id === source.displayId);
      if (!display) throw new Error("显示器已断开，请重新选择录制区域");
      const current = new BrowserWindow({
        ...display.bounds,
        fullscreen: true,
        minWidth: 1,
        minHeight: 1,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        show: false,
        focusable: false,
        resizable: false,
        movable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        enableLargerThanScreen: true,
        title: "SoftCam · 录制范围",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      window = current;
      current.setIgnoreMouseEvents(true);
      // Exclude the indicator from Windows Graphics Capture output.
      current.setContentProtection(true);
      current.setAlwaysOnTop(true, "screen-saver");
      current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      current.webContents.on("will-navigate", (e) => e.preventDefault());
      await current.loadFile(path.join(__dirname, "recording-border.html"));
      if (current.isDestroyed()) return;
      // Draw inside a monitor-sized window: Windows rounds small native window
      // sizes at fractional DPI. CSS preserves the physical crop edges.
      const rect = borderBounds(source, display);
      await current.webContents.insertCSS(`html body {
        position: absolute;
        left: ${rect.x - display.bounds.x}px;
        top: ${rect.y - display.bounds.y}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
      }`);
      if (!current.isDestroyed()) current.showInactive();
    },
  };
}
module.exports = { borderBounds, recordingBorder };
