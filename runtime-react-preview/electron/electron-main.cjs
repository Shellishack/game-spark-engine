const { BrowserWindow, app, dialog, ipcMain, protocol, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const isDev = !app.isPackaged;
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
let activeCodexChild = null;
const interactionLogSessions = new Map();
const previewServers = new Map();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "game-spark",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

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

function sanitizeFilePart(value, fallback) {
  const safe = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function interactionLogPath(interaction = {}) {
  const payload = interaction.payload && typeof interaction.payload === "object" ? interaction.payload : {};
  const projectName = payload.projectTitle || payload.projectName || payload.projectId || "app";
  const projectKey = sanitizeFilePart(projectName, "app");

  if (!interactionLogSessions.has(projectKey)) {
    interactionLogSessions.set(projectKey, {
      createdAt: new Date().toISOString(),
      path: path.join(app.getPath("userData"), "logs", `log_${projectKey}_${timestampForFile()}.json`),
      project: projectName,
    });
  }

  return interactionLogSessions.get(projectKey);
}

async function logInteraction(_event, interaction = {}) {
  const payload = interaction.payload && typeof interaction.payload === "object" ? interaction.payload : {};
  const session = await interactionLogPath(interaction);
  const entry = {
    id: `interaction-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    type: typeof interaction.type === "string" ? interaction.type : "unknown",
    payload,
  };
  let history = {
    schemaVersion: 1,
    app: "Game Spark AI",
    project: session.project,
    createdAt: session.createdAt,
    dataRoot: app.getPath("userData"),
    settingsPath: settingsPath(),
    interactions: [],
  };

  try {
    history = JSON.parse(await fs.readFile(session.path, "utf8"));
    if (!Array.isArray(history.interactions)) {
      history.interactions = [];
    }
  } catch {
    /* A new log file starts with an empty interaction history. */
  }

  history.interactions.push(entry);
  await fs.mkdir(path.dirname(session.path), { recursive: true });
  await fs.writeFile(session.path, JSON.stringify(history, null, 2), "utf8");
  return { ok: true, path: session.path, entry };
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

async function startPreviewServer(_event, projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return { ok: false, error: "Missing project id." };
  }

  const safeProjectId = sanitizeFilePart(projectId, "");
  if (!safeProjectId || safeProjectId !== projectId) {
    return { ok: false, error: "Invalid project id." };
  }

  const root = await workspaceRoot();
  const projectRoot = path.resolve(root, safeProjectId);
  const indexPath = path.join(projectRoot, "build", "index.html");
  if (!(await fileExists(indexPath))) {
    return { ok: false, error: "Playable preview is not ready." };
  }

  const existing = previewServers.get(safeProjectId);
  if (existing) {
    return { ok: true, url: existing.url, port: existing.port };
  }

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const rawPath = decodeURIComponent(requestUrl.pathname === "/" ? "/build/index.html" : requestUrl.pathname);
    const filePath = path.resolve(projectRoot, rawPath.replace(/^\/+/, ""));

    if (!filePath.startsWith(projectRoot + path.sep) && filePath !== projectRoot) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    fssync.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
      fssync.createReadStream(filePath).pipe(response);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const url = `http://127.0.0.1:${port}/build/index.html`;
  previewServers.set(safeProjectId, { server, url, port });
  return { ok: true, url, port };
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  return "application/octet-stream";
}

function registerProjectProtocol() {
  protocol.registerFileProtocol("game-spark", (request, callback) => {
    const parsed = new URL(request.url);
    const projectId = decodeURIComponent(parsed.hostname);
    const requestPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "build/index.html";

    workspaceRoot()
      .then((root) => {
        const projectRoot = path.resolve(root, projectId);
        const filePath = path.resolve(projectRoot, requestPath);
        if (!filePath.startsWith(projectRoot + path.sep) && filePath !== projectRoot) {
          callback({ error: -10 });
          return;
        }
        callback({ path: filePath });
      })
      .catch(() => callback({ error: -2 }));
  });
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
  interactionLogSessions.clear();
  return getWorkspaceInfo();
}

async function resetWorkspaceFolder() {
  const settings = await readSettings();
  delete settings.workspaceRoot;
  await writeSettings(settings);
  interactionLogSessions.clear();
  return getWorkspaceInfo();
}

async function listWorkspaceProjects() {
  const root = await workspaceRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(root, entry.name);
    const manifestPath = path.join(projectDir, "manifest.json");

    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const updatedAt = typeof manifest.updatedAt === "string" ? manifest.updatedAt : new Date().toISOString();
      const latestRun = Array.isArray(manifest.runHistory) ? manifest.runHistory[0] : null;
      const status = typeof latestRun?.status === "string" ? latestRun.status : "ready";
      const rawBuildPath = typeof manifest.buildPath === "string" ? manifest.buildPath : "build/index.html";
      const projectPrefix = `${entry.name}${path.sep}`;
      const normalizedBuildPath = rawBuildPath.replace(/[\\/]+/g, path.sep);
      const relativeBuildPath = normalizedBuildPath.startsWith(projectPrefix) ? normalizedBuildPath.slice(projectPrefix.length) : normalizedBuildPath;
      const hasBuild = await fileExists(path.join(projectDir, relativeBuildPath));
      const description =
        typeof latestRun?.summary === "string"
          ? latestRun.summary
          : Array.isArray(manifest.promptHistory) && manifest.promptHistory[0]
            ? String(manifest.promptHistory[0].content || manifest.promptHistory[0].prompt || "Local game project.")
            : "Local game project.";

      projects.push({
        id: typeof manifest.id === "string" ? manifest.id : entry.name,
        title: typeof manifest.title === "string" ? manifest.title : entry.name,
        description,
        updatedAt,
        status,
        color: colorFromProject(entry.name),
        path: projectDir,
        hasBuild,
        manifest,
      });
    } catch {
      /* Non-project folders are ignored. */
    }
  }

  return projects.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function colorFromProject(value) {
  const colors = ["#3a6f68", "#8f6d40", "#596b9a", "#9b5f6e", "#5f7f45", "#7c5d9b"];
  let hash = 0;
  for (const char of String(value)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return colors[hash % colors.length];
}

async function ensureProject(request) {
  const root = await workspaceRoot();
  const projectDir = path.join(root, request.projectId || "new-hd2d-game");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(projectDir, "runs", runId);
  const now = new Date().toISOString();

  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets", "sprites"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets", "models"), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "prompt.md"), request.prompt || "", "utf8");
  await upsertInitialManifest(projectDir, request, runId, now);

  return { projectDir, runDir, runId };
}

async function upsertInitialManifest(projectDir, request, runId, now) {
  const manifestPath = path.join(projectDir, "manifest.json");
  let manifest = null;

  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    manifest = null;
  }

  const projectId = request.projectId || path.basename(projectDir);
  const projectTitle = request.projectTitle || titleFromProjectId(projectId);
  const promptEntry = {
    id: `prompt-${runId}`,
    content: request.prompt || "",
    createdAt: now,
  };
  const runEntry = {
    id: `run-${runId}`,
    createdAt: now,
    status: request.workflowIntent === "game_update" ? "planning" : "idle",
    summary: request.workflowIntent === "game_update" ? "Game generation started." : "Conversation started.",
  };

  if (!manifest || typeof manifest !== "object") {
    manifest = {
      id: projectId,
      title: projectTitle,
      style: "HD2D",
      createdAt: now,
      updatedAt: now,
      workspacePath: projectId,
      playCanvasEntry: "src/main.js",
      buildPath: `${projectId}/build/index.html`,
      publishedPath: `published/${projectId}/index.html`,
      promptHistory: [promptEntry],
      runHistory: [runEntry],
      assets: [],
    };
  } else {
    manifest.id = typeof manifest.id === "string" ? manifest.id : projectId;
    manifest.title = typeof manifest.title === "string" ? manifest.title : projectTitle;
    manifest.style = typeof manifest.style === "string" ? manifest.style : "HD2D";
    manifest.createdAt = typeof manifest.createdAt === "string" ? manifest.createdAt : now;
    manifest.updatedAt = now;
    manifest.workspacePath = typeof manifest.workspacePath === "string" ? manifest.workspacePath : projectId;
    manifest.playCanvasEntry = typeof manifest.playCanvasEntry === "string" ? manifest.playCanvasEntry : "src/main.js";
    manifest.buildPath = typeof manifest.buildPath === "string" ? manifest.buildPath : `${projectId}/build/index.html`;
    manifest.publishedPath = typeof manifest.publishedPath === "string" ? manifest.publishedPath : `published/${projectId}/index.html`;
    manifest.promptHistory = Array.isArray(manifest.promptHistory) ? manifest.promptHistory : [];
    manifest.runHistory = Array.isArray(manifest.runHistory) ? manifest.runHistory : [];
    manifest.assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    manifest.promptHistory.push(promptEntry);
    manifest.runHistory.unshift(runEntry);
  }

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function titleFromProjectId(projectId) {
  return String(projectId)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "New Game";
}

async function readGameSparkSkill() {
  const skillRoot = path.join(repoRoot, "skills", "game-spark-agent");
  const files = [
    path.join(skillRoot, "SKILL.md"),
    path.join(skillRoot, "references", "design-rules.md"),
    path.join(skillRoot, "references", "project-contract.md"),
  ];

  const parts = [];
  for (const file of files) {
    try {
      parts.push(`--- ${path.relative(repoRoot, file)} ---\n${await fs.readFile(file, "utf8")}`);
    } catch {
      /* Skill files are optional in packaged builds until bundled. */
    }
  }
  return parts.join("\n\n");
}

async function createCodexPrompt(request) {
  const shouldRunWorkflow = request.workflowIntent === "game_update";
  const skillText = await readGameSparkSkill();
  return [
    "You are the Codex backend for Game Spark AI.",
    "Use the Game Spark Agent skill below as the source of truth for the core agentic loop.",
    "",
    skillText || "Game Spark Agent skill files were not found; follow the embedded fallback instructions.",
    "",
    "Fallback instructions:",
    "You are primarily a conversational game creation assistant.",
    "Do not modify files or run game-generation workflows unless WORKFLOW_ALLOWED is true.",
    "If WORKFLOW_ALLOWED is false, answer the user conversationally only. Do not write files. Do not create assets. Do not run shell commands. Do not build the game.",
    "If WORKFLOW_ALLOWED is true, you may use the game generation/update workflow as a tool to satisfy the user's request.",
    "The game workflow creates or updates a local PlayCanvas HD2D web game project in this workspace.",
    "When using the workflow, use Codex Image 2 for 2D sprite sheets and neilsonnn/image-blaster for 3D world assets.",
    "When using the workflow, write manifest.json, src/main.js, assets, build output, and runs metadata.",
    "",
    `WORKFLOW_ALLOWED: ${shouldRunWorkflow ? "true" : "false"}`,
    `Mode: ${request.mode}`,
    `User prompt:\n${request.prompt}`,
    "",
    "Sprite sheet rule when workflow is used: one 1024x1024 PNG per character emotion; emotions are idle, walk, laugh, confused, sad, angry, surprised; filename [character]_[emotion].png; 4 columns x 3 rows, 12 frames.",
  ].join("\n");
}

async function startCodexRun(event, request) {
  const { projectDir, runDir } = await ensureProject(request);
  const prompt = await createCodexPrompt(request);
  await fs.writeFile(path.join(runDir, "codex-prompt.md"), prompt, "utf8");

  emitAgentEvent(event.sender, {
    phase: request.workflowIntent === "game_update" ? "planning" : "idle",
    title: request.workflowIntent === "game_update" ? "Starting game workflow" : "Starting chat",
    detail:
      request.workflowIntent === "game_update"
        ? `Workspace: ${projectDir}`
        : "Codex will answer conversationally unless it decides the user explicitly requested a game update.",
  });

  const args = ["exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox", "-"];
  const model = process.env.GAME_SPARK_CODEX_MODEL;
  if (model) {
    args.splice(args.length - 1, 0, "--model", model);
  }

  const child = spawn(process.env.GAME_SPARK_CODEX_BIN || "codex", args, {
    cwd: projectDir,
    env: { ...process.env },
    windowsHide: true,
    shell: process.platform === "win32",
  });
  activeCodexChild = child;

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdin.write(prompt);
  child.stdin.end();

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    let newlineIndex;
    while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) handleCodexJsonLine(event.sender, line);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    event.sender.send("codex:log", chunk.toString());
  });

  child.on("error", (error) => {
    if (activeCodexChild === child) activeCodexChild = null;
    emitAgentEvent(event.sender, {
      phase: "error",
      title: "Codex failed to start",
      detail: error.message,
    });
  });

  child.on("close", async (code) => {
    if (activeCodexChild === child) activeCodexChild = null;
    const tail = stdoutBuffer.trim();
    if (tail) handleCodexJsonLine(event.sender, tail);

    if (code !== 0) {
      emitAgentEvent(event.sender, {
        phase: "error",
        title: `Codex exited with code ${code}`,
        detail: stderrBuffer.trim() || `Command: codex ${args.join(" ")}`,
      });
      return;
    }

    try {
      const manifestPath = path.join(projectDir, "manifest.json");
      const manifestText = await fs.readFile(manifestPath, "utf8");
      event.sender.send("codex:manifest", JSON.parse(manifestText));
    } catch {
      /* A successful Codex run may still be planning-only during early MVP work. */
    }

    emitAgentEvent(event.sender, {
      phase: "ready",
      title: "Codex finished",
      detail: "The run completed. Reloaded the project manifest if Codex wrote one.",
    });
  });

  return { ok: true, projectDir, runDir, pid: child.pid };
}

function stopCodexRun(event) {
  if (!activeCodexChild) {
    return { ok: true, stopped: false };
  }

  try {
    activeCodexChild.kill();
    activeCodexChild = null;
    emitAgentEvent(event.sender, {
      phase: "idle",
      title: "Codex stopped",
      detail: "The active Codex run was interrupted.",
    });
    return { ok: true, stopped: true };
  } catch (error) {
    emitAgentEvent(event.sender, {
      phase: "error",
      title: "Failed to stop Codex",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function emitAgentEvent(sender, event) {
  sender.send("codex:event", {
    id: `${event.phase}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    ...event,
  });
}

function handleCodexJsonLine(sender, line) {
  try {
    const parsed = JSON.parse(line);
    handleCodexEvent(sender, parsed);
  } catch {
    sender.send("codex:log", line);
  }
}

function handleCodexEvent(sender, event) {
  const method = event && typeof event === "object" ? event.method : undefined;
  const params = event && typeof event === "object" ? event.params : undefined;
  const type = event && typeof event === "object" ? event.type : undefined;

  if (method === "item/agentMessage/delta") {
    const delta = params && typeof params.delta === "string" ? params.delta : "";
    if (delta) sender.send("codex:log", delta);
    return;
  }

  if (method === "item/started") {
    const item = params && params.item;
    if (item?.type === "toolCall") {
      emitAgentEvent(sender, {
        phase: phaseForTool(item.name),
        title: `Running ${item.name || "tool"}`,
        detail: "Codex is using a local tool.",
      });
    }
    return;
  }

  if (type === "item.completed") {
    const item = event.item;
    if (item?.type === "tool_call") {
      emitAgentEvent(sender, {
        phase: phaseForTool(item.name),
        title: `Completed ${item.name || "tool"}`,
        detail: "Codex completed a local tool call.",
      });
      return;
    }
    if (item?.type === "agent_message" && typeof item.text === "string" && item.text) {
      sender.send("codex:log", item.text);
      return;
    }
  }

  if (method === "turn/completed" || type === "turn.completed") {
    emitAgentEvent(sender, {
      phase: "building",
      title: "Codex turn completed",
      detail: "Checking generated project files and manifest.",
    });
    return;
  }

  sender.send("codex:log", JSON.stringify(event));
}

function phaseForTool(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("image") || value.includes("sprite")) return "generating_assets";
  if (value.includes("blaster") || value.includes("model") || value.includes("3d")) return "generating_world";
  if (value.includes("shell") || value.includes("file") || value.includes("patch")) return "writing_code";
  return "planning";
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1120,
    minHeight: 760,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#fff9e8",
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await win.loadURL("http://127.0.0.1:5050");
  } else {
    await win.loadFile(path.join(appRoot, "dist", "index.html"));
  }
}

async function openPreviewWindow(_event, url) {
  if (typeof url !== "string" || !url.startsWith("http://127.0.0.1:")) {
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

async function openPreviewInBrowser(_event, url) {
  if (typeof url !== "string" || !url.startsWith("http://127.0.0.1:")) {
    return { ok: false, error: "Invalid preview URL." };
  }

  await shell.openExternal(url);
  return { ok: true };
}

ipcMain.handle("codex:start-run", startCodexRun);
ipcMain.handle("codex:stop-run", stopCodexRun);
ipcMain.handle("workspace:get", getWorkspaceInfo);
ipcMain.handle("workspace:select", selectWorkspaceFolder);
ipcMain.handle("workspace:reset", resetWorkspaceFolder);
ipcMain.handle("workspace:list-projects", listWorkspaceProjects);
ipcMain.handle("interaction:log", logInteraction);
ipcMain.handle("preview:start-server", startPreviewServer);
ipcMain.handle("preview:open-window", openPreviewWindow);
ipcMain.handle("preview:open-browser", openPreviewInBrowser);
ipcMain.handle("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle("window:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (win.isMaximized()) {
    win.unmaximize();
    return false;
  }
  win.maximize();
  return true;
});
ipcMain.handle("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());

app.whenReady().then(() => {
  registerProjectProtocol();
  return createWindow();
});

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
