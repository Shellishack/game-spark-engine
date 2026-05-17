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
  listWorkspaceProjects() {
    return ipcRenderer.invoke("workspace:list-projects");
  },
  getSettings() {
    return ipcRenderer.invoke("settings:get");
  },
  updateSettings(settings) {
    return ipcRenderer.invoke("settings:update", settings);
  },
  logInteraction(interaction) {
    return ipcRenderer.invoke("interaction:log", interaction);
  },
  openPreviewWindow(url) {
    return ipcRenderer.invoke("preview:open-window", url);
  },
  openPreviewInBrowser(url) {
    return ipcRenderer.invoke("preview:open-browser", url);
  },
  startPreviewServer(projectId) {
    return ipcRenderer.invoke("preview:start-server", projectId);
  },
  rebuildPreview(projectId) {
    return ipcRenderer.invoke("preview:rebuild", projectId);
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
