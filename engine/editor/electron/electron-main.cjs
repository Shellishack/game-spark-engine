const { BrowserWindow, app, dialog, ipcMain, net, protocol } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createProjectPreviewService } = require("./project-preview-service.cjs");
const { WindowService } = require("./window-service.cjs");

const isCliPreviewLaunch = Boolean(process.env.GAME_SPARK_PREVIEW_URL);
const isNpmEditorLaunch = process.env.GAME_SPARK_EDITOR_DIST === "1";
const isDev = !app.isPackaged && !isCliPreviewLaunch && !isNpmEditorLaunch;
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const windowService = new WindowService({
  appRoot,
  isDev,
  preloadPath: path.join(__dirname, "electron-preload.cjs"),
  devServerUrl: "http://127.0.0.1:5050",
  appUrl: "game-spark-app://editor/index.html",
});
const projectPreviewService = createProjectPreviewService({
  app,
  appRoot,
  workspaceRoot,
  sanitizeFilePart,
});
let activeCodexChild = null;
const interactionLogSessions = new Map();
let cliPreviewSession = null;

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
  {
    scheme: "game-spark-app",
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

function normalizeAgentEnv(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  const seen = new Map();

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const key = typeof item.key === "string" ? item.key.trim() : "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const entry = {
      id: typeof item.id === "string" && item.id.trim() ? item.id : `env-${key.toLowerCase()}`,
      key,
      value: typeof item.value === "string" ? item.value : String(item.value ?? ""),
    };
    const mapKey = key.toUpperCase();
    if (seen.has(mapKey)) {
      normalized[seen.get(mapKey)] = entry;
    } else {
      seen.set(mapKey, normalized.length);
      normalized.push(entry);
    }
  }

  return normalized;
}

function agentEnvRecord(agentEnv) {
  return Object.fromEntries(normalizeAgentEnv(agentEnv).map((item) => [item.key, item.value]));
}

function codexRuntimeEnv(settings) {
  const env = { ...process.env, ...agentEnvRecord(settings.agentEnv) };

  if (!env.FAL_API_KEY && env.FAL_KEY) {
    env.FAL_API_KEY = env.FAL_KEY;
  }
  if (!env.FAL_KEY && env.FAL_API_KEY) {
    env.FAL_KEY = env.FAL_API_KEY;
  }

  return env;
}

function injectedAgentEnvNames(settings) {
  const env = codexRuntimeEnv(settings);
  const names = new Set(normalizeAgentEnv(settings.agentEnv).map((item) => item.key));
  if (names.has("FAL_KEY") && env.FAL_API_KEY) names.add("FAL_API_KEY");
  if (names.has("FAL_API_KEY") && env.FAL_KEY) names.add("FAL_KEY");
  return Array.from(names).sort();
}

async function getAppSettings() {
  const settings = await readSettings();
  return {
    agentEnv: normalizeAgentEnv(settings.agentEnv),
  };
}

async function updateAppSettings(_event, nextSettings = {}) {
  const settings = await readSettings();
  const agentEnv = normalizeAgentEnv(nextSettings.agentEnv);
  await writeSettings({
    ...settings,
    agentEnv,
  });
  return {
    ok: true,
    agentEnv,
  };
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

function registerAppProtocol() {
  protocol.handle("game-spark-app", (request) => {
    try {
      const parsed = new URL(request.url);
      const requestPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "index.html";
      const distRoot = path.join(appRoot, "dist");
      const filePath = path.resolve(distRoot, requestPath);
      if (!filePath.startsWith(distRoot + path.sep) && filePath !== distRoot) {
        return new Response("Invalid app path.", { status: 403 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Failed to load app asset.", { status: 500 });
    }
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function buildCliPreviewSession() {
  const previewUrl = process.env.GAME_SPARK_PREVIEW_URL || argValue("--game-spark-preview-url");
  if (!previewUrl) return null;

  const projectRoot = process.env.GAME_SPARK_PREVIEW_PROJECT_ROOT || argValue("--game-spark-project-root");
  const projectId = process.env.GAME_SPARK_PREVIEW_PROJECT_ID || argValue("--game-spark-project-id") || (projectRoot ? path.basename(projectRoot) : "");
  let manifest = null;
  if (projectRoot) {
    try {
      manifest = JSON.parse(await fs.readFile(path.join(projectRoot, "manifest.json"), "utf8"));
    } catch {
      manifest = null;
    }
  }

  return {
    projectId,
    projectRoot,
    previewUrl,
    mode: "edit",
    manifest,
  };
}

function cliPreviewScenePath(scenePath) {
  if (!cliPreviewSession?.projectRoot) {
    throw new Error("No CLI preview session is active.");
  }
  const activeScenePath =
    scenePath ||
    (cliPreviewSession.manifest && typeof cliPreviewSession.manifest.editor?.activeScenePath === "string"
      ? cliPreviewSession.manifest.editor.activeScenePath
      : "assets/scenes/main.scene.json");
  const projectRoot = path.resolve(cliPreviewSession.projectRoot);
  const filePath = path.resolve(projectRoot, activeScenePath);
  if (!filePath.startsWith(projectRoot + path.sep) && filePath !== projectRoot) {
    throw new Error("Invalid scene path.");
  }
  return filePath;
}

async function readCliPreviewSceneFile(_event, scenePath) {
  try {
    const filePath = cliPreviewScenePath(scenePath);
    return { ok: true, path: filePath, scene: JSON.parse(await fs.readFile(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function updateCliPreviewSceneObject(_event, scenePath, objectId, transform = {}) {
  try {
    const filePath = cliPreviewScenePath(scenePath);
    const scene = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!Array.isArray(scene.objects)) {
      throw new Error("Scene file does not contain objects.");
    }
    let updated = false;
    scene.objects = scene.objects.map((object) => {
      if (object?.id !== objectId) return object;
      updated = true;
      return {
        ...object,
        transform: {
          ...(object.transform || {}),
          ...transform,
        },
      };
    });
    if (!updated) {
      throw new Error(`Scene object not found: ${objectId}`);
    }
    scene.updatedAt = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify(scene, null, 2), "utf8");
    return { ok: true, scene };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function ensureProject(request) {
  const root = await workspaceRoot();
  const projectId = sanitizeFilePart(request.projectId || "new-hd2d-game", "new-hd2d-game");
  const projectDir = path.join(root, projectId);
  if (request.mode === "create") {
    try {
      await fs.stat(projectDir);
      throw new Error(`Project "${request.projectTitle || projectId}" already exists. Choose a different project name.`);
    } catch (error) {
      if (error && error.code !== "ENOENT") throw error;
    }
  }
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
  const engine = request.engine === "phaser" ? "phaser" : "babylonjs";
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
      style: engine === "phaser" ? "2D" : "babylonjs",
      engine,
      createdAt: now,
      updatedAt: now,
      workspacePath: projectId,
      runtimeEntry: "src/main.js",
      babylonEntry: engine === "babylonjs" ? "src/main.js" : undefined,
      phaserEntry: engine === "phaser" ? "src/main.js" : undefined,
      editor: normalizeEditorState(),
      logicGraph: normalizeLogicGraph(null, now),
      buildPath: `${projectId}/build/index.html`,
      publishedPath: `published/${projectId}/index.html`,
      promptHistory: [promptEntry],
      runHistory: [runEntry],
      assets: [],
    };
  } else {
    manifest.id = typeof manifest.id === "string" ? manifest.id : projectId;
    manifest.title = typeof manifest.title === "string" ? manifest.title : projectTitle;
    manifest.engine = manifest.engine === "phaser" || engine === "phaser" ? "phaser" : "babylonjs";
    manifest.style = typeof manifest.style === "string" ? manifest.style : manifest.engine === "phaser" ? "2D" : "babylonjs";
    manifest.createdAt = typeof manifest.createdAt === "string" ? manifest.createdAt : now;
    manifest.updatedAt = now;
    manifest.workspacePath = typeof manifest.workspacePath === "string" ? manifest.workspacePath : projectId;
    manifest.runtimeEntry = typeof manifest.runtimeEntry === "string" ? manifest.runtimeEntry : manifest.playCanvasEntry || "src/main.js";
    manifest.babylonEntry = typeof manifest.babylonEntry === "string" ? manifest.babylonEntry : manifest.engine === "babylonjs" ? manifest.runtimeEntry : undefined;
    manifest.phaserEntry = typeof manifest.phaserEntry === "string" ? manifest.phaserEntry : manifest.engine === "phaser" ? manifest.runtimeEntry : undefined;
    manifest.editor = normalizeEditorState(manifest.editor);
    manifest.logicGraph = normalizeLogicGraph(manifest.logicGraph, now);
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

function normalizeEditorState(editor = {}) {
  const defaults = defaultEditorState();
  const record = editor && typeof editor === "object" ? editor : {};
  const savedTools = Array.isArray(record.tools) ? record.tools : [];
  return {
    applyMode: record.applyMode === "auto" ? "auto" : "preview",
    previewMode: record.previewMode === "play" ? "play" : "edit",
    playStartMode: record.playStartMode === "current" ? "current" : "fresh",
    activeScenePath: typeof record.activeScenePath === "string" ? record.activeScenePath : "assets/scenes/main.scene.json",
    activeTool: defaults.tools.some((tool) => tool.id === record.activeTool) ? record.activeTool : defaults.activeTool,
    tools: defaults.tools.map((tool) => {
      const saved = savedTools.find((item) => item && typeof item === "object" && item.id === tool.id) || {};
      return {
        ...tool,
        status: ["empty", "ready", "needs-generation"].includes(saved.status) ? saved.status : tool.status,
        summary: typeof saved.summary === "string" ? saved.summary : tool.summary,
        assetRefs: Array.isArray(saved.assetRefs) ? saved.assetRefs.filter((item) => typeof item === "string") : tool.assetRefs,
      };
    }),
  };
}

function defaultEditorState() {
  return {
    applyMode: "preview",
    previewMode: "edit",
    playStartMode: "fresh",
    activeScenePath: "assets/scenes/main.scene.json",
    activeTool: "logic",
    tools: [
      { id: "character-2d", title: "2D Character", status: "needs-generation", summary: "Chat-generated sprite sheets with emotion animation preview.", assetRefs: [] },
      { id: "character-3d", title: "3D Character", status: "empty", summary: "Chat-generated or imported Babylon.js character model preview.", assetRefs: [] },
      { id: "world", title: "World", status: "needs-generation", summary: "Scene, object placement, camera, and lighting direction.", assetRefs: [] },
      { id: "logic", title: "Logic", status: "ready", summary: "Node graph projection of code-driven gameplay logic.", assetRefs: [] },
      { id: "ui-dialogue", title: "UI & Dialogue", status: "ready", summary: "Dialogue tree, HUD, menus, prompts, and choice flow.", assetRefs: [] },
      { id: "audio", title: "Audio", status: "empty", summary: "Sound plan, music, ambience, event bindings, and volume groups.", assetRefs: [] },
      { id: "publish", title: "Publish", status: "ready", summary: "Validation, local build, export, and preview readiness.", assetRefs: [] },
    ],
  };
}

function normalizeLogicGraph(graph = {}, updatedAt = new Date().toISOString()) {
  const record = graph && typeof graph === "object" ? graph : {};
  const defaults = defaultLogicGraph(updatedAt);
  return {
    source: record.source === "ai-proposed" ? "ai-proposed" : "code-derived",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : updatedAt,
    nodes: Array.isArray(record.nodes) && record.nodes.length ? record.nodes : defaults.nodes,
    edges: Array.isArray(record.edges) && record.edges.length ? record.edges : defaults.edges,
  };
}

function defaultLogicGraph(updatedAt) {
  return {
    source: "code-derived",
    updatedAt,
    nodes: [
      { id: "node-start", kind: "trigger", title: "Start game", summary: "Initialize scene and player state.", codeRefs: ["src/main.js"], x: 40, y: 80 },
      { id: "node-choice", kind: "dialogue", title: "Story choice", summary: "Present player decisions.", codeRefs: ["src/main.js"], x: 260, y: 40 },
      { id: "node-state", kind: "state", title: "Update state", summary: "Track gameplay flags.", codeRefs: ["src/main.js"], x: 260, y: 180 },
      { id: "node-ending", kind: "ending", title: "Resolve ending", summary: "Branch to a final result.", codeRefs: ["src/main.js"], x: 500, y: 110 },
    ],
    edges: [
      { id: "edge-start-choice", from: "node-start", to: "node-choice", label: "opens" },
      { id: "edge-choice-state", from: "node-choice", to: "node-state", label: "sets" },
      { id: "edge-state-ending", from: "node-state", to: "node-ending", label: "resolves" },
    ],
  };
}

async function readGameSparkSkill() {
  const skillRoot = path.join(repoRoot, "skills", "game-spark-agent");
  const imageBlasterRoot = path.join(repoRoot, "skills", "image-blaster");
  const files = [
    path.join(skillRoot, "SKILL.md"),
    path.join(skillRoot, "references", "asset-generation.md"),
    path.join(skillRoot, "references", "design-rules.md"),
    path.join(skillRoot, "references", "game-quality-bar.md"),
    path.join(skillRoot, "references", "cli-tools.md"),
    path.join(skillRoot, "references", "scene-schema.md"),
    path.join(skillRoot, "references", "edit-play-contract.md"),
    path.join(skillRoot, "references", "lantern-grove5-postmortem.md"),
    path.join(skillRoot, "references", "project-contract.md"),
    path.join(skillRoot, "scripts", "README.md"),
    path.join(skillRoot, "scripts", "sprite-character-4x3.js"),
    path.join(skillRoot, "scripts", "generated-3d-object.js"),
    path.join(skillRoot, "scripts", "world-labs-environment.js"),
    path.join(skillRoot, "scripts", "validate-generated-game.mjs"),
    path.join(imageBlasterRoot, "SKILL.md"),
    path.join(imageBlasterRoot, "references", "image-blast-project.md"),
    path.join(imageBlasterRoot, "references", "image-blast-world.md"),
    path.join(imageBlasterRoot, "references", "image-blast-3d.md"),
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
  const engine = request.engine === "phaser" ? "phaser" : "babylonjs";
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
    "The game workflow creates or updates a local web game project in this workspace. The selected engine is authoritative.",
    "Supported engines are Babylon.js and Phaser only. Do not target PlayCanvas.",
    "Use Babylon.js for all HD2D and 3D games. For 2D games, use ENGINE, which may be phaser or babylonjs.",
    "Do not start Python, python -m http.server, or any ad hoc preview server. Electron owns preview serving with its Node HTTP bridge.",
    "When ENGINE is babylonjs, use OpenAI Image 2 for 2D sprite sheets and neilsonnn/image-blaster for 3D world assets when relevant.",
    "When ENGINE is phaser, build a Phaser 2D game with Phaser.Game config, Phaser.Scene classes, asset preloading, input, camera, physics or arcade systems as appropriate, and 2D UI. Do not run image-blaster for pure Phaser 2D games unless the user explicitly asks for 3D generated assets.",
    "Generated src/main.js must be directly browser-runnable from build/index.html. Do not use bare npm imports in generated game source. Use the global Phaser object for Phaser projects and the global BABYLON object for Babylon.js projects.",
    "For Babylon.js 3D/HD2D generation, before running image-blaster, use OpenAI Image 2 to generate a clean background/environment reference image from the user's prompt, save it under assets/scenes or assets/textures, and pass that image to image-blaster as its required reference input. The reference image must not include the final character sprite, dialogue UI, buttons, HUD, captions, logos, or UI text.",
    "When using the workflow, write manifest.json, src/main.js, assets, build output, and runs metadata.",
    "Maintain manifest.editor with applyMode, activeTool, and tool summaries for character-2d, character-3d, world, logic, ui-dialogue, audio, and publish.",
    "Maintain manifest.editor.previewMode, playStartMode, and activeScenePath. Default activeScenePath is assets/scenes/main.scene.json.",
    "Maintain manifest.logicGraph as a visual projection of canonical source code. Code is authoritative; graph edits are structured requests that must result in code changes plus refreshed graph metadata.",
    "Scene layout and object transforms are authored in assets/scenes/main.scene.json. Generated game code must load this scene JSON so edits made in Edit mode are reflected when the user starts Play mode.",
    "If applyMode is preview, describe proposed file and asset changes before applying them. If applyMode is auto, apply the change, validate, and report what changed.",
    "Generated assets must be visibly used in the playable runtime. Do not satisfy asset generation by writing files and manifest entries only.",
    "When ENGINE is babylonjs, load image-blaster generated scene/model assets into a Babylon.js Engine and Scene, then overlay the 2D character and bottom dialogue UI on top of that scene.",
    "For Babylon.js 3D scene viewers, load imported or generated 3D assets, including Gaussian splats, as environment/world models in the Babylon scene. In edit mode, support default viewer controls: hold right mouse plus WASD to move the camera, mouse wheel to zoom, and hold mouse wheel to pan.",
    "When ENGINE is phaser, load sprites, tilemaps, images, audio, and UI directly into Phaser scenes and keep the build browser-playable from build/index.html.",
    "Generated sprite sheets must be loaded by the overlay/runtime layer and animated from the 4x3 sheet layout.",
    "Generated 3D model or scene assets from image-blaster must be saved under assets/models or assets/scenes and loaded/instantiated through Babylon.js. If image-blaster is unavailable, record the gap and do not claim generated 3D assets exist.",
    "Validation must fail or record not-ready status when generated assets are manifest-only or not visible in the game.",
    "",
    `WORKFLOW_ALLOWED: ${shouldRunWorkflow ? "true" : "false"}`,
    `ENGINE: ${engine}`,
    `Mode: ${request.mode}`,
    `User prompt:\n${request.prompt}`,
    "",
    "Sprite sheet rule when workflow is used: one 1024x1024 PNG for each required emotion; emotions are idle, surprised, happy, sad, laugh; filename [character]_[emotion].png; 4 columns x 3 rows, 12 frames. Treat user spelling such as idel as idle.",
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
  const settings = await readSettings();
  const codexEnv = codexRuntimeEnv(settings);
  const envNames = injectedAgentEnvNames(settings);
  await fs.writeFile(
    path.join(runDir, "agent-env.md"),
    [
      "# Agent Environment",
      "",
      "These environment variable names were injected into the Codex runtime. Secret values are intentionally omitted.",
      "",
      ...(envNames.length ? envNames.map((name) => `- ${name}`) : ["- No saved agent environment variables configured."]),
      "",
    ].join("\n"),
    "utf8",
  );

  const child = spawn(process.env.GAME_SPARK_CODEX_BIN || "codex", args, {
    cwd: projectDir,
    env: codexEnv,
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

ipcMain.handle("codex:start-run", startCodexRun);
ipcMain.handle("codex:stop-run", stopCodexRun);
ipcMain.handle("workspace:get", getWorkspaceInfo);
ipcMain.handle("workspace:select", selectWorkspaceFolder);
ipcMain.handle("workspace:reset", resetWorkspaceFolder);
ipcMain.handle("workspace:list-projects", listWorkspaceProjects);
ipcMain.handle("settings:get", getAppSettings);
ipcMain.handle("settings:update", updateAppSettings);
ipcMain.handle("interaction:log", logInteraction);
ipcMain.handle("preview:start-server", projectPreviewService.startPreviewServer);
ipcMain.handle("preview:rebuild", projectPreviewService.rebuildProjectPreview);
ipcMain.handle("scene:read", projectPreviewService.readSceneFile);
ipcMain.handle("scene:update-object", projectPreviewService.updateSceneObject);
ipcMain.handle("preview:open-window", (_event, url) => windowService.openPreviewWindow(url));
ipcMain.handle("preview:open-browser", (_event, url) => windowService.openPreviewInBrowser(url));
ipcMain.handle("editor:open-panel-window", (_event, panelId) => windowService.openEditorPanelWindow(panelId));
ipcMain.handle("cli-preview:get-session", () => cliPreviewSession);
ipcMain.handle("cli-preview:scene-read", readCliPreviewSceneFile);
ipcMain.handle("cli-preview:scene-update-object", updateCliPreviewSceneObject);
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

app.whenReady().then(async () => {
  registerProjectProtocol();
  registerAppProtocol();
  cliPreviewSession = await buildCliPreviewSession();
  if (cliPreviewSession?.previewUrl) {
    return windowService.openEditorPanelWindow("preview", { notifyPreviewClosed: true });
  }
  return windowService.createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowService.createMainWindow();
  }
});
