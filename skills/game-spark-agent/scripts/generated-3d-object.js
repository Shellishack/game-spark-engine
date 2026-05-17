// Game Spark snippet: generated 3D object loader.
// Contract:
// - Generated model files are copied into assets/models/.
// - Prefer .glb for PlayCanvas runtime loading.
// - The visible object is the generated model; primitive geometry is only for collision/debug fallback.

function loadGeneratedModel(app, options) {
  const entity = new pc.Entity(options.name);
  entity.setPosition(options.position.x, options.position.y, options.position.z);
  entity.setEulerAngles(options.rotation?.x || 0, options.rotation?.y || 0, options.rotation?.z || 0);
  entity.setLocalScale(options.scale?.x || 1, options.scale?.y || 1, options.scale?.z || 1);
  app.root.addChild(entity);

  const asset = new pc.Asset(`${options.name}_model`, "container", { url: options.url });
  asset.on("error", (error) => {
    console.warn(`Failed to load generated model ${options.url}`, error);
    if (options.fallbackMaterial) {
      const fallback = new pc.Entity(`${options.name}_fallback`);
      fallback.addComponent("model", { type: options.fallbackType || "box" });
      fallback.setLocalScale(1, 1, 1);
      fallback.model.material = options.fallbackMaterial;
      entity.addChild(fallback);
    }
  });

  asset.ready(() => {
    const resource = asset.resource;
    const renderRoot = resource && resource.instantiateRenderEntity ? resource.instantiateRenderEntity() : null;
    if (!renderRoot) {
      console.warn(`Generated model ${options.url} did not expose a render entity.`);
      return;
    }
    entity.addChild(renderRoot);
  });

  app.assets.add(asset);
  app.assets.load(asset);

  if (options.collision) {
    entity.addComponent("collision", {
      type: options.collision.type || "box",
      halfExtents: options.collision.halfExtents || new pc.Vec3(0.5, 0.5, 0.5),
      radius: options.collision.radius,
      height: options.collision.height,
    });
  }

  if (options.rigidbody) {
    entity.addComponent("rigidbody", {
      type: options.rigidbody.type || "static",
      mass: options.rigidbody.mass || 0,
    });
  }

  entity.gameSparkAsset = {
    path: options.url,
    kind: "model",
    generated: true,
    usedBy: options.usedBy || "loadGeneratedModel",
  };

  return entity;
}

function createInteractionTrigger(app, options) {
  const trigger = new pc.Entity(`${options.name}_trigger`);
  trigger.setPosition(options.position.x, options.position.y, options.position.z);
  trigger.addComponent("collision", {
    type: "box",
    halfExtents: options.halfExtents || new pc.Vec3(1, 1, 1),
  });
  trigger.tags.add(options.tag || "interactable");
  app.root.addChild(trigger);
  return trigger;
}

