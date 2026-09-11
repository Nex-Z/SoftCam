const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const fixture = await electron.launch({ args: ["tests/fixture.cjs"], env });
  const app = await electron.launch({ args: ["."], env });
  let original;
  try {
    const page = await app.firstWindow();
    await page.waitForSelector("h1");
    original = (await page.evaluate(() => window.softcam.call("init")))
      .settings;
    const held = await fixture.evaluate(({ globalShortcut }) =>
      globalShortcut.register("CommandOrControl+Alt+F8", () => {}),
    );
    assert(held);
    const result = await page.evaluate(
      (settings) =>
        window.softcam.call("settings", {
          ...settings,
          recordShortcut: "CommandOrControl+Alt+F8",
        }),
      original,
    );
    assert(result.conflicts.includes("CommandOrControl+Alt+F8"));
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const input = page.getByLabel("录制快捷键");
    await input.focus();
    await page.waitForTimeout(100);
    await input.press("Control+Alt+F7");
    assert((await input.inputValue()).includes("F7"));
    await page.getByRole("button", { name: "保存快捷键", exact: true }).click();
    await page.waitForTimeout(150);
    assert(
      (await page.evaluate(() => window.softcam.call("init"))).settings
        .recordShortcut === "CommandOrControl+Alt+F7",
    );
    console.log("SHORTCUT PASS: conflict reported and key capture saved");
  } finally {
    if (original) {
      const p = await app.firstWindow();
      await p
        .evaluate(
          (settings) => window.softcam.call("settings", settings),
          original,
        )
        .catch(() => {});
    }
    await app.evaluate(({ app }) => app.quit());
    await app.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
