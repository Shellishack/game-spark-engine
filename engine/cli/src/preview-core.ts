import fs from "node:fs/promises";
import fssync from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

type GameEngine = "babylonjs" | "phaser";
type JsonRecord = Record<string, unknown>;

type PreviewCoreOptions = {
  repoRoot?: string;
  editorRoot?: string;
  tempRoot?: string;
};

type ProjectRequest = {
  project?: string;
  workspace?: string;
};

type SceneRequest = ProjectRequest & {
  scenePath?: string;
};

type PreviewStartRequest = ProjectRequest & {
  port?: number;
};

type RebuildRequest = ProjectRequest & {
  startServer?: boolean;
};

type UpdateSceneObjectRequest = SceneRequest & {
  objectId?: string;
  transform?: Partial<SceneTransform>;
};

type SceneTransform = {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
};

type SceneObject = {
  id: string;
  name: string;
  kind: string;
  assetRef?: string;
  editable: boolean;
  tags: string[];
  transform: SceneTransform;
  components: JsonRecord;
};

type SceneGroup = {
  id: string;
  name: string;
  objectIds: string[];
};

type SceneFile = {
  schemaVersion: 1;
  id: string;
  engine: GameEngine;
  updatedAt: string;
  objects: SceneObject[];
  groups: SceneGroup[];
};

type Manifest = JsonRecord & {
  id: string;
  title: string;
  engine: GameEngine;
  style: string;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  runtimeEntry: string;
  babylonEntry?: string;
  phaserEntry?: string;
  buildPath: string;
  promptHistory: unknown[];
  runHistory: Array<Record<string, unknown>>;
  assets: unknown[];
  editor: JsonRecord;
  logicGraph: JsonRecord;
};

type ManifestInput = JsonRecord & {
  playCanvasEntry?: unknown;
};

type OkProject = {
  ok: true;
  projectRoot: string;
  projectId: string;
  workspaceRoot: string;
};

type OkScenePath = OkProject & {
  path: string;
  relativePath: string;
};

type ErrorResult = {
  ok: false;
  error: string;
};

type PreviewServerRecord = {
  server: http.Server;
  url: string;
  port: number;
};

const previewServers = new Map<string, PreviewServerRecord>();
const requireFromCli = createRequire(__filename);

export function createPreviewCore(options: PreviewCoreOptions = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..", "..", "..");
  const editorRoot = options.editorRoot || path.join(repoRoot, "engine", "editor");
  const tempRoot = options.tempRoot || path.join(os.tmpdir(), "game-spark-ai");

  return {
    resolveWorkspaceRoot,
    resolveProjectRoot,
    startPreviewServer,
    rebuildProjectPreview,
    readSceneFile,
    updateSceneObject,
    writeAgentContext,
    stopPreviewServer,
  };

  async function resolveWorkspaceRoot(explicitWorkspace?: string) {
    if (typeof explicitWorkspace === "string" && explicitWorkspace.trim()) {
      return path.resolve(explicitWorkspace);
    }

    const settingsPath = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "game-spark-ai", "settings.json");
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8")) as JsonRecord;
      if (typeof settings.workspaceRoot === "string" && settings.workspaceRoot.trim()) {
        return path.resolve(settings.workspaceRoot);
      }
    } catch {
      // Fall back to the app's default workspace.
    }

    return path.join(os.homedir(), "Game Spark AI");
  }

  async function resolveProjectRoot(projectRef?: string, explicitWorkspace?: string): Promise<OkProject | ErrorResult> {
    if (typeof projectRef !== "string" || !projectRef.trim()) {
      return { ok: false, error: "Missing project." };
    }

    const directPath = path.resolve(projectRef);
    if (projectRef === "." || projectRef === ".." || path.isAbsolute(projectRef) || projectRef.includes("\\") || projectRef.includes("/")) {
      if (!(await directoryExists(directPath))) return { ok: false, error: "Project path does not exist." };
      return { ok: true, projectRoot: directPath, projectId: path.basename(directPath), workspaceRoot: path.dirname(directPath) };
    }

    const projectId = sanitizeFilePart(projectRef, "");
    if (!projectId || projectId !== projectRef) return { ok: false, error: "Invalid project id." };
    const workspaceRoot = await resolveWorkspaceRoot(explicitWorkspace);
    const projectRoot = path.resolve(workspaceRoot, projectId);
    if (!(await directoryExists(projectRoot))) return { ok: false, error: "Project does not exist in workspace." };
    return { ok: true, projectRoot, projectId, workspaceRoot };
  }

  async function startPreviewServer({ project, workspace, port = 0 }: PreviewStartRequest = {}) {
    const resolved = await resolveProjectRoot(project, workspace);
    if (!resolved.ok) return resolved;

    const indexPath = path.join(resolved.projectRoot, "build", "index.html");
    if (!(await fileExists(indexPath))) return { ok: false, error: "Playable preview is not ready." };

    const existing = previewServers.get(resolved.projectRoot);
    if (existing) {
      return { ok: true, projectRoot: resolved.projectRoot, projectId: resolved.projectId, url: existing.url, port: existing.port, mode: "edit" };
    }

    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const rawPath = decodeURIComponent(requestUrl.pathname === "/" ? "/build/index.html" : requestUrl.pathname);
      const relativePath = rawPath.replace(/^\/+/, "");
      const filePath = path.resolve(resolved.projectRoot, relativePath);

      if (!isInside(filePath, resolved.projectRoot)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      serveProjectFile(resolved.projectRoot, filePath, relativePath, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(port) || 0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    const resolvedPort = typeof address === "object" && address ? address.port : 0;
    const url = `http://127.0.0.1:${resolvedPort}/build/index.html`;
    previewServers.set(resolved.projectRoot, { server, url, port: resolvedPort });
    return { ok: true, projectRoot: resolved.projectRoot, projectId: resolved.projectId, url, port: resolvedPort, mode: "edit" };
  }

  async function rebuildProjectPreview({ project, workspace, startServer = false }: RebuildRequest = {}) {
    const resolved = await resolveProjectRoot(project, workspace);
    if (!resolved.ok) return resolved;

    const sourcePath = path.join(resolved.projectRoot, "src", "main.js");
    const sourceHtmlPath = path.join(resolved.projectRoot, "build", "index.html");
    if (!(await fileExists(sourcePath))) return { ok: false, error: "Game source is missing." };

    const tempBuildRoot = path.join(tempRoot, `rebuild-${resolved.projectId}-${Date.now()}`);
    const tempBuild = path.join(tempBuildRoot, "build");
    const finalBuild = path.join(resolved.projectRoot, "build");
    const backupBuild = path.join(resolved.projectRoot, `.build-backup-${Date.now()}`);

    try {
      await fs.mkdir(tempBuild, { recursive: true });
      await writePreviewMain(sourcePath, tempBuild);
      await copyIfExists(path.join(resolved.projectRoot, "assets"), path.join(tempBuild, "assets"));

      const manifestBefore = await readProjectManifest(resolved.projectRoot);
      const engine: GameEngine = manifestBefore.engine === "phaser" ? "phaser" : "babylonjs";
      await copyEngineVendor(engine, tempBuild);
      await copyPreviewRuntime(tempBuild);

      const html = (await fileExists(sourceHtmlPath))
        ? rewriteBuildHtml(await fs.readFile(sourceHtmlPath, "utf8"), engine)
        : defaultBuildHtml(titleFromProjectId(resolved.projectId), engine);
      await fs.writeFile(path.join(tempBuild, "index.html"), html, "utf8");

      await stopPreviewServer(resolved.projectRoot);
      await waitForUnlockedBuild(finalBuild);
      if (await directoryExists(finalBuild)) await fs.rename(finalBuild, backupBuild);
      await fs.rename(tempBuild, finalBuild);
      await fs.rm(backupBuild, { recursive: true, force: true });

      const manifest = await touchManifestAfterRebuild(resolved.projectRoot);
      await fs.rm(tempBuildRoot, { recursive: true, force: true });
      const preview = startServer ? await startPreviewServer({ project: resolved.projectRoot }) : null;
      return { ok: true, projectRoot: resolved.projectRoot, projectId: resolved.projectId, manifest, previewUrl: preview?.ok ? preview.url : undefined };
    } catch (error) {
      if (await directoryExists(backupBuild)) {
        await fs.rm(finalBuild, { recursive: true, force: true });
        await fs.rename(backupBuild, finalBuild);
      }
      await fs.rm(tempBuildRoot, { recursive: true, force: true });
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function readSceneFile({ project, workspace, scenePath }: SceneRequest = {}) {
    const resolved = await resolveProjectScenePath(project, workspace, scenePath);
    if (!resolved.ok) return resolved;

    try {
      if (!(await fileExists(resolved.path))) {
        const scene = defaultSceneFile(resolved.projectId);
        await fs.mkdir(path.dirname(resolved.path), { recursive: true });
        await fs.writeFile(resolved.path, JSON.stringify(scene, null, 2), "utf8");
        return { ok: true, projectRoot: resolved.projectRoot, scene, path: resolved.relativePath };
      }

      const scene = normalizeSceneFile(JSON.parse(await fs.readFile(resolved.path, "utf8")), resolved.projectId);
      return { ok: true, projectRoot: resolved.projectRoot, scene, path: resolved.relativePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function updateSceneObject({ project, workspace, scenePath, objectId, transform = {} }: UpdateSceneObjectRequest = {}) {
    const resolved = await resolveProjectScenePath(project, workspace, scenePath);
    if (!resolved.ok) return resolved;

    try {
      const baseScene = (await fileExists(resolved.path))
        ? normalizeSceneFile(JSON.parse(await fs.readFile(resolved.path, "utf8")), resolved.projectId)
        : defaultSceneFile(resolved.projectId);
      const now = new Date().toISOString();
      const scene = {
        ...baseScene,
        updatedAt: now,
        objects: baseScene.objects.map((object) =>
          object.id === objectId && object.editable ? { ...object, transform: { ...object.transform, ...numericTransformPatch(transform) } } : object,
        ),
      };

      await fs.mkdir(path.dirname(resolved.path), { recursive: true });
      await fs.writeFile(resolved.path, JSON.stringify(scene, null, 2), "utf8");
      return { ok: true, projectRoot: resolved.projectRoot, scene };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function writeAgentContext({ project, workspace, scenePath }: SceneRequest = {}) {
    const sceneResult = await readSceneFile({ project, workspace, scenePath });
    if (!sceneResult.ok) return sceneResult;
    if (!("scene" in sceneResult)) return { ok: false, error: "Scene was not loaded." };

    const resolved = await resolveProjectRoot(project, workspace);
    if (!resolved.ok) return resolved;

    const gameSparkRoot = path.join(resolved.projectRoot, ".game-spark");
    const selectionPath = path.join(gameSparkRoot, "selection.json");
    const editorStatePath = path.join(gameSparkRoot, "editor-state.json");
    const selection = ((await readJson(selectionPath)) || { activeScene: sceneResult.path, selectedObjectIds: [], selectedGroupIds: [] }) as JsonRecord;
    const editorState = ((await readJson(editorStatePath)) || { activeScene: sceneResult.path, mode: "edit" }) as JsonRecord;
    const selectedObjectIds = Array.isArray(selection.selectedObjectIds) ? selection.selectedObjectIds.filter((id): id is string => typeof id === "string") : [];
    const selected = new Set(selectedObjectIds);
    const scene = sceneResult.scene as SceneFile;
    const selectedObjects = scene.objects.filter((object) => selected.has(object.id));
    const context = [
      "# Game Spark Agent Context",
      "",
      `Project: ${resolved.projectId}`,
      `Scene: ${sceneResult.path}`,
      `Selected objects: ${selectedObjects.length}`,
      "",
      "```json",
      JSON.stringify({ selection, editorState, selectedObjects, scene }, null, 2),
      "```",
      "",
    ].join("\n");

    await fs.mkdir(gameSparkRoot, { recursive: true });
    await fs.writeFile(selectionPath, JSON.stringify(selection, null, 2), "utf8");
    await fs.writeFile(editorStatePath, JSON.stringify(editorState, null, 2), "utf8");
    const contextPath = path.join(gameSparkRoot, "agent-context.md");
    await fs.writeFile(contextPath, context, "utf8");
    return { ok: true, projectRoot: resolved.projectRoot, contextPath, selectionPath, editorStatePath };
  }

  async function resolveProjectScenePath(project?: string, workspace?: string, scenePath?: string): Promise<OkScenePath | ErrorResult> {
    const resolved = await resolveProjectRoot(project, workspace);
    if (!resolved.ok) return resolved;
    const relativePath = typeof scenePath === "string" && scenePath.trim() ? scenePath.replace(/\\/g, "/") : "assets/scenes/main.scene.json";
    if (relativePath.startsWith("/") || relativePath.includes("..")) return { ok: false, error: "Invalid scene path." };
    const filePath = path.resolve(resolved.projectRoot, relativePath);
    if (!isInside(filePath, resolved.projectRoot)) return { ok: false, error: "Invalid scene path." };
    return { ...resolved, path: filePath, relativePath };
  }

  async function stopPreviewServer(projectRoot: string) {
    const existing = previewServers.get(projectRoot);
    if (!existing) return;
    previewServers.delete(projectRoot);
    await new Promise<void>((resolve) => existing.server.close(() => resolve()));
  }

  async function copyEngineVendor(engine: GameEngine, buildRoot: string) {
    const vendorFiles =
      engine === "phaser"
        ? [{ source: path.join(editorRoot, "node_modules", "phaser", "dist", "phaser.min.js"), target: path.join(buildRoot, "vendor", "phaser.min.js") }]
        : [
            { source: path.join(editorRoot, "node_modules", "@babylonjs", "core", "babylon.js"), target: path.join(buildRoot, "vendor", "babylon.js") },
            { source: path.join(editorRoot, "node_modules", "@babylonjs", "loaders", "babylonjs.loaders.min.js"), target: path.join(buildRoot, "vendor", "babylonjs.loaders.min.js") },
          ];

    for (const file of vendorFiles) {
      if (!(await fileExists(file.source))) continue;
      await fs.mkdir(path.dirname(file.target), { recursive: true });
      await fs.copyFile(file.source, file.target);
    }
  }

  async function copyPreviewRuntime(buildRoot: string) {
    const source = path.join(editorRoot, "web", "runtime", "preview-editor-controls.js");
    if (!(await fileExists(source))) return;
    await fs.copyFile(source, path.join(buildRoot, "preview-editor-controls.js"));
  }

  async function writePreviewMain(sourcePath: string, buildRoot: string) {
    const source = await fs.readFile(sourcePath, "utf8");
    if (!usesModuleSyntax(source)) {
      await fs.writeFile(path.join(buildRoot, "main.js"), rewriteSourceForBuild(source), "utf8");
      return;
    }

    const esbuild = requireFromCli(path.join(editorRoot, "node_modules", "esbuild")) as {
      build(options: Record<string, unknown>): Promise<void>;
    };
    await esbuild.build({
      entryPoints: [sourcePath],
      bundle: true,
      absWorkingDir: editorRoot,
      nodePaths: [path.join(editorRoot, "node_modules")],
      outfile: path.join(buildRoot, "main.js"),
      format: "iife",
      platform: "browser",
      target: "es2020",
      sourcemap: false,
      logLevel: "silent",
    });
  }
}

function serveProjectFile(projectRoot: string, filePath: string, relativePath: string, response: http.ServerResponse) {
  fssync.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      const fallback = resolveBuildAssetFallback(projectRoot, relativePath);
      if (!fallback) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      fssync.stat(fallback, (fallbackError, fallbackStat) => {
        if (fallbackError || !fallbackStat.isFile()) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, { "Content-Type": contentTypeFor(fallback) });
        fssync.createReadStream(fallback).pipe(response);
      });
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    fssync.createReadStream(filePath).pipe(response);
  });
}

function resolveBuildAssetFallback(projectRoot: string, relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!normalized.startsWith("build/assets/")) return "";
  const fallbackPath = path.resolve(projectRoot, normalized.slice("build/".length));
  return isInside(fallbackPath, projectRoot) ? fallbackPath : "";
}

function rewriteBuildHtml(html: string, engine: GameEngine = "babylonjs") {
  const rewritten = html
    .replace(/<script\s+src=["']\.\.\/src\/main\.js["']><\/script>/i, '<script src="./main.js"></script>')
    .replace(/<script\s+src=["']src\/main\.js["']><\/script>/i, '<script src="./main.js"></script>')
    .replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, '<script src="./main.js"></script>');
  const withEngine = ensureEngineScript(rewritten, engine);
  const withEditorControls = injectPreviewEditorControls(withEngine);
  if (withEditorControls.includes('<script src="./main.js"></script>')) return withEditorControls;
  return withEditorControls.replace(/<\/body>/i, `${engineScriptTag(engine)}\n${previewEditorControlsScriptTag()}\n    <script src="./main.js"></script>\n  </body>`);
}

function rewriteSourceForBuild(source: string) {
  return source.replace(/const\s+ASSET_ROOT\s*=\s*['"]\.\.['"]\s*;/, "const ASSET_ROOT = '.';").replace(/(['"`])\.\.\/assets\//g, "$1./assets/");
}

function usesModuleSyntax(source: string) {
  return /^\s*import\s.+from\s+["'][^"']+["'];?/m.test(source) || /^\s*import\s+["'][^"']+["'];?/m.test(source) || /^\s*export\s+/m.test(source);
}

function defaultBuildHtml(title: string, engine: GameEngine = "babylonjs") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <canvas id="application"></canvas>
${engineScriptTag(engine)}
${previewEditorControlsScriptTag()}
    <script src="./main.js"></script>
  </body>
</html>
`;
}

function ensureEngineScript(html: string, engine: GameEngine) {
  if (engine === "phaser") {
    if (html.includes("vendor/phaser.min.js") || html.includes("Phaser")) return html;
    return html.replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, `${engineScriptTag(engine)}\n    <script src="./main.js"></script>`);
  }
  if (html.includes("vendor/babylon.js") || html.includes("BABYLON")) return html;
  return html.replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, `${engineScriptTag(engine)}\n    <script src="./main.js"></script>`);
}

function injectPreviewEditorControls(html: string) {
  const withoutLegacyInline = html.replace(/\s*<script>\s*([\s\S]*?)<\/script>/gi, (match, body) => {
    if (!body.includes("GAME_SPARK_PREVIEW_CONTROL")) return match;
    if (!body.includes("BABYLON.EngineStore") && !body.includes("event.preventDefault")) return match;
    return "";
  });
  if (withoutLegacyInline.includes("preview-editor-controls.js")) return withoutLegacyInline;
  return withoutLegacyInline.replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, `${previewEditorControlsScriptTag()}\n    <script src="./main.js"></script>`);
}

function previewEditorControlsScriptTag() {
  return '    <script src="./preview-editor-controls.js"></script>';
}

function engineScriptTag(engine: GameEngine) {
  if (engine === "phaser") return '    <script src="./vendor/phaser.min.js"></script>';
  return ['    <script src="./vendor/babylon.js"></script>', '    <script src="./vendor/babylonjs.loaders.min.js"></script>'].join("\n");
}

async function touchManifestAfterRebuild(projectRoot: string) {
  const manifestPath = path.join(projectRoot, "manifest.json");
  const now = new Date().toISOString();
  const manifest = normalizeManifest((await readProjectManifest(projectRoot)) || {}, path.basename(projectRoot), now);
  manifest.runHistory.unshift({ id: `local-rebuild-${timestampForFile()}`, createdAt: now, status: "ready", summary: "Rebuilt local preview from the current game source without running the agent." });
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

function normalizeManifest(inputManifest: JsonRecord, projectId: string, now: string): Manifest {
  const record = inputManifest as Partial<ManifestInput>;
  const id = typeof record.id === "string" ? record.id : projectId;
  const engine: GameEngine = record.engine === "phaser" ? "phaser" : "babylonjs";
  const runtimeEntry =
    typeof record.runtimeEntry === "string"
      ? record.runtimeEntry
      : typeof record.playCanvasEntry === "string"
        ? record.playCanvasEntry
        : "src/main.js";

  return {
    ...inputManifest,
    id,
    title: typeof record.title === "string" ? record.title : titleFromProjectId(id),
    engine,
    style: typeof record.style === "string" ? record.style : engine === "phaser" ? "2D" : "babylonjs",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: now,
    workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : id,
    runtimeEntry,
    babylonEntry: typeof record.babylonEntry === "string" ? record.babylonEntry : engine === "babylonjs" ? runtimeEntry : undefined,
    phaserEntry: typeof record.phaserEntry === "string" ? record.phaserEntry : engine === "phaser" ? runtimeEntry : undefined,
    editor: normalizeEditorState(record.editor),
    logicGraph: normalizeLogicGraph(record.logicGraph, now),
    buildPath: `${id}/build/index.html`,
    promptHistory: Array.isArray(record.promptHistory) ? record.promptHistory : [],
    runHistory: Array.isArray(record.runHistory) ? record.runHistory : [],
    assets: Array.isArray(record.assets) ? record.assets : [],
  };
}

function normalizeEditorState(editor: unknown = {}): JsonRecord {
  const record = editor && typeof editor === "object" ? (editor as JsonRecord) : {};
  return {
    applyMode: record.applyMode === "auto" ? "auto" : "preview",
    previewMode: record.previewMode === "play" ? "play" : "edit",
    playStartMode: record.playStartMode === "current" ? "current" : "fresh",
    activeScenePath: typeof record.activeScenePath === "string" ? record.activeScenePath : "assets/scenes/main.scene.json",
    activeTool: typeof record.activeTool === "string" ? record.activeTool : "world",
    tools: Array.isArray(record.tools) ? record.tools : [],
  };
}

function normalizeLogicGraph(graph: unknown = {}, updatedAt = new Date().toISOString()): JsonRecord {
  const record = graph && typeof graph === "object" ? (graph as JsonRecord) : {};
  return {
    source: record.source === "ai-proposed" ? "ai-proposed" : "code-derived",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : updatedAt,
    nodes: Array.isArray(record.nodes) ? record.nodes : [],
    edges: Array.isArray(record.edges) ? record.edges : [],
  };
}

function defaultSceneFile(projectId: string): SceneFile {
  return normalizeSceneFile(
    {
      schemaVersion: 1,
      id: `${projectId}-main-scene`,
      engine: "babylonjs",
      updatedAt: new Date().toISOString(),
      objects: [],
      groups: [],
    },
    projectId,
  );
}

function normalizeSceneFile(scene: unknown, projectId: string): SceneFile {
  const record = scene && typeof scene === "object" ? (scene as JsonRecord) : {};
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: typeof record.id === "string" ? record.id : `${projectId}-main-scene`,
    engine: record.engine === "phaser" ? "phaser" : "babylonjs",
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
    objects: (Array.isArray(record.objects) ? record.objects : []).map(normalizeSceneObject),
    groups: Array.isArray(record.groups) ? record.groups.map(normalizeSceneGroup) : [],
  };
}

function normalizeSceneObject(object: unknown, index: number): SceneObject {
  const record = object && typeof object === "object" ? (object as JsonRecord) : {};
  const transform = record.transform && typeof record.transform === "object" ? (record.transform as JsonRecord) : {};
  const components = record.components && typeof record.components === "object" ? (record.components as JsonRecord) : {};
  return {
    id: typeof record.id === "string" ? record.id : `scene-object-${index + 1}`,
    name: typeof record.name === "string" ? record.name : `Scene object ${index + 1}`,
    kind: typeof record.kind === "string" ? record.kind : "prop",
    assetRef: typeof record.assetRef === "string" ? record.assetRef : undefined,
    editable: record.editable !== false,
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    transform: {
      x: finiteNumber(transform.x, 50),
      y: finiteNumber(transform.y, 50),
      z: finiteNumber(transform.z, 0),
      rotationX: finiteNumber(transform.rotationX, 0),
      rotationY: finiteNumber(transform.rotationY, 0),
      rotationZ: finiteNumber(transform.rotationZ, 0),
      scaleX: finiteNumber(transform.scaleX, 1),
      scaleY: finiteNumber(transform.scaleY, 1),
      scaleZ: finiteNumber(transform.scaleZ, 1),
    },
    components,
  };
}

function normalizeSceneGroup(group: unknown, index: number): SceneGroup {
  const record = group && typeof group === "object" ? (group as JsonRecord) : {};
  return {
    id: typeof record.id === "string" ? record.id : `scene-group-${index + 1}`,
    name: typeof record.name === "string" ? record.name : `Scene group ${index + 1}`,
    objectIds: Array.isArray(record.objectIds) ? record.objectIds.filter((id): id is string => typeof id === "string") : [],
  };
}

function numericTransformPatch(transform: Partial<SceneTransform>) {
  const allowed: Array<keyof SceneTransform> = ["x", "y", "z", "rotationX", "rotationY", "rotationZ", "scaleX", "scaleY", "scaleZ"];
  return Object.fromEntries(allowed.filter((key) => Number.isFinite(Number(transform?.[key]))).map((key) => [key, Number(transform[key])]));
}

async function readProjectManifest(projectRoot: string): Promise<JsonRecord> {
  try {
    return JSON.parse(await fs.readFile(path.join(projectRoot, "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function copyIfExists(source: string, destination: string) {
  if (await directoryExists(source)) await fs.cp(source, destination, { recursive: true });
}

async function waitForUnlockedBuild(buildPath: string) {
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

async function fileExists(filePath: string) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function directoryExists(directoryPath: string) {
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

function isInside(filePath: string, root: string) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function sanitizeFilePart(value: unknown, fallback: string) {
  const safe = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function titleFromProjectId(projectId: unknown) {
  return String(projectId || "Untitled Game")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function contentTypeFor(filePath: string) {
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
  if (ext === ".sog") return "application/octet-stream";
  return "application/octet-stream";
}

function escapeHtml(value: unknown) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
