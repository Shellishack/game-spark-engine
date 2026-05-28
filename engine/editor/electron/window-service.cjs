const { BrowserWindow, shell } = require("electron");
const path = require("node:path");

class WindowService {
  constructor({ appRoot, isDev, preloadPath, devServerUrl, appUrl }) {
    this.appRoot = appRoot;
    this.isDev = isDev;
    this.preloadPath = preloadPath;
    this.devServerUrl = devServerUrl;
    this.appUrl = appUrl;
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

    this.attachDiagnostics(win);
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

    this.attachDiagnostics(previewWindow);
    previewWindow.on("closed", () => {
      if (process.send) {
        process.send({ type: "game-spark-preview-window-closed" });
      }
    });

    await previewWindow.loadURL(url);
    return { ok: true };
  }

  async openEditorPanelWindow(panelId, options = {}) {
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

    this.attachDiagnostics(panelWindow);
    if (options.notifyPreviewClosed) {
      panelWindow.on("closed", () => {
        if (process.send) {
          process.send({ type: "game-spark-preview-window-closed" });
        }
      });
    }

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

    const suffix = panelId ? `?panel=${encodeURIComponent(panelId)}` : "";
    await window.loadURL(`${this.appUrl}${suffix}`);
  }

  attachDiagnostics(window) {
    window.webContents.on("did-finish-load", async () => {
      if (process.env.GAME_SPARK_DEBUG_WINDOW !== "1") return;
      try {
        const info = await window.webContents.executeJavaScript(
          "({ url: location.href, rootTextLength: document.getElementById('root')?.innerText?.length ?? 0, bodyText: document.body.innerText.slice(0, 200) })",
        );
        process.stderr.write(`[Game Spark loaded] ${JSON.stringify(info)}\n`);
      } catch (error) {
        process.stderr.write(`[Game Spark diagnostics failed] ${error instanceof Error ? error.message : String(error)}\n`);
      }
    });
    window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
      if (level < 2) return;
      process.stderr.write(`[Game Spark renderer] ${message} (${sourceId}:${line})\n`);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      process.stderr.write(`[Game Spark renderer gone] ${details.reason}\n`);
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      process.stderr.write(`[Game Spark load failed] ${errorCode} ${errorDescription} ${validatedUrl}\n`);
    });
  }

  isLocalPreviewUrl(url) {
    return typeof url === "string" && url.startsWith("http://127.0.0.1:");
  }
}

module.exports = { WindowService };
