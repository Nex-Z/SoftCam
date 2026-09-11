const { BrowserWindow, screen, nativeImage } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { physicalCrop } = require("./policy.cjs");
// Owns a frozen desktop session. Pixel buffers remain in native images/files.
module.exports = function captureSession(ctx) {
  let session = null;
  const close = () => {
    const old = session;
    session = null;
    for (const item of old?.items || [])
      if (!item.window.isDestroyed()) item.window.destroy();
  };
  return {
    owns(sender) {
      return session?.items.some(
        (i) => !i.window.isDestroyed() && i.window.webContents === sender,
      );
    },
    async open(action = "screenshot") {
      if (session) {
        session.items[0]?.window.focus();
        return;
      }
      ctx.checkIdle();
      session = { items: [], loading: true, action };
      const current = session;
      ctx.hide();
      try {
        await new Promise((r) => setTimeout(r, 240));
        const sources = await ctx.sources();
        const caps = await ctx.capabilities();
        // Capture every monitor before showing any overlay.
        const shots = [];
        for (const source of sources.monitors) {
          const output = path.join(ctx.previewDir(), `${randomUUID()}.png`);
          const shot = await ctx.engine().call("screenshot", {
            source: { kind: "monitor", id: source.id },
            output,
          });
          shots.push({ source, shot: { ...shot, url: ctx.grant(shot.path) } });
        }
        current.sources = sources;
        current.caps = caps;
        for (const item of shots) {
          const display = screen
            .getAllDisplays()
            .find((d) => d.id === item.source.displayId);
          if (!display) throw new Error("显示器已断开，请重新捕获");
          const win = new BrowserWindow(
            ctx.options({
              ...display.bounds,
              minWidth: 1,
              minHeight: 1,
              fullscreen: true,
              alwaysOnTop: true,
              skipTaskbar: true,
              resizable: false,
              title: "SoftCam · 捕获",
              backgroundColor: "#101828",
            }),
          );
          win.setContentProtection(true);
          current.items.push({ ...item, window: win });
          win.on("closed", () => {
            if (session === current) {
              close();
              ctx.show();
            }
          });
          ctx.load(win, "#capture");
        }
        current.loading = false;
      } catch (e) {
        close();
        ctx.show();
        throw e;
      }
    },
    async call(sender, method, p = {}) {
      const current = session;
      const item = current?.items.find((i) => i.window.webContents === sender);
      if (!item) throw new Error("捕获会话已结束");
      if (method === "captureInit")
        return {
          source: item.source,
          shot: item.shot,
          windows: current.sources.windows,
          settings: ctx.settings(),
          capabilities: current.caps,
          action: current.action,
        };
      if (method === "captureReady") {
        item.window.show();
        return;
      }
      if (method === "captureCancel") {
        if (current.finishing) return;
        close();
        ctx.show();
        return;
      }
      if (method !== "captureConfirm" || current.finishing)
        throw new Error("无效捕获操作");
      const crop =
        p.mode === "monitor" ? null : physicalCrop(p.rect, item.source, p.view);
      const target =
        p.mode === "window"
          ? current.sources.windows.find((w) => w.id === p.windowId)
          : null;
      if (p.mode === "window" && !target) throw new Error("请选择窗口");
      current.finishing = true;
      try {
        if (p.action === "record") {
          const source = target
            ? { kind: "window", id: target.id }
            : {
                kind: "monitor",
                id: item.source.id,
                ...(crop ? { crop } : {}),
              };
          close();

          await ctx.record({
            displayId: item.source.displayId,
            source,
            audio: p.audio,
            pid: p.pid,
            microphone: p.microphone,
            fps: p.fps,
            quality: p.quality,
            codec: p.codec,
            cursor: p.cursor,
          });
        } else {
          let img = nativeImage.createFromPath(item.shot.path);
          if (crop) img = img.crop(crop);
          const output = path.join(ctx.previewDir(), `${randomUUID()}.png`);
          await fs.writeFile(output, img.toPNG());
          const result = {
            path: output,
            url: ctx.grant(output),
            ...img.getSize(),
          };
          close();
          ctx.show();
          ctx.event("captureShot", result);
        }
      } catch (e) {
        close();
        ctx.show();
        ctx.event("warning", { message: String(e) });
        throw e;
      }
    },
    close,
  };
};
