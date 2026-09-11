const { _electron: electron } = require("playwright");
const { Engine } = require("../desktop/engine.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const a = await electron.launch({ args: ["tests/fixture.cjs"], env }),
    b = await electron.launch({ args: ["tests/fixture.cjs"], env });
  const e = new Engine(
    path.resolve("engine/target/release/softcam-engine.exe"),
    {},
  );
  try {
    const pa = await a.firstWindow(),
      pb = await b.firstWindow();
    await pa.evaluate(() => {
      window.testFrequency = 1000;
      window.enableAudio();
    });
    await pb.evaluate(() => {
      window.testFrequency = 2000;
      window.enableAudio();
    });
    const target = await a.evaluate(({ BrowserWindow }) => ({
      id: Number(
        BrowserWindow.getAllWindows()[0]
          .getNativeWindowHandle()
          .readBigUInt64LE(),
      ),
      pid: process.pid,
    }));
    const dir = path.resolve("artifacts", `audio-isolation-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    const output = path.join(dir, "selected.mp4");
    await e.call("start", {
      source: { kind: "window", id: target.id },
      output,
      fps: 30,
      codec: "h264",
      quality: "balanced",
      audio: "application",
      pid: target.pid,
    });
    await wait(4500);
    await e.call("stop");
    const raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        output,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { maxBuffer: 2000000, windowsHide: true },
    );
    function magnitude(hz) {
      let max = 0;
      for (let o = 0; o + 1920 <= raw.length; o += 1920) {
        let re = 0,
          im = 0;
        for (let i = 0; i < 480; i++) {
          const v = raw.readFloatLE(o + i * 4),
            phase = (2 * Math.PI * hz * i) / 48000;
          re += v * Math.cos(phase);
          im += v * Math.sin(phase);
        }
        max = Math.max(max, Math.hypot(re, im) / 480);
      }
      return max;
    }
    const selected = magnitude(1000),
      excluded = magnitude(2000);
    assert(selected > 0.005 && selected > excluded * 10);
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        {
          selected1000Hz: selected,
          excluded2000Hz: excluded,
          ratio: selected / Math.max(excluded, 1e-12),
        },
        null,
        2,
      ),
    );
    console.log("AUDIO ISOLATION PASS", selected, excluded);
  } finally {
    await e.close();
    await a.close();
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
