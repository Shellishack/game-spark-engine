export type AgentPhase =
  | "idle"
  | "planning"
  | "generating_assets"
  | "generating_world"
  | "writing_code"
  | "building"
  | "ready"
  | "error";

export type AssetKind = "sprite" | "model" | "texture" | "script" | "scene";
export type AssetSource = "generated" | "imported" | "system";

export type Hd2dStyle = "2D" | "HD2D" | "3D" | "image-blaster" | "babylonjs";
export type GameEngine = "babylonjs" | "phaser";

export type GameProjectAsset = {
  id: string;
  name: string;
  kind: AssetKind;
  path: string;
  source: AssetSource;
  previewColor: string;
  usage: string;
  metadata?: Record<string, string | number | boolean>;
};

export type AgentEvent = {
  id: string;
  phase: AgentPhase;
  title: string;
  detail: string;
  timestamp: string;
};

export type PromptBlock =
  | { id: string; type: "text"; content: string }
  | { id: string; type: "file"; name: string; sizeLabel: string; content?: string };

export type GameProjectManifest = {
  id: string;
  title: string;
  style: Hd2dStyle;
  engine: GameEngine;
  createdAt: string;
  updatedAt: string;
  workspacePath: string;
  runtimeEntry: string;
  babylonEntry?: string;
  phaserEntry?: string;
  playCanvasEntry?: string;
  buildPath: string;
  publishedPath?: string;
  promptHistory: Array<{ id: string; content: string; createdAt: string }>;
  runHistory: Array<{ id: string; createdAt: string; status: AgentPhase; summary: string }>;
  assets: GameProjectAsset[];
};

export type PublishedGame = {
  id: string;
  title: string;
  description: string;
  thumbnailColor: string;
  path: string;
};

export type CodexRunRequest = {
  projectId: string;
  projectTitle?: string;
  prompt: string;
  mode: "chat" | "create" | "iterate";
  workflowIntent: "conversation" | "game_update";
  engine: GameEngine;
  attachments: PromptBlock[];
};

export type WorkspaceInfo = {
  path: string;
  defaultPath: string;
};

export type AgentEnvVariable = {
  id: string;
  key: string;
  value: string;
};

export type AppSettings = {
  agentEnv: AgentEnvVariable[];
};

export type WorkspaceProjectSummary = {
  id: string;
  title: string;
  description: string;
  updatedAt: string;
  status: AgentPhase;
  color: string;
  path: string;
  hasBuild: boolean;
  manifest: GameProjectManifest;
};

export type CodexRunStartResult = {
  ok: boolean;
  projectDir?: string;
  runDir?: string;
  pid?: number;
  error?: string;
};

export type CodexStopResult = {
  ok: boolean;
  stopped?: boolean;
  error?: string;
};

export type GameSparkBridge = {
  startCodexRun?: (request: CodexRunRequest) => Promise<CodexRunStartResult | GameProjectManifest>;
  stopCodexRun?: () => Promise<CodexStopResult>;
  getWorkspace?: () => Promise<WorkspaceInfo>;
  selectWorkspace?: () => Promise<WorkspaceInfo>;
  resetWorkspace?: () => Promise<WorkspaceInfo>;
  listWorkspaceProjects?: () => Promise<WorkspaceProjectSummary[]>;
  getSettings?: () => Promise<AppSettings>;
  updateSettings?: (settings: AppSettings) => Promise<{ ok: boolean; agentEnv: AgentEnvVariable[]; error?: string }>;
  logInteraction?: (interaction: { type: string; payload?: Record<string, unknown> }) => Promise<{ ok: boolean; path?: string }>;
  openPreviewWindow?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  openPreviewInBrowser?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  startPreviewServer?: (projectId: string) => Promise<{ ok: boolean; url?: string; port?: number; error?: string }>;
  rebuildPreview?: (projectId: string) => Promise<{ ok: boolean; manifest?: GameProjectManifest; previewUrl?: string; error?: string }>;
  minimizeWindow?: () => Promise<void>;
  toggleMaximizeWindow?: () => Promise<boolean>;
  closeWindow?: () => Promise<void>;
  listPublishedGames?: () => Promise<PublishedGame[]>;
  publishProject?: (projectId: string) => Promise<GameProjectManifest>;
  onCodexEvent?: (listener: (event: AgentEvent) => void) => () => void;
  onCodexLog?: (listener: (line: string) => void) => () => void;
  onCodexManifest?: (listener: (manifest: GameProjectManifest) => void) => () => void;
};

export type RuntimeAsset = {
  mime: string;
  data: string;
};

export type GameCategory = "arcade" | "platformer" | "puzzle-grid" | "shooter" | "runner" | "visual-novel";

export type GenerationMode = "create" | "modify";

export type RuntimeProject = {
  entry: string;
  files: Record<string, string>;
  assets: Record<string, RuntimeAsset>;
};

export type PreviewBundle = {
  js: string;
  assets: Record<string, string>;
};

declare global {
  interface Window {
    gameSpark?: GameSparkBridge;
  }
}
