const { _electron: electron } = require("playwright");
const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  const exe = path.resolve(process.argv[2]||"release/SoftCam-win32-x64/SoftCam.exe");
  const env = {
    ...process.env,
    PATH: path.join(process.env.SystemRoot, "System32"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SOFTCAM_ENGINE;
  delete env.SOFTCAM_FFMPEG;
  delete env.SOFTCAM_FFPROBE;
  const app = await electron.launch({
    executablePath: exe,
    args: [],
    cwd: path.dirname(exe),
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("h1");
    const init = await page.evaluate(() => window.softcam.call("init"));
    assert(!init.capabilities.error);
    assert(init.capabilities.encoders.length);
    await page.evaluate(() => window.softcam.call('captureOpen',{action:'screenshot'}));
    await page.waitForTimeout(800);
    const overlays=app.windows().filter(p=>p.url().endsWith('#capture'));
    assert(overlays.length > 0);
    for(const overlay of overlays) await overlay.waitForSelector('.frozen-desktop');
    await overlays[0].evaluate(()=>window.softcam.call('captureCancel')).catch(e=>{if(!overlays[0].isClosed())throw e;});
    const s = await page.evaluate(() => window.softcam.call("sources"));
    const source = {
      ...s.monitors[0],
      crop: { x: 0, y: 0, width: 640, height: 360 },
    };
    await page.evaluate(
      (source) =>
        window.softcam.call("record", {
          source,
          audio: "none",
          microphone: null,
        }),
      source,
    );
    await page.waitForTimeout(2200);
    const stop = await page.evaluate(() => window.softcam.call("stop"));
    const info = await page.evaluate(
      (path) => window.softcam.call("probe", { path }),
      stop.path,
    );
    assert(info.width === 640 && info.height === 360);
    assert(info.duration >= 1.8);
    await fs.mkdir("artifacts/portable", { recursive: true });
    await fs.writeFile(
      "artifacts/portable/result.json",
      JSON.stringify({ init, info, restrictedPath: env.PATH }, null, 2),
    );
    console.log("PORTABLE PASS", info.duration);
  } finally {
    await app.evaluate(({ app }) => app.quit());
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
