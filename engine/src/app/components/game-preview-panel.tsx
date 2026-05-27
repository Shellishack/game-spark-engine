import { useEffect, useRef, useState } from "react";
import type { AgentPhase, GameProjectManifest, PlayStartMode, SceneFile, SceneObject } from "../../types/project-types";
import { isCodexBusy } from "../app-utils";

type GamePreviewPanelProps = {
  project: GameProjectManifest | null;
  previewProject: GameProjectManifest | null;
  previewableProjectIds: Set<string>;
  phase: AgentPhase;
  onRebuildSource: () => void;
  logInteraction: (type: string, payload?: Record<string, unknown>) => void;
};

export function GamePreviewPanel({
  project,
  previewProject,
  previewableProjectIds,
  phase,
  onRebuildSource,
  logInteraction,
}: GamePreviewPanelProps) {
  const isWorking = isCodexBusy(phase);
  const currentProjectHasBuild = project ? previewableProjectIds.has(project.id) : false;
  const previousProjectHasBuild = previewProject ? previewableProjectIds.has(previewProject.id) : false;
  const effectivePreviewProject = previousProjectHasBuild ? previewProject : !isWorking && currentProjectHasBuild ? project : null;
  const hasPreview = Boolean(effectivePreviewProject);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMode, setPreviewMode] = useState<"edit" | "play">("edit");
  const [viewportMode, setViewportMode] = useState<"game" | "scene" | "split" | "inspector">("game");
  const [playStartMode, setPlayStartMode] = useState<PlayStartMode>("fresh");
  const [scene, setScene] = useState<SceneFile | null>(null);
  const [selectedSceneObjectId, setSelectedSceneObjectId] = useState("");
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const panStateRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const rightMouseHeldRef = useRef(false);
  const previewStatus = isWorking && hasPreview ? "Previous version" : hasPreview ? "Playtest ready" : isWorking ? "Generating game" : "No preview yet";
  const selectedSceneObject = scene?.objects.find((object) => object.id === selectedSceneObjectId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl("");

    if (!effectivePreviewProject) return undefined;

    window.gameSpark
      ?.startPreviewServer?.(effectivePreviewProject.id)
      .then((result) => {
        if (!cancelled && result?.ok && result.url) {
          setPreviewUrl(result.url);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [effectivePreviewProject?.id, effectivePreviewProject?.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setSelectedSceneObjectId("");

    if (!effectivePreviewProject) return undefined;

    window.gameSpark
      ?.readSceneFile?.(effectivePreviewProject.id, effectivePreviewProject.editor.activeScenePath)
      .then((result) => {
        if (!cancelled && result?.ok && result.scene) {
          setScene(result.scene);
          setSelectedSceneObjectId(result.scene.objects.find((object) => object.editable)?.id ?? "");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [effectivePreviewProject?.id, effectivePreviewProject?.updatedAt, effectivePreviewProject?.editor.activeScenePath]);

  const previewFrameUrl =
    previewUrl && effectivePreviewProject
      ? `${previewUrl}?t=${encodeURIComponent(effectivePreviewProject.updatedAt)}&mode=${previewMode}&start=${playStartMode}`
      : "";
  const hasEditableSceneObjects = Boolean(scene?.objects.some((object) => object.editable));

  function startPlay(nextStartMode: PlayStartMode) {
    setPlayStartMode(nextStartMode);
    setPreviewMode("play");
    logInteraction("preview_play_started", { projectId: effectivePreviewProject?.id, startMode: nextStartMode });
  }

  function stopPlay() {
    setPreviewMode("edit");
    logInteraction("preview_edit_mode_started", { projectId: effectivePreviewProject?.id });
  }

  function sendPreviewControl(action: string, payload: Record<string, unknown> = {}) {
    if (previewMode !== "edit") return;
    previewFrameRef.current?.contentWindow?.postMessage({ type: "GAME_SPARK_PREVIEW_CONTROL", action, payload }, "*");
  }

  function zoomPreviewScene(delta: number) {
    sendPreviewControl("zoom", { delta });
  }

  function resetViewportTransform() {
    sendPreviewControl("reset");
    logInteraction("preview_viewport_transform_reset", { projectId: effectivePreviewProject?.id });
  }

  function beginViewportPan(event: React.PointerEvent<HTMLDivElement>) {
    if (previewMode !== "edit" || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    panStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  function updateViewportPan(event: React.PointerEvent<HTMLDivElement>) {
    const panState = panStateRef.current;
    if (!panState || panState.pointerId !== event.pointerId) return;
    sendPreviewControl("pan", { dx: event.clientX - panState.startX, dy: event.clientY - panState.startY });
    panState.startX = event.clientX;
    panState.startY = event.clientY;
  }

  function endViewportPan(event: React.PointerEvent<HTMLDivElement>) {
    if (panStateRef.current?.pointerId !== event.pointerId) return;
    panStateRef.current = null;
  }

  function handleViewportKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (previewMode !== "edit" || !rightMouseHeldRef.current) return;
    const key = event.key.toLowerCase();
    const step = event.shiftKey ? 36 : 18;
    const movementByKey: Record<string, { x: number; y: number }> = {
      w: { x: 0, y: step },
      a: { x: -step, y: 0 },
      s: { x: 0, y: -step },
      d: { x: step, y: 0 },
    };
    const movement = movementByKey[key];
    if (!movement) return;
    event.preventDefault();
    sendPreviewControl("move", movement);
  }

  async function moveSceneObject(object: SceneObject, nextX: number, nextY: number) {
    if (!effectivePreviewProject) return;
    const transform = {
      ...object.transform,
      x: Math.max(0, Math.min(100, nextX)),
      y: Math.max(0, Math.min(100, nextY)),
    };
    setSelectedSceneObjectId(object.id);
    setScene((current) =>
      current
        ? {
            ...current,
            objects: current.objects.map((item) => (item.id === object.id ? { ...item, transform } : item)),
          }
        : current,
    );
    const result = await window.gameSpark?.updateSceneObject?.(effectivePreviewProject.id, effectivePreviewProject.editor.activeScenePath, object.id, transform);
    if (result?.ok && result.scene) setScene(result.scene);
  }

  return (
    <section className="panel viewport-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Viewport</p>
          <h2>Game preview</h2>
        </div>
        <div className="viewport-toolbar">
          <div className="preview-mode-tabs" aria-label="Viewport panels">
            {(["game", "scene", "split", "inspector"] as const).map((mode) => (
              <button
                className={viewportMode === mode ? "active" : ""}
                key={mode}
                type="button"
                disabled={!hasPreview && mode !== "game"}
                onClick={() => {
                  setViewportMode(mode);
                  logInteraction("viewport_mode_changed", { projectId: effectivePreviewProject?.id, viewportMode: mode });
                }}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="preview-mode-tabs" aria-label="Preview mode">
            <button className={previewMode === "edit" ? "active" : ""} type="button" disabled={!hasPreview} onClick={stopPlay}>
              Edit
            </button>
            <button className={previewMode === "play" ? "active" : ""} type="button" disabled={!hasPreview} onClick={() => startPlay("fresh")}>
              Play
            </button>
          </div>
        </div>
      </div>
      <div className={`viewport-workbench viewport-${viewportMode}`}>
        <div
          className={`viewport-stage ${previewMode === "edit" ? "is-editing" : "is-playing"}`}
          tabIndex={previewMode === "edit" ? 0 : -1}
          onContextMenu={(event) => {
            if (previewMode !== "edit") return;
            event.preventDefault();
          }}
          onKeyDown={handleViewportKeyDown}
          onPointerDown={(event) => {
            if (previewMode !== "edit" || event.button !== 2) return;
            rightMouseHeldRef.current = true;
            event.currentTarget.focus();
          }}
          onPointerUp={(event) => {
            if (event.button === 2) rightMouseHeldRef.current = false;
          }}
          onPointerLeave={() => {
            rightMouseHeldRef.current = false;
          }}
          onWheel={(event) => {
            if (previewMode !== "edit") return;
            event.preventDefault();
            zoomPreviewScene(event.deltaY < 0 ? 1 : -1);
          }}
        >
          <div className="game-preview-transform-surface">
            {effectivePreviewProject && previewFrameUrl ? (
              <iframe ref={previewFrameRef} className="game-preview-frame" src={previewFrameUrl} title={`${effectivePreviewProject.title} playable preview`} />
            ) : null}
            {effectivePreviewProject && previewMode === "edit" && scene && hasEditableSceneObjects ? (
              <SceneEditOverlay
                scene={scene}
                selectedObjectId={selectedSceneObjectId}
                onSelect={setSelectedSceneObjectId}
                onMove={moveSceneObject}
                onPanStart={beginViewportPan}
                onPanMove={updateViewportPan}
                onPanEnd={endViewportPan}
              />
            ) : null}
          </div>
          {!effectivePreviewProject || !previewUrl ? (
            <div className="preview-empty-state">
              {isWorking || effectivePreviewProject ? <span className="preview-spinner" aria-hidden="true" /> : null}
              <strong>{effectivePreviewProject ? "Starting preview server" : isWorking ? "Generating preview" : "Generate a game to preview"}</strong>
              <p>{effectivePreviewProject ? "Preparing a browser-openable localhost preview." : isWorking ? "The first playable preview will appear here when the agent finishes." : "Start a game generation or open a playable project."}</p>
            </div>
          ) : null}
          <div className="viewport-hud">
            <span>{previewMode === "edit" ? "Editing scene" : playStartMode === "fresh" ? "Playing from start" : "Playing from current"}</span>
            <span>{previewStatus}</span>
          </div>
          {previewMode === "edit" ? (
            <div className="viewport-zoom-controls" aria-label="Viewport zoom controls">
              <button type="button" disabled={!hasPreview} onClick={() => zoomPreviewScene(-1)}>
                -
              </button>
              <span>Scene</span>
              <button type="button" disabled={!hasPreview} onClick={() => zoomPreviewScene(1)}>
                +
              </button>
              <button type="button" disabled={!hasPreview} onClick={resetViewportTransform}>
                Reset
              </button>
            </div>
          ) : null}
        </div>
        {viewportMode !== "game" ? (
          <ViewportInspector
            scene={scene}
            selectedObject={selectedSceneObject}
            previewMode={previewMode}
            onSelect={setSelectedSceneObjectId}
            onMove={moveSceneObject}
          />
        ) : null}
      </div>
      <div className="control-bar">
        <button type="button" disabled={!hasPreview} onClick={() => startPlay("fresh")}>
          Play from start
        </button>
        <button className="secondary-button" type="button" disabled={!hasPreview} onClick={() => startPlay("current")}>
          Play from current
        </button>
        <button className="secondary-button" type="button" disabled={!hasPreview || previewMode === "edit"} onClick={stopPlay}>
          Stop
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!project || isWorking}
          onClick={() => {
            logInteraction("rebuild_source_clicked", { projectId: project?.id, projectTitle: project?.title });
            onRebuildSource();
          }}
        >
          Rebuild
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!hasPreview}
          onClick={() => {
            if (!previewUrl) return;
            logInteraction("preview_opened_in_window", { projectId: effectivePreviewProject?.id, projectTitle: effectivePreviewProject?.title });
            window.gameSpark?.openPreviewWindow?.(previewUrl);
          }}
        >
          Open in new window
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!hasPreview || !previewUrl}
          onClick={() => {
            if (!previewUrl) return;
            logInteraction("preview_opened_in_browser", { projectId: effectivePreviewProject?.id, projectTitle: effectivePreviewProject?.title });
            window.gameSpark?.openPreviewInBrowser?.(previewUrl);
          }}
        >
          Open in browser
        </button>
      </div>
    </section>
  );
}

function SceneEditOverlay({
  scene,
  selectedObjectId,
  onSelect,
  onMove,
  onPanStart,
  onPanMove,
  onPanEnd,
}: {
  scene: SceneFile;
  selectedObjectId: string;
  onSelect: (objectId: string) => void;
  onMove: (object: SceneObject, x: number, y: number) => void;
  onPanStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPanMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPanEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="scene-edit-overlay"
      aria-label="Scene edit overlay"
      onPointerDown={onPanStart}
      onPointerMove={onPanMove}
      onPointerUp={onPanEnd}
      onPointerCancel={onPanEnd}
    >
      {scene.objects
        .filter((object) => object.editable)
        .map((object) => (
          <button
            className={`scene-object-handle ${object.id === selectedObjectId ? "selected" : ""}`}
            key={object.id}
            type="button"
            style={{ left: `${object.transform.x}%`, top: `${object.transform.y}%` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              onSelect(object.id);
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
              if (!bounds) return;
              const x = ((event.clientX - bounds.left) / bounds.width) * 100;
              const y = ((event.clientY - bounds.top) / bounds.height) * 100;
              onMove(object, x, y);
            }}
          >
            <span>{object.name}</span>
          </button>
        ))}
    </div>
  );
}

function ViewportInspector({
  scene,
  selectedObject,
  previewMode,
  onSelect,
  onMove,
}: {
  scene: SceneFile | null;
  selectedObject: SceneObject | null;
  previewMode: "edit" | "play";
  onSelect: (objectId: string) => void;
  onMove: (object: SceneObject, x: number, y: number) => void;
}) {
  const editableObjects = scene?.objects.filter((object) => object.editable) ?? [];

  return (
    <aside className="viewport-inspector" aria-label="Scene inspector">
      <div className="inspector-block">
        <div className="inspector-heading">
          <span>Scene outliner</span>
          <small>{editableObjects.length}</small>
        </div>
        <div className="scene-object-list">
          {editableObjects.length ? (
            editableObjects.map((object) => (
              <button
                className={object.id === selectedObject?.id ? "selected" : ""}
                key={object.id}
                type="button"
                onClick={() => onSelect(object.id)}
              >
                <strong>{object.name}</strong>
                <span>
                  x {Math.round(object.transform.x)} / y {Math.round(object.transform.y)}
                </span>
              </button>
            ))
          ) : (
            <p>No editable scene objects loaded.</p>
          )}
        </div>
      </div>

      <div className="inspector-block">
        <div className="inspector-heading">
          <span>Inspector</span>
          <small>{previewMode}</small>
        </div>
        {selectedObject ? (
          <div className="transform-grid">
            <label>
              <span>X</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(selectedObject.transform.x)}
                disabled={previewMode === "play"}
                onChange={(event) => onMove(selectedObject, Number(event.target.value), selectedObject.transform.y)}
              />
            </label>
            <label>
              <span>Y</span>
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(selectedObject.transform.y)}
                disabled={previewMode === "play"}
                onChange={(event) => onMove(selectedObject, selectedObject.transform.x, Number(event.target.value))}
              />
            </label>
          </div>
        ) : (
          <p>Select an editable scene object to inspect transforms.</p>
        )}
      </div>

      <div className="inspector-block">
        <div className="inspector-heading">
          <span>Ports</span>
          <small>live</small>
        </div>
        <div className="port-list">
          <span>Game viewport</span>
          <span>Scene overlay</span>
          <span>Object inspector</span>
          <span>Playtest runtime</span>
        </div>
      </div>
    </aside>
  );
}
