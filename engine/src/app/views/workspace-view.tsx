import { Fragment, useRef, useState } from "react";
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from "@dnd-kit/core";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { Group, Panel, Separator } from "react-resizable-panels";
import { createDefaultEditorState } from "../../data/codex-pipeline";
import { logInteraction } from "../app-telemetry";
import { GamePreviewPanel } from "../components/game-preview-panel";
import { AgentChat, DockDragPreview, DockGroupView, EditorCommandCenter, NavigationPanel, previewDockGroupsForDrag, reorderDockGroupsForPanel } from "./editor-dock";
import { defaultDockGroups, dockGroupDefaults, editorPanelCatalog } from "./editor-dock-model";
import type { EditorDockGroup, EditorDockGroupId, EditorPanelId, EditorPanelLayout } from "./editor-dock-model";
import type { AgentEnvVariable, AgentEvent, AgentPhase, ApplyMode, EditorToolId, GameProjectAsset, GameProjectManifest, PromptBlock, WorkspaceInfo } from "../../types/project-types";
export function Workspace({
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
  panelWindowId,
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
  panelWindowId: EditorPanelId | null;
}) {
  const readyToolCount = (project?.editor.tools ?? []).filter((tool) => tool.status === "ready").length;
  const totalToolCount = project?.editor.tools.length ?? createDefaultEditorState().tools.length;
  const assetCount = project?.assets.length ?? 0;
  const logicNodeCount = project?.logicGraph.nodes.length ?? 0;
  const [dockGroups, setDockGroups] = useState<EditorDockGroup[]>(
    panelWindowId
      ? [{ id: "center", title: editorPanelCatalog[panelWindowId].title, panelId: panelWindowId, activePanelId: panelWindowId, collapsed: false }]
      : defaultDockGroups,
  );
  const [draggedPanelId, setDraggedPanelId] = useState<EditorPanelId | null>(null);
  const [dragTargetGroupId, setDragTargetGroupId] = useState<EditorDockGroupId | null>(null);
  const dragTargetGroupIdRef = useRef<EditorDockGroupId | null>(null);
  const dragPointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const dockSlotRectsRef = useRef<Array<{ id: EditorDockGroupId; left: number; right: number; top: number; bottom: number }>>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const previewDockGroups = draggedPanelId ? previewDockGroupsForDrag(dockGroups, draggedPanelId, dragTargetGroupId) : dockGroups;
  const visibleDockGroups = dockGroups.filter((group) => !group.collapsed);
  const previewGroupById = new Map(previewDockGroups.map((group) => [group.id, group]));
  const dragSourceGroupId = draggedPanelId ? dockGroups.find((group) => group.panelId === draggedPanelId)?.id ?? null : null;

  function updateDockGroup(groupId: EditorDockGroupId, patch: Partial<EditorDockGroup>) {
    setDockGroups((current) => current.map((group) => (group.id === groupId ? { ...group, ...patch } : group)));
  }

  function activatePanel(panelId: EditorPanelId) {
    setDockGroups((current) =>
      current.map((group) => (group.panelId === panelId ? { ...group, activePanelId: panelId, collapsed: false } : group)),
    );
  }

  function setDragTarget(nextTargetGroupId: EditorDockGroupId | null) {
    if (dragTargetGroupIdRef.current === nextTargetGroupId) return;
    dragTargetGroupIdRef.current = nextTargetGroupId;
    setDragTargetGroupId(nextTargetGroupId);
  }

  function measureDockSlots() {
    dockSlotRectsRef.current = Array.from(document.querySelectorAll<HTMLElement>("[data-dock-slot]")).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.dockSlot as EditorDockGroupId,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
  }

  function targetFromFrozenRects(point: { x: number; y: number }) {
    return dockSlotRectsRef.current.find((rect) => point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)?.id ?? null;
  }

  function handleDockDragStart(event: DragStartEvent) {
    const draggedId = event.active.id as EditorPanelId;
    setDraggedPanelId(draggedId);
    measureDockSlots();

    const sourceEvent = event.activatorEvent;
    if ("clientX" in sourceEvent && "clientY" in sourceEvent) {
      const origin = { x: Number(sourceEvent.clientX), y: Number(sourceEvent.clientY) };
      dragPointerOriginRef.current = origin;
      setDragTarget(targetFromFrozenRects(origin));
    }
  }

  function handleDockDragMove(event: DragMoveEvent) {
    const origin = dragPointerOriginRef.current;
    if (!origin) return;
    const point = {
      x: origin.x + event.delta.x,
      y: origin.y + event.delta.y,
    };
    const nextTargetGroupId = targetFromFrozenRects(point);
    if (nextTargetGroupId) setDragTarget(nextTargetGroupId);
  }

  function handleDockDragEnd(event: DragEndEvent) {
    const draggedId = event.active.id as EditorPanelId;
    const targetGroupId = dragTargetGroupIdRef.current;
    setDraggedPanelId(null);
    setDragTarget(null);
    dragPointerOriginRef.current = null;
    dockSlotRectsRef.current = [];
    if (!editorPanelCatalog[draggedId] || !targetGroupId) return;

    setDockGroups((current) => reorderDockGroupsForPanel(current, draggedId, targetGroupId));
    logInteraction("editor_panel_reordered", { draggedId, targetGroupId, projectId: project?.id });
  }

  function popOutPanel(panel: EditorPanelLayout) {
    window.gameSpark?.openEditorPanelWindow?.(panel.id);
    logInteraction("editor_panel_popped_out", { panelId: panel.id, projectId: project?.id });
  }

  function renderPanel(panel: EditorPanelLayout) {
    if (panel.id === "navigator") {
      return (
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
      );
    }
    if (panel.id === "assistant") {
      return (
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
      );
    }
    return (
      <GamePreviewPanel
        project={project}
        previewProject={previewProject}
        previewableProjectIds={previewableProjectIds}
        phase={phase}
        onRebuildSource={onRebuildSource}
        logInteraction={logInteraction}
      />
    );
  }

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
      <div className="editor-layout-shell">
        <div className="editor-layout-toolbar" aria-label="Editor layout controls">
          <div>
            <strong>{panelWindowId ? `${editorPanelCatalog[panelWindowId].title} popup` : "Docking layout"}</strong>
            <span>{panelWindowId ? "Detached live editor panel." : "Drag tab handles between dock groups, resize nested panes, collapse views, or detach a module."}</span>
          </div>
          {!panelWindowId ? (
            <div className="editor-layout-actions">
              {dockGroups.map((group) => (
                <button
                  className={group.collapsed ? "" : "active"}
                  key={group.id}
                  type="button"
                  onClick={() => updateDockGroup(group.id, { collapsed: !group.collapsed })}
                >
                  {group.title}
                </button>
              ))}
              <button type="button" onClick={() => setDockGroups(defaultDockGroups)}>
                Reset
              </button>
            </div>
          ) : null}
        </div>
        <DndContext
          sensors={sensors}
          onDragCancel={() => {
            setDraggedPanelId(null);
            setDragTarget(null);
            dragPointerOriginRef.current = null;
            dockSlotRectsRef.current = [];
          }}
          onDragEnd={handleDockDragEnd}
          onDragMove={handleDockDragMove}
          onDragStart={handleDockDragStart}
        >
          {visibleDockGroups.length ? (
            <LayoutGroup id="editor-dock-layout">
              <Group className="editor-dock-layout" orientation="horizontal" defaultLayout={{ left: 22, center: 33, right: 45 }} key={visibleDockGroups.map((group) => group.id).join("-")}>
                <AnimatePresence initial={false}>
                  {visibleDockGroups.map((slotGroup, index) => {
                    const previewGroup = previewGroupById.get(slotGroup.id) ?? slotGroup;
                    const panelKey = previewGroup.panelId ?? slotGroup.id;
                    return (
                    <Fragment key={panelKey}>
                      <Panel
                        className="editor-dock-panel"
                        defaultSize={slotGroup.id === "left" ? 22 : slotGroup.id === "center" ? 33 : 45}
                        id={slotGroup.id}
                        minSize={18}
                      >
                        <motion.div className="editor-dock-motion-shell" layout transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                          <DockGroupView
                            slotGroup={slotGroup}
                            previewGroup={previewGroup}
                            panels={editorPanelCatalog}
                            committedGroup={slotGroup}
                            dragSourceGroupId={dragSourceGroupId}
                            dragTargetGroupId={dragTargetGroupId}
                            draggedPanelId={draggedPanelId}
                            onCollapse={() => updateDockGroup(slotGroup.id, { collapsed: true })}
                            onPopOut={popOutPanel}
                            renderPanel={renderPanel}
                          />
                        </motion.div>
                      </Panel>
                      {index < visibleDockGroups.length - 1 ? <Separator className="editor-resize-handle" /> : null}
                    </Fragment>
                    );
                  })}
                </AnimatePresence>
              </Group>
            </LayoutGroup>
          ) : (
            <div className="editor-empty-layout">
              <strong>All views are collapsed</strong>
              <button type="button" onClick={() => setDockGroups(defaultDockGroups)}>
                Restore layout
              </button>
            </div>
          )}
          <DragOverlay>
            {draggedPanelId ? (
              <DockDragPreview panel={editorPanelCatalog[draggedPanelId]} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </section>
  );

}

