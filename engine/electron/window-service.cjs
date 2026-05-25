const { BrowserWindow, shell } = require("electron");
const path = require("node:path");

class WindowService {
  constructor({ appRoot, isDev, preloadPath, devServerUrl }) {
    this.appRoot = appRoot;
    this.isDev = isDev;
    this.preloadPath = preloadPath;
    this.devServerUrl = devServerUrl;
  }

  async createMainWindow() {
    const win = new BrowserWindow({
      width: 1440,
      height: 980,
      minWidth: 1120,
      minHeight: 760,
      frame: false,
      titleBarStyle: "hidden",
      backgroundColor: "#fff9e8",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await this.loadApp(win);
    return win;
  }

  async openPreviewWindow(url) {
    if (!this.isLocalPreviewUrl(url)) {
      return { ok: false, error: "Invalid preview URL." };
    }

    const previewWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: "#090d16",
      title: "Game Spark Preview",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await previewWindow.loadURL(url);
    return { ok: true };
  }

  async openEditorPanelWindow(panelId) {
    const safePanelId = ["navigator", "assistant", "preview"].includes(panelId) ? panelId : "";
    if (!safePanelId) {
      return { ok: false, error: "Invalid editor panel." };
    }

    const panelWindow = new BrowserWindow({
      width: safePanelId === "preview" ? 1280 : 980,
      height: 820,
      minWidth: 720,
      minHeight: 560,
      frame: false,
      titleBarStyle: "hidden",
      backgroundColor: "#f8f5ff",
      title: "Game Spark Editor Panel",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await this.loadApp(panelWindow, safePanelId);
    return { ok: true };
  }

  async openPreviewInBrowser(url) {
    if (!this.isLocalPreviewUrl(url)) {
      return { ok: false, error: "Invalid preview URL." };
    }

    await shell.openExternal(url);
    return { ok: true };
  }

  async loadApp(window, panelId) {
    if (this.isDev) {
      const suffix = panelId ? `/?panel=${encodeURIComponent(panelId)}` : "";
      await window.loadURL(`${this.devServerUrl}${suffix}`);
      return;
    }

    const options = panelId ? { query: { panel: panelId } } : undefined;
    await window.loadFile(path.join(this.appRoot, "dist", "index.html"), options);
  }

  isLocalPreviewUrl(url) {
    return typeof url === "string" && url.startsWith("http://127.0.0.1:");
  }
}

module.exports = { WindowService };
