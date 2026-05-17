# Game Spark Generation Snippets

These snippets are source templates for generated PlayCanvas runtime code.

Use them when creating or rebuilding `src/main.js`:

- `sprite-character-4x3.js`: visible 2D character object bound to 4x3 sprite-sheet animation sequences.
- `generated-3d-object.js`: visible/interactable 3D object bound to a generated local `.glb` asset.
- `world-labs-environment.js`: static 3D environment loader for image-blaster / World Labs local outputs.
- `validate-generated-game.mjs`: Node validation helper that checks the manifest, runtime references, generated sprite binding, generated 3D file presence, and prompt-specific story/drag-drop requirements.

Snippets are not standalone games. Copy the relevant helpers into generated runtime code and instantiate them from the game scene setup.

After generating or rebuilding a playable project, run:

```bash
node <skill-root>/scripts/validate-generated-game.mjs <project-root>
```

Copy the JSON result into `runs/<timestamp>/validation.md`. A non-zero exit means the game should be reported as `not-ready` unless the user explicitly asked for a rough prototype.
