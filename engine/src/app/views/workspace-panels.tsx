import { useState } from "react";
import type { RefObject } from "react";
import { spriteEmotions } from "../../data/codex-pipeline";
import { gameCreationTemplates, templateSupportsPhaser } from "../../data/game-templates";
import { phaseLabels, supportedEngines } from "../app-constants";
import { logInteraction } from "../app-telemetry";
import { engineLabel, isCodexBusy } from "../app-utils";
import type { AgentEvent, AgentPhase, GameEngine, GameProjectAsset, GameProjectManifest, PromptBlock, WorkspaceInfo } from "../../types/project-types";

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

export function WorkspacePicker({
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

export function PromptComposer({
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

export function AgentProgress({
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

export function AssetsViewer({
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

export function ProjectSnapshot({ project, workspace }: { project: GameProjectManifest | null; workspace: WorkspaceInfo }) {
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
