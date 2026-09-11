const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "recordingStatus",
  "captureOpen",
  "captureInit",
  "captureReady",
  "captureCancel",
  "captureConfirm",
  "init",
  "sources",
  "settings",
  "shortcutEditing",
  "chooseDirectory",
  "record",
  "pause",
  "resume",
  "stop",
  "screenshot",
  "saveScreenshot",
  "copyScreenshot",
  "selectRegion",
  "regionDone",
  "chooseVideo",
  "probe",
  "estimate",
  "compress",
  "cancel",
  "open",
  "reveal",
  "recover",
  "minimize",
  "close",
];
contextBridge.exposeInMainWorld("softcam", {
  call: (method, params) => {
    if (!methods.includes(method)) return Promise.reject(new Error("未知操作"));
    return ipcRenderer.invoke("softcam:call", method, params);
  },
  on: (handler) => {
    const listener = (_, message) => handler(message);
    ipcRenderer.on("softcam:event", listener);
    return () => ipcRenderer.removeListener("softcam:event", listener);
  },
});
