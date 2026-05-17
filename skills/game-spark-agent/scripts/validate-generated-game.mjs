#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.argv[2] || process.cwd());
const result = {
  projectRoot,
  status: "ready",
  errors: [],
  warnings: [],
  facts: {}
};

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  } catch {
    return "";
  }
}

function addError(message) {
  result.errors.push(message);
  result.status = "not-ready";
}

function addWarning(message) {
  result.warnings.push(message);
  if (result.status === "ready") result.status = "ready-with-gaps";
}

function walkFiles(dir, extensions) {
  const root = path.join(projectRoot, dir);
  if (!fs.existsSync(root)) return [];
  const output = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
        output.push(path.relative(projectRoot, fullPath).replaceAll("\\", "/"));
      }
    }
  }
  return output.sort();
}

let manifest = null;
try {
  manifest = JSON.parse(readText("manifest.json"));
} catch (error) {
  addError(`manifest.json does not parse: ${error.message}`);
}

const source = readText("src/main.js");
const build = readText("build/index.html");
if (!source) addError("src/main.js is missing or empty.");
if (!build) addError("build/index.html is missing or empty.");

const spriteFiles = walkFiles("assets/sprites", [".png"]);
const modelFiles = walkFiles("assets/models", [".glb", ".obj", ".gltf"]);
const sceneFiles = walkFiles("assets/scenes", [".glb", ".obj", ".gltf", ".spz"]);
result.facts.spriteFiles = spriteFiles.length;
result.facts.modelFiles = modelFiles.length;
result.facts.sceneFiles = sceneFiles.length;

if (manifest) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  result.facts.manifestAssets = assets.length;

  for (const asset of assets) {
    if (!asset || typeof asset !== "object") continue;
    if (asset.path && !exists(asset.path)) {
      addError(`Manifest asset path is missing on disk: ${asset.path}`);
    }
    const sourceValue = String(asset.source || "").toLowerCase();
    if (sourceValue.includes("fallback")) {
      addError(`Fallback asset cannot satisfy generated asset requirements: ${asset.path || asset.id || asset.name}`);
    }
    if ((asset.kind === "model" || asset.kind === "scene") && asset.path === "src/main.js") {
      addError(`3D ${asset.kind} asset points to src/main.js instead of a generated model/scene file: ${asset.id || asset.name}`);
    }
    if ((asset.kind === "model" || asset.kind === "scene") && sourceValue === "system") {
      addWarning(`3D ${asset.kind} asset is marked system, not generated: ${asset.id || asset.name}`);
    }
  }

  if (String(manifest.style || "").toUpperCase() === "HD2D" && spriteFiles.length === 0) {
    addError("HD2D project has no sprite sheets under assets/sprites.");
  }

  const spriteManifestPaths = new Set(
    assets.filter((asset) => asset.kind === "sprite" && asset.path).map((asset) => asset.path.replaceAll("\\", "/"))
  );
  for (const spriteFile of spriteFiles) {
    if (!spriteManifestPaths.has(spriteFile)) {
      addWarning(`Sprite sheet exists but has no dedicated manifest entry: ${spriteFile}`);
    }
  }
}

const hasDynamicSpriteLoader = /assets\/sprites/i.test(source) && /emotion|sheet|character|\$\{/i.test(source);
for (const spriteFile of spriteFiles) {
  const normalized = spriteFile.replaceAll("\\", "/");
  const basename = path.basename(normalized);
  if (!source.includes(normalized) && !source.includes(`./${normalized}`) && !source.includes(`../${normalized}`) && !source.includes(basename)) {
    if (hasDynamicSpriteLoader) {
      addWarning(`Sprite sheet is not literally referenced; dynamic loader must cover it: ${normalized}`);
    } else {
      addError(`Sprite sheet exists but is not referenced by runtime source: ${normalized}`);
    }
  }
}

const runtimeAssetRefs = [...source.matchAll(/["'`](\.{0,2}\/)?(assets\/(?:sprites|models|scenes|textures|audio)\/[^"'`)\s]+)/g)]
  .map((match) => match[2].replaceAll("\\", "/"));
for (const assetRef of new Set(runtimeAssetRefs)) {
  if (!exists(assetRef)) {
    addError(`Runtime references missing asset: ${assetRef}`);
  }
}

const hasGenerated3dFiles = modelFiles.length + sceneFiles.length > 0;
const claimsGenerated3d =
  /\bgenerated\s+3d\b/i.test(source) ||
  /\bimage-blaster\b/i.test(source) ||
  (manifest && JSON.stringify(manifest.assets || []).match(/"kind"\s*:\s*"(model|scene)"/i));

if (claimsGenerated3d && !hasGenerated3dFiles) {
  addError("Project claims or requires 3D model/scene assets but has no local .glb/.obj/.gltf/.spz files under assets/models or assets/scenes.");
}

const latestPrompt = walkFiles("runs", [".md"])
  .filter((file) => file.endsWith("/prompt.md"))
  .sort()
  .at(-1);
const promptText = latestPrompt ? readText(latestPrompt) : "";
if (/drag\s*\/?\s*drop|drag and drop/i.test(promptText)) {
  const pointerDrag =
    /pointerdown|mousedown|touchstart/i.test(source) &&
    /pointerup|mouseup|touchend/i.test(source) &&
    /raycast|screenToWorld|pick|dropTarget|drop target/i.test(source);
  if (!pointerDrag) {
    addError("Prompt requested drag/drop, but runtime does not implement pointer-driven drag/drop target detection.");
  }
}

if (/story|roleplay|novel|dialogue|branch/i.test(promptText)) {
  if (!/storyState|dialogueQueue|choices|objectReactions|branch/i.test(source)) {
    addError("Story/roleplay prompt lacks a clear narrative state machine with dialogue, choices, object reactions, and branches.");
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 1 : 0);
