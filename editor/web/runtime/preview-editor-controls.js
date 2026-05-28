(function () {
  if (window.__GAME_SPARK_PREVIEW_EDITOR_CONTROLS__) return;
  window.__GAME_SPARK_PREVIEW_EDITOR_CONTROLS__ = true;

  var initialCameraState = null;

  function getScene() {
    if (!window.BABYLON || !BABYLON.EngineStore || !BABYLON.EngineStore.LastCreatedScene) return null;
    return BABYLON.EngineStore.LastCreatedScene;
  }

  function getCamera() {
    var scene = getScene();
    return scene && scene.activeCamera ? scene.activeCamera : null;
  }

  function cloneVector(vector) {
    return vector && typeof vector.clone === "function" ? vector.clone() : null;
  }

  function captureInitialState(camera) {
    if (initialCameraState || !camera) return;
    initialCameraState = {
      position: cloneVector(camera.position),
      target: cloneVector(camera.target),
      radius: typeof camera.radius === "number" ? camera.radius : null,
    };
  }

  function getCameraBasis(camera) {
    var forward = camera.getDirection ? camera.getDirection(BABYLON.Axis.Z) : null;
    if (!forward || !isFinite(forward.x) || !isFinite(forward.y) || !isFinite(forward.z)) {
      forward = camera.target && camera.position ? camera.target.subtract(camera.position) : new BABYLON.Vector3(0, 0, 1);
    }
    if (forward.lengthSquared && forward.lengthSquared() > 0.0001) forward.normalize();
    var right = BABYLON.Vector3.Cross(BABYLON.Axis.Y, forward);
    if (right.lengthSquared && right.lengthSquared() > 0.0001) right.normalize();
    var up = BABYLON.Vector3.Cross(forward, right);
    if (up.lengthSquared && up.lengthSquared() > 0.0001) up.normalize();
    return { forward: forward, right: right, up: up };
  }

  function translateCamera(camera, vector) {
    if (camera.position && camera.position.addInPlace) camera.position.addInPlace(vector);
    if (camera.target && camera.target.addInPlace) camera.target.addInPlace(vector);
    if (camera.setTarget && camera.target) camera.setTarget(camera.target);
  }

  function zoomCamera(camera, delta) {
    captureInitialState(camera);
    if (typeof camera.radius === "number") {
      camera.radius = Math.max(1, camera.radius * (delta > 0 ? 0.88 : 1.14));
      return;
    }
    var basis = getCameraBasis(camera);
    translateCamera(camera, basis.forward.scale(delta > 0 ? 0.8 : -0.8));
  }

  function panCamera(camera, dx, dy) {
    captureInitialState(camera);
    var basis = getCameraBasis(camera);
    var distance = typeof camera.radius === "number" ? camera.radius : 10;
    var scale = Math.max(0.01, distance * 0.0018);
    var move = basis.right.scale(-dx * scale).add(basis.up.scale(dy * scale));
    translateCamera(camera, move);
  }

  function moveCamera(camera, x, y) {
    captureInitialState(camera);
    var basis = getCameraBasis(camera);
    var distance = typeof camera.radius === "number" ? camera.radius : 10;
    var scale = Math.max(0.03, distance * 0.006);
    var move = basis.right.scale(x * scale).add(basis.forward.scale(y * scale));
    translateCamera(camera, move);
  }

  function resetCamera(camera) {
    if (!initialCameraState) return;
    if (camera.position && initialCameraState.position) camera.position.copyFrom(initialCameraState.position);
    if (camera.target && initialCameraState.target) {
      camera.target.copyFrom(initialCameraState.target);
      if (camera.setTarget) camera.setTarget(camera.target);
    }
    if (typeof camera.radius === "number" && typeof initialCameraState.radius === "number") camera.radius = initialCameraState.radius;
  }

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "GAME_SPARK_PREVIEW_CONTROL") return;

    var payload = event.data.payload || {};
    if (event.data.action === "phaser-noop") return;

    var camera = getCamera();
    if (!camera || !window.BABYLON) return;

    if (event.data.action === "zoom") zoomCamera(camera, Number(payload.delta) || 0);
    if (event.data.action === "pan") panCamera(camera, Number(payload.dx) || 0, Number(payload.dy) || 0);
    if (event.data.action === "move") moveCamera(camera, Number(payload.x) || 0, Number(payload.y) || 0);
    if (event.data.action === "reset") resetCamera(camera);
  });
})();
