#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createPreviewCore } from "./preview-core";

type CliArgs = {
  positionals: string[];
  help?: boolean;
  detailed?: boolean;
  open?: boolean;
  preview?: boolean;
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
  writeOutput({ ok: false, error: error instanceof Error ? error.message : String(error) }, { detailed: process.argv.includes("--detailed"), kind: "error" });
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [domain, action, subaction] = args.positionals;

  if (args.help || !domain) {
    writeOutput({ ok: true, usage: usage() }, { detailed: Boolean(args.detailed), kind: "help" });
    return;
  }

  if (domain === "editor") {
    const openResult = await openEditor({
      preview: false,
    });
    if (!openResult.ok) return exitOutput(openResult, args, 1, "error");
    writeOutput({ ok: true, opened: true, mode: "editor" }, { detailed: Boolean(args.detailed), kind: "editor" });
    keepAlive();
    return;
  }

  if ((domain === "start" && args.preview) || (domain === "preview" && action === "start")) {
    const result = await core.startPreviewServer({ project: projectArg(args), workspace: args.workspace, port: args.port });
    if (!result.ok) return exitOutput(result, args, 1, "error");
    let opened = false;
    if (args.open) {
      const openResult = await openElectronPreview({
        url: String(result.url),
        projectId: String(result.projectId),
        projectRoot: String(result.projectRoot),
      });
      opened = openResult.ok;
      if (!openResult.ok) {
        await core.stopPreviewServer(String(result.projectRoot));
        return exitOutput({ ...result, ok: false, opened, openError: openResult.error }, args, 1, "error");
      }
    }
    writeOutput({ ...result, opened }, { detailed: Boolean(args.detailed), kind: "preview-start" });
    keepAlive();
    return;
  }

  if (domain === "preview" && action === "rebuild") {
    return exitOutput(await core.rebuildProjectPreview({ project: projectArg(args), workspace: args.workspace }), args, undefined, "preview-rebuild");
  }

  if (domain === "scene" && action === "read") {
    return exitOutput(await core.readSceneFile({ project: projectArg(args), workspace: args.workspace, scenePath: args.scene }), args, undefined, "scene-read");
  }

  if (domain === "scene" && action === "context") {
    return exitOutput(await core.writeAgentContext({ project: projectArg(args), workspace: args.workspace, scenePath: args.scene }), args, undefined, "scene-context");
  }

  return exitOutput({ ok: false, error: `Unknown command: ${domain} ${action || ""}`.trim() }, args, 1, "error");
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
    if (!fs.existsSync(electronCommandPath)) {
      resolve({
        ok: false,
        error: `The editor UI package is installed, but Electron was not found at ${electronCommandPath}. Reinstall @game-spark/editor.`,
      });
      return;
    }
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
          GAME_SPARK_EDITOR_DIST: "1",
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
    const editorRoot = path.dirname(require.resolve("@game-spark/editor/package.json", { paths: [process.cwd(), __dirname] }));
    if (!fs.existsSync(path.join(editorRoot, "package.json"))) {
      return { ok: false, error: "The editor UI package could not be resolved." };
    }
    return { ok: true, editorRoot };
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
    if (name === "detailed") {
      result.detailed = true;
      continue;
    }
    if (name === "open") {
      result.open = true;
      continue;
    }
    if (name === "preview") {
      result.preview = true;
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
    "game-spark start --preview [--project <id-or-path>] [--workspace <path>] [--port <number|0>] [--open] [--detailed]",
    "game-spark editor [--detailed]",
    "game-spark preview start [--project <id-or-path>] [--workspace <path>] [--port <number|0>] [--open] [--detailed]",
    "game-spark preview rebuild --project <id-or-path> [--workspace <path>] [--detailed]",
    "game-spark scene read [--project <id-or-path>] [--workspace <path>] [--scene <path>] [--detailed]",
    "game-spark scene context [--project <id-or-path>] [--workspace <path>] [--scene <path>] [--detailed]",
  ];
}

function exitOutput(payload: JsonPayload, args: CliArgs, code = payload?.ok === false ? 1 : 0, kind: OutputKind = "generic") {
  writeOutput(payload, { detailed: Boolean(args.detailed), kind });
  process.exit(code);
}

type OutputKind = "help" | "editor" | "preview-start" | "preview-rebuild" | "scene-read" | "scene-context" | "error" | "generic";

function writeOutput(payload: JsonPayload, options: { detailed: boolean; kind: OutputKind }) {
  if (options.detailed) {
    writeJson(payload);
    return;
  }

  process.stdout.write(`${formatMessage(payload, options.kind)}\n`);
}

function formatMessage(payload: JsonPayload, kind: OutputKind) {
  if (payload.ok === false) {
    return `Game Spark failed: ${payload.error || payload.openError || "Unknown error."}`;
  }

  if (kind === "help") {
    return helpManual();
  }

  if (kind === "editor") {
    return "Game Spark editor opened.";
  }

  if (kind === "preview-start") {
    const lines = [`Preview server started: ${payload.url || "URL unavailable"}`];
    if (payload.opened) lines.push("Editor preview window opened.");
    else lines.push("Run with --open to open the editor preview window.");
    lines.push("Press Ctrl+C to stop the preview server.");
    return lines.join("\n");
  }

  if (kind === "preview-rebuild") {
    return "Preview rebuilt.";
  }

  if (kind === "scene-read") {
    return `Scene loaded${payload.path ? `: ${payload.path}` : "."}`;
  }

  if (kind === "scene-context") {
    return `Agent context written${payload.contextPath ? `: ${payload.contextPath}` : "."}`;
  }

  return "Game Spark command completed.";
}

function helpManual() {
  return [
    "Game Spark CLI",
    "",
    "Use Game Spark from a terminal or from an agent workflow. By default, commands print short human-readable output.",
    "Add --detailed when another tool needs the full JSON payload.",
    "",
    "Common Commands",
    "",
    "  Open the editor",
    "    game-spark editor",
    "",
    "  Start a playable preview for the current project",
    "    game-spark start --preview",
    "",
    "  Start a preview and open it in the editor window",
    "    game-spark preview start --project <id-or-path> --open",
    "",
    "  Rebuild a project's local preview",
    "    game-spark preview rebuild --project <id-or-path>",
    "",
    "  Read scene data for inspection",
    "    game-spark scene read --project <id-or-path> --scene <path>",
    "",
    "  Write scene context for an agent run",
    "    game-spark scene context --project <id-or-path> --scene <path>",
    "",
    "Options",
    "",
    "  --project <id-or-path>    Project id, project folder, or . for the current folder.",
    "  --workspace <path>        Workspace folder that contains local Game Spark projects.",
    "  --scene <path>            Scene file path inside the selected project.",
    "  --port <number|0>         Preview server port. Use 0 to choose an available port.",
    "  --open                    Open the Electron preview window after starting the server.",
    "  --detailed                Print JSON instead of concise text.",
    "  --help                    Show this help manual.",
    "",
    "All Commands",
    "",
    ...usage().map((line) => `  ${line}`),
  ].join("\n");
}

function writeJson(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
