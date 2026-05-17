# Asset Generation Pipeline

This document is the source of truth for Game Spark asset generation. It expands the requirements from `prompts/1.md` into a concrete runtime contract.

## Supported Game Targets

Game Spark should support these categories:

- Platformer
- Top down RPG
- Isometric strategy
- First person shooter

Supported presentation styles:

- 2D
- HD2D
- 3D

Default MVP target is HD2D: 3D environment plus 2D sprite-sheet characters, with cinematic lighting and depth-of-field feel.

## Asset Plan First

Before generating files, write an asset plan in `runs/<timestamp>/plan.md`:

- playable style: `2D`, `HD2D`, or `3D`
- game category
- character list and role in gameplay
- required emotions per character
- world regions, landmarks, gates, hazards, and interactables
- 3D scene assets and object assets
- audio needs, if any
- exact destination paths
- runtime binding plan: which system loads each asset and where it appears in gameplay

Do not generate generic unused assets. Every generated asset must have a visible gameplay purpose or be marked as a planned placeholder.

The asset plan must also define blocking criteria. If the user asks for generated 2D sprite sheets or generated 3D object/environment assets, fallback drawings and procedural primitives are not acceptable substitutes for a ready game. They are allowed only for a not-ready prototype with the blocked generator recorded in `validation.md`.

## 2D Character Sprite Sheets

Use Image 2 for 2D character sprite sheets.

For every named playable character or NPC that appears in the current playable scene, generate one PNG per emotion:

- `idle`
- `walk`
- `laugh`
- `confused`
- `sad`
- `angry`
- `surprised`

File naming:

```text
assets/sprites/<character>_<emotion>.png
```

Example:

```text
assets/sprites/cat_idle.png
assets/sprites/cat_walk.png
assets/sprites/cat_laugh.png
assets/sprites/cat_confused.png
assets/sprites/cat_sad.png
assets/sprites/cat_angry.png
assets/sprites/cat_surprised.png
```

Sheet format:

- PNG
- 1024x1024
- 4 columns x 3 rows
- 12 frames total
- each frame should treat the character as 3:4 content inside its cell
- transparent background when possible
- consistent scale, costume, silhouette, camera angle, and palette across all emotions

Prompt each sheet as a sprite atlas, not a single illustration. Mention the character identity, style, facing direction, animation/emotion, transparent background, and frame consistency.

Do not mark fallback or hand-drawn placeholder atlases as generated Image 2 output. Use `source: "fallback"` or `source: "system-fallback"` and mark validation `not-ready` when Image 2 output was required by the prompt or template.

## 2D Runtime Binding

Sprite generation is incomplete until the game uses the sheets visibly.

Use `scripts/sprite-character-4x3.js` as the baseline implementation for visible 2D characters.

Runtime must:

- load each used PNG from `assets/sprites/`
- assign a visible fallback material first
- bind the sprite texture both when `asset.resource` already exists and when the load callback resolves
- apply the texture to a camera-facing billboard plane
- use alpha/opacity so transparent backgrounds render correctly
- animate frames with 4x3 texture tiling and offsets
- switch emotions from gameplay state: movement, dialogue, collection, damage, failure, victory, or surprise

Manifest must include one entry per emotion sheet, not one broad entry per character. For example, `lantern_keeper_idle.png`, `lantern_keeper_walk.png`, and `lantern_keeper_sad.png` are three distinct `kind: "sprite"` assets with their own `path` and `runtimeRefs`.

For storytelling games, every emotion sheet that is generated should have a named trigger in code or run notes, such as `dialogue:memory_reveal -> sad`, `object:bridge_key:on_archivist -> surprised`, or `movement -> walk`.

Primitive capsules, boxes, or spheres may be used only as invisible collision proxies when a sprite sheet exists for that visible character.

Validation must fail or mark the run not ready if generated sprite sheets exist only in the manifest or on disk but are not loaded in runtime code.

## 3D Environment And Object Assets

Use the vendored image-blaster workflow in `skills/image-blaster/` for 3D assets.

Use image-blaster for:

- static environment/world generation
- landmark structures
- interactable objects
- props that matter for navigation, storytelling, puzzle solving, cover, pickups, or gates
- optional ambient or object-specific SFX when relevant

For each gameplay-critical object requested in the prompt, decide whether it is:

- a generated 3D model file loaded at runtime;
- a generated texture/material applied to a simple collision proxy; or
- a temporary procedural fallback that makes the run not-ready for generated-asset requirements.

Do not silently downgrade meaningful 3D objects to boxes/spheres/cylinders and then mark the game ready.

Expected image-blaster outputs include:

- static environment `.spz`
- collider `.glb`
- object `.glb` or `.obj`
- panorama or thumbnail references
- ambient or object SFX `.mp3`

Minimum generated 3D set for an HD2D story RPG:

- one world or environment asset under `assets/scenes/`;
- one landmark or gate asset under `assets/models/`;
- at least three interactable object assets under `assets/models/`;
- optional invisible primitive colliders aligned to the generated assets.

Copy successful outputs into the Game Spark project:

```text
assets/models/
assets/scenes/
assets/textures/
assets/audio/
```

Do not leave runtime code loading provider URLs. Provider URLs belong only in metadata/provenance.

## 3D Asset Breakdown

For each game, define the 3D asset set by gameplay role:

- **World shell:** terrain, floor, static scene, or navigable arena.
- **Landmarks:** high-visibility orientation points.
- **Paths and gates:** bridges, doors, ledges, stairs, corridors, portals, locked routes.
- **Interactables:** switches, shrines, NPC stalls, puzzle devices, pickup pedestals.
- **Hazards and blockers:** spikes, brambles, enemy cover, moving obstacles.
- **Collectibles and rewards:** shards, keys, relics, ammo, upgrades.
- **Set dressing:** only after gameplay-critical assets are covered.

Generate environment first, then gameplay-critical objects, then decorative props.

## 3D Runtime Binding

3D generation is incomplete until the game loads the generated files.

Use `scripts/generated-3d-object.js` for individual generated object models.
Use `scripts/world-labs-environment.js` for image-blaster / World Labs environment outputs.

Runtime must:

- load generated `.glb`, `.obj`, or supported scene files from local project paths
- instantiate them in the PlayCanvas scene
- place them at authored coordinates
- set appropriate scale, collision proxies, and interaction triggers
- include generated world/collider assets in navigation and camera framing
- record `usedBy` or `runtimeRefs` for each asset in `manifest.json`

The runtime loader must create visible entities from the generated files. A manifest entry whose `path` is `src/main.js` does not count as a generated model, scene, or object asset.

Procedural primitives are allowed for collision, debug markers, or temporary fallback. They must not be the only visible environment if generated 3D assets were requested or claimed.

If image-blaster cannot be run because credentials, scripts, network, or source images are missing, record a known gap in `validation.md` and do not claim generated 3D model assets exist.

If generated 3D was explicitly requested and image-blaster cannot run, validation status should be `not-ready`, not `ready`.

## Manifest Requirements

Each generated asset entry must include:

- `id`
- `name`
- `kind`: `sprite`, `model`, `texture`, `script`, or `scene`
- `path`
- `source`: `generated`, `imported`, or `system`
- `previewColor`
- `usage`
- `usedBy` or `runtimeRefs`
- generation provenance when available

Use `kind: "sprite"` for sprite sheets, not `"sprite-sheet"`.

## Validation Checklist

Before reporting ready:

- Every manifest asset path exists.
- Every generated sprite sheet used in the scene is referenced by runtime code.
- At least `idle` and `walk` are wired for the playable character.
- NPC emotion sheets are triggered by dialogue or state.
- Runtime uses billboard planes for visible sprite characters.
- Generated 3D assets are copied into the project and loaded locally.
- No generated asset is manifest-only unless explicitly marked as a planned placeholder.
- `validation.md` lists missing generators, missing credentials, or unavailable image-blaster outputs plainly.
- `node <skill-root>/scripts/validate-generated-game.mjs <project-root>` has been run when available, and its errors are copied or summarized into `validation.md`.
- No asset with `source` containing `fallback` is used to satisfy a requested generated asset category.
- No model or scene asset points to `src/main.js` as its asset path.
