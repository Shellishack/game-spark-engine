const fs = require("node:fs/promises");
const fssync = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const previewServers = new Map();
let app;
let appRoot;
let workspaceRoot;
let sanitizeFilePart;

function createProjectPreviewService(dependencies) {
  app = dependencies.app;
  appRoot = dependencies.appRoot;
  workspaceRoot = dependencies.workspaceRoot;
  sanitizeFilePart = dependencies.sanitizeFilePart;

  return {
    startPreviewServer,
    rebuildProjectPreview,
    readSceneFile,
    updateSceneObject,
    stopPreviewServer,
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

    const projectManifest = await readProjectManifest(projectRoot);
    const engine = projectManifest.engine === "phaser" ? "phaser" : "babylonjs";
    await copyEngineVendor(engine, tempBuild);
    const html = (await fileExists(sourceHtmlPath))
      ? rewriteBuildHtml(await fs.readFile(sourceHtmlPath, "utf8"), safeProjectId, engine)
      : defaultBuildHtml(titleFromProjectId(safeProjectId), engine);
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

async function readSceneFile(_event, projectId, scenePath) {
  const resolved = await resolveProjectScenePath(projectId, scenePath);
  if (!resolved.ok) return resolved;

  try {
    if (!(await fileExists(resolved.path))) {
      const scene = defaultSceneFile(resolved.projectId);
      await fs.mkdir(path.dirname(resolved.path), { recursive: true });
      await fs.writeFile(resolved.path, JSON.stringify(scene, null, 2), "utf8");
      return { ok: true, scene, path: resolved.relativePath };
    }

    const scene = normalizeSceneFile(JSON.parse(await fs.readFile(resolved.path, "utf8")), resolved.projectId);
    return { ok: true, scene, path: resolved.relativePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function updateSceneObject(_event, projectId, scenePath, objectId, transform = {}) {
  const resolved = await resolveProjectScenePath(projectId, scenePath);
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
        object.id === objectId && object.editable
          ? {
              ...object,
              transform: {
                ...object.transform,
                ...numericTransformPatch(transform),
              },
            }
          : object,
      ),
    };

    await fs.mkdir(path.dirname(resolved.path), { recursive: true });
    await fs.writeFile(resolved.path, JSON.stringify(scene, null, 2), "utf8");
    return { ok: true, scene };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function resolveProjectScenePath(projectId, scenePath) {
  if (typeof projectId !== "string" || !projectId.trim()) {
    return { ok: false, error: "Missing project id." };
  }
  const safeProjectId = sanitizeFilePart(projectId, "");
  if (!safeProjectId || safeProjectId !== projectId) {
    return { ok: false, error: "Invalid project id." };
  }

  const relativePath = typeof scenePath === "string" && scenePath.trim() ? scenePath.replace(/\\/g, "/") : "assets/scenes/main.scene.json";
  if (relativePath.startsWith("/") || relativePath.includes("..")) {
    return { ok: false, error: "Invalid scene path." };
  }

  const root = await workspaceRoot();
  const projectRoot = path.resolve(root, safeProjectId);
  const filePath = path.resolve(projectRoot, relativePath);
  if (!filePath.startsWith(projectRoot + path.sep)) {
    return { ok: false, error: "Invalid scene path." };
  }

  return { ok: true, projectId: safeProjectId, path: filePath, relativePath };
}

function defaultSceneFile(projectId) {
  return normalizeSceneFile(
    {
      schemaVersion: 1,
      id: `${projectId}-main-scene`,
      engine: "babylonjs",
      updatedAt: new Date().toISOString(),
      objects: [
        {
          id: "hero-start",
          name: "Hero start",
          kind: "sprite",
          editable: true,
          tags: ["player", "spawn"],
          transform: { x: 38, y: 58, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
        },
        {
          id: "story-objective",
          name: "Objective",
          kind: "prop",
          editable: true,
          tags: ["objective"],
          transform: { x: 66, y: 34, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
        },
      ],
    },
    projectId,
  );
}

function normalizeSceneFile(scene, projectId) {
  const now = new Date().toISOString();
  const objects = Array.isArray(scene?.objects) ? scene.objects : [];
  return {
    schemaVersion: 1,
    id: typeof scene?.id === "string" ? scene.id : `${projectId}-main-scene`,
    engine: scene?.engine === "phaser" ? "phaser" : "babylonjs",
    updatedAt: typeof scene?.updatedAt === "string" ? scene.updatedAt : now,
    objects: objects.map(normalizeSceneObject),
  };
}

function normalizeSceneObject(object, index) {
  const transform = object?.transform && typeof object.transform === "object" ? object.transform : {};
  return {
    id: typeof object?.id === "string" ? object.id : `scene-object-${index + 1}`,
    name: typeof object?.name === "string" ? object.name : `Scene object ${index + 1}`,
    kind: ["sprite", "model", "trigger", "camera", "light", "zone", "prop"].includes(object?.kind) ? object.kind : "prop",
    assetRef: typeof object?.assetRef === "string" ? object.assetRef : undefined,
    editable: object?.editable !== false,
    tags: Array.isArray(object?.tags) ? object.tags.filter((tag) => typeof tag === "string") : [],
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
  };
}

function numericTransformPatch(transform) {
  const allowed = ["x", "y", "z", "rotationX", "rotationY", "rotationZ", "scaleX", "scaleY", "scaleZ"];
  return Object.fromEntries(
    allowed
      .filter((key) => Number.isFinite(Number(transform?.[key])))
      .map((key) => [key, Number(transform[key])]),
  );
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function rewriteBuildHtml(html, projectId, engine = "babylonjs") {
  const rewritten = html
    .replace(/<script\s+src=["']\.\.\/src\/main\.js["']><\/script>/i, '<script src="./main.js"></script>')
    .replace(/<script\s+src=["']src\/main\.js["']><\/script>/i, '<script src="./main.js"></script>')
    .replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, '<script src="./main.js"></script>');

  const withEngine = ensureEngineScript(rewritten, engine);
  const withEditorControls = injectPreviewEditorControls(withEngine, engine);

  if (withEditorControls.includes('<script src="./main.js"></script>')) {
    return withEditorControls;
  }

  return withEditorControls.replace(/<\/body>/i, `${engineScriptTag(engine)}\n${previewEditorControlsScript(engine)}\n    <script src="./main.js"></script>\n  </body>`);
}

function rewriteSourceForBuild(source) {
  return source
    .replace(/const\s+ASSET_ROOT\s*=\s*['"]\.\.['"]\s*;/, "const ASSET_ROOT = '.';")
    .replace(/(['"`])\.\.\/assets\//g, "$1./assets/");
}

function defaultBuildHtml(title, engine = "babylonjs") {
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
${previewEditorControlsScript(engine)}
    <script src="./main.js"></script>
  </body>
</html>
`;
}

async function readProjectManifest(projectRoot) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectRoot, "manifest.json"), "utf8"));
  } catch {
    return {};
  }
}

async function copyEngineVendor(engine, buildRoot) {
  const vendorFiles =
    engine === "phaser"
      ? [{ source: path.join(appRoot, "node_modules", "phaser", "dist", "phaser.min.js"), target: path.join(buildRoot, "vendor", "phaser.min.js") }]
      : [
          { source: path.join(appRoot, "node_modules", "@babylonjs", "core", "babylon.js"), target: path.join(buildRoot, "vendor", "babylon.js") },
          { source: path.join(appRoot, "node_modules", "@babylonjs", "loaders", "babylonjs.loaders.min.js"), target: path.join(buildRoot, "vendor", "babylonjs.loaders.min.js") },
        ];

  for (const file of vendorFiles) {
    if (!(await fileExists(file.source))) continue;
    await fs.mkdir(path.dirname(file.target), { recursive: true });
    await fs.copyFile(file.source, file.target);
  }
}

function ensureEngineScript(html, engine) {
  if (engine === "phaser") {
    if (html.includes("vendor/phaser.min.js") || html.includes("Phaser")) return html;
    return html.replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, `${engineScriptTag(engine)}\n    <script src="./main.js"></script>`);
  }

  if (html.includes("vendor/babylon.js") || html.includes("BABYLON")) return html;
  return html.replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, `${engineScriptTag(engine)}\n    <script src="./main.js"></script>`);
}

function injectPreviewEditorControls(html, engine) {
  if (html.includes("GAME_SPARK_PREVIEW_CONTROL")) return html;
  return html.replace(/<script\s+src=["']\.\/main\.js["']><\/script>/i, `${previewEditorControlsScript(engine)}\n    <script src="./main.js"></script>`);
}

function previewEditorControlsScript(engine) {
  if (engine === "phaser") {
    return `    <script>
      window.addEventListener("message", function(event) {
        if (!event.data || event.data.type !== "GAME_SPARK_PREVIEW_CONTROL") return;
        event.preventDefault && event.preventDefault();
      });
    </script>`;
  }

  return `    <script>
      (function() {
        var initialCameraState = null;

        function getScene() {
          if (!window.BABYLON || !BABYLON.EngineStore || !BABYLON.EngineStore.LastCreatedScene) return null;
          return BABYLON.EngineStore.LastCreatedScene;
        }

        function getCamera() {
          var scene = getScene();
          return scene && scene.activeCamera ? scene.activeCamera : null;
        }

        function cloneVector(vector) {
          return vector && typeof vector.clone === "function" ? vector.clone() : null;
        }

        function captureInitialState(camera) {
          if (initialCameraState || !camera) return;
          initialCameraState = {
            position: cloneVector(camera.position),
            target: cloneVector(camera.target),
            radius: typeof camera.radius === "number" ? camera.radius : null
          };
        }

        function getCameraBasis(camera) {
          var forward = camera.getDirection ? camera.getDirection(BABYLON.Axis.Z) : null;
          if (!forward || !isFinite(forward.x) || !isFinite(forward.y) || !isFinite(forward.z)) {
            forward = camera.target && camera.position ? camera.target.subtract(camera.position) : new BABYLON.Vector3(0, 0, 1);
          }
          if (forward.lengthSquared && forward.lengthSquared() > 0.0001) forward.normalize();
          var right = BABYLON.Vector3.Cross(BABYLON.Axis.Y, forward);
          if (right.lengthSquared && right.lengthSquared() > 0.0001) right.normalize();
          var up = BABYLON.Vector3.Cross(forward, right);
          if (up.lengthSquared && up.lengthSquared() > 0.0001) up.normalize();
          return { forward: forward, right: right, up: up };
        }

        function translateCamera(camera, vector) {
          if (camera.position && camera.position.addInPlace) camera.position.addInPlace(vector);
          if (camera.target && camera.target.addInPlace) camera.target.addInPlace(vector);
          if (camera.setTarget && camera.target) camera.setTarget(camera.target);
        }

        function zoomCamera(camera, delta) {
          captureInitialState(camera);
          if (typeof camera.radius === "number") {
            camera.radius = Math.max(1, camera.radius * (delta > 0 ? 0.88 : 1.14));
            return;
          }
          var basis = getCameraBasis(camera);
          translateCamera(camera, basis.forward.scale(delta > 0 ? 0.8 : -0.8));
        }

        function panCamera(camera, dx, dy) {
          captureInitialState(camera);
          var basis = getCameraBasis(camera);
          var distance = typeof camera.radius === "number" ? camera.radius : 10;
          var scale = Math.max(0.01, distance * 0.0018);
          var move = basis.right.scale(-dx * scale).add(basis.up.scale(dy * scale));
          translateCamera(camera, move);
        }

        function moveCamera(camera, x, y) {
          captureInitialState(camera);
          var basis = getCameraBasis(camera);
          var distance = typeof camera.radius === "number" ? camera.radius : 10;
          var scale = Math.max(0.03, distance * 0.006);
          var move = basis.right.scale(x * scale).add(basis.forward.scale(y * scale));
          translateCamera(camera, move);
        }

        function resetCamera(camera) {
          if (!initialCameraState) return;
          if (camera.position && initialCameraState.position) camera.position.copyFrom(initialCameraState.position);
          if (camera.target && initialCameraState.target) {
            camera.target.copyFrom(initialCameraState.target);
            if (camera.setTarget) camera.setTarget(camera.target);
          }
          if (typeof camera.radius === "number" && typeof initialCameraState.radius === "number") camera.radius = initialCameraState.radius;
        }

        window.addEventListener("message", function(event) {
          if (!event.data || event.data.type !== "GAME_SPARK_PREVIEW_CONTROL") return;
          var camera = getCamera();
          if (!camera || !window.BABYLON) return;
          var payload = event.data.payload || {};
          if (event.data.action === "zoom") zoomCamera(camera, Number(payload.delta) || 0);
          if (event.data.action === "pan") panCamera(camera, Number(payload.dx) || 0, Number(payload.dy) || 0);
          if (event.data.action === "move") moveCamera(camera, Number(payload.x) || 0, Number(payload.y) || 0);
          if (event.data.action === "reset") resetCamera(camera);
        });
      })();
    </script>`;
}

function engineScriptTag(engine) {
  if (engine === "phaser") {
    return '    <script src="./vendor/phaser.min.js"></script>';
  }
  return ['    <script src="./vendor/babylon.js"></script>', '    <script src="./vendor/babylonjs.loaders.min.js"></script>'].join("\n");
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
  manifest.engine = manifest.engine === "phaser" ? "phaser" : "babylonjs";
  manifest.style = typeof manifest.style === "string" ? manifest.style : manifest.engine === "phaser" ? "2D" : "babylonjs";
  manifest.createdAt = typeof manifest.createdAt === "string" ? manifest.createdAt : now;
  manifest.updatedAt = now;
  manifest.workspacePath = typeof manifest.workspacePath === "string" ? manifest.workspacePath : manifest.id;
  manifest.runtimeEntry = typeof manifest.runtimeEntry === "string" ? manifest.runtimeEntry : manifest.playCanvasEntry || "src/main.js";
  manifest.babylonEntry = typeof manifest.babylonEntry === "string" ? manifest.babylonEntry : manifest.engine === "babylonjs" ? manifest.runtimeEntry : undefined;
  manifest.phaserEntry = typeof manifest.phaserEntry === "string" ? manifest.phaserEntry : manifest.engine === "phaser" ? manifest.runtimeEntry : undefined;
  manifest.editor = normalizeEditorState(manifest.editor);
  manifest.logicGraph = normalizeLogicGraph(manifest.logicGraph, now);
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

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
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

module.exports = { createProjectPreviewService };
