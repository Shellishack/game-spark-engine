import { useEffect, useMemo, useRef, useState } from "react";
import {
  createManifest,
  createMockRunEvents,
  defaultPromptBlocks,
  publishedGames,
  spriteEmotions,
  starterProject,
} from "../data/codex-pipeline";
import { GamePreview } from "./play-canvas-preview";
import shuffleIdeaAtlasUrl from "../assets/shuffle-idea-atlas.png";
import type {
  AgentEvent,
  AgentPhase,
  CodexRunRequest,
  GameProjectAsset,
  GameProjectManifest,
  PromptBlock,
  WorkspaceInfo,
} from "../types/project-types";

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
const randomGameIdeas = [
  {
    title: "Rainy Neon Courier",
    prompt: "Create a neon city delivery game where a scooter courier dodges drones, upgrades routes, and uncovers a mystery package network.",
  },
  {
    title: "Mushroom Kingdom Cafe",
    prompt: "Create a cozy fantasy cafe builder where mushroom villagers request recipes, decorate rooms, and unlock forest festivals.",
  },
  {
    title: "Clocktower Spell School",
    prompt: "Create a magical academy RPG where students bend time in puzzle rooms, duel rivals, and repair a broken clocktower.",
  },
  {
    title: "Sky Whale Rescue",
    prompt: "Create an airborne exploration game where pilots rescue sky whales, gather storm crystals, and upgrade a floating base.",
  },
  {
    title: "Dungeon Gardening Club",
    prompt: "Create a dungeon gardening roguelike where players plant traps, grow monster allies, and survive adventurer waves.",
  },
  {
    title: "Tiny Mech Postal Service",
    prompt: "Create a miniature mech delivery game where players cross oversized kitchens, repair routes, and upgrade stamp-powered gadgets.",
  },
  {
    title: "Ghost Museum Night Shift",
    prompt: "Create a spooky comedy adventure where a night guard interviews ghosts, rearranges cursed exhibits, and solves old mysteries.",
  },
  {
    title: "Solarpunk Train Village",
    prompt: "Create a solarpunk life sim on a moving train where players grow gardens, befriend passengers, and choose new rail destinations.",
  },
  {
    title: "Bubble Mage Aquarium",
    prompt: "Create an underwater spellcasting puzzle game where a bubble mage redirects currents, rescues sea creatures, and restores coral gates.",
  },
  {
    title: "Paper Dragon Tactics",
    prompt: "Create a paper-craft tactics game where foldable dragons change shapes, capture wind shrines, and combo terrain effects.",
  },
  {
    title: "Midnight Snack Heist",
    prompt: "Create a stealth comedy game where tiny kitchen creatures steal snacks, avoid sleepy humans, and build a secret pantry base.",
  },
  {
    title: "Crystal Radio Rangers",
    prompt: "Create an exploration RPG where rangers tune crystal radios to reveal hidden paths, recruit signal spirits, and stop a static storm.",
  },
  {
    title: "Cloud Orchard Keeper",
    prompt: "Create a sky-farming game where players grow floating fruit trees, tame weather, and trade harvests with airship towns.",
  },
  {
    title: "Robot Theater Troupe",
    prompt: "Create a narrative management game where robot actors rehearse plays, improvise dialogue, and win over different audience factions.",
  },
  {
    title: "Library of Living Maps",
    prompt: "Create a mystery adventure where players explore animated maps, rewrite landmarks, and chase a cartographer who vanished between pages.",
  },
  {
    title: "Frog Knight Tournament",
    prompt: "Create a whimsical action RPG where frog knights joust on lily pads, collect pond relics, and defend a rainy kingdom.",
  },
  {
    title: "Asteroid Bakery League",
    prompt: "Create a resource-management game where bakers mine asteroid flour, dodge meteor storms, and compete in zero-gravity pastry contests.",
  },
  {
    title: "Dream Elevator Bureau",
    prompt: "Create a surreal puzzle adventure where players operate an elevator between dreams, resolve strange requests, and repair broken memories.",
  },
  {
    title: "Lantern Bug Expedition",
    prompt: "Create a tiny exploration game where glowing beetle scouts map a giant backyard, solve dew puzzles, and protect their lantern queen.",
  },
  {
    title: "Volcano Spa Resort",
    prompt: "Create a cozy management game where players run a spa on a sleepy volcano, calm lava spirits, and craft mineral treatments.",
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
  const projectRef = useRef<GameProjectManifest | null>(project);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    window.gameSpark?.getWorkspace?.().then(setWorkspace).catch(() => undefined);
  }, []);

  useEffect(() => {
    const offEvent = window.gameSpark?.onCodexEvent?.((event) => {
      const currentProject = projectRef.current;
      logInteraction("agent_response", {
        projectId: currentProject?.id,
        projectTitle: currentProject?.title,
        phase: event.phase,
        title: event.title,
        content: event.detail,
        source: "codex-event",
      });
      setEvents((current) => [...current, event]);
      setPhase(event.phase);
    });
    const offLog = window.gameSpark?.onCodexLog?.((line) => {
      const text = line.trim();
      if (!text) return;
      const currentProject = projectRef.current;
      logInteraction("agent_response", {
        projectId: currentProject?.id,
        projectTitle: currentProject?.title,
        phase: "planning",
        title: "Codex log",
        content: text,
        source: "codex-log",
      });
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
      logInteraction("agent_response", {
        projectId: manifest.id,
        projectTitle: manifest.title,
        phase: "ready",
        title: "Project manifest updated",
        content: `Updated local project manifest with ${manifest.assets.length} assets.`,
        source: "codex-manifest",
      });
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

  async function startRun(mode: CodexRunRequest["mode"], explicitIntent?: CodexRunRequest["workflowIntent"], overrides?: { prompt?: string; projectName?: string }) {
    const prompt = overrides?.prompt ?? promptBlocks.map(blockToPromptText).filter(Boolean).join("\n\n");
    const nextProject =
      mode === "create" ? createManifest(overrides?.projectName?.trim() || newProjectName.trim() || titleFromPrompt(prompt)) : project ?? createManifest(titleFromPrompt(prompt));
    const workflowIntent = explicitIntent ?? classifyWorkflowIntent(prompt, mode);
    const request: CodexRunRequest = {
      projectId: nextProject.id,
      prompt,
      mode,
      workflowIntent,
      attachments: promptBlocks,
    };

    logInteraction("user_message", {
      mode,
      workflowIntent,
      projectId: nextProject.id,
      projectTitle: nextProject.title,
      content: prompt,
      attachments: promptBlocks
        .filter((block) => block.type === "file")
        .map((block) => ({ name: block.name, sizeLabel: block.sizeLabel })),
      source: overrides ? "shortcut" : "composer",
    });

    logInteraction("agent_run_submitted", {
      mode,
      workflowIntent,
      projectId: nextProject.id,
      projectTitle: nextProject.title,
      promptLength: prompt.length,
      attachmentCount: promptBlocks.filter((block) => block.type === "file").length,
      source: overrides ? "shortcut" : "composer",
    });

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
      logInteraction("agent_response", {
        projectId: nextProject.id,
        projectTitle: nextProject.title,
        phase: "error",
        title: "Codex failed",
        content: error instanceof Error ? error.message : String(error),
        source: "error",
      });
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
      logInteraction("agent_response", {
        projectId: nextProject.id,
        projectTitle: nextProject.title,
        phase: event.phase,
        title: event.title,
        content: event.detail,
        source: "mock-event",
      });
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
    logInteraction("existing_project_opened", { projectTitle });
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
    logInteraction("attachment_added", { name: "reference-moodboard.png", sizeLabel: "2.4 MB" });
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
      <WindowFrame
        phase={phase}
        onHome={() => {
          logInteraction("top_nav_home_clicked", { from: view });
          setView("home");
        }}
        showHome={view === "workspace"}
      />
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
            onStartIdea={(idea) => startRun("create", "game_update", idea)}
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
            onSelectAsset={(assetId) => {
              logInteraction("asset_selected", { assetId, projectId: project?.id });
              setSelectedAssetId(assetId);
            }}
          />
        )}
      </div>
    </main>
  );

  async function selectWorkspace() {
    const nextWorkspace = await window.gameSpark?.selectWorkspace?.();
    if (nextWorkspace) {
      logInteraction("workspace_selected", { path: nextWorkspace.path, usesDefault: nextWorkspace.path === nextWorkspace.defaultPath });
      setWorkspace(nextWorkspace);
    }
  }

  async function resetWorkspace() {
    const nextWorkspace = await window.gameSpark?.resetWorkspace?.();
    if (nextWorkspace) {
      logInteraction("workspace_reset", { path: nextWorkspace.path });
      setWorkspace(nextWorkspace);
    }
  }

  async function interruptCodex() {
    logInteraction("agent_interrupt_clicked", { phase, projectId: project?.id });
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

function logInteraction(type: string, payload: Record<string, unknown> = {}) {
  window.gameSpark?.logInteraction?.({ type, payload }).catch(() => undefined);
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
        <button
          type="button"
          aria-label="Minimize window"
          onClick={() => {
            logInteraction("window_control_clicked", { action: "minimize" });
            window.gameSpark?.minimizeWindow?.();
          }}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Maximize window"
          onClick={() => {
            logInteraction("window_control_clicked", { action: "toggle-maximize" });
            window.gameSpark?.toggleMaximizeWindow?.();
          }}
        >
          □
        </button>
        <button
          type="button"
          aria-label="Close window"
          onClick={() => {
            logInteraction("window_control_clicked", { action: "close" });
            window.gameSpark?.closeWindow?.();
          }}
        >
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
    onStartIdea: (idea: { projectName: string; prompt: string }) => void;
    onOpenProject: (projectTitle: string) => void;
    projectName: string;
    onProjectNameChange: (value: string) => void;
  },
) {
  return (
    <section className="home-view">
      <div className="brand-row">
        <div className="home-brand">
          <div className="home-brand-badge">GS</div>
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
        </div>
        <nav className="home-tabs" aria-label="Main page tabs">
          <button
            className="active"
            type="button"
            onClick={() => {
              logInteraction("home_tab_clicked", { tab: "home" });
              document.querySelector(".home-view")?.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => {
              logInteraction("home_tab_clicked", { tab: "hub" });
              document.getElementById("home-hub")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Hub
          </button>
        </nav>
        <div className="home-top-actions">
          <span className="status-pill">Local Codex backend</span>
        </div>
      </div>

      <div className="home-hub-grid" id="home-hub">
        <div className="home-main-column">
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
          <RecentGames onOpenProject={props.onOpenProject} />
        </div>
        <aside className="home-side-column">
          <RandomIdeas onPickIdea={props.onProjectNameChange} onDraftChange={props.onDraftChange} onStartIdea={props.onStartIdea} />
          <SupportedTypes />
        </aside>
      </div>
    </section>
  );
}

function RecentGames({ onOpenProject }: { onOpenProject: (projectTitle: string) => void }) {
  return (
    <section className="existing-projects-band" aria-label="Existing projects">
      <div className="section-heading">
        <h2>Recent games</h2>
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
            </div>
            <div className="existing-project-footer">
              <div className="project-card-meta">
                <span>{project.status}</span>
                <span>{project.updated}</span>
              </div>
              <button type="button" onClick={() => onOpenProject(project.title)}>
                Open
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RandomIdeas({
  onPickIdea,
  onDraftChange,
  onStartIdea,
}: {
  onPickIdea: (projectTitle: string) => void;
  onDraftChange: (content: string) => void;
  onStartIdea: (idea: { projectName: string; prompt: string }) => void;
}) {
  const [idea, setIdea] = useState(randomGameIdeas[0]);
  function shuffleIdea() {
    setIdea((current) => {
      const pool = randomGameIdeas.filter((candidate) => candidate.title !== current.title);
      const nextIdea = pool[Math.floor(Math.random() * pool.length)] ?? current;
      logInteraction("random_idea_shuffled", { from: current.title, to: nextIdea.title });
      return nextIdea;
    });
  }
  function buildIdea() {
    logInteraction("random_idea_build_clicked", { title: idea.title, promptLength: idea.prompt.length });
    onPickIdea(idea.title);
    onDraftChange(idea.prompt);
    onStartIdea({ projectName: idea.title, prompt: idea.prompt });
  }
  const ideaIndex = randomGameIdeas.findIndex((candidate) => candidate.title === idea.title);
  const atlasColumn = Math.max(0, ideaIndex % 5);
  const atlasRow = Math.max(0, Math.floor(ideaIndex / 5));

  return (
    <section className="random-idea-band" aria-label="Try something random">
      <div className="section-heading">
        <h2>Try something random</h2>
      </div>
      <div className="random-idea-card">
        <div
          className="random-idea-thumb"
          style={{
            backgroundImage: `url(${shuffleIdeaAtlasUrl})`,
            backgroundPosition: `${atlasColumn * 25}% ${atlasRow * 33.3333}%`,
          }}
        >
          <span>{idea.title.slice(0, 2)}</span>
        </div>
        <div>
          <h3>{idea.title}</h3>
          <p>{idea.prompt}</p>
        </div>
      </div>
      <div className="random-idea-actions">
        <button className="secondary-button" type="button" onClick={shuffleIdea}>
          Shuffle
        </button>
        <button type="button" onClick={buildIdea}>
          Build this
        </button>
      </div>
    </section>
  );
}

function SupportedTypes() {
  const pageSize = 3;
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(categoryTemplates.length / pageSize);
  const visibleTemplates = categoryTemplates.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <section className="template-band" aria-label="Game type templates">
      <div className="section-heading">
        <h2>Game templates</h2>
        <span>
          {page + 1} / {pageCount}
        </span>
      </div>
      <div className="template-grid">
        {visibleTemplates.map((template) => (
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
      <div className="template-pagination" aria-label="Template pagination">
        <button
          type="button"
          onClick={() =>
            setPage((current) => {
              const nextPage = Math.max(0, current - 1);
              logInteraction("template_page_changed", { direction: "previous", from: current + 1, to: nextPage + 1 });
              return nextPage;
            })
          }
          disabled={page === 0}
        >
          Previous
        </button>
        <div>
          {Array.from({ length: pageCount }, (_, index) => (
            <span className={index === page ? "active" : ""} key={index} />
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setPage((current) => {
              const nextPage = Math.min(pageCount - 1, current + 1);
              logInteraction("template_page_changed", { direction: "next", from: current + 1, to: nextPage + 1 });
              return nextPage;
            })
          }
          disabled={page === pageCount - 1}
        >
          Next
        </button>
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
          <button
            className={`nav-item ${activeTab === "project" ? "active" : ""}`}
            type="button"
            onClick={() => {
              logInteraction("editor_nav_tab_clicked", { from: activeTab, to: "project", projectId: project?.id });
              setActiveTab("project");
            }}
          >
            <span className="nav-icon">P</span>
            Project
          </button>
          <button
            className={`nav-item ${activeTab === "assets" ? "active" : ""}`}
            type="button"
            onClick={() => {
              logInteraction("editor_nav_tab_clicked", { from: activeTab, to: "assets", projectId: project?.id });
              setActiveTab("assets");
            }}
          >
            <span className="nav-icon">A</span>
            Assets management
          </button>
          <button
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => {
              logInteraction("editor_nav_tab_clicked", { from: activeTab, to: "settings", projectId: project?.id });
              setActiveTab("settings");
            }}
          >
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
              <input
                value={projectNameControls.value}
                onChange={(event) => {
                  logInteraction("project_name_changed", { length: event.target.value.length });
                  projectNameControls.onChange(event.target.value);
                }}
                placeholder="New game project"
              />
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
                <select
                  value={selectedTemplate}
                  onChange={(event) => {
                    logInteraction("composer_template_selected", { template: event.target.value });
                    setSelectedTemplate(event.target.value);
                  }}
                >
                  {categoryTemplates.map((template) => (
                    <option key={template.title} value={template.title}>
                      {template.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Style</span>
                <select
                  value={selectedStyle}
                  onChange={(event) => {
                    logInteraction("composer_style_selected", { style: event.target.value });
                    setSelectedStyle(event.target.value);
                  }}
                >
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
              onClick={() =>
                setCollapsedGroups((current) => {
                  const collapsed = !current[group.id];
                  logInteraction("asset_group_toggled", { groupId: group.id, label: group.label, collapsed });
                  return { ...current, [group.id]: collapsed };
                })
              }
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
