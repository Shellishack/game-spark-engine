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
    const relativePath = rawPath.replace(/^\/+/, "");
    const filePath = path.resolve(projectRoot, relativePath);

    if (!filePath.startsWith(projectRoot + path.sep) && filePath !== projectRoot) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    serveProjectFile(projectRoot, filePath, relativePath, response);
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

function serveProjectFile(projectRoot, filePath, relativePath, response) {
  fssync.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      const assetFallback = resolveBuildAssetFallback(projectRoot, relativePath);
      if (assetFallback) {
        fssync.stat(assetFallback, (fallbackError, fallbackStat) => {
          if (fallbackError || !fallbackStat.isFile()) {
            response.writeHead(404);
            response.end("Not found");
            return;
          }
          response.writeHead(200, { "Content-Type": contentTypeFor(assetFallback) });
          fssync.createReadStream(assetFallback).pipe(response);
        });
        return;
      }

      if (statError || !stat.isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
    }

    response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    fssync.createReadStream(filePath).pipe(response);
  });
}

function resolveBuildAssetFallback(projectRoot, relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith("build/assets/")) return "";

  const assetRelativePath = normalized.slice("build/".length);
  const fallbackPath = path.resolve(projectRoot, assetRelativePath);
  if (!fallbackPath.startsWith(projectRoot + path.sep)) return "";
  return fallbackPath;
}

async function rebuildProjectPreview(_event, projectId) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return { ok: false, error: "Missing project id." };
  }

  const safeProjectId = sanitizeFilePart(projectId, "");
  if (!safeProjectId || safeProjectId !== projectId) {
    return { ok: false, error: "Invalid project id." };
  }

  const root = await workspaceRoot();
  const projectRoot = path.resolve(root, safeProjectId);
  const sourcePath = path.join(projectRoot, "src", "main.js");
  const sourceHtmlPath = path.join(projectRoot, "build", "index.html");

  if (!(await fileExists(sourcePath))) {
    return { ok: false, error: "Game source is missing." };
  }

  const tempRoot = path.join(app.getPath("temp"), "game-spark-ai", `rebuild-${safeProjectId}-${Date.now()}`);
  const tempBuild = path.join(tempRoot, "build");
  const finalBuild = path.join(projectRoot, "build");
  const backupBuild = path.join(projectRoot, `.build-backup-${Date.now()}`);

  try {
    await fs.mkdir(tempBuild, { recursive: true });
    const source = rewriteSourceForBuild(await fs.readFile(sourcePath, "utf8"));
    await fs.writeFile(path.join(tempBuild, "main.js"), source, "utf8");
    await copyIfExists(path.join(projectRoot, "assets"), path.join(tempBuild, "assets"));

    const html = (await fileExists(sourceHtmlPath))
      ? rewriteBuildHtml(await fs.readFile(sourceHtmlPath, "utf8"), safeProjectId)
      : defaultBuildHtml(titleFromProjectId(safeProjectId));
    await fs.writeFile(path.join(tempBuild, "index.html"), html, "utf8");

    await stopPreviewServer(safeProjectId);
    await waitForUnlockedBuild(finalBuild);
    if (await directoryExists(finalBuild)) {
      await fs.rename(finalBuild, backupBuild);
    }
    await fs.rename(tempBuild, finalBuild);
    await fs.rm(backupBuild, { recursive: true, force: true });

    const manifest = await touchManifestAfterRebuild(projectRoot);
    await fs.rm(tempRoot, { recursive: true, force: true });
    const preview = await startPreviewServer(null, safeProjectId);
    return { ok: true, manifest, previewUrl: preview.ok ? preview.url : undefined };
  } catch (error) {
    if (await directoryExists(backupBuild)) {
      await fs.rm(finalBuild, { recursive: true, force: true });
      await fs.rename(backupBuild, finalBuild);
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
    await startPreviewServer(null, safeProjectId).catch(() => undefined);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function stopPreviewServer(projectId) {
  const existing = previewServers.get(projectId);
  if (!existing) return;

  previewServers.delete(projectId);
  await new Promise((resolve) => {
    existing.server.close(() => resolve());
  });
}

async function waitForUnlockedBuild(buildPath) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      if (!(await directoryExists(buildPath))) return;
      const probePath = path.join(buildPath, `.rebuild-probe-${Date.now()}`);
      await fs.writeFile(probePath, "ok", "utf8");
      await fs.rm(probePath, { force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
}

function rewriteBuildHtml(html, projectId) {
  const rewritten = html
    .replace(/<script\s+src=["']\.\.\/src\/main\.js["']><\/script>/i, '<script src="./main.js"></script>')
    .replace(/<script\s+src=["']src\/main\.js["']><\/script>/i, '<script src="./main.js"></script>')
    .replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, '<script src="./main.js"></script>');

  if (rewritten.includes('<script src="./main.js"></script>')) {
    return rewritten;
  }

  return rewritten.replace(/<\/body>/i, '    <script src="./main.js"></script>\n  </body>');
}

function rewriteSourceForBuild(source) {
  return source
    .replace(/const\s+ASSET_ROOT\s*=\s*['"]\.\.['"]\s*;/, "const ASSET_ROOT = '.';")
    .replace(/(['"`])\.\.\/assets\//g, "$1./assets/");
}

function defaultBuildHtml(title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <canvas id="application"></canvas>
    <script src="./main.js"></script>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function touchManifestAfterRebuild(projectRoot) {
  const manifestPath = path.join(projectRoot, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    manifest = {};
  }

  const now = new Date().toISOString();
  manifest.id = typeof manifest.id === "string" ? manifest.id : path.basename(projectRoot);
  manifest.title = typeof manifest.title === "string" ? manifest.title : titleFromProjectId(manifest.id);
  manifest.style = typeof manifest.style === "string" ? manifest.style : "image-blaster";
  manifest.createdAt = typeof manifest.createdAt === "string" ? manifest.createdAt : now;
  manifest.updatedAt = now;
  manifest.workspacePath = typeof manifest.workspacePath === "string" ? manifest.workspacePath : manifest.id;
  manifest.playCanvasEntry = "src/main.js";
  manifest.buildPath = `${manifest.id}/build/index.html`;
  manifest.promptHistory = Array.isArray(manifest.promptHistory) ? manifest.promptHistory : [];
  manifest.runHistory = Array.isArray(manifest.runHistory) ? manifest.runHistory : [];
  manifest.assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  manifest.runHistory.unshift({
    id: `local-rebuild-${timestampForFile()}`,
    createdAt: now,
    status: "ready",
    summary: "Rebuilt local preview from the current game source without running the agent.",
  });

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

async function copyIfExists(source, destination) {
  if (await directoryExists(source)) {
    await fs.cp(source, destination, { recursive: true });
  }
}

async function directoryExists(directoryPath) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
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
      style: "image-blaster",
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
    manifest.style = typeof manifest.style === "string" ? manifest.style : "image-blaster";
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
  const imageBlasterRoot = path.join(repoRoot, "skills", "image-blaster");
  const files = [
    path.join(skillRoot, "SKILL.md"),
    path.join(skillRoot, "references", "asset-generation.md"),
    path.join(skillRoot, "references", "design-rules.md"),
    path.join(skillRoot, "references", "game-quality-bar.md"),
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
    "The game workflow creates or updates a local image-blaster-based web game project in this workspace. Do not target PlayCanvas for new games.",
    "Do not start Python, python -m http.server, or any ad hoc preview server. Electron owns preview serving with its Node HTTP bridge.",
    "When using the workflow, use OpenAI Image 2 for 2D sprite sheets and neilsonnn/image-blaster for 3D world assets.",
    "Before running image-blaster, use OpenAI Image 2 to generate a clean background/environment reference image from the user's prompt, save it under assets/scenes or assets/textures, and pass that image to image-blaster as its required reference input. The reference image must not include the final character sprite, dialogue UI, buttons, HUD, captions, logos, or UI text.",
    "When using the workflow, write manifest.json, src/main.js, assets, build output, and runs metadata.",
    "Generated assets must be visibly used in the playable runtime. Do not satisfy asset generation by writing files and manifest entries only.",
    "Use the runtime, viewer, framework, and file structure produced or recommended by image-blaster, then overlay the 2D character and bottom dialogue UI on top of that scene.",
    "Generated sprite sheets must be loaded by the overlay/runtime layer and animated from the 4x3 sheet layout.",
    "Generated 3D model or scene assets from image-blaster must be saved under assets/models or assets/scenes and loaded/instantiated through the image-blaster-compatible runtime. If image-blaster is unavailable, record the gap and do not claim generated 3D assets exist.",
    "Validation must fail or record not-ready status when generated assets are manifest-only or not visible in the game.",
    "",
    `WORKFLOW_ALLOWED: ${shouldRunWorkflow ? "true" : "false"}`,
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
ipcMain.handle("settings:get", getAppSettings);
ipcMain.handle("settings:update", updateAppSettings);
ipcMain.handle("interaction:log", logInteraction);
ipcMain.handle("preview:start-server", startPreviewServer);
ipcMain.handle("preview:rebuild", rebuildProjectPreview);
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
