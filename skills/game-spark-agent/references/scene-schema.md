# Scene Schema

`assets/scenes/main.scene.json` is the edit-mode source of truth. Runtime code should load or mirror this data so play mode reflects edit mode changes.

Minimum shape:

```json
{
  "schemaVersion": 1,
  "id": "project-main-scene",
  "engine": "babylonjs",
  "updatedAt": "ISO timestamp",
  "objects": [
    {
      "id": "object-id",
      "name": "Object name",
      "kind": "model",
      "assetRef": "asset-id",
      "editable": true,
      "tags": [],
      "transform": {
        "x": 50,
        "y": 50,
        "z": 0,
        "rotationX": 0,
        "rotationY": 0,
        "rotationZ": 0,
        "scaleX": 1,
        "scaleY": 1,
        "scaleZ": 1
      },
      "components": {}
    }
  ],
  "groups": [
    {
      "id": "group-id",
      "name": "Group name",
      "objectIds": ["object-id"]
    }
  ]
}
```

Agents should modify semantic scene data first. Engine-specific Babylon.js or Phaser code is an adapter/runtime implementation, not the canonical edit-mode model.
