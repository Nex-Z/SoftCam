const { _electron: electron } = require("playwright");
const path = require("node:path");
const fs = require("node:fs/promises");
(async () => {
  await fs.mkdir("artifacts/ui", { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (e) => console.error("PAGE ERROR", e));
    await page.waitForSelector("h1");
    await page.getByRole("button", { name: "开始捕获", exact: true }).waitFor();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "artifacts/ui/record.png" });
    for (const [label, file] of [
      ["压缩", "compression"],
      ["设置", "settings"],
    ]) {
      await page
        .getByRole("button", { name: label, exact: true })
        .first()
        .click();
      await page.screenshot({ path: `artifacts/ui/${file}.png` });
    }
    console.log("UI PASS");
  } finally {
    await app.evaluate(({ app }) => app.quit());
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
