// Game Spark snippet: World Labs / image-blaster environment binding.
// Contract:
// - image-blaster world outputs are copied into assets/scenes/ or assets/models/.
// - Runtime loads local files only. Provider URLs are provenance, not runtime paths.
// - Use the generated collider .glb for physics/navigation when available.

function loadWorldLabsEnvironment(app, options) {
  const root = new pc.Entity(options.name || "world-labs-environment");
  root.setPosition(options.position?.x || 0, options.position?.y || 0, options.position?.z || 0);
  root.setEulerAngles(options.rotation?.x || 0, options.rotation?.y || 0, options.rotation?.z || 0);
  root.setLocalScale(options.scale?.x || 1, options.scale?.y || 1, options.scale?.z || 1);
  app.root.addChild(root);

  if (options.colliderGlbUrl) {
    const colliderAsset = new pc.Asset(`${root.name}_collider`, "container", { url: options.colliderGlbUrl });
    colliderAsset.on("error", (error) => console.warn(`Failed to load world collider ${options.colliderGlbUrl}`, error));
    colliderAsset.ready(() => {
      const colliderEntity = colliderAsset.resource?.instantiateRenderEntity?.();
      if (!colliderEntity) return;
      colliderEntity.name = `${root.name}_collider_mesh`;
      colliderEntity.enabled = options.showCollider === true;
      root.addChild(colliderEntity);

      // Use authored collision proxies when possible. Mesh collision can be expensive.
      if (options.addStaticCollision) {
        colliderEntity.addComponent("collision", { type: "mesh" });
        colliderEntity.addComponent("rigidbody", { type: "static" });
      }
    });
    app.assets.add(colliderAsset);
    app.assets.load(colliderAsset);
  }

  if (options.environmentGlbUrl) {
    const environmentAsset = new pc.Asset(`${root.name}_environment`, "container", { url: options.environmentGlbUrl });
    environmentAsset.on("error", (error) => console.warn(`Failed to load world environment ${options.environmentGlbUrl}`, error));
    environmentAsset.ready(() => {
      const environmentEntity = environmentAsset.resource?.instantiateRenderEntity?.();
      if (!environmentEntity) return;
      environmentEntity.name = `${root.name}_visible_environment`;
      root.addChild(environmentEntity);
    });
    app.assets.add(environmentAsset);
    app.assets.load(environmentAsset);
  }

  if (options.panoramaUrl) {
    const panoramaAsset = new pc.Asset(`${root.name}_panorama`, "texture", { url: options.panoramaUrl });
    panoramaAsset.ready(() => {
      // Optional: generated games may map this to a skybox or background sphere.
      root.gameSparkPanorama = panoramaAsset.resource;
    });
    app.assets.add(panoramaAsset);
    app.assets.load(panoramaAsset);
  }

  root.gameSparkAsset = {
    kind: "scene",
    generated: true,
    environmentGlbUrl: options.environmentGlbUrl,
    colliderGlbUrl: options.colliderGlbUrl,
    splatUrl: options.splatUrl,
    panoramaUrl: options.panoramaUrl,
    usedBy: options.usedBy || "loadWorldLabsEnvironment",
  };

  return root;
}

function createWorldBounds(app, options) {
  const bounds = new pc.Entity(options.name || "world-bounds");
  bounds.setPosition(options.position?.x || 0, options.position?.y || 0, options.position?.z || 0);
  bounds.addComponent("collision", {
    type: "box",
    halfExtents: options.halfExtents || new pc.Vec3(10, 1, 10),
  });
  bounds.addComponent("rigidbody", { type: "static" });
  bounds.enabled = options.enabled !== false;
  app.root.addChild(bounds);
  return bounds;
}

