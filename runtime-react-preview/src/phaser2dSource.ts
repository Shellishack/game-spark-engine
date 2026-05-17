export const phaser2dSource = String.raw`
const React = globalThis.__RuntimeReact;
const Phaser = globalThis.__RuntimePhaser;

export { Phaser };

export function PhaserGame({ width = 800, height = 450, backgroundColor = "#0f172a", scene, config = {}, className = "" }) {
  const hostRef = React.useRef(null);
  const gameRef = React.useRef(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    if (!Phaser || !Phaser.Game) {
      host.innerHTML = '<pre style="color:#991b1b;white-space:pre-wrap">Phaser runtime bridge was not initialized.</pre>';
      return undefined;
    }

    host.innerHTML = "";
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width,
      height,
      backgroundColor,
      pixelArt: true,
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: "arcade",
        arcade: {
          gravity: { y: 0 },
          debug: false,
        },
      },
      scene,
      ...config,
    });

    gameRef.current = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
      host.innerHTML = "";
    };
  }, [width, height, backgroundColor, scene, config]);

  return React.createElement("div", {
    ref: hostRef,
    className: "runtime-phaser-host " + className,
    style: {
      width: "100%",
      maxWidth: width + "px",
      aspectRatio: width + " / " + height,
      display: "grid",
      placeItems: "center",
      overflow: "hidden",
      borderRadius: "8px",
      background: backgroundColor,
      touchAction: "none",
    },
  });
}

export function createArcadeScene(definition) {
  return class RuntimeArcadeScene extends Phaser.Scene {
    constructor() {
      super("RuntimeArcadeScene");
    }

    preload() {
      if (definition.preload) definition.preload(this, Phaser);
    }

    create() {
      if (definition.create) definition.create(this, Phaser);
    }

    update(time, delta) {
      if (definition.update) definition.update(this, time, delta, Phaser);
    }
  };
}
`;
