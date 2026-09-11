const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1280,
    height: 720,
    frame: false,
    title: "SoftCam test pattern",
    backgroundColor: "#14233a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  w.loadFile(path.join(__dirname, "fixture.html"));
});
app.on("window-all-closed", () => app.quit());
