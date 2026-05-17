const { BrowserWindow, app, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

const isDev = !app.isPackaged;
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
let activeCodexChild = null;
const interactionLogSessions = new Map();

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

async function ensureProject(request) {
  const root = await workspaceRoot();
  const projectDir = path.join(root, request.projectId || "new-hd2d-game");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(projectDir, "runs", runId);

  await fs.mkdir(path.join(projectDir, "src"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets", "sprites"), { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets", "models"), { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "prompt.md"), request.prompt || "", "utf8");

  return { projectDir, runDir, runId };
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

ipcMain.handle("codex:start-run", startCodexRun);
ipcMain.handle("codex:stop-run", stopCodexRun);
ipcMain.handle("workspace:get", getWorkspaceInfo);
ipcMain.handle("workspace:select", selectWorkspaceFolder);
ipcMain.handle("workspace:reset", resetWorkspaceFolder);
ipcMain.handle("interaction:log", logInteraction);
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
