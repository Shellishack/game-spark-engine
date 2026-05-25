import { useEffect, useMemo, useRef, useState } from "react";
import {
  createManifest,
  createMockRunEvents,
  defaultPromptBlocks,
  publishedGames,
} from "../data/codex-pipeline";
import { buildPromptFromTemplate, gameCreationTemplates, templateSupportsPhaser } from "../data/game-templates";
import {
  blockToPromptText,
  classifyWorkflowIntent,
  engineForTemplate,
  findDuplicateProject,
  formatCodexLogForDisplay,
  isValidEnvName,
  normalizeManifest,
  titleFromPrompt,
  wait,
} from "./app-utils";
import { logInteraction } from "./app-telemetry";
import { Home } from "./views/home-view";
import { WindowFrame } from "./views/window-frame";
import { Workspace } from "./views/workspace-view";
import type {
  AgentEnvVariable,
  AgentEvent,
  AgentPhase,
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
export default function App() {
  const [view, setView] = useState<"home" | "workspace">("home");
  const panelWindowId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const panel = new URLSearchParams(window.location.search).get("panel");
    return panel === "navigator" || panel === "assistant" || panel === "preview" ? panel : null;
  }, []);
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
    if (panelWindowId) setView("workspace");
    window.gameSpark?.getWorkspace?.().then(setWorkspace).catch(() => undefined);
    window.gameSpark?.getSettings?.().then((settings) => setAgentEnv(settings.agentEnv)).catch(() => undefined);
    refreshWorkspaceProjects();
  }, [panelWindowId]);

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
            panelWindowId={panelWindowId}
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

