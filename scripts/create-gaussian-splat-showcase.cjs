const fs = require("node:fs/promises");
const path = require("node:path");
const esbuild = require("../engine/editor/node_modules/esbuild");

const repoRoot = path.resolve(__dirname, "..");
const editorRoot = path.join(repoRoot, "engine", "editor");
const sourceSog = "C:\\Users\\ellis\\Downloads\\Cochem Imperial Castle, Germany.sog";
const projectId = "cochem-gaussian-splat-showcase";
const title = "Cochem Gaussian Splat Showcase";

async function main() {
  const workspaceRoot = await resolveWorkspaceRoot();
  const projectRoot = path.join(workspaceRoot, projectId);
  const now = new Date().toISOString();

  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "assets", "models"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "assets", "scenes"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "build"), { recursive: true });

  const modelTarget = path.join(projectRoot, "assets", "models", "cochem-imperial-castle.sog");
  await fs.copyFile(sourceSog, modelTarget);

  await fs.writeFile(path.join(projectRoot, "src", "main.js"), runtimeSource(), "utf8");
  await fs.writeFile(path.join(projectRoot, "build", "index.html"), indexHtml(), "utf8");
  await fs.writeFile(path.join(projectRoot, "assets", "scenes", "main.scene.json"), JSON.stringify(sceneFile(now), null, 2), "utf8");
  await fs.writeFile(path.join(projectRoot, "manifest.json"), JSON.stringify(manifest(now), null, 2), "utf8");

  await esbuild.build({
    entryPoints: [path.join(projectRoot, "src", "main.js")],
    bundle: true,
    absWorkingDir: editorRoot,
    nodePaths: [path.join(editorRoot, "node_modules")],
    outfile: path.join(projectRoot, "build", "main.js"),
    format: "iife",
    platform: "browser",
    target: "es2020",
    sourcemap: false,
    logLevel: "silent",
  });

  console.log(`Created ${projectRoot}`);
}

async function resolveWorkspaceRoot() {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
  const settingsPath = path.join(appData, "game-spark-ai", "settings.json");
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    if (typeof settings.workspaceRoot === "string" && settings.workspaceRoot.trim()) {
      return settings.workspaceRoot;
    }
  } catch {
    // Fall back to the same default workspace used by the Electron app.
  }
  return path.join(process.env.USERPROFILE || "", "Game Spark AI");
}


function indexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <canvas id="application"></canvas>
    <script src="./main.js"></script>
  </body>
</html>
`;
}

function runtimeSource() {
  return `import * as BABYLON from "@babylonjs/core";
import "@babylonjs/loaders/SPLAT";

(() => {
  const canvas = document.getElementById("application");
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
  });

  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.025, 0.031, 0.04, 1);
  scene.environmentIntensity = 0.6;

  const camera = new BABYLON.UniversalCamera("editor-camera", new BABYLON.Vector3(0, 2, -13), scene);
  camera.minZ = 0.02;
  camera.maxZ = 10000;
  installDefaultSceneViewerControls(canvas, camera, BABYLON);

  const light = new BABYLON.HemisphericLight("soft-sky", new BABYLON.Vector3(0.2, 1, 0.4), scene);
  light.intensity = 0.65;

  installCanvasStyles();
  const transformState = {
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    rotationX: 180,
    rotationY: 180,
    rotationZ: 0,
    scale: 1,
  };
  const transformOverlay = createTransformOverlay(transformState, applyTransformState);
  const modelUrl = "./assets/models/cochem-imperial-castle.sog";
  let environmentRoot = null;
  let baseTransform = null;

  BABYLON.ImportMeshAsync(modelUrl, scene)
    .then((result) => {
      const splat = result.meshes.find((mesh) => mesh instanceof BABYLON.GaussianSplattingMesh) || result.meshes[0];
      splat.name = "Cochem Imperial Castle SOG";

      environmentRoot = new BABYLON.TransformNode("environment-root", scene);
      result.meshes.forEach((mesh) => {
        if (mesh === environmentRoot) return;
        mesh.parent = environmentRoot;
      });

      const frame = moveEnvironmentToCameraTarget(environmentRoot, result.meshes, BABYLON);
      baseTransform = {
        position: environmentRoot.position.clone(),
        scaling: environmentRoot.scaling.clone(),
      };
      applyTransformState();
      camera.position.copyFrom(frame.center.add(new BABYLON.Vector3(0, frame.radius * 0.28, -frame.radius)));
      camera.setTarget(frame.center);
      camera.metadata = { ...(camera.metadata || {}), viewerRadius: frame.radius };
      camera.maxZ = Math.max(frame.radius * 40, 1000);
      transformOverlay.setStatus("Loaded");

    })
    .catch((error) => {
      transformOverlay.setStatus("Load failed");
      console.error(error);
    });

  engine.runRenderLoop(() => scene.render());
  window.addEventListener("resize", () => engine.resize());

  function moveEnvironmentToCameraTarget(root, meshes, BABYLON) {
    const targetLargestDimension = 9;
    let bounds = getEnvironmentBounds(meshes, BABYLON);
    let center = bounds.min.add(bounds.max).scale(0.5);
    let size = bounds.max.subtract(bounds.min);
    let largestDimension = Math.max(size.x, size.y, size.z, 1);
    const scale = targetLargestDimension / largestDimension;

    root.scaling.scaleInPlace(scale);
    root.computeWorldMatrix(true);
    meshes.forEach((mesh) => mesh.computeWorldMatrix(true));

    bounds = getEnvironmentBounds(meshes, BABYLON);
    center = bounds.min.add(bounds.max).scale(0.5);
    root.position.subtractInPlace(center);
    root.computeWorldMatrix(true);
    meshes.forEach((mesh) => mesh.computeWorldMatrix(true));

    bounds = getEnvironmentBounds(meshes, BABYLON);
    size = bounds.max.subtract(bounds.min);
    largestDimension = Math.max(size.x, size.y, size.z, 1);

    return {
      center: new BABYLON.Vector3(0, 0, 0),
      radius: Math.max(largestDimension * 0.72, 4),
    };
  }

  function getEnvironmentBounds(meshes, BABYLON) {
    const renderableMeshes = meshes.filter((mesh) => mesh.getHierarchyBoundingVectors || mesh.getBoundingInfo);
    if (!renderableMeshes.length) {
      return { min: new BABYLON.Vector3(-1, -1, -1), max: new BABYLON.Vector3(1, 1, 1) };
    }

    return renderableMeshes.reduce(
      (bounds, mesh) => {
        const meshBounds = mesh.getHierarchyBoundingVectors
          ? mesh.getHierarchyBoundingVectors(true)
          : {
              min: mesh.getBoundingInfo().boundingBox.minimumWorld,
              max: mesh.getBoundingInfo().boundingBox.maximumWorld,
            };
        return {
          min: BABYLON.Vector3.Minimize(bounds.min, meshBounds.min),
          max: BABYLON.Vector3.Maximize(bounds.max, meshBounds.max),
        };
      },
      {
        min: new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY),
        max: new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY),
      },
    );
  }

  function applyTransformState() {
    if (!environmentRoot || !baseTransform) return;
    environmentRoot.position.copyFrom(
      baseTransform.position.add(new BABYLON.Vector3(transformState.offsetX, transformState.offsetY, transformState.offsetZ)),
    );
    environmentRoot.rotation = new BABYLON.Vector3(
      BABYLON.Tools.ToRadians(transformState.rotationX),
      BABYLON.Tools.ToRadians(transformState.rotationY),
      BABYLON.Tools.ToRadians(transformState.rotationZ),
    );
    environmentRoot.scaling.copyFrom(baseTransform.scaling.scale(transformState.scale));
  }

  function installDefaultSceneViewerControls(canvas, camera, BABYLON) {
    if (camera.inputs?.attached?.pointers) {
      camera.inputs.attached.pointers.buttons = [0];
    }

    let rightMouseHeld = false;
    let rightLook = null;
    let middlePan = null;
    const pressedKeys = new Set();

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("wheel", (event) => {
      const basis = cameraBasis();
      const speed = viewerMoveScale() * 0.12;
      translateCamera(basis.forward.scale(event.deltaY < 0 ? speed : -speed));
      event.preventDefault();
    }, { passive: false });

    canvas.addEventListener("pointerdown", (event) => {
      canvas.focus();
      if (event.button === 2) {
        rightMouseHeld = true;
        rightLook = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      if (event.button === 1) {
        middlePan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      if (rightLook && rightLook.pointerId === event.pointerId) {
        rotateCamera(event.clientX - rightLook.x, event.clientY - rightLook.y);
        rightLook = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        event.preventDefault();
        return;
      }
      if (!middlePan || middlePan.pointerId !== event.pointerId) return;
      panCamera(event.clientX - middlePan.x, event.clientY - middlePan.y);
      middlePan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      event.preventDefault();
    });

    canvas.addEventListener("pointerup", (event) => {
      if (event.button === 2) {
        rightMouseHeld = false;
        rightLook = null;
      }
      if (middlePan?.pointerId === event.pointerId) middlePan = null;
    });

    canvas.addEventListener("pointercancel", (event) => {
      if (middlePan?.pointerId === event.pointerId) middlePan = null;
      if (rightLook?.pointerId === event.pointerId) rightLook = null;
      rightMouseHeld = false;
    });

    window.addEventListener("blur", () => {
      rightMouseHeld = false;
      rightLook = null;
      middlePan = null;
      pressedKeys.clear();
    });

    window.addEventListener("keydown", (event) => {
      if (!rightMouseHeld) return;
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d"].includes(key)) return;
      pressedKeys.add(key);
      event.preventDefault();
    });

    window.addEventListener("keyup", (event) => {
      pressedKeys.delete(event.key.toLowerCase());
    });

    scene.onBeforeRenderObservable.add(() => {
      if (!rightMouseHeld || pressedKeys.size === 0) return;
      const delta = Math.min(0.05, engine.getDeltaTime() / 1000);
      const speed = viewerMoveScale() * (pressedKeys.has("shift") ? 1.6 : 0.9) * delta;
      let x = 0;
      let z = 0;
      if (pressedKeys.has("w")) z += speed;
      if (pressedKeys.has("s")) z -= speed;
      if (pressedKeys.has("a")) x -= speed;
      if (pressedKeys.has("d")) x += speed;
      moveCamera(x, z);
    });

    function cameraBasis() {
      const forward = camera.getForwardRay().direction;
      if (forward.lengthSquared() > 0.0001) forward.normalize();
      const right = camera.getDirection(BABYLON.Axis.X).normalize();
      const up = camera.getDirection(BABYLON.Axis.Y).normalize();
      return { forward, right, up };
    }

    function viewerMoveScale() {
      return Math.max(2, camera.metadata?.viewerRadius || 10);
    }

    function translateCamera(vector) {
      camera.position.addInPlace(vector);
    }

    function moveCamera(x, z) {
      const basis = cameraBasis();
      translateCamera(basis.right.scale(x).add(basis.forward.scale(z)));
    }

    function rotateCamera(dx, dy) {
      const angularScale = 0.0045;
      camera.rotation.y += dx * angularScale;
      camera.rotation.x = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camera.rotation.x + dy * angularScale));
    }

    function panCamera(dx, dy) {
      const basis = cameraBasis();
      const scale = Math.max(0.01, viewerMoveScale() * 0.0018);
      translateCamera(basis.right.scale(-dx * scale).add(basis.up.scale(dy * scale)));
    }
  }

  function installCanvasStyles() {
    const style = document.createElement("style");
    style.textContent = \`
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #05070a;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #application {
        width: 100%;
        height: 100%;
        display: block;
        outline: none;
      }

      .coords-panel {
        position: fixed;
        left: 14px;
        bottom: 14px;
        z-index: 10;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        width: min(360px, calc(100vw - 28px));
        padding: 12px;
        color: #eef4ff;
        background: rgba(8, 11, 16, 0.76);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(10px);
      }

      .coords-panel header {
        display: flex;
        grid-column: 1 / -1;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .coords-panel-body {
        display: contents;
      }

      .coords-panel.collapsed {
        grid-template-columns: minmax(0, 1fr);
        width: auto;
      }

      .coords-panel.collapsed .coords-panel-body,
      .coords-panel.collapsed [data-status] {
        display: none;
      }

      .coords-panel strong,
      .coords-panel span,
      .coords-panel label {
        font-size: 12px;
        letter-spacing: 0;
      }

      .coords-panel span {
        color: #9ee3c2;
      }

      .coords-panel label {
        display: grid;
        gap: 4px;
        color: #bfcbda;
      }

      .coords-panel input {
        min-width: 0;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        padding: 6px 8px;
        background: rgba(255, 255, 255, 0.08);
        color: #eef4ff;
        font: inherit;
      }

      .coords-panel button {
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 999px;
        padding: 5px 9px;
        background: rgba(255, 255, 255, 0.08);
        color: #eef4ff;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
      }
    \`;
    document.head.appendChild(style);
  }

  function createTransformOverlay(state, onChange) {
    const panel = document.createElement("section");
    panel.className = "coords-panel";
    panel.innerHTML = \`
      <header>
        <strong>Scene transform</strong>
        <span data-status>Loading</span>
        <button type="button" data-collapse aria-label="Collapse scene transform panel">Hide</button>
      </header>
      <div class="coords-panel-body">
        <label>Position X <input type="number" step="0.1" data-key="offsetX" /></label>
        <label>Position Y <input type="number" step="0.1" data-key="offsetY" /></label>
        <label>Position Z <input type="number" step="0.1" data-key="offsetZ" /></label>
        <label>Rotate X <input type="number" step="1" data-key="rotationX" /></label>
        <label>Rotate Y <input type="number" step="1" data-key="rotationY" /></label>
        <label>Rotate Z <input type="number" step="1" data-key="rotationZ" /></label>
        <label>Scale <input type="number" min="0.05" step="0.05" data-key="scale" /></label>
      </div>
    \`;
    document.body.appendChild(panel);
    const collapseButton = panel.querySelector("[data-collapse]");

    collapseButton.addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      collapseButton.textContent = collapsed ? "Show" : "Hide";
      collapseButton.setAttribute("aria-label", collapsed ? "Expand scene transform panel" : "Collapse scene transform panel");
    });

    panel.querySelectorAll("input").forEach((input) => {
      const key = input.dataset.key;
      input.value = String(state[key]);
      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        state[key] = key === "scale" ? Math.max(0.05, value) : value;
        onChange();
      });
    });

    return {
      setStatus(status) {
        const statusElement = panel.querySelector("[data-status]");
        if (statusElement) statusElement.textContent = status;
      },
    };
  }
})();
`;
}

function sceneFile(now) {
  return {
    schemaVersion: 1,
    id: `${projectId}-main-scene`,
    engine: "babylonjs",
    updatedAt: now,
    objects: [
      {
        id: "cochem-sog",
        name: "Cochem Imperial Castle SOG",
        kind: "model",
        assetRef: "asset-cochem-sog",
        editable: true,
        tags: ["gaussian-splat", "sog", "showcase"],
        transform: { x: 50, y: 50, z: 0, rotationX: 180, rotationY: 180, rotationZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      },
    ],
  };
}

function manifest(now) {
  return {
    id: projectId,
    title,
    style: "babylonjs",
    engine: "babylonjs",
    editor: {
      applyMode: "auto",
      previewMode: "edit",
      playStartMode: "fresh",
      activeScenePath: "assets/scenes/main.scene.json",
      activeTool: "world",
      tools: [
        { id: "character-2d", title: "2D Character", status: "empty", summary: "No 2D character for this showcase.", assetRefs: [] },
        { id: "character-3d", title: "3D Character", status: "ready", summary: "Gaussian splat model loaded through Babylon.js.", assetRefs: ["asset-cochem-sog"] },
        { id: "world", title: "World", status: "ready", summary: "Cochem Imperial Castle SOG preview scene.", assetRefs: ["asset-cochem-sog"] },
        { id: "logic", title: "Logic", status: "ready", summary: "Orbit camera and loading status overlay.", assetRefs: [] },
        { id: "ui-dialogue", title: "UI Dialogue", status: "ready", summary: "Minimal showcase overlay.", assetRefs: [] },
        { id: "audio", title: "Audio", status: "empty", summary: "No audio for this showcase.", assetRefs: [] },
        { id: "publish", title: "Publish", status: "ready", summary: "Local preview build is ready.", assetRefs: [] },
      ],
    },
    logicGraph: {
      source: "code-derived",
      updatedAt: now,
      nodes: [
        { id: "load-sog", kind: "action", title: "Load SOG", summary: "Import the Gaussian splat with Babylon.js.", codeRefs: ["src/main.js"], x: 35, y: 30 },
        { id: "frame-camera", kind: "action", title: "Frame Camera", summary: "Fit the orbit camera to the loaded splat bounds.", codeRefs: ["src/main.js"], x: 62, y: 42 },
      ],
      edges: [{ id: "load-to-frame", from: "load-sog", to: "frame-camera", label: "on load" }],
    },
    createdAt: now,
    updatedAt: now,
    workspacePath: projectId,
    runtimeEntry: "src/main.js",
    babylonEntry: "src/main.js",
    buildPath: `${projectId}/build/index.html`,
    promptHistory: [
      {
        id: "prompt-gaussian-splat-showcase",
        content: "Create a Babylon.js Gaussian splat showcase for Cochem Imperial Castle, Germany.sog.",
        createdAt: now,
      },
    ],
    runHistory: [
      {
        id: "showcase-created",
        createdAt: now,
        status: "ready",
        summary: "Created a local Babylon.js showcase that loads the SOG Gaussian splat.",
      },
    ],
    assets: [
      {
        id: "asset-cochem-sog",
        name: "Cochem Imperial Castle, Germany",
        kind: "model",
        path: "assets/models/cochem-imperial-castle.sog",
        source: "imported",
        previewColor: "#88bfa8",
        usage: "Loaded as a Babylon.js GaussianSplattingMesh in the runtime showcase.",
        metadata: { format: "sog", sourceFile: sourceSog },
      },
    ],
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
