const { _electron: electron } = require("playwright");
const { Engine } = require("../desktop/engine.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = path.resolve("artifacts", `edges-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const fixture = await electron.launch({ args: ["tests/fixture.cjs"], env });
  const e = new Engine(
    path.resolve("engine/target/release/softcam-engine.exe"),
    {},
  );
  const events = [];
  e.on("event", (m) => events.push(m));
  try {
    await fixture.firstWindow();
    await wait(500);
    const source = await fixture.evaluate(({ BrowserWindow }) => ({
      kind: "window",
      id: Number(
        BrowserWindow.getAllWindows()[0]
          .getNativeWindowHandle()
          .readBigUInt64LE(),
      ),
    }));
    const output = path.join(dir, "close.mp4");
    await e.call("start", {
      source,
      output,
      fps: 30,
      codec: "h264",
      quality: "balanced",
      audio: "none",
    });
    await wait(1000);
    await assert.rejects(
      e.call("screenshot", { source, output: path.join(dir, "busy.png") }),
    );
    await fixture.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(800, 600),
    );
    await wait(1000);
    await fixture.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    for (
      let i = 0;
      i < 150 &&
      !events.some(
        (m) => m.event === "recording" && m.data.state === "completed",
      );
      i++
    )
      await wait(100);
    assert(
      events.some(
        (m) => m.event === "recording" && m.data.state === "completed",
      ),
    );
    const info = await e.call("probe", { path: output });
    const monitors = (await e.call("sources")).monitors;
    const tiny = path.join(dir, "tiny.mp4");
    await e.call("start", {
      source: { ...monitors[0], crop: { x: 0, y: 0, width: 64, height: 64 } },
      output: tiny,
      fps: 30,
      codec: "h264",
      quality: "balanced",
      audio: "none",
    });
    await wait(500);
    await e.call("stop");
    assert(
      events.some(
        (m) => m.event === "warning" && m.data.message.includes("软件编码"),
      ),
    );
    const recoverySource = path.join(dir, "recovery-source.recording.mkv");
    require("node:child_process").execFileSync(
      "ffmpeg",
      ["-v", "error", "-n", "-i", output, "-c", "copy", recoverySource],
      { windowsHide: true },
    );
    const recovered = await e.call("recover", {
      input: recoverySource,
      output: path.join(dir, "recovered.mp4"),
    });
    assert((await fs.stat(recovered.path)).size > 1000);
    assert((await fs.stat(recoverySource)).size > 1000);
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        {
          closedTarget: info,
          recovery: await e.call("probe", { path: recovered.path }),
          softwareFallback: true,
          busyRejected: true,
        },
        null,
        2,
      ),
    );
    console.log("EDGES PASS", dir);
  } finally {
    e.close();
    await fixture.close().catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
