# Game Quality Bar

This reference defines the acceptance bar for generated Game Spark games. Use it before writing code and again during validation.

## HD2D Baseline

An HD2D game is not a primitive blockout. It must include:

- 3D scene assets or authored 3D environment pieces that define the visible world.
- 2D sprite-sheet characters rendered as camera-facing billboard planes.
- Runtime animation from the 4x3 sprite sheets.
- Lighting, depth layering, and camera framing that make the world readable.
- Interactable world objects that are visible, named, and tied to gameplay state.

Procedural boxes, spheres, and cylinders are allowed for invisible collision, triggers, debug markers, or temporary blockers. They do not count as generated 3D assets.

## Storytelling And Roleplay Games

For prompts that mention story, roleplay, novel adventure, emotional dialogue, secrets, branches, choices, or character reactions, the game must include a narrative state machine.

Minimum runtime systems:

- `storyState`: current chapter, revealed memories/secrets, relationship flags, chosen branch, and ending state.
- `dialogueQueue`: ordered speaker turns with speaker id, emotion, line text, and optional state mutation.
- `choices`: at least two meaningful player choices gated by story state.
- `objectReactions`: map of object + target to dialogue, emotion change, memory reveal, or branch mutation.
- `endingCheck`: a rule that resolves the story based on what the player learned or restored.

Minimum playable behavior:

- Two named characters take turns speaking in authored lines.
- Emotional sprite changes happen during dialogue and object reactions.
- At least three meaningful inspectable objects reveal different information.
- At least two object-to-target interactions unlock different dialogue or branch state.
- The final decision uses information revealed by prior interaction, not only a fixed collect count.

A timer, shard counter, or bridge unlock can support the story, but it cannot be the whole game loop for a storytelling-heavy prompt.

## Drag And Drop Interaction

If the prompt says drag/drop, implement pointer-driven drag/drop. Keyboard pickup/drop is acceptable only as an extra accessibility path.

Runtime must:

- Raycast or otherwise hit-test pointer down on draggable objects.
- Move the selected object with the pointer or attach it to a visible cursor/hand marker.
- Highlight valid drop targets while dragging.
- Detect drop target on pointer up.
- Fire the object reaction from object id + target id.
- Update dialogue, emotion, story state, and object placement after a valid drop.

Record validation as not-ready if drag/drop was requested but only `E`/`Q` pickup/drop was implemented.

## Asset Binding Quality

Generated assets are accepted only when all three layers agree:

- Disk: files exist in `assets/sprites`, `assets/models`, `assets/scenes`, `assets/textures`, or `assets/audio`.
- Manifest: every generated asset has a specific entry with `path`, `source`, `usage`, and `runtimeRefs`.
- Runtime: `src/main.js` or imported scripts load the same file paths and visibly instantiate them.

Do not collapse generated 3D objects into a manifest entry that points to `src/main.js`. A visible generated 3D object needs a local model or scene file and a runtime loader call.

## Ready Status

Use these statuses in `validation.md`:

- `ready`: all requested gameplay and asset binding requirements pass.
- `ready-with-gaps`: the game is playable, and the gaps are minor or explicitly out of scope for the prompt.
- `not-ready`: a requested core mechanic, generated asset category, or runtime binding is missing.

For prompts that explicitly request generated sprite sheets, generated 3D objects, drag/drop, or novel-style story branches, missing any of those is `not-ready`, not `ready-with-gaps`.
