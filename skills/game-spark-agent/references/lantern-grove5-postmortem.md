# Lantern Grove 5 Postmortem

Use this postmortem as a negative example when generating future storytelling-heavy HD2D games.

## User Prompt Summary

The prompt requested a storytelling-heavy HD2D roleplay adventure with two characters, emotional turn-taking dialogue, secrets, choices, drag/drop meaningful objects, generated 2D sprite emotion sheets, generated 3D scene/object assets, and branch outcomes before dawn.

## What Went Wrong

- The game was playable but mechanically shallow for the prompt. It used a short linear story loop instead of a proper novel-adventure state machine with gated choices, secrets, branch flags, and endings.
- Object interaction was keyboard pickup/drop, not pointer drag/drop. That does not satisfy a prompt asking to drag/drop objects onto characters or scene targets.
- 3D objects and environment were procedural primitives in `src/main.js`. The old well, shrine, bridge gate, moon statue, lanterns, and keepsakes were boxes/spheres/cylinders, not generated 3D assets.
- No image-blaster outputs were created or loaded. There were no local `.glb`, `.obj`, or `.spz` assets under `assets/models` or `assets/scenes`.
- The run used fallback sprite atlases. That can be useful for a temporary prototype, but it cannot satisfy a request for Image 2 generated sprites.
- Asset provenance was too weak. Runtime sprite loading existed, but the manifest did not model every emotion sheet as its own generated asset with concrete runtime refs.
- The run status said `ready-with-gaps`; for this prompt the missing generated 3D assets and missing pointer drag/drop should have made it `not-ready`.

## Why Sprites Felt Unlinked

The runtime did load sprite sheets through a `SpriteSheetCharacter` helper, but the result still felt unlinked because:

- The sprite art was fallback/generated-placeholder quality rather than Image 2 output.
- Manifest entries collapsed multiple emotion sheets into broad character assets, making it hard for the UI and validator to show which sheets are actually used.
- Validation checked that files existed and code referenced sprite paths, but did not prove that each requested emotion was triggered by specific story or object states.

Future runs must create one manifest entry per emotion sheet and define the exact story or gameplay transition that uses it.

## Why 3D Assets Were Not Generated Or Loaded

The skill allowed a procedural fallback when image-blaster was unavailable, but it did not force the agent to treat that as a blocking failure for prompts that explicitly requested generated 3D objects. The generated game then used primitives as the visible world and recorded the image-blaster gap after the fact.

Future runs must:

- Plan the required generated 3D environment and object list before coding.
- Run the image-blaster workflow or mark the run not-ready.
- Copy outputs into `assets/models` or `assets/scenes`.
- Instantiate those files using the generated object/environment snippets.
- Use primitives only as invisible colliders or clearly labeled blockout when the run is not-ready.

## Corrective Rule

For storytelling-heavy HD2D prompts, do not report `ready` or `ready-with-gaps` unless the game includes:

- Image-generated sprite sheets or a declared not-ready generator block.
- Local generated 3D model/scene files or a declared not-ready generator block.
- Pointer drag/drop when requested.
- A narrative state machine with turn-taking dialogue, emotional state changes, object reactions, branch flags, and an ending decision.
