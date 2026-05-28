import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { motion } from "framer-motion";
import { createDefaultEditorState, createDefaultLogicGraph } from "../../data/codex-pipeline";
import { phaseLabels } from "../app-constants";
import { engineLabel, isCodexBusy, isValidEnvName } from "../app-utils";
import { logInteraction } from "../app-telemetry";
import { AgentProgress, AssetsViewer, ProjectSnapshot, PromptComposer, WorkspacePicker } from "./workspace-panels";
import type { EditorDockGroup, EditorDockGroupId, EditorPanelId, EditorPanelLayout } from "./editor-dock-model";
import type { AgentEnvVariable, AgentEvent, AgentPhase, ApplyMode, EditorToolId, GameEngine, GameProjectAsset, GameProjectManifest, PromptBlock, WorkspaceInfo } from "../../types/project-types";
export function reorderDockGroupsForPanel(groups: EditorDockGroup[], panelId: EditorPanelId, targetGroupId: EditorDockGroupId) {
  const sourceIndex = groups.findIndex((group) => group.panelId === panelId);
  const targetIndex = groups.findIndex((group) => group.id === targetGroupId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return groups;

  const panelOrder = groups.map((group) => group.panelId).filter(Boolean) as EditorPanelId[];
  const [movedPanel] = panelOrder.splice(sourceIndex, 1);
  panelOrder.splice(targetIndex, 0, movedPanel);

  return groups.map((group, index) => {
    const nextPanelId = panelOrder[index] ?? null;
    return {
      ...group,
      panelId: nextPanelId,
      activePanelId: nextPanelId,
      collapsed: false,
    };
  });
}

export function previewDockGroupsForDrag(groups: EditorDockGroup[], panelId: EditorPanelId, targetGroupId: EditorDockGroupId | null) {
  if (!targetGroupId) {
    return groups;
  }

  return reorderDockGroupsForPanel(groups, panelId, targetGroupId);
}

export function DockGroupView({
  slotGroup,
  previewGroup,
  panels,
  committedGroup,
  dragSourceGroupId,
  dragTargetGroupId,
  draggedPanelId,
  onCollapse,
  onPopOut,
  renderPanel,
}: {
  slotGroup: EditorDockGroup;
  previewGroup: EditorDockGroup;
  panels: Record<EditorPanelId, EditorPanelLayout>;
  committedGroup: EditorDockGroup | null;
  dragSourceGroupId: EditorDockGroupId | null;
  dragTargetGroupId: EditorDockGroupId | null;
  draggedPanelId: EditorPanelId | null;
  onCollapse: () => void;
  onPopOut: (panel: EditorPanelLayout) => void;
  renderPanel: (panel: EditorPanelLayout) => ReactNode;
}) {
  const activePanelId = previewGroup.panelId ?? previewGroup.activePanelId ?? null;
  const activePanel = activePanelId ? panels[activePanelId] : null;
  const committedPanel = committedGroup?.panelId ? panels[committedGroup.panelId] : null;
  const isDragTarget = dragTargetGroupId === slotGroup.id;
  const isDraggedPreviewSlot = Boolean(draggedPanelId && activePanel?.id === draggedPanelId);
  const isSourceSlot = Boolean(draggedPanelId && activePanel?.id === draggedPanelId && committedPanel?.id === draggedPanelId && dragSourceGroupId === slotGroup.id);
  const isShiftedSlot = Boolean(draggedPanelId && activePanelId && committedPanel?.id && activePanelId !== committedPanel.id && !isDraggedPreviewSlot);

  return (
    <section className={`editor-dock-group dock-${slotGroup.id} ${isDragTarget ? "drop-preview" : ""} ${isSourceSlot ? "source-blur" : ""}`} data-dock-slot={slotGroup.id}>
      <header className="dock-group-header">
        {activePanel ? <DockViewDragHandle panel={activePanel} /> : null}
        <div>
          <strong>{slotGroup.title}</strong>
          <span>{activePanel?.port ?? "Drop a view here"}</span>
        </div>
        <div className="dock-group-actions">
          {activePanel ? (
            <button type="button" onClick={() => onPopOut(activePanel)}>
              Pop out
            </button>
          ) : null}
          <button type="button" onClick={onCollapse}>
            Collapse
          </button>
        </div>
      </header>
      <div className={`dock-drop-preview ${isDragTarget ? "visible" : ""}`} aria-hidden={!isDragTarget}>
        <strong>{isDraggedPreviewSlot ? "Release to place view" : "View will move out of this slot"}</strong>
        <span>{isDraggedPreviewSlot ? "The dragged preview will expand into this region." : "This region is being pushed to its preview location."}</span>
      </div>
      <motion.div
        className={`dock-panel-body ${!activePanel ? "empty" : ""} ${isDraggedPreviewSlot ? "source-blur" : ""} ${isShiftedSlot ? "shifted" : ""}`}
        layout
        layoutId={activePanel ? `dock-view-${activePanel.id}` : `dock-empty-${slotGroup.id}`}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {activePanel ? renderPanel(activePanel) : <DockEmptySlot />}
      </motion.div>
    </section>
  );
}

export function DockDragPreview({ panel }: { panel: EditorPanelLayout }) {
  return (
    <div className={`dock-drag-preview-card preview-${panel.id}`}>
      <header>
        <span aria-hidden="true">::</span>
        <strong>{panel.title}</strong>
      </header>
      <div className="dock-drag-preview-body">
        {panel.id === "navigator" ? (
          <>
            <i />
            <i />
            <i />
            <b />
            <b />
          </>
        ) : panel.id === "assistant" ? (
          <>
            <i />
            <b />
            <b />
            <em />
          </>
        ) : (
          <>
            <div className="preview-screen" />
            <b />
            <b />
          </>
        )}
      </div>
    </div>
  );
}

function DockEmptySlot() {
  return (
    <div className="dock-empty-slot">
      <strong>Empty slot</strong>
      <span>Drop a view here</span>
    </div>
  );
}

function DockViewDragHandle({ panel }: { panel: EditorPanelLayout }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: panel.id });

  return (
    <button
      className={`dock-view-drag-handle ${isDragging ? "dragging" : ""}`}
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Drag ${panel.title}`}
      title="Drag view"
    >
      <span aria-hidden="true">::</span>
    </button>
  );
}

export function EditorCommandCenter({
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

export function NavigationPanel({
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
              <CreditsOnlySettings />
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

function CreditsOnlySettings() {
  const [selectedPackId, setSelectedPackId] = useState("starter");
  const creditPacks = [
    { id: "starter", credits: 500, price: "$5" },
    { id: "creator", credits: 1500, price: "$12" },
    { id: "studio", credits: 5000, price: "$35" },
  ];
  const selectedPack = creditPacks.find((pack) => pack.id === selectedPackId) ?? creditPacks[0];

  return (
    <section className="credits-settings" aria-label="Credits">
      <div className="section-heading">
        <h2>Credits</h2>
        <span>Purchase only</span>
      </div>
      <p>Game Spark uses prepaid credits for AI generation. No subscription plan is required.</p>
      <div className="credit-balance-card">
        <span>Available credits</span>
        <strong>0</strong>
      </div>
      <div className="credit-pack-grid" role="radiogroup" aria-label="Credit packs">
        {creditPacks.map((pack) => (
          <button
            className={pack.id === selectedPackId ? "selected" : ""}
            key={pack.id}
            type="button"
            role="radio"
            aria-checked={pack.id === selectedPackId}
            onClick={() => {
              setSelectedPackId(pack.id);
              logInteraction("credit_pack_selected", { packId: pack.id, credits: pack.credits, price: pack.price });
            }}
          >
            <strong>{pack.credits.toLocaleString()} credits</strong>
            <span>{pack.price}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          logInteraction("credit_purchase_clicked", {
            packId: selectedPack.id,
            credits: selectedPack.credits,
            price: selectedPack.price,
          });
        }}
      >
        Buy {selectedPack.credits.toLocaleString()} credits
      </button>
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

export function AgentChat({
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

