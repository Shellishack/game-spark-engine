import { useEffect, useRef, useState } from "react";
import * as pc from "playcanvas";
import type { AgentPhase, GameProjectAsset, GameProjectManifest } from "../types/project-types";

export function GamePreview({
  project,
  phase,
  selectedAsset,
}: {
  project: GameProjectManifest | null;
  phase: AgentPhase;
  selectedAsset?: GameProjectAsset;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let app: pc.Application | undefined;

    try {
      app = new pc.Application(canvas, {
        graphicsDeviceOptions: {
          alpha: true,
        },
      });
      app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
      app.setCanvasResolution(pc.RESOLUTION_AUTO);
      app.start();

      const camera = new pc.Entity("HD2D Camera");
      camera.addComponent("camera", {
        clearColor: new pc.Color(0.54, 0.67, 0.7),
        fov: 38,
      });
      camera.setPosition(0, 5.2, 8);
      camera.lookAt(0, 0.2, 0);
      app.root.addChild(camera);

      const sun = new pc.Entity("Warm Key Light");
      sun.addComponent("light", {
        type: "directional",
        color: new pc.Color(1, 0.86, 0.58),
        intensity: 1.8,
      });
      sun.setEulerAngles(45, 34, 0);
      app.root.addChild(sun);

      const ambient = new pc.Entity("Lantern Fill");
      ambient.addComponent("light", {
        type: "omni",
        color: new pc.Color(1, 0.74, 0.32),
        intensity: 0.75,
        range: 8,
      });
      ambient.setPosition(0, 1.2, 1.6);
      app.root.addChild(ambient);

      const ground = new pc.Entity("Village Ground");
      ground.addComponent("render", {
        type: "box",
      });
      ground.setLocalScale(8, 0.18, 6);
      ground.setPosition(0, -0.12, 0);
      app.root.addChild(ground);

      const path = new pc.Entity("Golden Path");
      path.addComponent("render", {
        type: "box",
      });
      path.setLocalScale(1.1, 0.2, 5.4);
      path.setPosition(0.25, 0.02, 0.4);
      app.root.addChild(path);

      const sprite = new pc.Entity("Sprite Billboard");
      sprite.addComponent("render", {
        type: "plane",
      });
      sprite.setLocalScale(0.85, 1.2, 1);
      sprite.setPosition(0.2, 0.9, 0.8);
      app.root.addChild(sprite);

      const groundMaterial = material(new pc.Color(0.27, 0.35, 0.28));
      const pathMaterial = material(new pc.Color(0.72, 0.62, 0.38));
      const spriteMaterial = material(colorFromHex(selectedAsset?.previewColor ?? "#d7c66a"));
      ground.render!.meshInstances.forEach((mesh) => (mesh.material = groundMaterial));
      path.render!.meshInstances.forEach((mesh) => (mesh.material = pathMaterial));
      sprite.render!.meshInstances.forEach((mesh) => (mesh.material = spriteMaterial));

      let elapsed = 0;
      app.on("update", (dt) => {
        elapsed += dt;
        sprite.setEulerAngles(0, Math.sin(elapsed * 0.8) * 8, 0);
        sprite.setPosition(0.2, 0.9 + Math.sin(elapsed * 2.2) * 0.04, 0.8);
      });

      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error(error);
    }

    return () => {
      app?.destroy();
    };
  }, [selectedAsset?.previewColor]);

  return (
    <div className="game-preview-host">
      <canvas ref={canvasRef} aria-label={`${project?.title ?? "HD2D"} game preview`} />
      {failed ? <FallbackScene phase={phase} selectedAsset={selectedAsset} /> : null}
    </div>
  );
}

function material(color: pc.Color) {
  const standard = new pc.StandardMaterial();
  standard.diffuse = color;
  standard.update();
  return standard;
}

function colorFromHex(value: string) {
  const hex = value.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return new pc.Color(red || 0.8, green || 0.7, blue || 0.4);
}

function FallbackScene({ phase, selectedAsset }: { phase: AgentPhase; selectedAsset?: GameProjectAsset }) {
  return (
    <div className="viewport-stage fallback-stage">
      <div className="sky-layer" />
      <div className="depth-layer far" />
      <div className="depth-layer mid" />
      <div className="village-ground">
        <span className="path-line" />
        <span className="water-strip" />
        <span className="lantern one" />
        <span className="lantern two" />
        <span className="sprite-billboard" style={{ backgroundColor: selectedAsset?.previewColor ?? "#d7c66a" }} />
      </div>
      <div className="viewport-hud">
        <span>{phase === "ready" ? "Playtest ready" : "Generating preview"}</span>
        <span>HD2D DOF</span>
      </div>
    </div>
  );
}
