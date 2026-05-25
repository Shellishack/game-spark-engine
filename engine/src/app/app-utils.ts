import { createDefaultEditorState, createDefaultLogicGraph } from "../data/codex-pipeline";
import { templateSupportsPhaser } from "../data/game-templates";
import type {
  AgentPhase,
  CodexRunRequest,
  EditorToolId,
  GameEngine,
  GameProjectAsset,
  GameProjectManifest,
  PromptBlock,
  WorkspaceProjectSummary,
} from "../types/project-types";
import { phaseLabels } from "./app-constants";

export function blockToPromptText(block: PromptBlock) {
  if (block.type === "text") return block.content.trim();
  return `Attached file: ${block.name} (${block.sizeLabel})`;
}

export class ManifestNormalizer {
  normalize(manifest: GameProjectManifest): GameProjectManifest {
    const now = new Date().toISOString();
    const id = typeof manifest.id === "string" ? manifest.id : slugifyTitle(manifest.title || "local-game");
    const title = typeof manifest.title === "string" ? manifest.title : id;
    const promptHistory = normalizePromptHistory(manifest, now);
    const runHistory = normalizeRunHistory(manifest, now);
    const assets = normalizeAssets(manifest);
    const engine: GameEngine = manifest.engine === "phaser" ? "phaser" : "babylonjs";
    const runtimeEntry =
      typeof manifest.runtimeEntry === "string"
        ? manifest.runtimeEntry
        : typeof manifest.playCanvasEntry === "string"
          ? manifest.playCanvasEntry
          : "src/main.js";
    const manifestRecord = manifest as unknown as Record<string, unknown>;
    const editor = normalizeEditor(manifestRecord);
    const logicGraph = normalizeLogicGraph(manifestRecord, now);

    return {
      id,
      title,
      style: typeof manifest.style === "string" && ["2D", "HD2D", "3D", "image-blaster", "babylonjs"].includes(manifest.style) ? manifest.style : "babylonjs",
      engine,
      editor,
      logicGraph,
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : now,
      updatedAt: typeof manifest.updatedAt === "string" ? manifest.updatedAt : now,
      workspacePath: typeof manifest.workspacePath === "string" ? manifest.workspacePath : id,
      runtimeEntry,
      babylonEntry: typeof manifest.babylonEntry === "string" ? manifest.babylonEntry : engine === "babylonjs" ? runtimeEntry : undefined,
      phaserEntry:
        typeof manifest.phaserEntry === "string"
          ? manifest.phaserEntry
          : engine === "phaser"
            ? runtimeEntry
            : undefined,
      playCanvasEntry: typeof manifest.playCanvasEntry === "string" ? manifest.playCanvasEntry : undefined,
      buildPath: typeof manifest.buildPath === "string" ? manifest.buildPath : `${id}/build/index.html`,
      publishedPath: typeof manifest.publishedPath === "string" ? manifest.publishedPath : undefined,
      promptHistory,
      runHistory,
      assets,
    };
  }
}

export const manifestNormalizer = new ManifestNormalizer();

export function normalizeManifest(manifest: GameProjectManifest): GameProjectManifest {
  return manifestNormalizer.normalize(manifest);
}

function normalizePromptHistory(manifest: GameProjectManifest, now: string) {
  return Array.isArray(manifest.promptHistory)
    ? manifest.promptHistory.map((prompt, index) => {
        const record = prompt as unknown as Record<string, unknown>;
        return {
          id: typeof record.id === "string" ? record.id : `prompt-${index + 1}`,
          content: typeof record.content === "string" ? record.content : typeof record.prompt === "string" ? record.prompt : "",
          createdAt: typeof record.createdAt === "string" ? record.createdAt : typeof record.timestamp === "string" ? record.timestamp : now,
        };
      })
    : [];
}

function normalizeRunHistory(manifest: GameProjectManifest, now: string) {
  return Array.isArray(manifest.runHistory)
    ? manifest.runHistory.map((run, index) => {
        const record = run as unknown as Record<string, unknown>;
        const status = typeof record.status === "string" && record.status in phaseLabels ? (record.status as AgentPhase) : "ready";
        return {
          id: typeof record.id === "string" ? record.id : `run-${index + 1}`,
          createdAt: typeof record.createdAt === "string" ? record.createdAt : typeof record.timestamp === "string" ? record.timestamp : now,
          status,
          summary: typeof record.summary === "string" ? record.summary : typeof record.mode === "string" ? `${record.mode} run` : "Local game run.",
        };
      })
    : [];
}

function normalizeAssets(manifest: GameProjectManifest) {
  return Array.isArray(manifest.assets)
    ? manifest.assets.map((asset, index) => {
        const record = asset as unknown as Record<string, unknown>;
        const kind = typeof record.kind === "string" && ["sprite", "model", "texture", "script", "scene"].includes(record.kind) ? record.kind : "texture";
        const source = typeof record.source === "string" && ["generated", "imported", "system"].includes(record.source) ? record.source : "generated";
        return {
          id: typeof record.id === "string" ? record.id : `asset-${index + 1}`,
          name: typeof record.name === "string" ? record.name : `Asset ${index + 1}`,
          kind: kind as GameProjectAsset["kind"],
          path: typeof record.path === "string" ? record.path : "",
          source: source as GameProjectAsset["source"],
          previewColor: typeof record.previewColor === "string" ? record.previewColor : "#d7c66a",
          usage: typeof record.usage === "string" ? record.usage : "Project asset",
          metadata: record.metadata && typeof record.metadata === "object" ? (record.metadata as GameProjectAsset["metadata"]) : undefined,
        };
      })
    : [];
}

function normalizeEditor(manifestRecord: Record<string, unknown>): GameProjectManifest["editor"] {
  const defaultEditor = createDefaultEditorState();
  const editorRecord = manifestRecord.editor && typeof manifestRecord.editor === "object" ? (manifestRecord.editor as Record<string, unknown>) : {};
  const editorTools = Array.isArray(editorRecord.tools)
    ? defaultEditor.tools.map((defaultTool) => {
        const savedTool = (editorRecord.tools as unknown[]).find((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === defaultTool.id) as
          | Record<string, unknown>
          | undefined;
        return {
          ...defaultTool,
          status:
            savedTool?.status === "empty" || savedTool?.status === "ready" || savedTool?.status === "needs-generation"
              ? savedTool.status
              : defaultTool.status,
          summary: typeof savedTool?.summary === "string" ? savedTool.summary : defaultTool.summary,
          assetRefs: Array.isArray(savedTool?.assetRefs) ? savedTool.assetRefs.filter((item): item is string => typeof item === "string") : defaultTool.assetRefs,
        };
      })
    : defaultEditor.tools;

  return {
    applyMode: editorRecord.applyMode === "auto" ? "auto" : "preview",
    previewMode: editorRecord.previewMode === "play" ? "play" : "edit",
    playStartMode: editorRecord.playStartMode === "current" ? "current" : "fresh",
    activeScenePath: typeof editorRecord.activeScenePath === "string" ? editorRecord.activeScenePath : defaultEditor.activeScenePath,
    activeTool: defaultEditor.tools.some((tool) => tool.id === editorRecord.activeTool) ? (editorRecord.activeTool as EditorToolId) : defaultEditor.activeTool,
    tools: editorTools,
  };
}

function normalizeLogicGraph(manifestRecord: Record<string, unknown>, now: string): GameProjectManifest["logicGraph"] {
  const graphRecord = manifestRecord.logicGraph && typeof manifestRecord.logicGraph === "object" ? (manifestRecord.logicGraph as Record<string, unknown>) : {};
  const defaultGraph = createDefaultLogicGraph(now);
  return {
    source: graphRecord.source === "ai-proposed" ? "ai-proposed" : "code-derived",
    updatedAt: typeof graphRecord.updatedAt === "string" ? graphRecord.updatedAt : defaultGraph.updatedAt,
    nodes: Array.isArray(graphRecord.nodes) && graphRecord.nodes.length ? graphRecord.nodes : defaultGraph.nodes,
    edges: Array.isArray(graphRecord.edges) && graphRecord.edges.length ? graphRecord.edges : defaultGraph.edges,
  };
}

export function formatRelativeDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const diffMs = Date.now() - timestamp;
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs < 60 * 1000) return "Just now";
  if (diffMs < dayMs) return "Today";
  if (diffMs < dayMs * 2) return "Yesterday";
  if (diffMs < dayMs * 7) return "This week";
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function slugifyTitle(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local-game"
  );
}

export function findDuplicateProject(projectName: string, projects: WorkspaceProjectSummary[]) {
  const requestedId = slugifyTitle(projectName);
  const requestedTitle = projectName.trim().toLowerCase();
  return projects.find((item) => item.id.toLowerCase() === requestedId || item.title.trim().toLowerCase() === requestedTitle);
}

export function engineForTemplate(templateId: string, requestedEngine: GameEngine): GameEngine {
  return templateSupportsPhaser(templateId) ? requestedEngine : "babylonjs";
}

export function engineLabel(engine: GameEngine) {
  return engine === "phaser" ? "Phaser" : "Babylon.js";
}

export function formatCodexLogForDisplay(text: string) {
  const parsed = parseJsonObject(text);
  if (!parsed) return { title: "Codex log", detail: text };

  if (parsed.type === "thread.started") {
    return { title: "Codex started", detail: typeof parsed.thread_id === "string" ? `Thread ${parsed.thread_id}` : "Thread started." };
  }

  if (parsed.type === "turn.started") {
    return { title: "Codex started", detail: "Started a new agent turn." };
  }

  if (parsed.type === "item.started" || parsed.type === "item.completed") {
    return formatCodexItemEvent(parsed);
  }

  if (typeof parsed.message === "string") {
    return { title: readableTitle(parsed.type, "Codex message"), detail: parsed.message };
  }

  return { title: readableTitle(parsed.type, "Codex event"), detail: summarizeObject(parsed) };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function formatCodexItemEvent(event: Record<string, unknown>) {
  const item = event.item && typeof event.item === "object" ? (event.item as Record<string, unknown>) : {};
  const itemType = typeof item.type === "string" ? item.type : "item";
  const status = typeof item.status === "string" ? item.status : event.type === "item.started" ? "started" : "completed";
  const title = readableTitle(itemType, "Codex item");

  if (itemType === "command_execution") {
    const lines = [`Command ${status}`];
    if (typeof item.command === "string") lines.push(shortenCommand(item.command));
    if (typeof item.exit_code === "number") lines.push(`Exit code: ${item.exit_code}`);
    if (typeof item.aggregated_output === "string" && item.aggregated_output.trim()) {
      lines.push(cleanCommandOutput(item.aggregated_output));
    }
    return { title, detail: lines.join("\n") };
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const details = changes
      .map((change) => {
        if (!change || typeof change !== "object") return "";
        const record = change as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind : "change";
        const pathValue = typeof record.path === "string" ? record.path : "";
        return `${kind}: ${pathValue}`;
      })
      .filter(Boolean);
    return { title, detail: [`File changes ${status}`, ...details].join("\n") };
  }

  return { title, detail: summarizeObject(item) };
}

function readableTitle(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortenCommand(command: string) {
  return command.replace(/^"[^"]*pwsh\.exe"\s+-Command\s+/i, "").replace(/^powershell(?:\.exe)?\s+-Command\s+/i, "");
}

function cleanCommandOutput(output: string) {
  return output.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r\n/g, "\n").trim();
}

function summarizeObject(value: Record<string, unknown>) {
  return Object.entries(value)
    .map(([key, item]) => {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return `${key}: ${item}`;
      return `${key}: ${Array.isArray(item) ? `${item.length} items` : "object"}`;
    })
    .join("\n");
}

export function classifyWorkflowIntent(prompt: string, mode: CodexRunRequest["mode"]): CodexRunRequest["workflowIntent"] {
  if (mode === "create") return "game_update";

  const text = prompt.toLowerCase();
  const updateVerbs = [
    "create",
    "build",
    "generate",
    "make",
    "add",
    "update",
    "change",
    "modify",
    "remove",
    "delete",
    "fix",
    "implement",
    "regenerate",
    "publish",
    "export",
    "replace",
    "tune",
    "balance",
    "increase",
    "decrease",
  ];
  const gameTargets = [
    "game",
    "level",
    "scene",
    "asset",
    "sprite",
    "character",
    "npc",
    "model",
    "world",
    "map",
    "mechanic",
    "script",
    "image-blaster",
    "camera",
    "lighting",
    "control",
  ];

  const hasUpdateVerb = updateVerbs.some((verb) => text.includes(verb));
  const hasGameTarget = gameTargets.some((target) => text.includes(target));
  return hasUpdateVerb && hasGameTarget ? "game_update" : "conversation";
}

export function isCodexBusy(phase: AgentPhase) {
  return phase === "planning" || phase === "generating_assets" || phase === "generating_world" || phase === "writing_code" || phase === "building";
}

export function isValidEnvName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export function titleFromPrompt(prompt: string) {
  const firstWords = prompt.split(/\s+/).slice(0, 4).join(" ");
  return firstWords || "New image-blaster game";
}

export function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
