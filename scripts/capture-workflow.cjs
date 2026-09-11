const { _electron: electron } = require("playwright");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  assert = require("node:assert/strict");
(async () => {
  const env = {
    ...process.env,
    SOFTCAM_ENGINE: path.resolve("engine/target/release/softcam-engine.exe"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const dir = path.resolve("artifacts/capture-workflow");
  await fs.mkdir(dir, { recursive: true });
  const fixture = await electron.launch({ args: ["tests/fixture.cjs"], env });
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => console.error("MAIN", e));
    await page.getByRole("button", { name: "开始捕获", exact: true }).waitFor();
    await page.screenshot({ path: path.join(dir, "launcher.png") });
    await page.getByRole("button", { name: "压缩", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: "选择视频", exact: true }).count(),
      1,
    );
    assert.equal(await page.locator(".page-heading button").count(), 0);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => !w.webContents.getURL().includes("#"))
        .webContents.send("softcam:event", {
          event: "warning",
          data: { message: "自动消失验证" },
        }),
    );
    await page.getByText("自动消失验证", { exact: true }).waitFor();
    await page
      .getByText("自动消失验证", { exact: true })
      .waitFor({ state: "hidden", timeout: 6500 });
    await page.getByRole("button", { name: "捕获", exact: true }).click();
    const open = async (action = "screenshot") => {
      await page.evaluate(
        (action) => window.softcam.call("captureOpen", { action }),
        action,
      );
      let overlays = app.windows().filter((p) => p.url().endsWith("#capture"));
      for (let n = 0; !overlays.length && n < 100; n++) {
        await page.waitForTimeout(100);
        overlays = app.windows().filter((p) => p.url().endsWith("#capture"));
      }
      console.log("overlays", overlays.length);
      for (const p of overlays) {
        p.setDefaultTimeout(15000);
        p.on("pageerror", (e) => console.error("OVERLAY", e));
        await p.locator(".frozen-desktop").waitFor();
        await p.waitForFunction(
          () => document.querySelector(".frozen-desktop").complete,
        );
      }
      assert(overlays.length > 0);
      return overlays;
    };
    console.log("open cancel");
    let overlays = await open();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((w) => !w.webContents.getURL().includes("#"))
          ?.isVisible(),
      ),
      false,
    );
    await overlays[0].keyboard.press("Escape").catch((e) => {
      if (!overlays[0].isClosed()) throw e;
    });
    await page.waitForTimeout(300);
    assert(!app.windows().some((p) => p.url().endsWith("#capture")));
    overlays = await open();
    console.log("cancel passed");
    const monitorCount = overlays.length;
    for (let index = 0; index < monitorCount; index++) {
      if (index > 0) overlays = await open();
      console.log("monitor", index);
      const p = overlays[index];
      await p.mouse.move(110, 210);
      await p.mouse.down();
      await p.mouse.move(610, 510, { steps: 5 });
      await p.mouse.up();
      await p.locator(".capture-selection").waitFor();
      console.log("selected");
      const expected = await p.evaluate(async () => {
        const img = document.querySelector(".frozen-desktop");
        await img.decode();
        const sx = img.naturalWidth / innerWidth,
          sy = img.naturalHeight / innerHeight;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(500 * sx);
        canvas.height = Math.round(300 * sy);
        canvas
          .getContext("2d")
          .drawImage(
            img,
            Math.round(110 * sx),
            Math.round(210 * sy),
            canvas.width,
            canvas.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
        return {
          width: canvas.width,
          height: canvas.height,
          png: canvas.toDataURL(),
        };
      });
      // Change the live desktop after freezing. Screenshot must still match frozen pixels.
      await (
        await fixture.firstWindow()
      ).evaluate(() => (document.body.style.background = "#ff0000"));
      await p.getByRole("button", { name: "完成截图", exact: true }).click();
      await page.locator(".canvas-area canvas").waitFor();
      await page.waitForTimeout(600);
      console.log("editor");
      const actual = await page
        .locator(".canvas-area canvas")
        .evaluate((c) => ({
          width: c.width,
          height: c.height,
          png: c.toDataURL(),
        }));
      assert.deepEqual(
        actual,
        expected,
        "Screenshot must use frozen pixels and physical monitor dimensions",
      );
      await page.getByRole("button", { name: "复制图片", exact: true }).click();
      await page.waitForTimeout(200);
      assert(await app.evaluate(({ clipboard }) => clipboard.has("image/png")));
      await page
        .getByRole("button", { name: "关闭编辑器", exact: true })
        .click();
    }
    console.log("record test");
    overlays = await open("record");
    const p = overlays[0];
    await p.getByRole("button", { name: "窗口", exact: true }).click();
    const opt = p.getByLabel("选择窗口");
    const value = await opt
      .locator("option")
      .evaluateAll(
        (os) => os.find((o) => o.textContent === "SoftCam test pattern")?.value,
      );
    assert(value, "Native window bounds should identify fixture");
    await opt.selectOption(value);
    await p.getByTitle("录制配置", { exact: true }).click();
    await p.getByLabel("声音", { exact: true }).selectOption("none");
    const captureInfo = await p.evaluate(() =>
      window.softcam.call("captureInit"),
    );
    const startAt = Date.now();
    await p.getByRole("button", { name: "开始录制", exact: true }).click();
    let floatInfo;
    for (let n = 0; n < 50; n++) {
      floatInfo = await app.evaluate(({ BrowserWindow, screen }, id) => {
        const w = BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().endsWith("#float"),
        );
        return {
          visible: w?.isVisible(),
          bounds: w?.getBounds(),
          workArea: screen.getAllDisplays().find((d) => d.id === id)?.workArea,
        };
      }, captureInfo.source.displayId);
      if (floatInfo.visible) break;
      await page.waitForTimeout(20);
    }
    const toolbarLatencyMs = Date.now() - startAt;
    assert(floatInfo.visible);
    assert(
      toolbarLatencyMs < 1500,
      "Toolbar should appear promptly: " + toolbarLatencyMs + "ms",
    );
    assert.equal(floatInfo.bounds.y, floatInfo.workArea.y + 16);
    assert.equal(
      floatInfo.bounds.x,
      Math.round(floatInfo.workArea.x + (floatInfo.workArea.width - 350) / 2),
    );
    console.log("Toolbar visible after", toolbarLatencyMs, "ms, top centered");

    await page.waitForTimeout(5500);
    assert(!app.windows().some((p) => p.url().endsWith("#capture")));
    const floating = app.windows().find((p) => p.url().endsWith("#float"));
    assert(floating);
    await floating.getByTitle("暂停", { exact: true }).click();
    await page.waitForTimeout(400);
    await floating.getByTitle("继续", { exact: true }).click();
    await page.waitForTimeout(1200);
    await floating.getByTitle("停止并保存", { exact: true }).click();
    await page
      .getByText("文件已保存", { exact: true })
      .waitFor({ timeout: 30000 });
    await fs.writeFile(
      path.join(dir, "result.json"),
      JSON.stringify(
        {
          toolbarLatencyMs,
          topCentered: true,
          toastAutoDismiss: true,
          singleImportButton: true,
          frozenPixelEquality: true,
          monitors: monitorCount,
          clipboard: true,
          cancel: true,
          windowRecord: true,
          pauseResume: true,
        },
        null,
        2,
      ),
    );
    console.log("Capture workflow passed", monitorCount, "monitors");
  } finally {
    await app.evaluate(({ app }) => app.quit());
    await app.close();
    await fixture.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
