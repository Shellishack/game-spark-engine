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
   - 2D characters: create one 1024x1024 PNG sprite sheet per emotion.
   - Required emotions: `idle`, `walk`, `laugh`, `confused`, `sad`, `angry`, `surprised`.
   - Sprite sheet layout: 4 columns x 3 rows, 12 frames.
   - Naming: `[character]_[emotion].png`, for example `cat_idle.png`.
   - 3D world/props: use the image-blaster workflow when available.

6. **Write game code**
   - Use PlayCanvas scripts in JavaScript.
   - Keep systems modular: player, camera, interactions, NPCs, objectives, inventory/progression, world events.
   - Keep generated runtime code readable and editable.

7. **Build and validate**
   - Produce or update a playable local build under `build/`.
   - Validate that entry files exist, assets referenced in code exist, and `manifest.json` matches disk.
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

Each asset entry should include `id`, `name`, `kind`, `path`, `source`, `previewColor`, and `usage`.

## References

For detailed design rules, read `references/design-rules.md`.
For project file conventions and validation details, read `references/project-contract.md`.

