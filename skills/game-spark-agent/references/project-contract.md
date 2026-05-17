# Project Contract

## Local Files

The workspace folder contains many project folders. Do not create an extra `projects/` wrapper unless the user asks for it.

Use this pattern:

```text
<workspace>/
├── lantern-grove/
├── clockwork-harbor/
└── new-game/
```

## Required Outputs

When creating or updating a playable game, ensure these exist:

- `manifest.json`
- `src/main.js`
- `assets/`
- `runs/<timestamp>/prompt.md`
- `runs/<timestamp>/plan.md`
- `runs/<timestamp>/changes.md`
- `runs/<timestamp>/validation.md`

If a build is requested or expected by the UI, also ensure:

- `build/index.html`

## Validation Checklist

Before reporting completion:

- `manifest.json` parses as JSON.
- `manifest.assets` paths exist or are explicitly marked as planned placeholders.
- `src/main.js` exists.
- Referenced scripts/assets use relative paths that work from project root.
- Generated sprite sheets that are part of the playable scene are referenced by runtime code and assigned to visible billboard materials.
- Visible characters do not use primitive capsules/boxes when matching generated sprite sheets exist. Primitive geometry is acceptable for invisible collision proxies.
- Generated 3D environment or prop assets are loaded and instantiated when the manifest or run notes claim image-blaster/generated 3D output.
- Procedural primitives are clearly labeled as blockout/fallback if no generated 3D model output is available.
- `runs/<timestamp>/validation.md` records asset-binding results, including any generated assets that are not used in the runtime.
- Run notes identify changed files.
- Known gaps are stated plainly.

## Asset Binding Rules

Generated assets must be part of the playable game, not only stored on disk.

- Sprite sheets: load PNG sheets from `assets/sprites/`, create texture-backed materials, apply them to camera-facing billboard planes, and animate through the 4x3 frame layout.
- Sprite loading must handle both already-loaded and later-loaded texture assets. Assign a visible fallback material first, then bind the texture from `asset.resource` immediately when present and from the asset load/ready callback when it resolves.
- Emotion sheets: wire at least `idle` and `walk` in gameplay; wire dialogue or state changes to emotion sheets when those states exist.
- 3D models/scenes: place image-blaster outputs in `assets/models/` or `assets/scenes/`, include them in `manifest.assets`, and instantiate them in `src/main.js` or a referenced module.
- Fallbacks: if a generator is unavailable, use a temporary procedural blockout only after documenting the gap in `validation.md`.
- Completion: do not mark a run ready when generated assets are manifest-only.

## Versioning

Never delete or overwrite user-authored assets casually.

For large changes:

- Keep prior generated files unless cleanup is requested.
- Add a run record.
- Write changed-file summary to `runs/<timestamp>/changes.md`.
