// Game Spark snippet: 2D sprite character with 4x3 animation sheets.
// Contract:
// - Each animation sheet is a 1024x1024 PNG in assets/sprites/.
// - Each sheet is 4 columns x 3 rows, 12 frames total.
// - Each emotion/action is a separate sheet: idle, walk, laugh, confused, sad, angry, surprised.
// - The visible character is a camera-facing plane. Use separate invisible entities for collision.

function createTextureAsset(app, name, url) {
  const asset = new pc.Asset(name, "texture", { url });
  asset.on("error", (error) => console.warn(`Failed to load texture ${url}`, error));
  app.assets.add(asset);
  app.assets.load(asset);
  return asset;
}

function createUnlitSpriteMaterial(textureAsset, fallbackColor) {
  const material = new pc.StandardMaterial();
  material.diffuse = fallbackColor || new pc.Color(1, 1, 1);
  material.blendType = pc.BLEND_NORMAL;
  material.alphaTest = 0.02;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.useLighting = false;

  if (textureAsset && textureAsset.resource) {
    textureAsset.resource.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
    textureAsset.resource.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
    textureAsset.resource.minFilter = pc.FILTER_NEAREST;
    textureAsset.resource.magFilter = pc.FILTER_NEAREST;
    material.diffuseMap = textureAsset.resource;
    material.opacityMap = textureAsset.resource;
    material.emissiveMap = textureAsset.resource;
    material.emissive = new pc.Color(1, 1, 1);
    material.emissiveIntensity = 0.28;
  }

  material.update();
  return material;
}

function setSpriteSheetFrame(material, frameIndex) {
  if (!material) return;
  const columns = 4;
  const rows = 3;
  const frame = frameIndex % 12;
  const column = frame % columns;
  const row = Math.floor(frame / columns);
  const tiling = new pc.Vec2(1 / columns, 1 / rows);
  const offset = new pc.Vec2(column / columns, 1 - (row + 1) / rows);

  material.diffuseMapTiling = tiling;
  material.diffuseMapOffset = offset;
  material.opacityMapTiling = tiling;
  material.opacityMapOffset = offset;
  material.emissiveMapTiling = tiling;
  material.emissiveMapOffset = offset;
  material.update();
}

class SpriteSheetCharacter {
  constructor(app, options) {
    this.app = app;
    this.camera = options.camera;
    this.name = options.name;
    this.emotion = options.initialEmotion || "idle";
    this.frame = 0;
    this.frameTimer = 0;
    this.frameDuration = options.frameDuration || 0.11;
    this.materials = {};
    this.textureAssets = {};
    this.fallbackColor = options.fallbackColor || new pc.Color(1, 1, 1);

    this.entity = new pc.Entity(options.name);
    this.entity.addComponent("model", { type: "plane" });
    this.entity.setEulerAngles(90, 0, 0);
    this.entity.setPosition(options.position.x, options.position.y, options.position.z);
    this.entity.setLocalScale(options.width || 1.25, 1, options.height || 1.75);
    this.entity.model.material = createUnlitSpriteMaterial(null, this.fallbackColor);
    app.root.addChild(this.entity);

    for (const [emotion, url] of Object.entries(options.sheets)) {
      const textureAsset = createTextureAsset(app, `${options.name}_${emotion}`, url);
      this.textureAssets[emotion] = textureAsset;

      const bind = () => {
        if (!textureAsset.resource) return;
        this.materials[emotion] = createUnlitSpriteMaterial(textureAsset, this.fallbackColor);
        setSpriteSheetFrame(this.materials[emotion], this.frame);
        if (emotion === this.emotion) this.entity.model.material = this.materials[emotion];
      };

      if (textureAsset.resource) bind();
      textureAsset.ready(bind);
      textureAsset.on("load", bind);
    }
  }

  setEmotion(emotion) {
    if (!this.textureAssets[emotion] || this.emotion === emotion) return;
    this.emotion = emotion;
    this.frame = 0;
    if (this.materials[emotion]) {
      this.entity.model.material = this.materials[emotion];
      setSpriteSheetFrame(this.materials[emotion], this.frame);
    }
  }

  setPosition(x, y, z) {
    this.entity.setPosition(x, y, z);
  }

  getPosition() {
    return this.entity.getPosition();
  }

  update(dt) {
    this.frameTimer += dt;
    if (this.frameTimer >= this.frameDuration) {
      this.frameTimer = 0;
      this.frame = (this.frame + 1) % 12;
      setSpriteSheetFrame(this.entity.model.material, this.frame);
    }

    if (this.camera) {
      this.entity.lookAt(this.camera.getPosition());
      this.entity.rotateLocal(0, 180, 0);
    }
  }
}

function createCharacterSheetMap(characterName, assetRoot = ".") {
  const emotions = ["idle", "walk", "laugh", "confused", "sad", "angry", "surprised"];
  return Object.fromEntries(emotions.map((emotion) => [emotion, `${assetRoot}/assets/sprites/${characterName}_${emotion}.png`]));
}

