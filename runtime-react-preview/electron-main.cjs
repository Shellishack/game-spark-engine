const { BrowserWindow, app, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = !app.isPackaged;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");

function defaultWorkspaceRoot() {
  return path.join(app.getPath("home"), "Game Spark AI");
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeSettings(settings) {
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

async function workspaceRoot() {
  const settings = await readSettings();
  const root = settings.workspaceRoot || defaultWorkspaceRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

async function getWorkspaceInfo() {
  return {
    path: await workspaceRoot(),
    defaultPath: defaultWorkspaceRoot(),
  };
}

async function selectWorkspaceFolder() {
  const result = await dialog.showOpenDialog({
    title: "Choose Game Spark AI workspace",
    defaultPath: await workspaceRoot(),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return getWorkspaceInfo();
  }

  await writeSettings({
    ...(await readSettings()),
    workspaceRoot: result.filePaths[0],
  });

  await fs.mkdir(result.filePaths[0], { recursive: true });
  return getWorkspaceInfo();
}

async function resetWorkspaceFolder() {
  const settings = await readSettings();
  delete settings.workspaceRoot;
  await writeSettings(settings);
  return getWorkspaceInfo();
}

async function ensureProject(request) {
  const root = await workspaceRoot();
  const projectDir = path.join(root, "projects", request.projectId || "new-hd2d-game");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(projectDir, "runs", runId);

  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets", "sprites"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets", "models"), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "prompt.md"), request.prompt || "", "utf8");

  return { projectDir, runDir, runId };
}

function createCodexPrompt(request) {
  return [
    "You are the Codex backend for Game Spark AI.",
    "Generate a local PlayCanvas HD2D web game project in this workspace.",
    "Use Codex Image 2 for 2D sprite sheets and neilsonnn/image-blaster for 3D world assets.",
    "Write manifest.json, src/main.js, assets, build output, and runs metadata.",
    "",
    `Mode: ${request.mode}`,
    `User prompt:\n${request.prompt}`,
    "",
    "Sprite sheet rule: one 1024x1024 PNG per character emotion; emotions are idle, walk, laugh, confused, sad, angry, surprised; filename [character]_[emotion].png; 4 columns x 3 rows, 12 frames.",
  ].join("\n");
}

async function startCodexRun(event, request) {
  const { projectDir, runDir } = await ensureProject(request);
  const prompt = createCodexPrompt(request);
  await fs.writeFile(path.join(runDir, "codex-prompt.md"), prompt, "utf8");

  event.sender.send("codex:event", {
    phase: "planning",
    title: "Starting Codex",
    detail: `Workspace: ${projectDir}`,
    timestamp: new Date().toISOString(),
  });

  const child = spawn("codex", ["exec", "--cwd", projectDir, prompt], {
    cwd: projectDir,
    windowsHide: true,
    shell: process.platform === "win32",
  });

  child.stdout.on("data", (chunk) => {
    event.sender.send("codex:log", chunk.toString());
  });

  child.stderr.on("data", (chunk) => {
    event.sender.send("codex:log", chunk.toString());
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`Codex exited with code ${code}`));
        return;
      }

      const manifestPath = path.join(projectDir, "manifest.json");
      const manifestText = await fs.readFile(manifestPath, "utf8");
      resolve(JSON.parse(manifestText));
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#eceff1",
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await win.loadURL("http://127.0.0.1:5050");
  } else {
    await win.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

ipcMain.handle("codex:start-run", startCodexRun);
ipcMain.handle("workspace:get", getWorkspaceInfo);
ipcMain.handle("workspace:select", selectWorkspaceFolder);
ipcMain.handle("workspace:reset", resetWorkspaceFolder);

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
