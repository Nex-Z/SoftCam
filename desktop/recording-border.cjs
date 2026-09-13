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

function recordingBorder({ BrowserWindow, screen, windowBounds }) {
  let session;
  function close() {
    const old = session;
    session = null;
    clearTimeout(old?.timer);
    for (const item of old?.items || [])
      if (!item.window.isDestroyed()) item.window.destroy();
  }
  return {
    close,
    async show(source) {
      close();
      const displays = screen
        .getAllDisplays()
        .filter((d) => source.kind === "window" || d.id === source.displayId);
      if (!displays.length) throw new Error("显示器已断开，请重新选择录制区域");
      const active = { items: [], timer: null };
      session = active;
      for (const display of displays) {
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
        active.items.push({
          window: current,
          display,
          css: null,
          previous: null,
        });
        current.setIgnoreMouseEvents(true);
        // Exclude the indicator from Windows Graphics Capture output.
        current.setContentProtection(true);
        current.setAlwaysOnTop(true, "screen-saver");
        current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        current.webContents.on("will-navigate", (e) => e.preventDefault());
        await current.loadFile(path.join(__dirname, "recording-border.html"));
        if (current.isDestroyed()) return;
      }
      const update = async () => {
        const bounds =
          source.kind === "window" ? await windowBounds(source.id) : null;
        if (session !== active) return;
        for (const item of active.items) {
          const { window: current, display } = item;
          if (current.isDestroyed()) continue;
          if (source.kind === "window" && !bounds) {
            current.hide();
            continue;
          }
          const origin = screen.dipToScreenPoint({
            x: display.bounds.x,
            y: display.bounds.y,
          });
          const rect =
            source.kind === "window"
              ? {
                  x: (bounds.x - origin.x) / display.scaleFactor,
                  y: (bounds.y - origin.y) / display.scaleFactor,
                  width: bounds.width / display.scaleFactor,
                  height: bounds.height / display.scaleFactor,
                }
              : borderBounds(source, display);
          if (source.kind !== "window") {
            rect.x -= display.bounds.x;
            rect.y -= display.bounds.y;
          }
          // Inset full-screen indicators so the native capture border cannot
          // cover them. Region coordinates stay on their exact crop boundary.
          const inset = source.kind === "monitor" && !source.crop ? 4 : 0;
          const css = `html body { position: absolute; left: ${rect.x + inset}px;
            top: ${rect.y + inset}px; width: ${Math.max(1, rect.width - inset * 2)}px;
            height: ${Math.max(1, rect.height - inset * 2)}px; }`;
          if (css !== item.previous) {
            const previous = item.css;
            item.css = await current.webContents.insertCSS(css);
            item.previous = css;
            if (previous && !current.isDestroyed())
              await current.webContents.removeInsertedCSS(previous);
          }
          if (!current.isDestroyed() && session === active) {
            current.setAlwaysOnTop(true, "screen-saver");
            current.showInactive();
          }
        }
      };
      await update();
      if (source.kind === "window") {
        const tick = async () => {
          if (session !== active) return;
          try {
            await update();
          } catch {
            if (session === active) close();
          }
          if (session === active) active.timer = setTimeout(tick, 100);
        };
        active.timer = setTimeout(tick, 100);
      }
    },
  };
}
module.exports = { borderBounds, recordingBorder };
