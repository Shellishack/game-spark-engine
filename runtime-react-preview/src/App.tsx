import { useEffect, useMemo, useRef, useState } from "react";
import {
  createManifest,
  createMockRunEvents,
  defaultPromptBlocks,
  publishedGames,
  spriteEmotions,
  starterProject,
} from "./codexPipeline";
import { GamePreview } from "./PlayCanvasPreview";
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

const supportedGameTypes = ["Platformer", "Top down RPG", "Isometric strategy", "First person shooter"];
const supportedStyles = ["2D", "HD2D", "3D"];
const existingProjects = [
  {
    id: "lantern-grove",
    title: "Lantern Grove",
    description: "Forest mystery prototype with NPCs, moon shards, and a bridge unlock.",
    updated: "Today",
    status: "Playable",
    color: "#3a6f68",
  },
  {
    id: "clockwork-harbor",
    title: "Clockwork Harbor",
    description: "Puzzle RPG workspace with harbor machines and timing gates.",
    updated: "Yesterday",
    status: "Iterating",
    color: "#8f6d40",
  },
  {
    id: "skyline-ruins",
    title: "Skyline Ruins",
    description: "Isometric traversal test with generated props and billboard actors.",
    updated: "This week",
    status: "Draft",
    color: "#596b9a",
  },
];
const categoryTemplates = [
  {
    title: "Classic RPG",
    description: "Party progression, quests, towns, encounters, and loot.",
    icon: "RP",
    type: "Top down RPG",
  },
  {
    title: "Roleplay Sandbox",
    description: "NPC relationships, factions, choices, and emergent scenes.",
    icon: "RS",
    type: "Top down RPG",
  },
  {
    title: "Storytelling Adventure",
    description: "Dialogue, branching events, cutscenes, and character arcs.",
    icon: "SA",
    type: "Top down RPG",
  },
  {
    title: "Arcane Roguelike",
    description: "Chambers, relics, bosses, and run modifiers.",
    icon: "AR",
    type: "Top down RPG",
  },
  {
    title: "Cozy Builder",
    description: "Rooms, residents, resources, and quests.",
    icon: "CB",
    type: "Isometric strategy",
  },
  {
    title: "Tactical Arena",
    description: "Grid combat, enemy waves, cover, and tuning.",
    icon: "TA",
    type: "First person shooter",
  },
  {
    title: "Puzzle Platformer",
    description: "Physics toys, level grammar, and checkpoints.",
    icon: "PP",
    type: "Platformer",
  },
];

export default function App() {
  const [view, setView] = useState<"home" | "workspace">("home");
  const [promptBlocks, setPromptBlocks] = useState<PromptBlock[]>(defaultPromptBlocks);
  const [project, setProject] = useState<GameProjectManifest | null>(starterProject);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [phase, setPhase] = useState<AgentPhase>("ready");
  const [selectedAssetId, setSelectedAssetId] = useState(starterProject.assets[0]?.id ?? "");
  const [newProjectName, setNewProjectName] = useState("Lantern Grove");
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
    const nextProject = mode === "create" ? createManifest(newProjectName.trim() || titleFromPrompt(prompt)) : project ?? createManifest(titleFromPrompt(prompt));
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
                ? "Generated new HD2D game project scaffold."
                : "Applied iteration request to local project."
              : "Answered conversationally without changing project files.",
        },
        ...nextProject.runHistory,
      ],
    };
    setProject(updatedProject);
    setSelectedAssetId(updatedProject.assets[0]?.id ?? "");
  }

  function openExistingProject(projectTitle: string) {
    const nextProject = createManifest(projectTitle);
    setProject(nextProject);
    setSelectedAssetId(nextProject.assets[0]?.id ?? "");
    setPhase("ready");
    setEvents([]);
    setView("workspace");
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
      <WindowFrame phase={phase} onHome={() => setView("home")} showHome={view === "workspace"} />
      <div className="app-content">
        {view === "home" ? (
          <Home
            promptBlocks={promptBlocks}
            workspace={workspace}
            onDraftChange={updateDraft}
            onAddAttachment={addMockAttachment}
            onSelectWorkspace={selectWorkspace}
            onResetWorkspace={resetWorkspace}
            onStart={() => startRun("create", "game_update")}
            onOpenProject={openExistingProject}
            projectName={newProjectName}
            onProjectNameChange={setNewProjectName}
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
            onInterrupt={interruptCodex}
            onSelectAsset={setSelectedAssetId}
          />
        )}
      </div>
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

  async function interruptCodex() {
    const result = await window.gameSpark?.stopCodexRun?.();
    const nextPhase: AgentPhase = result?.ok === false ? "error" : "idle";
    setPhase(nextPhase);
    setEvents((current) => [
      ...current,
      {
        id: `interrupt-${Date.now()}`,
        phase: nextPhase,
        title: result?.ok === false ? "Interrupt failed" : result?.stopped ? "Codex interrupted" : "No active Codex run",
        detail: result?.error || (result?.stopped ? "The active agent process was stopped." : "There was no running Codex process to stop."),
        timestamp: new Date().toISOString(),
      },
    ]);
  }
}

function WindowFrame({ phase, onHome, showHome }: { phase: AgentPhase; onHome: () => void; showHome: boolean }) {
  return (
    <header className="window-frame">
      <div className="window-drag-region">
        <span className="window-badge">GS</span>
        <div>
          <strong>Game Spark AI</strong>
          <small>{phaseLabels[phase]}</small>
        </div>
        <nav className="window-nav" aria-label="Top navigation">
          {showHome ? (
            <button type="button" onClick={onHome}>
              Home
            </button>
          ) : null}
        </nav>
      </div>
      <div className="window-controls">
        <button type="button" aria-label="Minimize window" onClick={() => window.gameSpark?.minimizeWindow?.()}>
          -
        </button>
        <button type="button" aria-label="Maximize window" onClick={() => window.gameSpark?.toggleMaximizeWindow?.()}>
          □
        </button>
        <button type="button" aria-label="Close window" onClick={() => window.gameSpark?.closeWindow?.()}>
          ×
        </button>
      </div>
    </header>
  );
}

type PromptComposerProps = {
  compact?: boolean;
  showGameSelectors?: boolean;
  projectNameControls?: {
    value: string;
    onChange: (value: string) => void;
  };
  workspaceControls?: {
    workspace: WorkspaceInfo;
    onSelectWorkspace: () => void;
    onResetWorkspace: () => void;
  };
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
    onOpenProject: (projectTitle: string) => void;
    projectName: string;
    onProjectNameChange: (value: string) => void;
  },
) {
  return (
    <section className="home-view">
      <div className="brand-row">
        <div className="brand-copy">
          <h1>Game Spark AI</h1>
          <div className="headline-carousel" aria-label="Game Spark AI highlights">
            <div>
              <span>Ship astonishing games with Codex</span>
              <span>Build your dream game in minutes</span>
              <span>Cursor but for games</span>
              <span>AI native game engine</span>
            </div>
          </div>
        </div>
        <span className="status-pill">Local Codex backend</span>
      </div>

      <PromptComposer
        showGameSelectors
        projectNameControls={{
          value: props.projectName,
          onChange: props.onProjectNameChange,
        }}
        workspaceControls={{
          workspace: props.workspace,
          onSelectWorkspace: props.onSelectWorkspace,
          onResetWorkspace: props.onResetWorkspace,
        }}
        promptBlocks={props.promptBlocks}
        actionLabel="Generate game"
        onDraftChange={props.onDraftChange}
        onAddAttachment={props.onAddAttachment}
        onSubmit={props.onStart}
      />

      <ExistingProjects onOpenProject={props.onOpenProject} />

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

function ExistingProjects({ onOpenProject }: { onOpenProject: (projectTitle: string) => void }) {
  return (
    <section className="existing-projects-band" aria-label="Existing projects">
      <div className="section-heading">
        <h2>Existing projects</h2>
        <span>{existingProjects.length} workspaces</span>
      </div>
      <div className="existing-project-grid">
        {existingProjects.map((project) => (
          <article className="existing-project-card" key={project.id}>
            <div className="existing-project-thumb" style={{ backgroundColor: project.color }}>
              <span>{project.title.slice(0, 2)}</span>
            </div>
            <div>
              <h3>{project.title}</h3>
              <p>{project.description}</p>
              <div className="project-card-meta">
                <span>{project.status}</span>
                <span>{project.updated}</span>
              </div>
            </div>
            <button type="button" onClick={() => onOpenProject(project.title)}>
              Open
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function SupportedTypes() {
  return (
    <section className="template-band" aria-label="Game type templates">
      <div className="section-heading">
        <h2>Game templates</h2>
        <span>{categoryTemplates.length} starters</span>
      </div>
      <div className="template-grid">
        {categoryTemplates.map((template) => (
          <article className="template-card" key={template.title}>
            <div className="template-icon">{template.icon}</div>
            <div>
              <h3>{template.title}</h3>
              <p>{template.description}</p>
              <small>{template.type}</small>
            </div>
          </article>
        ))}
      </div>
      <div className="support-inline" aria-label="Supported styles">
        <span>Supported types</span>
        {supportedGameTypes.map((type) => (
          <small key={type}>{type}</small>
        ))}
        <span>Styles</span>
        {supportedStyles.map((style) => (
          <small key={style}>{style}</small>
        ))}
      </div>
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
  onInterrupt,
  onSelectAsset,
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
  onInterrupt: () => void;
  onSelectAsset: (assetId: string) => void;
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
      />
      <AgentChat
        promptBlocks={promptBlocks}
        events={events}
        phase={phase}
        project={project}
        onDraftChange={onDraftChange}
        onAddAttachment={onAddAttachment}
        onIterate={onIterate}
        onInterrupt={onInterrupt}
      />
      <GamePreviewPanel project={project} phase={phase} selectedAsset={selectedAsset} />
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
}: {
  project: GameProjectManifest | null;
  workspace: WorkspaceInfo;
  assets: GameProjectAsset[];
  selectedAssetId: string;
  onSelectAsset: (assetId: string) => void;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"project" | "assets" | "settings">("project");

  return (
    <aside className="nav-panel">
      <div className="nav-brand">
        <div>
          <h1>{project?.title ?? "Untitled"}</h1>
          <span>{project?.style ?? "HD2D"} project</span>
        </div>
      </div>

      <div className="nav-scroll">
        <nav className="nav-section" aria-label="Project navigation">
          <button className={`nav-item ${activeTab === "project" ? "active" : ""}`} type="button" onClick={() => setActiveTab("project")}>
            <span className="nav-icon">P</span>
            Project
          </button>
          <button className={`nav-item ${activeTab === "assets" ? "active" : ""}`} type="button" onClick={() => setActiveTab("assets")}>
            <span className="nav-icon">A</span>
            Assets management
          </button>
          <button className={`nav-item ${activeTab === "settings" ? "active" : ""}`} type="button" onClick={() => setActiveTab("settings")}>
            <span className="nav-icon">S</span>
            Settings
          </button>
        </nav>

        <div className="nav-tab-content">
          {activeTab === "project" ? <ProjectOverview project={project} assets={assets} /> : null}
          {activeTab === "assets" ? <AssetsViewer assets={assets} selectedAssetId={selectedAssetId} onSelectAsset={onSelectAsset} /> : null}
          {activeTab === "settings" ? (
            <>
              <ProjectSnapshot project={project} workspace={workspace} />
              <WorkspacePicker compact workspace={workspace} onSelectWorkspace={onSelectWorkspace} onResetWorkspace={onResetWorkspace} />
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function ProjectOverview({ project, assets }: { project: GameProjectManifest | null; assets: GameProjectAsset[] }) {
  const counts = groupAssets(assets);
  return (
    <section className="project-overview">
      <div className="section-heading">
        <h2>Project</h2>
        <span>{project?.style ?? "Game"}</span>
      </div>
      <p>{project ? `${project.title} is ready for chat-driven edits and playtesting.` : "Start a chat with the agent to shape this project."}</p>
      <div className="overview-stat-grid">
        <div>
          <strong>{assets.length}</strong>
          <span>Files</span>
        </div>
        <div>
          <strong>{project?.style ?? "Game"}</strong>
          <span>Style</span>
        </div>
      </div>
      <div className="overview-tags">
        {counts.map((group) => (
          <span key={group.id}>
            {group.label} {group.items.length}
          </span>
        ))}
      </div>
    </section>
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
  onInterrupt,
}: {
  promptBlocks: PromptBlock[];
  events: AgentEvent[];
  phase: AgentPhase;
  project: GameProjectManifest | null;
  onDraftChange: (content: string) => void;
  onAddAttachment: () => void;
  onIterate: () => void;
  onInterrupt: () => void;
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
        <div className="chat-actions">
          <span className={`phase-chip phase-${phase}`}>{phaseLabels[phase]}</span>
          <button className="interrupt-button" type="button" onClick={onInterrupt} disabled={!isCodexBusy(phase)}>
            Interrupt
          </button>
        </div>
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
  className = "",
  as = "section",
  workspace,
  onSelectWorkspace,
  onResetWorkspace,
}: {
  compact?: boolean;
  className?: string;
  as?: "section" | "div";
  workspace: WorkspaceInfo;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
}) {
  const usesDefault = workspace.path === workspace.defaultPath;
  const Tag = as;
  return (
    <Tag className={`workspace-picker ${compact ? "compact" : ""} ${className}`}>
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
    </Tag>
  );
}

function PromptComposer({
  compact = false,
  showGameSelectors = false,
  projectNameControls,
  workspaceControls,
  promptBlocks,
  actionLabel,
  onDraftChange,
  onAddAttachment,
  onSubmit,
}: PromptComposerProps) {
  const [selectedTemplate, setSelectedTemplate] = useState(categoryTemplates[0]?.title ?? "");
  const [selectedStyle, setSelectedStyle] = useState(supportedStyles[1] ?? supportedStyles[0] ?? "");
  const draft = promptBlocks.find((block): block is Extract<PromptBlock, { type: "text" }> => block.id === "draft" && block.type === "text");
  return (
    <section className={`composer ${compact ? "compact" : ""}`}>
      {workspaceControls || projectNameControls ? (
        <div className="composer-project-row">
          {projectNameControls ? (
            <label className="project-name-field">
              <span>Project name</span>
              <input value={projectNameControls.value} onChange={(event) => projectNameControls.onChange(event.target.value)} placeholder="New game project" />
            </label>
          ) : null}
          {workspaceControls ? (
            <WorkspacePicker
              compact
              as="div"
              className="composer-workspace-picker"
              workspace={workspaceControls.workspace}
              onSelectWorkspace={workspaceControls.onSelectWorkspace}
              onResetWorkspace={workspaceControls.onResetWorkspace}
            />
          ) : null}
        </div>
      ) : null}
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
        <div className="composer-left-tools">
          {showGameSelectors ? (
            <>
              <label>
                <span>Template</span>
                <select value={selectedTemplate} onChange={(event) => setSelectedTemplate(event.target.value)}>
                  {categoryTemplates.map((template) => (
                    <option key={template.title} value={template.title}>
                      {template.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Style</span>
                <select value={selectedStyle} onChange={(event) => setSelectedStyle(event.target.value)}>
                  {supportedStyles.map((style) => (
                    <option key={style} value={style}>
                      {style}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>
        <div className="composer-right-tools">
          <button className="secondary-button" type="button" onClick={onAddAttachment}>
            Add file
          </button>
          <button type="button" onClick={onSubmit}>
            {actionLabel}
          </button>
        </div>
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

function GamePreviewPanel({
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
        <h2>Game preview</h2>
        <span>{project?.playCanvasEntry ?? "src/main.js"}</span>
      </div>
      <div className="viewport-stage">
        <GamePreview project={project} phase={phase} selectedAsset={selectedAsset} />
        <div className="viewport-hud">
          <span>{phase === "ready" ? "Playtest ready" : "Generating preview"}</span>
          <span>HD2D preview</span>
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const groups = groupAssets(assets);
  return (
    <section className="panel assets-panel">
      <div className="section-heading">
        <h2>Files</h2>
        <span>{assets.length} indexed</span>
      </div>
      <div className="asset-groups">
        {groups.map((group) => (
          <div className="asset-group" key={group.id}>
            <button
              className="asset-group-title"
              type="button"
              onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
              aria-expanded={!collapsedGroups[group.id]}
            >
              <strong>{group.label}</strong>
              <span>{group.items.length}</span>
            </button>
            {!collapsedGroups[group.id] ? (
              <div className="asset-list">
                {group.items.map((asset) => (
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
            ) : null}
          </div>
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

function groupAssets(assets: GameProjectAsset[]) {
  const order = [
    { id: "scripts", label: "Scripts" },
    { id: "assets", label: "Assets" },
    { id: "sounds", label: "Sounds" },
    { id: "scenes", label: "Scenes" },
    { id: "other", label: "Other" },
  ];
  const buckets = new Map(order.map((group) => [group.id, [] as GameProjectAsset[]]));

  for (const asset of assets) {
    buckets.get(categoryForAsset(asset))?.push(asset);
  }

  return order
    .map((group) => ({
      ...group,
      items: buckets.get(group.id) ?? [],
    }))
    .filter((group) => group.items.length > 0);
}

function categoryForAsset(asset: GameProjectAsset) {
  const path = asset.path.toLowerCase();
  if (asset.kind === "script" || path.endsWith(".js") || path.endsWith(".ts") || path.endsWith(".tsx")) return "scripts";
  if (path.endsWith(".wav") || path.endsWith(".mp3") || path.endsWith(".ogg") || path.includes("/sounds/") || path.includes("/audio/")) return "sounds";
  if (asset.kind === "scene" || path.includes("/scenes/") || path.endsWith(".scene.json")) return "scenes";
  if (asset.kind === "sprite" || asset.kind === "model" || asset.kind === "texture") return "assets";
  return "other";
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
          <dd>{project?.workspacePath ?? "new-game"}</dd>
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

function isCodexBusy(phase: AgentPhase) {
  return phase === "planning" || phase === "generating_assets" || phase === "generating_world" || phase === "writing_code" || phase === "building";
}

function titleFromPrompt(prompt: string) {
  const firstWords = prompt.split(/\s+/).slice(0, 4).join(" ");
  return firstWords || "New HD2D Game";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
