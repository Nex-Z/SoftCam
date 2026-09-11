const { _electron: electron } = require("playwright");
const { Engine } = require("../desktop/engine.cjs");
const path = require("node:path");
const fs = require("node:fs/promises");
const { execFile } = require("node:child_process");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const seconds = Number(process.env.SOFTCAM_SOAK_SECONDS || 1800),
    dir = path.resolve("artifacts", `soak-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const fixture = await electron.launch({ args: ["tests/fixture.cjs"], env });
  const e = new Engine(
    path.resolve("engine/target/release/softcam-engine.exe"),
    {},
  );
  const ticks = [];
  let failure = null;
  const startedAt = Date.now();
  e.on("event", (m) => {
    if (
      m.event === "engineError" ||
      (m.event === "recording" && m.data.state === "error")
    )
      failure = new Error(m.data.message || "Engine failed during soak");
    if (
      m.event === "recording" &&
      m.data.state === "completed" &&
      (ticks.at(-1)?.seconds || 0) < seconds - 1
    )
      failure = new Error("Recording ended before the requested duration");
    if (m.event === "tick") ticks.push(m.data);
    if (m.event === "recording" && m.data.reason?.includes("最小化"))
      fixture
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].restore(),
        )
        .then(() => e.call("resume"))
        .catch(console.error);
    if (["warning", "recording"].includes(m.event))
      console.log(JSON.stringify(m));
  });
  try {
    await fixture.firstWindow();
    await wait(1500);
    const info = await fixture.evaluate(({ BrowserWindow }) => ({
      id: Number(
        BrowserWindow.getAllWindows()[0]
          .getNativeWindowHandle()
          .readBigUInt64LE(),
      ),
      pid: process.pid,
    }));
    const source = { kind: "window", id: info.id };
    const output = path.join(dir, "soak.mp4");
    const caps = await e.call("capabilities");
    await e.call("start", {
      source,
      output,
      fps: 30,
      codec: "h264",
      quality: "balanced",
      audio: "application",
      pid: info.pid,
      microphone: null,
      cursor: true,
    });
    const memory = [];
    for (
      let elapsed = 0;
      (ticks.at(-1)?.seconds || 0) < seconds;
      elapsed += 15
    ) {
      await wait(15000);
      if (failure) throw failure;
      if (Date.now() - startedAt > (seconds * 1.25 + 60) * 1000)
        throw new Error("Soak exceeded its wall-clock deadline");
      const mb = await new Promise((resolve) =>
        execFile(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `Get-Process -Id ${e.child.pid} | Select-Object WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
          ],
          { windowsHide: true },
          (_, out) => {
            try {
              resolve(JSON.parse(out));
            } catch {
              resolve({});
            }
          },
        ),
      );
      memory.push({ seconds: Math.min(elapsed + 15, seconds), ...mb });
      await fs.writeFile(
        path.join(dir, "progress.json"),
        JSON.stringify({ memory, lastTick: ticks.at(-1) }, null, 2),
      );
      if (elapsed % 60 === 0)
        console.log("soak", elapsed + 15, "seconds", JSON.stringify(mb));
    }
    await e.call("stop");
    const media = await e.call("probe", { path: output });
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        { caps, media, memory, firstTick: ticks[0], lastTick: ticks.at(-1) },
        null,
        2,
      ),
    );
    console.log("SOAK PASS", dir, media.duration);
  } finally {
    await e.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
