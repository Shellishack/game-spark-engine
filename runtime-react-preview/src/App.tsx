import { useEffect, useMemo, useRef, useState } from "react";
import {
  createManifest,
  createMockRunEvents,
  defaultPromptBlocks,
  publishedGames,
  spriteEmotions,
  starterProject,
} from "./codexPipeline";
import { PlayCanvasPreview } from "./PlayCanvasPreview";
import type {
  AgentEvent,
  AgentPhase,
  CodexRunRequest,
  GameProjectAsset,
  GameProjectManifest,
  PromptBlock,
  WorkspaceInfo,
} from "./projectTypes";

const phaseLabels: Record<AgentPhase, string> = {
  idle: "Idle",
  planning: "Planning",
  generating_assets: "Sprites",
  generating_world: "World",
  writing_code: "Code",
  building: "Build",
  ready: "Ready",
  error: "Error",
};

export default function App() {
  const [view, setView] = useState<"home" | "workspace">("home");
  const [promptBlocks, setPromptBlocks] = useState<PromptBlock[]>(defaultPromptBlocks);
  const [project, setProject] = useState<GameProjectManifest | null>(starterProject);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [phase, setPhase] = useState<AgentPhase>("ready");
  const [selectedAssetId, setSelectedAssetId] = useState(starterProject.assets[0]?.id ?? "");
  const [workspace, setWorkspace] = useState<WorkspaceInfo>({
    path: "~/Game Spark AI",
    defaultPath: "~/Game Spark AI",
  });

  useEffect(() => {
    window.gameSpark?.getWorkspace?.().then(setWorkspace).catch(() => undefined);
  }, []);

  useEffect(() => {
    const offEvent = window.gameSpark?.onCodexEvent?.((event) => {
      setEvents((current) => [...current, event]);
      setPhase(event.phase);
    });
    const offLog = window.gameSpark?.onCodexLog?.((line) => {
      const text = line.trim();
      if (!text) return;
      setEvents((current) => [
        ...current,
        {
          id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          phase: "planning",
          title: "Codex log",
          detail: text,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
    const offManifest = window.gameSpark?.onCodexManifest?.((manifest) => {
      setProject(manifest);
      setSelectedAssetId(manifest.assets[0]?.id ?? "");
      setPhase("ready");
    });

    return () => {
      offEvent?.();
      offLog?.();
      offManifest?.();
    };
  }, []);

  const selectedAsset = useMemo(
    () => project?.assets.find((asset) => asset.id === selectedAssetId) ?? project?.assets[0],
    [project, selectedAssetId],
  );

  async function startRun(mode: CodexRunRequest["mode"], explicitIntent?: CodexRunRequest["workflowIntent"]) {
    const prompt = promptBlocks.map(blockToPromptText).filter(Boolean).join("\n\n");
    const nextProject = project ?? createManifest(titleFromPrompt(prompt));
    const workflowIntent = explicitIntent ?? classifyWorkflowIntent(prompt, mode);
    const request: CodexRunRequest = {
      projectId: nextProject.id,
      prompt,
      mode,
      workflowIntent,
      attachments: promptBlocks,
    };

    setView("workspace");
    setProject(nextProject);
    setPhase(workflowIntent === "game_update" ? "planning" : "idle");
    setEvents([]);

    try {
      const bridgeResult = await window.gameSpark?.startCodexRun?.(request);
      if (bridgeResult && "assets" in bridgeResult) {
        setProject(bridgeResult);
        setPhase("ready");
        setSelectedAssetId(bridgeResult.assets[0]?.id ?? "");
        return;
      }
      if (bridgeResult?.ok) {
        return;
      }
      if (bridgeResult && !bridgeResult.ok) {
        throw new Error(bridgeResult.error || "Codex did not start.");
      }
    } catch (error) {
      setPhase("error");
      setEvents((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          phase: "error",
          title: "Codex failed",
          detail: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    const mockEvents = createMockRunEvents(request);
    for (const event of mockEvents) {
      await wait(260);
      setEvents((current) => [...current, event]);
      setPhase(event.phase);
    }

    const updatedProject = {
      ...nextProject,
      updatedAt: new Date().toISOString(),
      promptHistory: [
        ...nextProject.promptHistory,
        {
          id: `prompt-${nextProject.promptHistory.length + 1}`,
          content: prompt,
          createdAt: new Date().toISOString(),
        },
      ],
      runHistory: [
        {
          id: `run-${nextProject.runHistory.length + 1}`,
          createdAt: new Date().toISOString(),
          status: "ready" as const,
          summary:
            workflowIntent === "game_update"
              ? mode === "create"
                ? "Generated new HD2D PlayCanvas project scaffold."
                : "Applied iteration request to local project."
              : "Answered conversationally without changing project files.",
        },
        ...nextProject.runHistory,
      ],
    };
    setProject(updatedProject);
    setSelectedAssetId(updatedProject.assets[0]?.id ?? "");
  }

  function updateDraft(content: string) {
    setPromptBlocks((current) =>
      current.map((block) => {
        if (block.id !== "draft" || block.type !== "text") return block;
        return { ...block, content };
      }),
    );
  }

  function addMockAttachment() {
    setPromptBlocks((current) => [
      ...current,
      {
        id: `file-${Date.now()}`,
        type: "file",
        name: "reference-moodboard.png",
        sizeLabel: "2.4 MB",
      },
    ]);
  }

  return (
    <main className={`app-shell ${view === "workspace" ? "is-workspace" : ""}`}>
      {view === "home" ? (
        <Home
          promptBlocks={promptBlocks}
          workspace={workspace}
          onDraftChange={updateDraft}
          onAddAttachment={addMockAttachment}
          onSelectWorkspace={selectWorkspace}
          onResetWorkspace={resetWorkspace}
          onStart={() => startRun("create", "game_update")}
        />
      ) : (
        <Workspace
          promptBlocks={promptBlocks}
          project={project}
          selectedAsset={selectedAsset}
          selectedAssetId={selectedAssetId}
          events={events}
          phase={phase}
          workspace={workspace}
          onDraftChange={updateDraft}
          onAddAttachment={addMockAttachment}
          onSelectWorkspace={selectWorkspace}
          onResetWorkspace={resetWorkspace}
          onIterate={() => startRun("chat")}
          onSelectAsset={setSelectedAssetId}
          onBackHome={() => setView("home")}
        />
      )}
    </main>
  );

  async function selectWorkspace() {
    const nextWorkspace = await window.gameSpark?.selectWorkspace?.();
    if (nextWorkspace) {
      setWorkspace(nextWorkspace);
    }
  }

  async function resetWorkspace() {
    const nextWorkspace = await window.gameSpark?.resetWorkspace?.();
    if (nextWorkspace) {
      setWorkspace(nextWorkspace);
    }
  }
}

type PromptComposerProps = {
  compact?: boolean;
  promptBlocks: PromptBlock[];
  actionLabel: string;
  onDraftChange: (content: string) => void;
  onAddAttachment: () => void;
  onSubmit: () => void;
};

function Home(
  props: Omit<PromptComposerProps, "compact" | "actionLabel" | "onSubmit"> & {
    workspace: WorkspaceInfo;
    onSelectWorkspace: () => void;
    onResetWorkspace: () => void;
    onStart: () => void;
  },
) {
  return (
    <section className="home-view">
      <div className="brand-row">
        <div>
          <p className="eyebrow">Game Spark AI</p>
          <h1>AI-native HD2D game creation</h1>
        </div>
        <span className="status-pill">Local Codex backend</span>
      </div>

      <WorkspacePicker workspace={props.workspace} onSelectWorkspace={props.onSelectWorkspace} onResetWorkspace={props.onResetWorkspace} />

      <PromptComposer
        promptBlocks={props.promptBlocks}
        actionLabel="Generate game"
        onDraftChange={props.onDraftChange}
        onAddAttachment={props.onAddAttachment}
        onSubmit={props.onStart}
      />

      <section className="gallery-band" aria-label="Published games">
        <div className="section-heading">
          <h2>Published locally</h2>
          <span>{publishedGames.length} builds</span>
        </div>
        <div className="game-gallery">
          {publishedGames.map((game) => (
            <article className="game-card" key={game.id}>
              <div className="game-thumb" style={{ backgroundColor: game.thumbnailColor }}>
                <span>{game.title.slice(0, 2)}</span>
              </div>
              <div>
                <h3>{game.title}</h3>
                <p>{game.description}</p>
                <code>{game.path}</code>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function Workspace({
  promptBlocks,
  project,
  selectedAsset,
  selectedAssetId,
  events,
  phase,
  workspace,
  onDraftChange,
  onAddAttachment,
  onSelectWorkspace,
  onResetWorkspace,
  onIterate,
  onSelectAsset,
  onBackHome,
}: {
  promptBlocks: PromptBlock[];
  project: GameProjectManifest | null;
  selectedAsset?: GameProjectAsset;
  selectedAssetId: string;
  events: AgentEvent[];
  phase: AgentPhase;
  workspace: WorkspaceInfo;
  onDraftChange: (content: string) => void;
  onAddAttachment: () => void;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
  onIterate: () => void;
  onSelectAsset: (assetId: string) => void;
  onBackHome: () => void;
}) {
  return (
    <section className="workspace-view">
      <NavigationPanel
        project={project}
        workspace={workspace}
        assets={project?.assets ?? []}
        selectedAssetId={selectedAssetId}
        onSelectAsset={onSelectAsset}
        onSelectWorkspace={onSelectWorkspace}
        onResetWorkspace={onResetWorkspace}
        onBackHome={onBackHome}
      />
      <AgentChat
        promptBlocks={promptBlocks}
        events={events}
        phase={phase}
        project={project}
        onDraftChange={onDraftChange}
        onAddAttachment={onAddAttachment}
        onIterate={onIterate}
      />
      <PlayCanvasViewport project={project} phase={phase} selectedAsset={selectedAsset} />
    </section>
  );
}

function NavigationPanel({
  project,
  workspace,
  assets,
  selectedAssetId,
  onSelectAsset,
  onSelectWorkspace,
  onResetWorkspace,
  onBackHome,
}: {
  project: GameProjectManifest | null;
  workspace: WorkspaceInfo;
  assets: GameProjectAsset[];
  selectedAssetId: string;
  onSelectAsset: (assetId: string) => void;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
  onBackHome: () => void;
}) {
  return (
    <aside className="nav-panel">
      <div className="nav-brand">
        <button className="home-link" type="button" onClick={onBackHome}>
          Game Spark AI
        </button>
        <div>
          <h1>{project?.title ?? "Untitled"}</h1>
          <span>{project?.style ?? "HD2D"} project</span>
        </div>
      </div>

      <nav className="nav-section" aria-label="Project navigation">
        <button className="nav-item active" type="button">
          <span className="nav-icon">P</span>
          Project
        </button>
        <button className="nav-item" type="button">
          <span className="nav-icon">A</span>
          Assets management
        </button>
        <button className="nav-item" type="button">
          <span className="nav-icon">S</span>
          Settings
        </button>
      </nav>

      <AssetsViewer assets={assets} selectedAssetId={selectedAssetId} onSelectAsset={onSelectAsset} />
      <ProjectSnapshot project={project} workspace={workspace} />
      <WorkspacePicker compact workspace={workspace} onSelectWorkspace={onSelectWorkspace} onResetWorkspace={onResetWorkspace} />
    </aside>
  );
}

function AgentChat({
  promptBlocks,
  events,
  phase,
  project,
  onDraftChange,
  onAddAttachment,
  onIterate,
}: {
  promptBlocks: PromptBlock[];
  events: AgentEvent[];
  phase: AgentPhase;
  project: GameProjectManifest | null;
  onDraftChange: (content: string) => void;
  onAddAttachment: () => void;
  onIterate: () => void;
}) {
  const messagesRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [events.length, phase]);

  return (
    <section className="chat-panel">
      <header className="chat-header">
        <div>
          <p className="eyebrow">Agent chat</p>
          <h2>{project?.title ?? "Game project"}</h2>
        </div>
        <span className={`phase-chip phase-${phase}`}>{phaseLabels[phase]}</span>
      </header>

      <AgentProgress events={events} phase={phase} messagesRef={messagesRef} />

      <PromptComposer
        compact
        promptBlocks={promptBlocks}
        actionLabel="Send"
        onDraftChange={onDraftChange}
        onAddAttachment={onAddAttachment}
        onSubmit={onIterate}
      />
    </section>
  );
}

function WorkspacePicker({
  compact = false,
  workspace,
  onSelectWorkspace,
  onResetWorkspace,
}: {
  compact?: boolean;
  workspace: WorkspaceInfo;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
}) {
  const usesDefault = workspace.path === workspace.defaultPath;
  return (
    <section className={`workspace-picker ${compact ? "compact" : ""}`}>
      <div>
        <h2>Workspace folder</h2>
        <p>{workspace.path}</p>
        <small>{usesDefault ? "Default local workspace" : "Custom local workspace"}</small>
      </div>
      <div className="workspace-actions">
        <button className="secondary-button" type="button" onClick={onSelectWorkspace}>
          Choose
        </button>
        <button className="ghost-button" type="button" onClick={onResetWorkspace}>
          Default
        </button>
      </div>
    </section>
  );
}

function PromptComposer({
  compact = false,
  promptBlocks,
  actionLabel,
  onDraftChange,
  onAddAttachment,
  onSubmit,
}: PromptComposerProps) {
  const draft = promptBlocks.find((block): block is Extract<PromptBlock, { type: "text" }> => block.id === "draft" && block.type === "text");
  return (
    <section className={`composer ${compact ? "compact" : ""}`}>
      <textarea
        value={draft?.content ?? ""}
        onChange={(event) => onDraftChange(event.target.value)}
        placeholder={compact ? "Ask a question, or ask the agent to update the game." : "Describe the game you want to generate."}
      />
      <div className="attachment-list">
        {promptBlocks
          .filter((block) => block.type === "file")
          .map((block) => (
            <div className="attachment" key={block.id}>
              <span>{block.name}</span>
              <small>{block.sizeLabel}</small>
            </div>
          ))}
      </div>
      <div className="composer-actions">
        <button className="secondary-button" type="button" onClick={onAddAttachment}>
          Add file
        </button>
        <button type="button" onClick={onSubmit}>
          {actionLabel}
        </button>
      </div>
    </section>
  );
}

function AgentProgress({
  events,
  phase,
  messagesRef,
}: {
  events: AgentEvent[];
  phase: AgentPhase;
  messagesRef?: React.RefObject<HTMLOListElement | null>;
}) {
  const visibleEvents =
    events.length > 0
      ? events
      : [
          {
            id: "idle",
            phase,
            title: "Waiting for Codex",
            detail: "The local CLI bridge will stream planning, asset generation, world generation, code writing, and build status here.",
            timestamp: new Date().toISOString(),
          },
        ];

  return (
    <section className="panel progress-panel">
      <div className="section-heading">
        <h2>Progress</h2>
        <span>{phaseLabels[phase]}</span>
      </div>
      <ol className="event-list" ref={messagesRef}>
        {visibleEvents.map((event) => (
          <li key={event.id} className={event.phase === phase ? "active" : ""}>
            <span className="event-dot" />
            <div>
              <strong>{event.title}</strong>
              <p>{event.detail}</p>
              <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlayCanvasViewport({
  project,
  phase,
  selectedAsset,
}: {
  project: GameProjectManifest | null;
  phase: AgentPhase;
  selectedAsset?: GameProjectAsset;
}) {
  return (
    <section className="panel viewport-panel">
      <div className="section-heading">
        <h2>PlayCanvas viewport</h2>
        <span>{project?.playCanvasEntry ?? "src/main.js"}</span>
      </div>
      <div className="viewport-stage">
        <PlayCanvasPreview project={project} phase={phase} selectedAsset={selectedAsset} />
        <div className="viewport-hud">
          <span>{phase === "ready" ? "Playtest ready" : "Generating preview"}</span>
          <span>PlayCanvas HD2D</span>
        </div>
      </div>
      <div className="control-bar">
        <button type="button" disabled={phase !== "ready"}>
          Play
        </button>
        <button className="secondary-button" type="button" disabled={phase !== "ready"}>
          Publish local build
        </button>
      </div>
    </section>
  );
}

function AssetsViewer({
  assets,
  selectedAssetId,
  onSelectAsset,
}: {
  assets: GameProjectAsset[];
  selectedAssetId: string;
  onSelectAsset: (assetId: string) => void;
}) {
  return (
    <section className="panel assets-panel">
      <div className="section-heading">
        <h2>Assets</h2>
        <span>{assets.length} indexed</span>
      </div>
      <div className="asset-list">
        {assets.slice(0, 8).map((asset) => (
          <button
            className={`asset-row ${asset.id === selectedAssetId ? "selected" : ""}`}
            key={asset.id}
            type="button"
            onClick={() => onSelectAsset(asset.id)}
          >
            <span className="asset-swatch" style={{ backgroundColor: asset.previewColor }} />
            <span>
              <strong>{asset.name}</strong>
              <small>
                {asset.kind} / {asset.source}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="sprite-rule">
        <strong>Sprite contract</strong>
        <span>{spriteEmotions.join(", ")}</span>
        <small>4 x 3 sheet, 12 frames, 1024 PNG per emotion.</small>
      </div>
    </section>
  );
}

function ProjectSnapshot({ project, workspace }: { project: GameProjectManifest | null; workspace: WorkspaceInfo }) {
  return (
    <section className="project-snapshot">
      <h2>Local project</h2>
      <dl>
        <div>
          <dt>Root</dt>
          <dd>{workspace.path}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{project?.workspacePath ?? "projects/new-game"}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd>{project?.buildPath ?? "build/index.html"}</dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{project?.runHistory.length ?? 0}</dd>
        </div>
      </dl>
    </section>
  );
}

function blockToPromptText(block: PromptBlock) {
  if (block.type === "text") return block.content.trim();
  return `Attached file: ${block.name} (${block.sizeLabel})`;
}

function classifyWorkflowIntent(prompt: string, mode: CodexRunRequest["mode"]): CodexRunRequest["workflowIntent"] {
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
    "playcanvas",
    "camera",
    "lighting",
    "control",
  ];

  const hasUpdateVerb = updateVerbs.some((verb) => text.includes(verb));
  const hasGameTarget = gameTargets.some((target) => text.includes(target));
  return hasUpdateVerb && hasGameTarget ? "game_update" : "conversation";
}

function titleFromPrompt(prompt: string) {
  const firstWords = prompt.split(/\s+/).slice(0, 4).join(" ");
  return firstWords || "New HD2D Game";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
