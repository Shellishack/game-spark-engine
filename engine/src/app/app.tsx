import { useEffect, useMemo, useRef, useState } from "react";
import {
  createManifest,
  createMockRunEvents,
  createDefaultEditorState,
  createDefaultLogicGraph,
  defaultPromptBlocks,
  publishedGames,
  spriteEmotions,
} from "../data/codex-pipeline";
import { buildPromptFromTemplate, gameCreationTemplates, templateSupportsPhaser } from "../data/game-templates";
import capability2dGameUrl from "../assets/capability-2d-game.png";
import capability3dGameUrl from "../assets/capability-3d-game.png";
import capability3dRenderingUrl from "../assets/capability-3d-rendering.png";
import capabilityAssetsGenerationUrl from "../assets/capability-assets-generation.png";
import shuffleIdeaAtlasUrl from "../assets/shuffle-idea-atlas.png";
import { phaseLabels, randomGameIdeas, supportedEngines, supportedGameTypes, supportedStyles } from "./app-constants";
import {
  blockToPromptText,
  classifyWorkflowIntent,
  engineForTemplate,
  engineLabel,
  findDuplicateProject,
  formatCodexLogForDisplay,
  formatRelativeDate,
  isCodexBusy,
  isValidEnvName,
  normalizeManifest,
  titleFromPrompt,
  wait,
} from "./app-utils";
import { GamePreviewPanel } from "./components/game-preview-panel";
import type {
  AgentEvent,
  AgentPhase,
  AgentEnvVariable,
  ApplyMode,
  CodexRunRequest,
  EditorToolId,
  GameEngine,
  GameProjectAsset,
  GameProjectManifest,
  PromptBlock,
  WorkspaceInfo,
  WorkspaceProjectSummary,
} from "../types/project-types";

const capabilityGallery = [
  {
    title: "2D games",
    eyebrow: "Phaser or Babylon",
    description: "Generate sprite-driven worlds, platformers, arcade loops, HUDs, and animation-ready 2D scenes.",
    imageUrl: capability2dGameUrl,
  },
  {
    title: "3D games",
    eyebrow: "BabylonJS runtime",
    description: "Build playable 3D worlds with characters, cameras, interaction logic, and real-time preview.",
    imageUrl: capability3dGameUrl,
  },
  {
    title: "3D rendering",
    eyebrow: "Realtime visuals",
    description: "Preview lighting, materials, scene composition, and cinematic shots directly inside the engine workspace.",
    imageUrl: capability3dRenderingUrl,
  },
  {
    title: "Asset generation",
    eyebrow: "AI production loop",
    description: "Create game-ready characters, props, sprites, textures, and style variants from chat-led tools.",
    imageUrl: capabilityAssetsGenerationUrl,
  },
];

export default function App() {
  const [view, setView] = useState<"home" | "workspace">("home");
  const [promptBlocks, setPromptBlocks] = useState<PromptBlock[]>(defaultPromptBlocks);
  const [project, setProject] = useState<GameProjectManifest | null>(null);
  const [lastPreviewProject, setLastPreviewProject] = useState<GameProjectManifest | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [activeEditorTool, setActiveEditorTool] = useState<EditorToolId>("logic");
  const [applyMode, setApplyMode] = useState<ApplyMode>("preview");
  const [newProjectName, setNewProjectName] = useState("Lantern Grove");
  const [projectNameError, setProjectNameError] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState(gameCreationTemplates[0]?.id ?? "");
  const [selectedEngine, setSelectedEngine] = useState<GameEngine>("babylonjs");
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProjectSummary[]>([]);
  const [previewableProjectIds, setPreviewableProjectIds] = useState<Set<string>>(new Set());
  const [workspace, setWorkspace] = useState<WorkspaceInfo>({
    path: "~/Game Spark AI",
    defaultPath: "~/Game Spark AI",
  });
  const [agentEnv, setAgentEnv] = useState<AgentEnvVariable[]>([]);
  const [settingsStatus, setSettingsStatus] = useState<{ kind: "idle" | "saved" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });
  const projectRef = useRef<GameProjectManifest | null>(project);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    window.gameSpark?.getWorkspace?.().then(setWorkspace).catch(() => undefined);
    window.gameSpark?.getSettings?.().then((settings) => setAgentEnv(settings.agentEnv)).catch(() => undefined);
    refreshWorkspaceProjects();
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
      const formattedLog = formatCodexLogForDisplay(text);
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
          title: formattedLog.title,
          detail: formattedLog.detail,
          timestamp: new Date().toISOString(),
        },
      ]);
    });
    const offManifest = window.gameSpark?.onCodexManifest?.((manifest) => {
      const normalizedManifest = normalizeManifest(manifest);
      logInteraction("agent_response", {
        projectId: normalizedManifest.id,
        projectTitle: normalizedManifest.title,
        phase: "ready",
        title: "Project manifest updated",
        content: `Updated local project manifest with ${normalizedManifest.assets.length} assets.`,
        source: "codex-manifest",
      });
      setProject(normalizedManifest);
      refreshWorkspaceProjects().then((projects) => {
        const summary = projects.find((item) => item.id === normalizedManifest.id);
        setLastPreviewProject(summary?.hasBuild ? normalizedManifest : null);
      });
      setSelectedAssetId(normalizedManifest.assets[0]?.id ?? "");
      setActiveEditorTool(normalizedManifest.editor.activeTool);
      setApplyMode(normalizedManifest.editor.applyMode);
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
    const draftPrompt = overrides?.prompt ?? promptBlocks.map(blockToPromptText).filter(Boolean).join("\n\n");
    const prompt = mode === "create" && !overrides?.prompt ? buildPromptFromTemplate(selectedTemplateId, draftPrompt) : draftPrompt;
    const requestedProjectName = overrides?.projectName?.trim() || newProjectName.trim() || titleFromPrompt(prompt);
    if (mode === "create") {
      const duplicate = findDuplicateProject(requestedProjectName, workspaceProjects);
      if (duplicate) {
        const message = `A project named "${duplicate.title}" already exists. Choose a different project name.`;
        setProjectNameError(message);
        logInteraction("project_create_blocked", {
          reason: "duplicate_project_name",
          requestedProjectName,
          existingProjectId: duplicate.id,
          existingProjectTitle: duplicate.title,
        });
        return;
      }
      setProjectNameError("");
    }
    const engine = mode === "create" ? engineForTemplate(selectedTemplateId, selectedEngine) : project?.engine ?? selectedEngine;
    const nextProject =
      mode === "create" ? createManifest(requestedProjectName, engine) : project ?? createManifest(titleFromPrompt(prompt), engine);
    const workflowIntent = explicitIntent ?? classifyWorkflowIntent(prompt, mode);
    const request: CodexRunRequest = {
      projectId: nextProject.id,
      projectTitle: nextProject.title,
      prompt,
      mode,
      workflowIntent,
      engine,
      attachments: promptBlocks,
    };

    logInteraction("user_message", {
      mode,
      workflowIntent,
      engine,
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
      engine,
      projectId: nextProject.id,
      projectTitle: nextProject.title,
      promptLength: prompt.length,
      attachmentCount: promptBlocks.filter((block) => block.type === "file").length,
      source: overrides ? "shortcut" : "composer",
    });

    setView("workspace");
    setProject(nextProject);
    setActiveEditorTool(nextProject.editor.activeTool);
    setApplyMode(nextProject.editor.applyMode);
    setLastPreviewProject(previewableProjectIds.has(nextProject.id) ? nextProject : null);
    setPhase(workflowIntent === "game_update" ? "planning" : "idle");
    setEvents([]);

    try {
      const bridgeResult = await window.gameSpark?.startCodexRun?.(request);
      if (bridgeResult && "assets" in bridgeResult) {
        const normalizedProject = normalizeManifest(bridgeResult);
        setProject(normalizedProject);
        refreshWorkspaceProjects().then((projects) => {
          const summary = projects.find((item) => item.id === normalizedProject.id);
          setLastPreviewProject(summary?.hasBuild ? normalizedProject : null);
        });
        setPhase("ready");
        setSelectedAssetId(normalizedProject.assets[0]?.id ?? "");
        setActiveEditorTool(normalizedProject.editor.activeTool);
        setApplyMode(normalizedProject.editor.applyMode);
        return;
      }
      if (bridgeResult?.ok) {
        refreshWorkspaceProjects();
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
                ? "Generated new image-blaster game project scaffold."
                : "Applied iteration request to local project."
              : "Answered conversationally without changing project files.",
        },
        ...nextProject.runHistory,
      ],
    };
    setProject(updatedProject);
    refreshWorkspaceProjects().then((projects) => {
      const summary = projects.find((item) => item.id === updatedProject.id);
      setLastPreviewProject(summary?.hasBuild ? updatedProject : null);
    });
    setSelectedAssetId(updatedProject.assets[0]?.id ?? "");
    setActiveEditorTool(updatedProject.editor.activeTool);
    setApplyMode(updatedProject.editor.applyMode);
  }

  async function refreshWorkspaceProjects() {
    const projects = await window.gameSpark?.listWorkspaceProjects?.();
    if (projects) {
      setWorkspaceProjects(projects);
      setPreviewableProjectIds(new Set(projects.filter((item) => item.hasBuild).map((item) => item.id)));
      return projects;
    }
    return [];
  }

  function openExistingProject(projectSummary: WorkspaceProjectSummary) {
    logInteraction("existing_project_opened", { projectId: projectSummary.id, projectTitle: projectSummary.title, path: projectSummary.path });
    const nextProject = normalizeManifest(projectSummary.manifest);
    setProject(nextProject);
    setLastPreviewProject(projectSummary.hasBuild ? nextProject : null);
    setSelectedAssetId(nextProject.assets[0]?.id ?? "");
    setActiveEditorTool(nextProject.editor.activeTool);
    setApplyMode(nextProject.editor.applyMode);
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

  function selectEditorTool(toolId: EditorToolId) {
    setActiveEditorTool(toolId);
    setProject((current) =>
      current
        ? {
            ...current,
            editor: {
              ...current.editor,
              activeTool: toolId,
            },
          }
        : current,
    );
    logInteraction("editor_tool_selected", { toolId, projectId: project?.id });
  }

  function changeApplyMode(nextMode: ApplyMode) {
    setApplyMode(nextMode);
    setProject((current) =>
      current
        ? {
            ...current,
            editor: {
              ...current.editor,
              applyMode: nextMode,
            },
          }
        : current,
    );
    logInteraction("editor_apply_mode_changed", { applyMode: nextMode, projectId: project?.id });
  }

  function draftToolPrompt(toolId: EditorToolId, instruction: string) {
    const tool = project?.editor.tools.find((item) => item.id === toolId);
    updateDraft(
      [
        `[Editor tool: ${tool?.title ?? toolId}]`,
        `[Apply mode: ${applyMode}]`,
        instruction,
        "",
        "Use the selected editor tool context. Treat generated code as canonical, update manifest editor metadata, and refresh logicGraph if game logic changes.",
      ].join("\n"),
    );
    selectEditorTool(toolId);
    logInteraction("editor_tool_prompt_drafted", { toolId, applyMode, projectId: project?.id, instruction });
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
            workspaceProjects={workspaceProjects}
            projectName={newProjectName}
            projectNameError={projectNameError}
            selectedTemplateId={selectedTemplateId}
            selectedEngine={selectedEngine}
            onTemplateChange={(templateId) => {
              setSelectedTemplateId(templateId);
              if (!templateSupportsPhaser(templateId)) setSelectedEngine("babylonjs");
            }}
            onEngineChange={setSelectedEngine}
            onProjectNameChange={(value) => {
              setProjectNameError("");
              setNewProjectName(value);
            }}
          />
        ) : (
          <Workspace
            promptBlocks={promptBlocks}
            project={project}
            previewProject={lastPreviewProject}
            previewableProjectIds={previewableProjectIds}
            selectedAsset={selectedAsset}
            selectedAssetId={selectedAssetId}
            events={events}
            phase={phase}
            workspace={workspace}
            agentEnv={agentEnv}
            settingsStatus={settingsStatus}
            activeEditorTool={activeEditorTool}
            applyMode={applyMode}
            onDraftChange={updateDraft}
            onAddAttachment={addMockAttachment}
            onSelectWorkspace={selectWorkspace}
            onResetWorkspace={resetWorkspace}
            onAddAgentEnv={addAgentEnv}
            onUpdateAgentEnv={updateAgentEnv}
            onRemoveAgentEnv={removeAgentEnv}
            onSaveAgentEnv={saveAgentEnv}
            onIterate={() => startRun("chat")}
            onRebuildSource={rebuildPreview}
            onInterrupt={interruptCodex}
            onSelectEditorTool={selectEditorTool}
            onApplyModeChange={changeApplyMode}
            onToolPrompt={draftToolPrompt}
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
      refreshWorkspaceProjects();
    }
  }

  async function resetWorkspace() {
    const nextWorkspace = await window.gameSpark?.resetWorkspace?.();
    if (nextWorkspace) {
      logInteraction("workspace_reset", { path: nextWorkspace.path });
      setWorkspace(nextWorkspace);
      refreshWorkspaceProjects();
    }
  }

  function addAgentEnv() {
    setAgentEnv((current) => [
      ...current,
      {
        id: `env-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        key: "",
        value: "",
      },
    ]);
    setSettingsStatus({ kind: "idle", message: "" });
  }

  function updateAgentEnv(id: string, patch: Partial<AgentEnvVariable>) {
    setAgentEnv((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    setSettingsStatus({ kind: "idle", message: "" });
  }

  function removeAgentEnv(id: string) {
    setAgentEnv((current) => current.filter((item) => item.id !== id));
    setSettingsStatus({ kind: "idle", message: "" });
  }

  async function saveAgentEnv() {
    const invalid = agentEnv.find((item) => item.key.trim() && !isValidEnvName(item.key.trim()));
    if (invalid) {
      setSettingsStatus({ kind: "error", message: `${invalid.key || "Variable name"} is not a valid environment variable name.` });
      return;
    }

    try {
      const result = await window.gameSpark?.updateSettings?.({
        agentEnv: agentEnv
          .filter((item) => item.key.trim())
          .map((item) => ({ ...item, key: item.key.trim() })),
      });
      if (!result?.ok) {
        throw new Error(result?.error || "Settings were not saved.");
      }
      setAgentEnv(result.agentEnv);
      setSettingsStatus({
        kind: "saved",
        message: `${result.agentEnv.length} environment variable${result.agentEnv.length === 1 ? "" : "s"} saved.`,
      });
      logInteraction("settings_agent_env_saved", {
        count: result.agentEnv.length,
        keys: result.agentEnv.map((item) => item.key),
      });
    } catch (error) {
      setSettingsStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
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

  async function rebuildPreview() {
    if (!project) return;
    logInteraction("preview_rebuild_started", { projectId: project.id, projectTitle: project.title });
    setPhase("building");
    setEvents((current) => [
      ...current,
      {
        id: `rebuild-start-${Date.now()}`,
        phase: "building",
        title: "Rebuilding preview",
        detail: "Building the playable preview locally from the current game source.",
        timestamp: new Date().toISOString(),
      },
    ]);

    const result = await window.gameSpark?.rebuildPreview?.(project.id);
    if (!result?.ok || !result.manifest) {
      const detail = result?.error || "The local preview rebuild failed.";
      logInteraction("preview_rebuild_failed", { projectId: project.id, projectTitle: project.title, error: detail });
      setPhase("error");
      setEvents((current) => [
        ...current,
        {
          id: `rebuild-error-${Date.now()}`,
          phase: "error",
          title: "Rebuild failed",
          detail,
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    const normalizedProject = normalizeManifest(result.manifest);
    logInteraction("preview_rebuild_completed", { projectId: normalizedProject.id, projectTitle: normalizedProject.title });
    setProject(normalizedProject);
    setLastPreviewProject(normalizedProject);
    setSelectedAssetId(normalizedProject.assets[0]?.id ?? "");
    setActiveEditorTool(normalizedProject.editor.activeTool);
    setApplyMode(normalizedProject.editor.applyMode);
    setPhase("ready");
    setEvents((current) => [
      ...current,
      {
        id: `rebuild-done-${Date.now()}`,
        phase: "ready",
        title: "Preview rebuilt",
        detail: "Replaced the currently served preview from a local temp build.",
        timestamp: new Date().toISOString(),
      },
    ]);
    refreshWorkspaceProjects();
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
    error?: string;
  };
  selectedTemplateId?: string;
  onTemplateChange?: (templateId: string) => void;
  selectedEngine?: GameEngine;
  onEngineChange?: (engine: GameEngine) => void;
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
    onOpenProject: (project: WorkspaceProjectSummary) => void;
    workspaceProjects: WorkspaceProjectSummary[];
    projectName: string;
    projectNameError: string;
    selectedTemplateId: string;
    selectedEngine: GameEngine;
    onTemplateChange: (templateId: string) => void;
    onEngineChange: (engine: GameEngine) => void;
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

      <CapabilityGallery />

      <div className="home-hub-grid" id="home-hub">
        <div className="home-main-column">
          <PromptComposer
            showGameSelectors
            projectNameControls={{
              value: props.projectName,
              onChange: props.onProjectNameChange,
              error: props.projectNameError,
            }}
            workspaceControls={{
              workspace: props.workspace,
              onSelectWorkspace: props.onSelectWorkspace,
              onResetWorkspace: props.onResetWorkspace,
            }}
            selectedTemplateId={props.selectedTemplateId}
            selectedEngine={props.selectedEngine}
            onTemplateChange={props.onTemplateChange}
            onEngineChange={props.onEngineChange}
            promptBlocks={props.promptBlocks}
            actionLabel="Generate game"
            onDraftChange={props.onDraftChange}
            onAddAttachment={props.onAddAttachment}
            onSubmit={props.onStart}
          />
          <RecentGames projects={props.workspaceProjects} onOpenProject={props.onOpenProject} />
        </div>
        <aside className="home-side-column">
          <RandomIdeas onPickIdea={props.onProjectNameChange} onDraftChange={props.onDraftChange} onStartIdea={props.onStartIdea} />
          <SupportedTypes />
        </aside>
      </div>
    </section>
  );
}

function CapabilityGallery() {
  return (
    <section className="capability-section" aria-label="Game engine capabilities">
      <div className="capability-section-copy">
        <p className="eyebrow">AI-native game engine</p>
        <h2>Design, generate, edit, and playtest from one canvas.</h2>
        <p>
          Game Spark AI combines chat-led production tools with live engine previews so ideas can move from concept to playable
          scenes without leaving the editor.
        </p>
      </div>
      <div className="capability-gallery">
        {capabilityGallery.map((item, index) => (
          <article className={`capability-card capability-card-${index + 1}`} key={item.title}>
            <img src={item.imageUrl} alt="" />
            <div>
              <span>{item.eyebrow}</span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RecentGames({ projects, onOpenProject }: { projects: WorkspaceProjectSummary[]; onOpenProject: (project: WorkspaceProjectSummary) => void }) {
  return (
    <section className="existing-projects-band" aria-label="Existing projects">
      <div className="section-heading">
        <h2>Recent games</h2>
        <span>{projects.length} workspaces</span>
      </div>
      <div className="existing-project-grid">
        {projects.length === 0 ? (
          <article className="existing-project-card empty">
            <div className="existing-project-thumb">
              <span>GS</span>
            </div>
            <div>
              <h3>No local games yet</h3>
              <p>Generated games in the selected workspace will appear here.</p>
            </div>
          </article>
        ) : null}
        {projects.map((project) => (
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
                <span>{phaseLabels[project.status] ?? project.status}</span>
                <span>{formatRelativeDate(project.updatedAt)}</span>
              </div>
              <button type="button" onClick={() => onOpenProject(project)}>
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
  const pageCount = Math.ceil(gameCreationTemplates.length / pageSize);
  const visibleTemplates = gameCreationTemplates.slice(page * pageSize, page * pageSize + pageSize);

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
          <article className="template-card" key={template.id}>
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
  previewProject,
  previewableProjectIds,
  selectedAsset,
  selectedAssetId,
  events,
  phase,
  workspace,
  agentEnv,
  settingsStatus,
  activeEditorTool,
  applyMode,
  onDraftChange,
  onAddAttachment,
  onSelectWorkspace,
  onResetWorkspace,
  onAddAgentEnv,
  onUpdateAgentEnv,
  onRemoveAgentEnv,
  onSaveAgentEnv,
  onIterate,
  onRebuildSource,
  onInterrupt,
  onSelectEditorTool,
  onApplyModeChange,
  onToolPrompt,
  onSelectAsset,
}: {
  promptBlocks: PromptBlock[];
  project: GameProjectManifest | null;
  previewProject: GameProjectManifest | null;
  previewableProjectIds: Set<string>;
  selectedAsset?: GameProjectAsset;
  selectedAssetId: string;
  events: AgentEvent[];
  phase: AgentPhase;
  workspace: WorkspaceInfo;
  agentEnv: AgentEnvVariable[];
  settingsStatus: { kind: "idle" | "saved" | "error"; message: string };
  activeEditorTool: EditorToolId;
  applyMode: ApplyMode;
  onDraftChange: (content: string) => void;
  onAddAttachment: () => void;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
  onAddAgentEnv: () => void;
  onUpdateAgentEnv: (id: string, patch: Partial<AgentEnvVariable>) => void;
  onRemoveAgentEnv: (id: string) => void;
  onSaveAgentEnv: () => void;
  onIterate: () => void;
  onRebuildSource: () => void;
  onInterrupt: () => void;
  onSelectEditorTool: (toolId: EditorToolId) => void;
  onApplyModeChange: (mode: ApplyMode) => void;
  onToolPrompt: (toolId: EditorToolId, instruction: string) => void;
  onSelectAsset: (assetId: string) => void;
}) {
  const readyToolCount = (project?.editor.tools ?? []).filter((tool) => tool.status === "ready").length;
  const totalToolCount = project?.editor.tools.length ?? createDefaultEditorState().tools.length;
  const assetCount = project?.assets.length ?? 0;
  const logicNodeCount = project?.logicGraph.nodes.length ?? 0;

  return (
    <section className="workspace-view">
      <EditorCommandCenter
        project={project}
        phase={phase}
        workspace={workspace}
        readyToolCount={readyToolCount}
        totalToolCount={totalToolCount}
        assetCount={assetCount}
        logicNodeCount={logicNodeCount}
      />
      <NavigationPanel
        project={project}
        workspace={workspace}
        assets={project?.assets ?? []}
        selectedAssetId={selectedAssetId}
        agentEnv={agentEnv}
        settingsStatus={settingsStatus}
        activeEditorTool={activeEditorTool}
        onSelectAsset={onSelectAsset}
        onSelectEditorTool={onSelectEditorTool}
        onSelectWorkspace={onSelectWorkspace}
        onResetWorkspace={onResetWorkspace}
        onAddAgentEnv={onAddAgentEnv}
        onUpdateAgentEnv={onUpdateAgentEnv}
        onRemoveAgentEnv={onRemoveAgentEnv}
        onSaveAgentEnv={onSaveAgentEnv}
      />
      <AgentChat
        promptBlocks={promptBlocks}
        events={events}
        phase={phase}
        project={project}
        selectedAsset={selectedAsset}
        activeEditorTool={activeEditorTool}
        applyMode={applyMode}
        onApplyModeChange={onApplyModeChange}
        onToolPrompt={onToolPrompt}
        onDraftChange={onDraftChange}
        onAddAttachment={onAddAttachment}
        onIterate={onIterate}
        onInterrupt={onInterrupt}
      />
      <GamePreviewPanel
        project={project}
        previewProject={previewProject}
        previewableProjectIds={previewableProjectIds}
        phase={phase}
        onRebuildSource={onRebuildSource}
        logInteraction={logInteraction}
      />
    </section>
  );
}

function EditorCommandCenter({
  project,
  phase,
  workspace,
  readyToolCount,
  totalToolCount,
  assetCount,
  logicNodeCount,
}: {
  project: GameProjectManifest | null;
  phase: AgentPhase;
  workspace: WorkspaceInfo;
  readyToolCount: number;
  totalToolCount: number;
  assetCount: number;
  logicNodeCount: number;
}) {
  const ports = [
    { label: "Runtime", value: project ? engineLabel(project.engine) : "None" },
    { label: "AI tools", value: `${readyToolCount}/${totalToolCount}` },
    { label: "Assets", value: String(assetCount) },
    { label: "Logic", value: `${logicNodeCount} nodes` },
  ];

  return (
    <header className="editor-command-center">
      <div className="editor-command-title">
        <p className="eyebrow">AI native editor</p>
        <h1>{project?.title ?? "Game workspace"}</h1>
        <span>{workspace.path}</span>
      </div>
      <div className="editor-port-strip" aria-label="Editor ports">
        {ports.map((port) => (
          <div className="editor-port-card" key={port.label}>
            <span>{port.label}</span>
            <strong>{port.value}</strong>
          </div>
        ))}
      </div>
      <div className="editor-run-state">
        <span className={`phase-chip phase-${phase}`}>{phaseLabels[phase]}</span>
      </div>
    </header>
  );
}

function NavigationPanel({
  project,
  workspace,
  assets,
  selectedAssetId,
  agentEnv,
  settingsStatus,
  activeEditorTool,
  onSelectAsset,
  onSelectEditorTool,
  onSelectWorkspace,
  onResetWorkspace,
  onAddAgentEnv,
  onUpdateAgentEnv,
  onRemoveAgentEnv,
  onSaveAgentEnv,
}: {
  project: GameProjectManifest | null;
  workspace: WorkspaceInfo;
  assets: GameProjectAsset[];
  selectedAssetId: string;
  agentEnv: AgentEnvVariable[];
  settingsStatus: { kind: "idle" | "saved" | "error"; message: string };
  activeEditorTool: EditorToolId;
  onSelectAsset: (assetId: string) => void;
  onSelectEditorTool: (toolId: EditorToolId) => void;
  onSelectWorkspace: () => void;
  onResetWorkspace: () => void;
  onAddAgentEnv: () => void;
  onUpdateAgentEnv: (id: string, patch: Partial<AgentEnvVariable>) => void;
  onRemoveAgentEnv: (id: string) => void;
  onSaveAgentEnv: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"tools" | "assets" | "settings">("tools");

  return (
    <aside className="nav-panel">
      <div className="nav-brand">
        <div>
          <h1>{project?.title ?? "Untitled"}</h1>
          <span>{project ? `${engineLabel(project.engine)} project` : "No project"}</span>
        </div>
      </div>

      <div className="nav-scroll">
        <nav className="nav-section" aria-label="Project navigation">
          <button
            className={`nav-item ${activeTab === "tools" ? "active" : ""}`}
            type="button"
            onClick={() => {
              logInteraction("editor_nav_tab_clicked", { from: activeTab, to: "tools", projectId: project?.id });
              setActiveTab("tools");
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              AI
            </span>
            AI tools
          </button>
          <button
            className={`nav-item ${activeTab === "assets" ? "active" : ""}`}
            type="button"
            onClick={() => {
              logInteraction("editor_nav_tab_clicked", { from: activeTab, to: "assets", projectId: project?.id });
              setActiveTab("assets");
            }}
          >
            <span className="nav-icon" aria-hidden="true">
              <AssetsIcon />
            </span>
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
            <span className="nav-icon" aria-hidden="true">
              <SettingsIcon />
            </span>
            Settings
          </button>
        </nav>

        <div className="nav-tab-content">
          {activeTab === "tools" ? <EditorToolList project={project} activeTool={activeEditorTool} onSelectTool={onSelectEditorTool} /> : null}
          {activeTab === "assets" ? <AssetsViewer assets={assets} selectedAssetId={selectedAssetId} onSelectAsset={onSelectAsset} /> : null}
          {activeTab === "settings" ? (
            <>
              <ProjectSnapshot project={project} workspace={workspace} />
              <WorkspacePicker compact workspace={workspace} onSelectWorkspace={onSelectWorkspace} onResetWorkspace={onResetWorkspace} />
              <AgentEnvSettings
                agentEnv={agentEnv}
                status={settingsStatus}
                onAdd={onAddAgentEnv}
                onUpdate={onUpdateAgentEnv}
                onRemove={onRemoveAgentEnv}
                onSave={onSaveAgentEnv}
              />
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function EditorToolList({
  project,
  activeTool,
  onSelectTool,
}: {
  project: GameProjectManifest | null;
  activeTool: EditorToolId;
  onSelectTool: (toolId: EditorToolId) => void;
}) {
  const tools = project?.editor.tools ?? createDefaultEditorState().tools;
  return (
    <section className="editor-tool-list">
      <div className="section-heading">
        <h2>AI tools</h2>
        <span>{tools.length}</span>
      </div>
      <div className="tool-list">
        {tools.map((tool) => (
          <button
            className={`tool-row ${tool.id === activeTool ? "selected" : ""}`}
            key={tool.id}
            type="button"
            onClick={() => onSelectTool(tool.id)}
          >
            <span className={`tool-status ${tool.status}`} />
            <span>
              <strong>{tool.title}</strong>
              <small>{tool.summary}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AgentEnvSettings({
  agentEnv,
  status,
  onAdd,
  onUpdate,
  onRemove,
  onSave,
}: {
  agentEnv: AgentEnvVariable[];
  status: { kind: "idle" | "saved" | "error"; message: string };
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<AgentEnvVariable>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
}) {
  return (
    <section className="agent-env-settings">
      <div className="section-heading">
        <h2>Agent environment</h2>
        <span>{agentEnv.filter((item) => item.key.trim()).length}</span>
      </div>
      <p>Saved variables are injected into the Codex process when the agent runs.</p>
      <div className="env-list">
        {agentEnv.length ? (
          agentEnv.map((item) => {
            const keyIsInvalid = Boolean(item.key.trim()) && !isValidEnvName(item.key.trim());
            return (
              <div className="env-row" key={item.id}>
                <label>
                  <span>Name</span>
                  <input
                    value={item.key}
                    onChange={(event) => onUpdate(item.id, { key: event.target.value })}
                    placeholder="WORLD_LABS_API_KEY"
                    aria-invalid={keyIsInvalid}
                    spellCheck={false}
                  />
                </label>
                <label>
                  <span>Value</span>
                  <input
                    type="password"
                    value={item.value}
                    onChange={(event) => onUpdate(item.id, { value: event.target.value })}
                    placeholder="Stored locally"
                    spellCheck={false}
                  />
                </label>
                <button className="ghost-button" type="button" onClick={() => onRemove(item.id)}>
                  Remove
                </button>
              </div>
            );
          })
        ) : (
          <div className="env-empty">No agent environment variables saved.</div>
        )}
      </div>
      <div className="env-actions">
        <button className="secondary-button" type="button" onClick={onAdd}>
          Add variable
        </button>
        <button type="button" onClick={onSave}>
          Save
        </button>
      </div>
      {status.message ? <small className={`settings-status ${status.kind}`}>{status.message}</small> : null}
    </section>
  );
}

function AssetsIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M6 8.5 12 5l6 3.5v7L12 19l-6-3.5z" />
      <path d="M6.5 9 12 12.2 17.5 9M12 12.2V18" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4z" />
      <path d="M12 3.8v2.1M12 18.1v2.1M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M3.8 12h2.1M18.1 12h2.1M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5" />
    </svg>
  );
}

function AgentChat({
  promptBlocks,
  events,
  phase,
  project,
  selectedAsset,
  activeEditorTool,
  applyMode,
  onApplyModeChange,
  onToolPrompt,
  onDraftChange,
  onAddAttachment,
  onIterate,
  onInterrupt,
}: {
  promptBlocks: PromptBlock[];
  events: AgentEvent[];
  phase: AgentPhase;
  project: GameProjectManifest | null;
  selectedAsset?: GameProjectAsset;
  activeEditorTool: EditorToolId;
  applyMode: ApplyMode;
  onApplyModeChange: (mode: ApplyMode) => void;
  onToolPrompt: (toolId: EditorToolId, instruction: string) => void;
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

      <EditorToolWorkspace
        project={project}
        selectedAsset={selectedAsset}
        activeTool={activeEditorTool}
        applyMode={applyMode}
        onApplyModeChange={onApplyModeChange}
        onToolPrompt={onToolPrompt}
      />

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

function EditorToolWorkspace({
  project,
  selectedAsset,
  activeTool,
  applyMode,
  onApplyModeChange,
  onToolPrompt,
}: {
  project: GameProjectManifest | null;
  selectedAsset?: GameProjectAsset;
  activeTool: EditorToolId;
  applyMode: ApplyMode;
  onApplyModeChange: (mode: ApplyMode) => void;
  onToolPrompt: (toolId: EditorToolId, instruction: string) => void;
}) {
  const tool = project?.editor.tools.find((item) => item.id === activeTool) ?? createDefaultEditorState().tools.find((item) => item.id === activeTool);
  const actions = toolActions(activeTool, project?.engine ?? "babylonjs");
  return (
    <section className="editor-workspace">
      <div className="editor-workspace-head">
        <div>
          <p className="eyebrow">AI editor</p>
          <h3>{tool?.title ?? "Tool"}</h3>
        </div>
        <div className="apply-toggle" aria-label="Apply mode">
          {(["preview", "auto"] as ApplyMode[]).map((mode) => (
            <button className={applyMode === mode ? "active" : ""} key={mode} type="button" onClick={() => onApplyModeChange(mode)}>
              {mode}
            </button>
          ))}
        </div>
      </div>
      <p className="editor-tool-summary">{tool?.summary}</p>
      <AIPortMatrix project={project} selectedAsset={selectedAsset} activeTool={activeTool} />
      {activeTool === "logic" ? <LogicGraphPreview graph={project?.logicGraph ?? createDefaultLogicGraph()} /> : <ToolPreview toolId={activeTool} engine={project?.engine ?? "babylonjs"} />}
      <div className="tool-action-grid">
        {actions.map((action) => (
          <button key={action.label} type="button" onClick={() => onToolPrompt(activeTool, action.prompt)}>
            <strong>{action.label}</strong>
            <span>{action.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AIPortMatrix({
  project,
  selectedAsset,
  activeTool,
}: {
  project: GameProjectManifest | null;
  selectedAsset?: GameProjectAsset;
  activeTool: EditorToolId;
}) {
  const activeToolMeta = project?.editor.tools.find((tool) => tool.id === activeTool) ?? createDefaultEditorState().tools.find((tool) => tool.id === activeTool);
  const ports = [
    {
      label: "Prompt port",
      value: activeToolMeta?.title ?? "Tool",
      detail: "Chat instructions route into the selected editor tool.",
    },
    {
      label: "Scene port",
      value: project?.editor.activeScenePath ?? "scene.json",
      detail: "Edits are reflected in the live scene manifest.",
    },
    {
      label: "Asset port",
      value: selectedAsset?.name ?? "No asset selected",
      detail: selectedAsset ? `${selectedAsset.kind} asset ready for AI iteration.` : "Select an asset to expose it to the editor context.",
    },
    {
      label: "Logic port",
      value: `${project?.logicGraph.nodes.length ?? 0} nodes`,
      detail: "Game rules can be generated as editable logic graph nodes.",
    },
  ];

  return (
    <div className="ai-port-matrix" aria-label="AI editor ports">
      {ports.map((port) => (
        <article key={port.label}>
          <span>{port.label}</span>
          <strong>{port.value}</strong>
          <p>{port.detail}</p>
        </article>
      ))}
    </div>
  );
}

function LogicGraphPreview({ graph }: { graph: GameProjectManifest["logicGraph"] }) {
  return (
    <div className="logic-graph-preview">
      <svg viewBox="0 0 680 300" role="img" aria-label="Game logic node graph">
        {graph.edges.map((edge) => {
          const from = graph.nodes.find((node) => node.id === edge.from);
          const to = graph.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          const x1 = from.x + 120;
          const y1 = from.y + 34;
          const x2 = to.x;
          const y2 = to.y + 34;
          return (
            <g key={edge.id}>
              <path d={`M ${x1} ${y1} C ${x1 + 48} ${y1}, ${x2 - 48} ${y2}, ${x2} ${y2}`} />
              <text x={(x1 + x2) / 2 - 18} y={(y1 + y2) / 2 - 8}>
                {edge.label}
              </text>
            </g>
          );
        })}
        {graph.nodes.map((node) => (
          <g className={`graph-node ${node.kind}`} key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <rect width="128" height="68" rx="8" />
            <text x="12" y="24">
              {node.title}
            </text>
            <text x="12" y="46">
              {node.kind}
            </text>
          </g>
        ))}
      </svg>
      <div className="logic-node-list">
        {graph.nodes.map((node) => (
          <article key={node.id}>
            <strong>{node.title}</strong>
            <span>{node.summary}</span>
          </article>
        ))}
      </div>
    </div>
  );
}

function ToolPreview({ toolId, engine }: { toolId: EditorToolId; engine: GameEngine }) {
  const title: Record<EditorToolId, string> = {
    "character-2d": "Sprite animation preview",
    "character-3d": "3D character preview",
    world: "Scene preview",
    logic: "Logic preview",
    "ui-dialogue": "Dialogue and HUD preview",
    audio: "Audio event map",
    publish: "Build readiness",
  };
  return (
    <div className={`tool-preview tool-preview-${toolId}`}>
      <div className="tool-preview-stage">
        <span>{engineLabel(engine)}</span>
        <strong>{title[toolId]}</strong>
      </div>
    </div>
  );
}

function toolActions(toolId: EditorToolId, engine: GameEngine) {
  const engineText = engine === "phaser" ? "Phaser" : "Babylon.js";
  const actions: Record<EditorToolId, Array<{ label: string; detail: string; prompt: string }>> = {
    "character-2d": [
      { label: "Generate sheet", detail: "Create idle/surprised/happy/sad/laugh.", prompt: "Generate or update the 2D character sprite sheets and wire the animation states into the runtime." },
      { label: "Tune motion", detail: "Adjust frame timing and emotion mapping.", prompt: "Tune the 2D character animation timing, emotion transitions, and runtime references." },
    ],
    "character-3d": [
      { label: "Design model", detail: "Create a model direction for Babylon.js.", prompt: "Design or update the 3D character model plan, materials, scale, and Babylon.js preview usage." },
      { label: "Pose preview", detail: "Add camera, light, and pose notes.", prompt: "Add a 3D character preview setup with camera, lighting, material notes, and runtime references." },
    ],
    world: [
      { label: "Generate world", detail: `Create a ${engineText} scene plan.`, prompt: `Generate or update the ${engineText} world scene, camera, lighting, object placement, and asset references.` },
      { label: "Add interactions", detail: "Objects, pickups, and inspect targets.", prompt: "Add interactable world objects and connect them to game state, dialogue, and feedback." },
    ],
    logic: [
      { label: "Update graph", detail: "Use nodes as an edit request.", prompt: "Update the game logic code from the current node graph intent, then refresh logicGraph metadata from the resulting code." },
      { label: "Add branch", detail: "Create a new trigger/action path.", prompt: "Add a new gameplay branch with trigger, condition, action, state update, and ending/dialogue impact." },
    ],
    "ui-dialogue": [
      { label: "Write dialogue", detail: "Branching choices and HUD states.", prompt: "Write or revise the dialogue tree, choice UI, HUD prompts, and runtime state transitions." },
      { label: "Polish UI", detail: "Improve layout and readability.", prompt: "Polish the in-game UI layout, dialogue panel, button states, and readable feedback." },
    ],
    audio: [
      { label: "Sound map", detail: "Bind sounds to events.", prompt: "Create or update the audio event map for music, ambience, UI sounds, and gameplay feedback." },
      { label: "Mix groups", detail: "Music, SFX, ambience.", prompt: "Add volume groups and audio playback hooks for music, sound effects, and ambience." },
    ],
    publish: [
      { label: "Validate build", detail: "Check files and runtime references.", prompt: "Validate the playable build, asset references, manifest metadata, and preview readiness." },
      { label: "Prepare export", detail: "Summarize publish state.", prompt: "Prepare the local publish/export state and document any blockers in the latest run validation." },
    ],
  };
  return actions[toolId];
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
  selectedTemplateId,
  selectedEngine = "babylonjs",
  onTemplateChange,
  onEngineChange,
  workspaceControls,
  promptBlocks,
  actionLabel,
  onDraftChange,
  onAddAttachment,
  onSubmit,
}: PromptComposerProps) {
  const activeTemplateId = selectedTemplateId ?? gameCreationTemplates[0]?.id ?? "";
  const canUsePhaser = templateSupportsPhaser(activeTemplateId);
  const effectiveEngine = canUsePhaser ? selectedEngine : "babylonjs";
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
                aria-invalid={Boolean(projectNameControls.error)}
              />
              {projectNameControls.error ? <small className="project-name-error">{projectNameControls.error}</small> : null}
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
                  value={activeTemplateId}
                  onChange={(event) => {
                    const nextTemplateId = event.target.value;
                    logInteraction("composer_template_selected", { templateId: nextTemplateId });
                    onTemplateChange?.(nextTemplateId);
                  }}
                >
                  {gameCreationTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Engine</span>
                <select
                  value={effectiveEngine}
                  disabled={!canUsePhaser}
                  onChange={(event) => {
                    const nextEngine = event.target.value as GameEngine;
                    logInteraction("composer_engine_selected", { engine: nextEngine, templateId: activeTemplateId });
                    onEngineChange?.(nextEngine);
                  }}
                >
                  {supportedEngines.map((engine) => (
                    <option key={engine} value={engine}>
                      {engine === "babylonjs" ? "Babylon.js" : "Phaser"}
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
          <dt>Preview</dt>
          <dd>{project ? "Playable project preview" : "Not generated yet"}</dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{project?.runHistory.length ?? 0}</dd>
        </div>
      </dl>
    </section>
  );
}
