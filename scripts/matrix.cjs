const { _electron: electron } = require("playwright");
const { Engine } = require("../desktop/engine.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = path.resolve("artifacts", `matrix-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const fixture = await electron.launch({ args: ["tests/fixture.cjs"], env });
  const e = new Engine(
    path.resolve("engine/target/release/softcam-engine.exe"),
    {},
  );
  let minimizeTest = false;
  const events = [];
  e.on("event", (m) => {
    events.push(m);
    if (
      !minimizeTest &&
      m.event === "recording" &&
      m.data.reason?.includes("最小化")
    )
      fixture
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].restore(),
        )
        .then(() => e.call("resume"))
        .catch(console.error);
    if (m.event === "warning" || m.event === "recording") console.log(m);
  });
  try {
    const page = await fixture.firstWindow();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.enableAudio());
    const target = await fixture.evaluate(({ BrowserWindow }) => ({
      id: Number(
        BrowserWindow.getAllWindows()[0]
          .getNativeWindowHandle()
          .readBigUInt64LE(),
      ),
      pid: process.pid,
    }));
    const source = { kind: "window", id: target.id };
    const results = [];
    for (const [width, height, fps, audio, mic] of [
      [1920, 1080, 30, "application", null],
      [1920, 1080, 60, "system", null],
      [2560, 1440, 30, "application", "default"],
      [2560, 1440, 60, "none", null],
    ]) {
      await fixture.evaluate(
        ({ BrowserWindow, screen }, { width, height }) => {
          const d = screen.getPrimaryDisplay();
          BrowserWindow.getAllWindows()[0].setContentSize(
            Math.round(width / d.scaleFactor),
            Math.round(height / d.scaleFactor),
          );
        },
        { width, height },
      );
      await wait(600);
      const output = path.join(dir, `${height}p${fps}-${audio}.mp4`);
      await e.call("start", {
        source: { ...source, crop: { x: 0, y: 0, width, height } },
        output,
        fps,
        codec: "h264",
        quality: "balanced",
        audio,
        pid: target.pid,
        microphone: mic,
        cursor: true,
      });
      await wait(8000);
      await e.call("stop");
      const info = await e.call("probe", { path: output });
      assert(Math.abs(info.duration - 8) < 0.5);
      results.push(info);
      console.log("MATRIX", height, fps, info.duration);
    }
    minimizeTest = true;
    const out = path.join(dir, "minimize.mp4");
    await e.call("start", {
      source,
      output: out,
      fps: 30,
      codec: "h264",
      quality: "balanced",
      audio: "none",
    });
    await wait(1200);
    await fixture.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await wait(1200);
    assert(
      events.some(
        (m) => m.event === "recording" && m.data.reason?.includes("最小化"),
      ),
    );
    await fixture.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    await e.call("resume");
    await wait(1200);
    await e.call("stop");
    const cancelled = path.join(dir, "cancelled.mp4");
    const compress = e.call("compress", {
      input: results[0].path,
      output: cancelled,
      codec: "h264",
      quality: "small",
    });
    await wait(30);
    await e.call("cancel");
    await assert.rejects(compress);
    await assert.rejects(fs.stat(cancelled));
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        {
          results,
          minimize: await e.call("probe", { path: out }),
          cancelled: true,
        },
        null,
        2,
      ),
    );
    console.log("MATRIX PASS", dir);
  } finally {
    e.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
