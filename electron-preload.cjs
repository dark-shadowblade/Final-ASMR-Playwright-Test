const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("appAPI", {
  start: () => ipcRenderer.invoke("start-runner"),
  openConfig: () => ipcRenderer.invoke("open-config"),
  onEvent: callback => ipcRenderer.on("runner-event", (_event, data) => callback(data))
});
