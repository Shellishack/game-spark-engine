const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gameSpark", {
  startCodexRun(request) {
    return ipcRenderer.invoke("codex:start-run", request);
  },
  stopCodexRun() {
    return ipcRenderer.invoke("codex:stop-run");
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
  minimizeWindow() {
    return ipcRenderer.invoke("window:minimize");
  },
  toggleMaximizeWindow() {
    return ipcRenderer.invoke("window:toggle-maximize");
  },
  closeWindow() {
    return ipcRenderer.invoke("window:close");
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
  onCodexManifest(listener) {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("codex:manifest", handler);
    return () => ipcRenderer.removeListener("codex:manifest", handler);
  },
});
