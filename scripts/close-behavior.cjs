const { _electron: electron } = require("playwright");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
(async () => {
  const config = path.resolve("data/settings.json");
  let backup;
  try {
    backup = await fs.readFile(config);
  } catch {}
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const dir = path.resolve("artifacts/close-behavior");
  await fs.mkdir(dir, { recursive: true });
  let app;
  const launch = async () => {
    app = await electron.launch({ args: ["."], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    await page.locator("h1").waitFor();
    return page;
  };
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const tree = () =>
    JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('electron.exe','softcam-engine.exe','ffmpeg.exe') } | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`,
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
  const children = () => {
    const rows = tree(),
      ids = [app.process().pid];
    for (let n = 0; n < 5; n++)
      for (const p of rows)
        if (ids.includes(p.ParentProcessId) && !ids.includes(p.ProcessId))
          ids.push(p.ProcessId);
    return ids;
  };
  const exited = async (ids) => {
    const deadline = Date.now() + 35000;
    while (ids.some(alive) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(ids.filter(alive), [], "Owned processes must all exit");
    app = null;
  };
  try {
    const original = backup ? JSON.parse(backup.toString()) : {};
    delete original.closeBehavior;
    await fs.writeFile(config, JSON.stringify(original));
    let page = await launch();
    assert.equal(
      (await page.evaluate(() => window.softcam.call("init"))).settings
        .closeBehavior,
      "quit",
    );
    let ids = children();
    await page
      .getByTitle("退出程序", { exact: true })
      .click()
      .catch((e) => {
        if (!page.isClosed()) throw e;
      });
    await exited(ids);
    page = await launch();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("关闭窗口时").selectOption("tray");
    await page.getByTitle("收起到托盘", { exact: true }).waitFor();
    assert.equal(
      JSON.parse(await fs.readFile(config, "utf8")).closeBehavior,
      "tray",
    );
    await page.getByTitle("收起到托盘", { exact: true }).click();
    assert(
      await app.evaluate(
        ({ BrowserWindow }) =>
          !BrowserWindow.getAllWindows()
            .find((w) => !w.webContents.getURL().includes("#"))
            .isVisible(),
      ),
    );
    ids = children();
    await app.evaluate(({ app }) => app.quit());
    await exited(ids);
    page = await launch();
    assert.equal(
      (await page.evaluate(() => window.softcam.call("init"))).settings
        .closeBehavior,
      "tray",
    );
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByLabel("关闭窗口时").selectOption("quit");
    await page.getByTitle("退出程序", { exact: true }).waitFor();
    await page.evaluate(async (outputDirectory) => {
      await window.softcam.call("settings", { outputDirectory });
      const s = await window.softcam.call("sources");
      await window.softcam.call("record", {
        source: {
          ...s.monitors[0],
          crop: { x: 0, y: 0, width: 640, height: 360 },
        },
        audio: "none",
        microphone: null,
      });
    }, dir);
    await page.waitForTimeout(1200);
    ids = children();
    // Native close (including Alt+F4) follows the same preference and finalizes recording.
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().includes("#"))
          .close(),
      )
      .catch(() => {});
    await exited(ids);
    assert((await fs.readdir(dir)).some((f) => f.endsWith(".mp4")));
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        {
          legacyDefaultQuit: true,
          trayHidden: true,
          persisted: true,
          nativeCloseSavesRecording: true,
          noOwnedProcessesRemain: true,
        },
        null,
        2,
      ),
    );
    console.log("CLOSE BEHAVIOR PASS");
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.quit()).catch(() => {});
      await app.close().catch(() => {});
    }
    if (backup) await fs.writeFile(config, backup);
    else await fs.rm(config, { force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
