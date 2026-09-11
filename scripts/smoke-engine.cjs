const { Engine } = require("../desktop/engine.cjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const dir = path.resolve("artifacts", `smoke-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const e = new Engine(
    path.resolve("engine/target/release/softcam-engine.exe"),
    {},
  );
  e.on("event", (m) => console.log("event", JSON.stringify(m)));
  e.on("log", (s) => process.stderr.write(s));
  try {
    const caps = await e.call("capabilities");
    console.log("capabilities", JSON.stringify(caps));
    assert(caps.encoders.some((x) => x[0] === "h264"));
    const sources = await e.call("sources");
    console.log("sources", {
      monitors: sources.monitors.length,
      windows: sources.windows.length,
    });
    const source = sources.monitors[0];
    assert(source);
    const shot = await e.call("screenshot", {
      source,
      output: path.join(dir, "screen.png"),
    });
    assert((await fs.stat(shot.path)).size > 1000);
    const output = path.join(dir, "record.mp4");
    await e.call("start", {
      source,
      output,
      fps: 30,
      codec: "h264",
      quality: "balanced",
      audio: "system",
      cursor: true,
    });
    await wait(3000);
    await e.call("pause");
    await wait(1500);
    await e.call("resume");
    await wait(3000);
    await e.call("stop");
    const info = await e.call("probe", { path: output });
    console.log("record info", info);
    assert(info.duration >= 5 && info.duration <= 7.5);
    const estimate = await e.call("estimate", {
      input: output,
      codec: "h264",
      quality: "small",
      tempDir: dir,
    });
    assert(estimate.estimatedSize > 0);
    console.log("estimate", estimate);
    const compressed = await e.call("compress", {
      input: output,
      output: path.join(dir, "compressed.mp4"),
      codec: "h264",
      quality: "small",
    });
    assert(compressed.size > 0);
    await assert.rejects(
      e.call("compress", {
        input: output,
        output,
        codec: "h264",
        quality: "small",
      }),
    );
    await assert.rejects(e.call("unknown"));
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify({ caps, info, estimate, compressed }, null, 2),
    );
    console.log("PASS", dir);
  } finally {
    e.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
