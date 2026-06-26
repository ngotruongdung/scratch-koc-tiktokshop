const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  launchBrowser: (options) => ipcRenderer.send("launch-browser", options),
  startScraping: (options) => ipcRenderer.send("start-scraping", options),
  stopScraping: () => ipcRenderer.send("stop-scraping"),
  openOutputFolder: () => ipcRenderer.send("open-output-folder"),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  installUpdate: () => ipcRenderer.send("install-update"),
  
  onLog: (callback) => ipcRenderer.on("log", (event, data) => callback(data)),
  onStats: (callback) => ipcRenderer.on("stats", (event, data) => callback(data)),
  onStateChange: (callback) => ipcRenderer.on("state-change", (event, data) => callback(data)),
  onUpdateState: (callback) => ipcRenderer.on("update-state", (event, data) => callback(data)),
});
