#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createPreviewCore } from "./preview-core";

type CliArgs = {
  positionals: string[];
  help?: boolean;
  open?: boolean;
  port?: number;
  project?: string;
  workspace?: string;
  scene?: string;
  [key: string]: string | number | boolean | string[] | undefined;
};

type JsonPayload = Record<string, unknown>;

declare const __dirname: string;
declare const require: NodeRequire;

const engineRoot = path.resolve(__dirname, "..", "..");
const repoRoot = path.resolve(engineRoot, "..");
const core = createPreviewCore({ repoRoot, editorRoot: path.join(engineRoot, "editor") });
let previewChild: ReturnType<typeof spawn> | null = null;

main().catch((error) => {
  writeJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [domain, action, subaction] = args.positionals;

  if (args.help || !domain) {
    writeJson({ ok: true, usage: usage() });
    return;
  }

  if (domain === "editor") {
    const openResult = await openEditor({
      preview: false,
    });
    if (!openResult.ok) return exitJson(openResult, 1);
    writeJson({ ok: true, opened: true, mode: "editor" });
    keepAlive();
    return;
  }

  if ((domain === "start" && args.preview) || (domain === "preview" && action === "start")) {
    const result = await core.startPreviewServer({ project: projectArg(args), workspace: args.workspace, port: args.port });
    if (!result.ok) return exitJson(result, 1);
    let opened = false;
    if (args.open) {
      const openResult = await openElectronPreview({
        url: String(result.url),
        projectId: String(result.projectId),
        projectRoot: String(result.projectRoot),
      });
      opened = openResult.ok;
      if (!openResult.ok) return exitJson({ ...result, opened, openError: openResult.error }, 1);
    }
    writeJson({ ...result, opened });
    keepAlive();
    return;
  }

  if (domain === "preview" && action === "rebuild") {
    return exitJson(await core.rebuildProjectPreview({ project: projectArg(args), workspace: args.workspace }));
  }

  if (domain === "scene" && action === "read") {
    return exitJson(await core.readSceneFile({ project: projectArg(args), workspace: args.workspace, scenePath: args.scene }));
  }

  if (domain === "scene" && action === "context") {
    return exitJson(await core.writeAgentContext({ project: projectArg(args), workspace: args.workspace, scenePath: args.scene }));
  }

  return exitJson({ ok: false, error: `Unknown command: ${domain} ${action}` }, 1);
}

function projectArg(args: CliArgs) {
  return args.project || ".";
}

function openElectronPreview(session: { url: string; projectId: string; projectRoot: string }): Promise<{ ok: boolean; error?: string }> {
  return openEditor({
    preview: true,
    url: session.url,
    projectId: session.projectId,
    projectRoot: session.projectRoot,
  });
}

function openEditor(session: { preview: boolean; url?: string; projectId?: string; projectRoot?: string }): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const editorResolution = resolveEditorPackageRoot();
    if (!editorResolution.ok) {
      resolve({ ok: false, error: editorResolution.error });
      return;
    }
    const editorRoot = editorResolution.editorRoot;
    const electronCommandPath =
      process.platform === "win32"
        ? path.join(editorRoot, "node_modules", "electron", "dist", "electron.exe")
        : path.join(editorRoot, "node_modules", ".bin", "electron");
    let settled = false;
    previewChild = spawn(
      electronCommandPath,
      [
        ".",
      ],
      {
        cwd: editorRoot,
        env: {
          ...process.env,
          ...(session.preview
            ? {
                GAME_SPARK_PREVIEW_URL: session.url || "",
                GAME_SPARK_PREVIEW_PROJECT_ID: session.projectId || "",
                GAME_SPARK_PREVIEW_PROJECT_ROOT: session.projectRoot || "",
              }
            : {}),
        },
        stdio: ["ignore", "ignore", "pipe"],
        shell: false,
        windowsHide: false,
      },
    );
    let stderr = "";
    previewChild.stderr?.setEncoding("utf8");
    previewChild.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    const openTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ ok: true });
      }
    }, 1200);
    previewChild.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(openTimer);
        resolve({ ok: false, error: error.message });
      }
    });
    previewChild.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(openTimer);
        resolve({ ok: false, error: stderr.trim() || `Preview window exited before opening with code ${code}.` });
        return;
      }
      process.exit(0);
    });
  });
}

function resolveEditorPackageRoot(): { ok: true; editorRoot: string } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      editorRoot: path.dirname(require.resolve("@game-spark/editor/package.json", { paths: [process.cwd(), __dirname] })),
    };
  } catch {
    const globalEditorRoot = resolveGlobalEditorPackageRoot();
    if (globalEditorRoot) {
      return { ok: true, editorRoot: globalEditorRoot };
    }
    return { ok: false, error: "The editor UI package is not installed. Install it with `npm install -g @game-spark/editor` or run `npx @game-spark/editor`." };
  }
}

function resolveGlobalEditorPackageRoot() {
  const candidates = new Set<string>();
  try {
    const prefix = execFileSync("npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" }).trim();
    if (prefix) candidates.add(path.join(prefix, "@game-spark", "editor"));
  } catch {
    /* Fall back to conventional npm global locations below. */
  }

  if (process.env.APPDATA) {
    candidates.add(path.join(process.env.APPDATA, "npm", "node_modules", "@game-spark", "editor"));
  }

  for (const editorRoot of candidates) {
    if (fs.existsSync(path.join(editorRoot, "package.json"))) return editorRoot;
  }

  return "";
}


function keepAlive() {
  const timer = setInterval(() => undefined, 60_000);
  process.on("SIGINT", () => {
    previewChild?.kill();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    clearInterval(timer);
    previewChild?.kill();
    process.exit(0);
  });
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result.positionals.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "help") {
      result.help = true;
      continue;
    }
    if (name === "open") {
      result.open = true;
      continue;
    }
    const value = argv[index + 1];
    index += 1;
    if (name === "port") result.port = Number(value) || 0;
    else result[name] = value;
  }
  return result;
}

function usage(): string[] {
  return [
    "game-spark start --preview [--project <id-or-path>] [--workspace <path>] [--port <number|0>] [--open]",
    "game-spark editor  # requires @game-spark/editor",
    "game-spark preview start [--project <id-or-path>] [--workspace <path>] [--port <number|0>] [--open]",
    "game-spark preview rebuild --project <id-or-path> [--workspace <path>]",
    "game-spark scene read [--project <id-or-path>] [--workspace <path>] [--scene <path>]",
    "game-spark scene context [--project <id-or-path>] [--workspace <path>] [--scene <path>]",
  ];
}

function exitJson(payload: JsonPayload, code = payload?.ok === false ? 1 : 0) {
  writeJson(payload);
  process.exit(code);
}

function writeJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
