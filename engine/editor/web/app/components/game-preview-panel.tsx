import { useEffect, useRef, useState } from "react";
import type { AgentPhase, CliPreviewSession, GameProjectManifest, PlayStartMode, SceneFile, SceneObject } from "../../types/project-types";
import { isCodexBusy } from "../app-utils";

type GamePreviewPanelProps = {
  project: GameProjectManifest | null;
  previewProject: GameProjectManifest | null;
  previewableProjectIds: Set<string>;
  cliPreviewSession?: CliPreviewSession | null;
  phase: AgentPhase;
  onRebuildSource: () => void;
  logInteraction: (type: string, payload?: Record<string, unknown>) => void;
};

export function GamePreviewPanel({
  project,
  previewProject,
  previewableProjectIds,
  cliPreviewSession,
  phase,
  onRebuildSource,
  logInteraction,
}: GamePreviewPanelProps) {
  const isWorking = isCodexBusy(phase);
  const cliPreviewProject = cliPreviewSession?.manifest ?? null;
  const currentProjectHasBuild = project ? previewableProjectIds.has(project.id) : false;
  const previousProjectHasBuild = previewProject ? previewableProjectIds.has(previewProject.id) : false;
  const effectivePreviewProject = cliPreviewProject ?? (previousProjectHasBuild ? previewProject : !isWorking && currentProjectHasBuild ? project : null);
  const hasPreview = Boolean(effectivePreviewProject || cliPreviewSession?.previewUrl);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewMode, setPreviewMode] = useState<"edit" | "play">("edit");
  const [viewportMode, setViewportMode] = useState<"game" | "scene" | "split" | "inspector">("game");
  const [playStartMode, setPlayStartMode] = useState<PlayStartMode>("fresh");
  const [scene, setScene] = useState<SceneFile | null>(null);
  const [selectedSceneObjectId, setSelectedSceneObjectId] = useState("");
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const viewportStageRef = useRef<HTMLDivElement | null>(null);
  const rightMouseHeldRef = useRef(false);
  const [isViewportFullscreen, setIsViewportFullscreen] = useState(false);
  const previewStatus = isWorking && hasPreview ? "Previous version" : hasPreview ? "Playtest ready" : isWorking ? "Generating game" : "No preview yet";
  const selectedSceneObject = scene?.objects.find((object) => object.id === selectedSceneObjectId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl("");

    if (cliPreviewSession?.previewUrl) {
      setPreviewUrl(cliPreviewSession.previewUrl);
      return undefined;
    }

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
  }, [cliPreviewSession?.previewUrl, effectivePreviewProject?.id, effectivePreviewProject?.updatedAt]);

  useEffect(() => {
    let cancelled = false;
    setScene(null);
    setSelectedSceneObjectId("");

    if (!effectivePreviewProject) return undefined;

    const readScene = cliPreviewSession
      ? window.gameSpark?.readCliPreviewSceneFile?.(effectivePreviewProject.editor.activeScenePath)
      : window.gameSpark?.readSceneFile?.(effectivePreviewProject.id, effectivePreviewProject.editor.activeScenePath);

    readScene
      ?.then((result) => {
        if (!cancelled && result?.ok && result.scene) {
          setScene(result.scene);
          setSelectedSceneObjectId(result.scene.objects.find((object) => object.editable)?.id ?? "");
        }
      })
      .catch(() => undefined);

    if (!readScene) return undefined;

    return () => {
      cancelled = true;
    };
  }, [cliPreviewSession, effectivePreviewProject?.id, effectivePreviewProject?.updatedAt, effectivePreviewProject?.editor.activeScenePath]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsViewportFullscreen(document.fullscreenElement === viewportStageRef.current);
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const previewFrameUrl =
    previewUrl && (effectivePreviewProject || cliPreviewSession)
      ? `${previewUrl}?t=${encodeURIComponent(effectivePreviewProject?.updatedAt ?? Date.now())}&mode=${previewMode}&start=${playStartMode}`
      : "";

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

  async function toggleViewportFullscreen() {
    const stage = viewportStageRef.current;
    if (!stage) return;

    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
        logInteraction("preview_fullscreen_exited", { projectId: effectivePreviewProject?.id });
        return;
      }

      await stage.requestFullscreen();
      logInteraction("preview_fullscreen_started", { projectId: effectivePreviewProject?.id });
    } catch (error) {
      logInteraction("preview_fullscreen_failed", {
        projectId: effectivePreviewProject?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    const result = cliPreviewSession
      ? await window.gameSpark?.updateCliPreviewSceneObject?.(effectivePreviewProject.editor.activeScenePath, object.id, transform)
      : await window.gameSpark?.updateSceneObject?.(effectivePreviewProject.id, effectivePreviewProject.editor.activeScenePath, object.id, transform);
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
          ref={viewportStageRef}
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
            {previewFrameUrl ? (
              <iframe ref={previewFrameRef} className="game-preview-frame" src={previewFrameUrl} title={`${effectivePreviewProject?.title ?? cliPreviewSession?.projectId ?? "Game"} playable preview`} />
            ) : null}
          </div>
          {!hasPreview || !previewUrl ? (
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
          <button
            className="viewport-fullscreen-button"
            type="button"
            disabled={!hasPreview || !previewUrl}
            aria-label={isViewportFullscreen ? "Exit fullscreen viewport" : "Open viewport fullscreen"}
            title={isViewportFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleViewportFullscreen}
          >
            {isViewportFullscreen ? "Exit" : "Fullscreen"}
          </button>
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
