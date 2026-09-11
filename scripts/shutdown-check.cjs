const { Engine } = require("../desktop/engine.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = path.resolve("artifacts", `shutdown-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const exe = path.resolve("engine/target/release/softcam-engine.exe");
  const e = new Engine(exe, {});
  const source = (await e.call("sources")).monitors[0];
  const output = path.join(dir, "eof.mp4");
  await e.call("start", {
    source: { ...source, crop: { x: 0, y: 0, width: 640, height: 360 } },
    output,
    fps: 30,
    codec: "h264",
    quality: "balanced",
    audio: "system",
  });
  await wait(1000);
  await e.close();
  assert((await fs.stat(output)).size > 1000);
  const second = new Engine(exe, {});
  try {
    const input = output;
    const compressed = path.join(dir, "cancel.mp4");
    const request = second
      .call("compress", {
        input,
        output: compressed,
        codec: "h264",
        quality: "small",
      })
      .catch((e) => e);
    await wait(40);
    await second.close();
    assert((await request) instanceof Error);
    await assert.rejects(fs.stat(compressed));
    console.log("SHUTDOWN PASS", dir);
  } finally {
    await second.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
