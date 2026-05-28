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
export type ApplyMode = "preview" | "auto";
export type PreviewMode = "edit" | "play";
export type PlayStartMode = "fresh" | "current";
export type EditorToolId = "character-2d" | "character-3d" | "world" | "logic" | "ui-dialogue" | "audio" | "publish";

export type LogicGraphNodeKind = "trigger" | "condition" | "action" | "state" | "dialogue" | "ending";

export type LogicGraphNode = {
  id: string;
  kind: LogicGraphNodeKind;
  title: string;
  summary: string;
  codeRefs: string[];
  x: number;
  y: number;
};

export type LogicGraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
};

export type LogicGraph = {
  source: "code-derived" | "ai-proposed";
  updatedAt: string;
  nodes: LogicGraphNode[];
  edges: LogicGraphEdge[];
};

export type EditorToolState = {
  id: EditorToolId;
  title: string;
  status: "empty" | "ready" | "needs-generation";
  summary: string;
  assetRefs: string[];
};

export type ProjectEditorState = {
  applyMode: ApplyMode;
  previewMode: PreviewMode;
  playStartMode: PlayStartMode;
  activeScenePath: string;
  activeTool: EditorToolId;
  tools: EditorToolState[];
};

export type SceneObject = {
  id: string;
  name: string;
  kind: "sprite" | "model" | "trigger" | "camera" | "light" | "zone" | "prop";
  assetRef?: string;
  editable: boolean;
  tags: string[];
  transform: {
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
};

export type SceneFile = {
  schemaVersion: 1;
  id: string;
  engine: GameEngine;
  updatedAt: string;
  objects: SceneObject[];
};

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
  editor: ProjectEditorState;
  logicGraph: LogicGraph;
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

export type CliPreviewSession = {
  projectId: string;
  projectRoot: string;
  previewUrl: string;
  mode: "edit";
  manifest?: GameProjectManifest | null;
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
  openEditorPanelWindow?: (panelId: "navigator" | "assistant" | "preview") => Promise<{ ok: boolean; error?: string }>;
  getCliPreviewSession?: () => Promise<CliPreviewSession | null>;
  startPreviewServer?: (projectId: string) => Promise<{ ok: boolean; url?: string; port?: number; error?: string }>;
  rebuildPreview?: (projectId: string) => Promise<{ ok: boolean; manifest?: GameProjectManifest; previewUrl?: string; error?: string }>;
  readSceneFile?: (projectId: string, scenePath?: string) => Promise<{ ok: boolean; scene?: SceneFile; path?: string; error?: string }>;
  readCliPreviewSceneFile?: (scenePath?: string) => Promise<{ ok: boolean; scene?: SceneFile; path?: string; error?: string }>;
  updateSceneObject?: (
    projectId: string,
    scenePath: string | undefined,
    objectId: string,
    transform: Partial<SceneObject["transform"]>,
  ) => Promise<{ ok: boolean; scene?: SceneFile; error?: string }>;
  updateCliPreviewSceneObject?: (
    scenePath: string | undefined,
    objectId: string,
    transform: Partial<SceneObject["transform"]>,
  ) => Promise<{ ok: boolean; scene?: SceneFile; error?: string }>;
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
