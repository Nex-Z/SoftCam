const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { borderBounds } = require("../desktop/recording-border.cjs");

(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.argv[2] && path.resolve(process.argv[2]);
  if (exe) {
    env.PATH = path.join(process.env.SystemRoot, "System32");
    delete env.SOFTCAM_ENGINE;
    delete env.SOFTCAM_FFMPEG;
    delete env.SOFTCAM_FFPROBE;
  }
  const app = await electron.launch(
    exe
      ? { executablePath: exe, args: [], cwd: path.dirname(exe), env }
      : { args: ["."], env },
  );
  const dir = path.resolve("artifacts/recording-border");
  await fs.mkdir(dir, { recursive: true });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "开始捕获", exact: true }).waitFor();
    const sources = await page.evaluate(() => window.softcam.call("sources"));
    const monitor = sources.monitors[0];
    const crop = { x: 120, y: 180, width: 600, height: 400 };
    const status = () =>
      page.evaluate(() => window.softcam.call("recordingStatus"));
    const border = () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === "SoftCam · 录制范围",
        );
        return w
          ? {
              bounds: w.getBounds(),
              visible: w.isVisible(),
              focusable: w.isFocusable(),
              top: w.isAlwaysOnTop(),
            }
          : null;
      });
    await page.evaluate((p) => window.softcam.call("record", p), {
      source: { kind: "monitor", id: monitor.id, crop },
      displayId: monitor.displayId,
      audio: "none",
      codec: "h264",
      fps: 30,
    });
    const info = await border();
    assert(info?.visible && info.top && !info.focusable);
    assert.deepEqual(info.bounds, monitor.bounds);
    const borderPage = app
      .windows()
      .find((p) => p.url().endsWith("recording-border.html"));
    const drawn = await borderPage.evaluate(() => {
      const r = document.body.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const expected = borderBounds(
      { ...monitor, crop },
      { bounds: { ...monitor.bounds, x: 0, y: 0 } },
    );
    for (const key of Object.keys(expected))
      assert(
        Math.abs(drawn[key] - expected[key]) < 0.02,
        `${key}: ${JSON.stringify({ drawn, expected })}`,
      );
    await borderPage.screenshot({
      path: path.join(dir, "border.png"),
      omitBackground: true,
    });
    assert.equal(
      await borderPage.evaluate(
        () => getComputedStyle(document.body).borderTopColor,
      ),
      "rgb(255, 48, 48)",
    );
    await page.waitForTimeout(1800);
    assert.equal((await status()).state, "recording");
    await page.evaluate(() => window.softcam.call("pause"));
    assert((await border()).visible);
    await page.evaluate(() => window.softcam.call("resume"));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.softcam.call("stop"));
    assert.equal(await border(), null);
    await page
      .getByText("文件已保存", { exact: true })
      .waitFor({ timeout: 30000 });
    // A rejected engine start must remove the newly created overlay as well.
    await assert.rejects(
      page.evaluate((p) => window.softcam.call("record", p), {
        source: { kind: "monitor", id: monitor.id, crop },
        displayId: monitor.displayId,
        audio: "none",
        fps: 0,
      }),
    );
    assert.equal(await border(), null);
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        {
          bounds: info.bounds,
          visible: true,
          pausePreserved: true,
          stopCleared: true,
          failedStartCleared: true,
          realRecordingSaved: true,
        },
        null,
        2,
      ),
    );
    console.log("Recording border integration passed");
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
