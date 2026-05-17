---
name: game-spark-agent
description: Use when creating, updating, reviewing, or operating Game Spark AI projects without relying on the Electron UI. This skill defines the core agentic loop for an AI-native local-first game engine using PlayCanvas, local files, generated 2D sprite sheets, generated 3D assets, JavaScript game scripts, manifests, and playable builds.
---

# Game Spark Agent

This skill is the core Game Spark AI workflow. The Electron app is only a UI shell around this same loop.

## Project Contract

Work inside one local project folder. The folder itself is the project root under the user's workspace.

Expected structure:

```text
<project>/
├── manifest.json
├── src/
│   ├── main.js
│   ├── scripts/
│   └── systems/
├── assets/
│   ├── sprites/
│   ├── models/
│   ├── textures/
│   ├── audio/
│   └── scenes/
├── build/
│   └── index.html
└── runs/
    └── <timestamp>/
        ├── prompt.md
        ├── plan.md
        ├── changes.md
        └── validation.md
```

Always maintain `manifest.json`. It is the UI contract.

## Agentic Loop

1. **Classify intent**
   - Conversation: answer without changing files.
   - Game update: create or modify project files.
   - Review/debug: inspect project, identify issues, and patch only what is needed.

2. **Read project state**
   - Inspect `manifest.json`, `src/`, `assets/`, and latest `runs/`.
   - Preserve user files and existing project decisions unless the request asks to replace them.

3. **Plan**
   - Write a concise plan to `runs/<timestamp>/plan.md`.
   - Include gameplay loop, level/world changes, assets, scripts, and validation steps.

4. **Design**
   - Prefer HD2D for MVP: 3D environment, 2D sprite billboard characters, cinematic lighting, depth-of-field feel.
   - Make gameplay first: goals, verbs, feedback, challenge, progression, and iteration hooks.

5. **Generate assets**
   - Follow `references/asset-generation.md`.
   - Follow `references/game-quality-bar.md` for genre-specific acceptance criteria.
   - Use Image 2 for 2D character sprite sheets.
   - Use the vendored `skills/image-blaster/` workflow for 3D world, model, and scene assets.
   - Asset generation is not complete until generated assets are visibly used by the runtime. Do not satisfy this step by writing files and manifest entries only.
   - Do not mark a game ready when requested generated assets are replaced by fallback drawings or procedural primitives. Record the run as not-ready or ready-with-blockers and name the blocked generator.

6. **Write game code**
   - Use PlayCanvas scripts in JavaScript.
   - Use snippets from `scripts/` when creating generated game objects.
   - Keep systems modular: player, camera, interactions, NPCs, objectives, inventory/progression, world events.
   - Keep generated runtime code readable and editable.
   - Bind every generated character sprite sheet that is part of the current playable scene to a textured billboard material and animate frames from the 4x3 sheet.
   - Use primitive capsules/boxes for invisible collision, triggers, or early blockout only. If a sprite sheet exists for a visible character, the final visible character must not be a primitive capsule.
   - Load and instantiate generated 3D model or scene assets for the environment and props when image-blaster output exists. Procedural primitives may supplement generated assets, but they must not be the only visible environment if generated 3D assets were requested or claimed.
   - If image-blaster is unavailable, record that as a known gap and do not claim generated 3D model assets exist.

7. **Build and validate**
   - Produce or update a playable local build under `build/`.
   - Do not start Python, `python -m http.server`, or any ad hoc preview server. The Electron app owns preview serving through its local Node/Electron bridge.
   - A build means files are written to disk and assets are copied or referenced correctly; serving is outside the agent workflow.
   - Validate that entry files exist, assets referenced in code exist, `manifest.json` matches disk, and generated assets are referenced by runtime code.
   - Treat manifest-only assets as incomplete unless they are explicitly marked as planned placeholders.
   - The run is not ready if generated sprite sheets are not used for visible characters or generated 3D assets are not loaded for claimed generated environments.
   - Run `node <skill-root>/scripts/validate-generated-game.mjs <project-root>` when available, and copy the JSON summary into `runs/<timestamp>/validation.md`.
   - If the user prompt asks for a novel adventure, roleplay, story branches, or drag/drop interactions, validate those mechanics against `references/game-quality-bar.md`; do not treat keyboard pickup/drop as satisfying mouse or pointer drag/drop.
   - Record validation in `runs/<timestamp>/validation.md`.

8. **Report**
   - Summarize changed files, playable build path, known gaps, and suggested next iteration.

## Manifest Requirements

`manifest.json` should include:

```json
{
  "id": "project-slug",
  "title": "Project Title",
  "style": "HD2D",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "workspacePath": "project-slug",
  "playCanvasEntry": "src/main.js",
  "buildPath": "project-slug/build/index.html",
  "promptHistory": [],
  "runHistory": [],
  "assets": []
}
```

Each asset entry should include `id`, `name`, `kind`, `path`, `source`, `previewColor`, `usage`, and a short runtime usage note such as `usedBy` or `runtimeRefs`. Use `kind: "sprite"` for sprite sheets.

## References

For asset generation, read `references/asset-generation.md`.
For detailed design rules, read `references/design-rules.md`.
For roleplay, storytelling, and interaction acceptance criteria, read `references/game-quality-bar.md`.
For a concrete failure analysis to avoid repeating, read `references/lantern-grove5-postmortem.md`.
For project file conventions and validation details, read `references/project-contract.md`.
For reusable PlayCanvas object snippets, read `scripts/README.md` and the snippet files in `scripts/`.
For 3D world/object generation, read `../image-blaster/SKILL.md`.
