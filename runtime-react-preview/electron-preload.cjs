const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gameSpark", {
  startCodexRun(request) {
    return ipcRenderer.invoke("codex:start-run", request);
  },
  getWorkspace() {
    return ipcRenderer.invoke("workspace:get");
  },
  selectWorkspace() {
    return ipcRenderer.invoke("workspace:select");
  },
  resetWorkspace() {
    return ipcRenderer.invoke("workspace:reset");
  },
  onCodexEvent(listener) {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.removeListener("codex:event", handler);
  },
  onCodexLog(listener) {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("codex:log", handler);
    return () => ipcRenderer.removeListener("codex:log", handler);
  },
});
