import * as esbuild from "esbuild-wasm";
import wasmUrl from "esbuild-wasm/esbuild.wasm?url";
import { phaser2dSource } from "./phaser-2d-source";
import type { PreviewBundle, RuntimeAsset, RuntimeProject } from "../types/project-types";

let initialized: Promise<void> | undefined;

export async function bundleProject(project: RuntimeProject): Promise<PreviewBundle> {
  await initializeEsbuild();

  const entryPoint = normalizePath(project.entry);
  const virtualEntry = "/__runtime_entry.tsx";

  // Runtime compilation happens here. esbuild-wasm sees a virtual filesystem
  // made from user/LLM project files and assets, then emits one browser bundle.
  const result = await esbuild.build({
    absWorkingDir: "/",
    bundle: true,
    entryPoints: [virtualEntry],
    format: "iife",
    globalName: "__GameSparkAIBundle",
    write: false,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    target: "es2020",
    banner: {
      js: [
        "const React = globalThis.__RuntimeReact;",
        "const ReactDOM = globalThis.__RuntimeReactDOM;",
        "const RuntimeAssets = globalThis.__RuntimeAssets || {};",
      ].join("\n"),
    },
    plugins: [virtualProjectPlugin(project, virtualEntry, entryPoint)],
  });

  const output =
    result.outputFiles?.find((file) => file.path.endsWith(".js")) ??
    result.outputFiles?.find((file) => file.text.trim().length > 0);
  if (!output) {
    throw new Error("esbuild did not return a JavaScript bundle.");
  }

  return {
    js: output.text,
    assets: createRuntimeAssetMap(project.assets),
  };
}

function initializeEsbuild() {
  initialized ??= esbuild.initialize({
    wasmURL: wasmUrl,
    worker: true,
  });

  return initialized;
}

function virtualProjectPlugin(
  project: RuntimeProject,
  virtualEntry: string,
  entryPoint: string,
): esbuild.Plugin {
  const normalizedFiles = normalizeRecord(project.files);
  const normalizedAssets = normalizeAssetRecord(project.assets);

  return {
    name: "runtime-project",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === "react" || args.path === "react-dom" || args.path === "react-dom/client" || args.path === "phaser") {
          return { path: args.path, namespace: "runtime-external" };
        }

        if (args.path === "@runtime/phaser-2d") {
          return { path: args.path, namespace: "runtime-engine" };
        }

        if (args.path === virtualEntry) {
          return { path: virtualEntry, namespace: "runtime-files" };
        }

        const resolved = resolveVirtualPath(args.path, args.resolveDir || "/");
        const filePath = resolveExisting(resolved, normalizedFiles);
        if (filePath) {
          return { path: filePath, namespace: "runtime-files" };
        }

        const assetPath = resolveExisting(resolved, normalizedAssets);
        if (assetPath) {
          return { path: assetPath, namespace: "runtime-assets" };
        }

        return {
          errors: [{ text: `Could not resolve "${args.path}" from ${args.resolveDir || "/"}` }],
        };
      });

      build.onLoad({ filter: /.*/, namespace: "runtime-external" }, (args) => {
        const map: Record<string, string> = {
          react: "module.exports = React;",
          "react-dom": "module.exports = ReactDOM;",
          "react-dom/client": "module.exports = ReactDOM;",
          phaser: "module.exports = globalThis.__RuntimePhaser;",
        };

        return {
          contents: map[args.path],
          loader: "js",
        };
      });

      build.onLoad({ filter: /.*/, namespace: "runtime-engine" }, () => ({
        contents: phaser2dSource,
        loader: "jsx",
      }));

      build.onLoad({ filter: /.*/, namespace: "runtime-files" }, (args) => {
        if (args.path === virtualEntry) {
          return {
            contents: [
              `import App from ${JSON.stringify(entryPoint)};`,
              "globalThis.__GeneratedApp = App;",
            ].join("\n"),
            loader: "tsx",
            resolveDir: dirname(virtualEntry),
          };
        }

        const contents = normalizedFiles[args.path];
        if (contents === undefined) {
          return { errors: [{ text: `Missing virtual file: ${args.path}` }] };
        }

        return {
          contents,
          loader: loaderForPath(args.path),
          resolveDir: dirname(args.path),
        };
      });

      build.onLoad({ filter: /.*/, namespace: "runtime-assets" }, (args) => {
        const asset = normalizedAssets[args.path];
        if (!asset) {
          return { errors: [{ text: `Missing virtual asset: ${args.path}` }] };
        }

        if (asset.mime === "application/json" || args.path.endsWith(".json")) {
          return {
            contents: decodeTextAsset(asset),
            loader: "json",
          };
        }

        return {
          contents: dataUrlToBytes(asset.data),
          loader: "dataurl",
        };
      });
    },
  };
}

function createRuntimeAssetMap(assets: Record<string, RuntimeAsset>) {
  return Object.fromEntries(
    Object.entries(assets).map(([path, asset]) => [
      normalizePath(path),
      asset.data.startsWith("data:") ? asset.data : `data:${asset.mime};base64,${asset.data}`,
    ]),
  );
}

function normalizeRecord(files: Record<string, string>) {
  return Object.fromEntries(Object.entries(files).map(([path, contents]) => [normalizePath(path), contents]));
}

function normalizeAssetRecord(assets: Record<string, RuntimeAsset>) {
  return Object.fromEntries(Object.entries(assets).map(([path, asset]) => [normalizePath(path), asset]));
}

function resolveExisting(path: string, records: Record<string, unknown>) {
  const candidates = [
    path,
    `${path}.tsx`,
    `${path}.ts`,
    `${path}.jsx`,
    `${path}.js`,
    `${path}.json`,
    `${path}/index.tsx`,
    `${path}/index.ts`,
    `${path}/index.jsx`,
    `${path}/index.js`,
  ];

  return candidates.find((candidate) => candidate in records);
}

function resolveVirtualPath(path: string, resolveDir: string) {
  if (path.startsWith("/")) {
    return normalizePath(path);
  }

  if (path.startsWith(".")) {
    return normalizePath(`${resolveDir}/${path}`);
  }

  return normalizePath(path);
}

function normalizePath(path: string) {
  const parts: string[] = [];
  const input = path.replace(/\\/g, "/");

  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return `/${parts.join("/")}`;
}

function dirname(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function loaderForPath(path: string): esbuild.Loader {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".css")) return "css";
  return "js";
}

function decodeTextAsset(asset: RuntimeAsset) {
  if (asset.data.startsWith("data:")) {
    return atob(asset.data.split(",")[1] || "");
  }

  return asset.data;
}

function dataUrlToBytes(value: string) {
  const base64 = value.startsWith("data:") ? value.split(",")[1] || "" : value;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
