---
name: game-spark-agent
description: Use when creating, updating, reviewing, or operating Game Spark AI projects without relying on the Electron UI. This skill defines the core agentic loop for an AI-native local-first game engine using Babylon.js or Phaser, image-blaster generated assets when relevant, local files, generated 2D sprite sheets, generated 3D scene assets, JavaScript code, manifests, and playable builds.
---

# Game Spark Agent

This skill is the core Game Spark AI workflow. The Electron app is only a UI shell around this same loop.

## Intent Gate

Treat game generation as a tool, not the default response.

- Conversation: answer without changing files.
- Game update: create or modify project files only when the user clearly asks to create, generate, rebuild, update, modify, fix, or publish game content.
- Review/debug: inspect the project, identify issues, and patch only what is needed.

When game generation is allowed, build a local game with the selected engine. Supported engines are only `babylonjs` and `phaser`.

- Use `babylonjs` for all 3D and HD2D games, and optionally for 2D games when the user selects Babylon.js.
- Use `phaser` only for 2D games when the user selects Phaser.
- Do not target PlayCanvas for new games.
- Generated `src/main.js` must be directly browser-runnable from `build/index.html`. Do not use bare npm imports in generated game source. Use global `BABYLON` for Babylon.js projects and global `Phaser` for Phaser projects.

## Project Contract

Work inside one local project folder under the user's selected workspace.

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

## AI Editor Contract

Game Spark AI is a chat-led game engine. Traditional editor surfaces are control layers over AI-generated project code.

- Generated code is canonical.
- Visual tools, including the logic node graph, are editable projections that produce structured chat/change requests.
- Maintain `manifest.editor` with `applyMode`, `activeTool`, and tool states for `character-2d`, `character-3d`, `world`, `logic`, `ui-dialogue`, `audio`, and `publish`.
- Maintain `manifest.logicGraph` as a code-derived node graph with nodes for triggers, conditions, actions, state, dialogue, and endings.
- When graph edits are requested, update source code first, then refresh `logicGraph` metadata from the resulting code.
- In `preview` apply mode, propose changes and validation expectations before applying files. In `auto` apply mode, apply changes, validate, and report changed files.

## New Game Generation Workflow

When the user starts a request to generate a new game, run this sequence:

1. **Generate the image-blaster reference image**
   - Before running image-blaster, use OpenAI Image 2 to generate a single background reference image from the user's game request.
   - The image must be an environment/background reference for image-blaster, not a full gameplay mockup.
   - The image should show the intended world, mood, landmark composition, camera angle, lighting, and visual style for the 3D scene.
   - Do not include the final 2D character sprite, dialogue box, decision buttons, HUD, captions, logos, or UI text in this background reference.
   - Keep the background reference clean enough for image-blaster to infer scene geometry and atmosphere.
   - Save the reference under `assets/textures/` or `assets/scenes/`, for example `assets/scenes/world_reference.png`.
   - Record the reference image in `manifest.json` with prompt provenance.
   - This reference image is the required image input for image-blaster. Do not run image-blaster without either this generated reference or a user-supplied reference image.

2. **Prepare image-blaster**
   - If `skills/image-blaster/` is missing, clone `https://github.com/neilsonnn/image-blaster` into `skills/image-blaster/` before generating world assets.
   - Follow the cloned repository's setup and run instructions.
   - Use World Labs API and fal API exactly as required by image-blaster. Required credentials must come from the environment, such as `WORLD_LABS_API_KEY` and `FAL_KEY` or the variable names documented by image-blaster.
   - If a required key or dependency is unavailable, record the blocker in `runs/<timestamp>/validation.md` and do not claim image-blaster assets were generated.

3. **Generate the scene with image-blaster**
   - Do not use Claude Code to generate images even if image-blaster recommends it. Use Codex for any code generation related to image-blaster's asset generation, runtime, or viewer.
   - For Babylon.js 3D/HD2D games, use image-blaster to create the primary 3D world or scene backdrop from the reference image.
   - For Phaser 2D games, skip image-blaster unless the user explicitly asks for 3D generated assets.
   - Save resulting scene/model assets under `assets/scenes/` or `assets/models/`.
   - Use Babylon.js as the underlying game engine and import image-blaster outputs as scene/model assets.
   - Do not convert the scene into PlayCanvas.
   - Load and instantiate the generated assets in a Babylon.js `Engine` and `Scene`. Manifest-only generated assets are incomplete.

4. **Generate character emotion sprite sheets**
   - Use OpenAI Image 2 to generate one character with five 2D emotion sprite sheets.
   - The required emotions are `idle`, `surprised`, `happy`, `sad`, and `laugh`.
   - Treat user spelling such as `idel` as `idle`.
   - Generate one 1024x1024 PNG per emotion, each as a 4 columns x 3 rows sprite sheet with 12 frames.
   - Name files `[character]_[emotion].png` and save them under `assets/sprites/`.
   - Keep the character visually consistent across all five sheets.
   - Load each sprite sheet as a texture and animate it from the 4x3 frame layout.

5. **Overlay the sprite actor over the generated scene**
   - For Babylon.js games, render the character as a 2D overlay layer on top of the Babylon.js scene.
   - For Phaser games, render the character as Phaser sprites, sprite sheets, or scene/UI layers.
   - Use the current dialogue state to switch the visible emotion sheet.
   - The character may be a screen-space HTML/CSS/canvas overlay, a transparent textured plane in Babylon.js, Phaser sprite animation, or another overlay method that fits the selected runtime.
   - Do not add PlayCanvas-specific billboards, entities, scripts, or primitive proxies.

6. **Add bottom dialogue UI**
   - Add a dialogue interface anchored to the bottom of the game viewport.
   - Include speaker name, dialogue line, and two to three decision buttons.
   - The interface must be playable with pointer/click input and keyboard selection where practical.
   - Do not cover the main character's face or primary scene objective with the dialogue panel.

7. **Create a five-round interactive story**
   - Make up a compact branching decision tree for about five rounds.
   - Each round should present a clear story choice, update game state, change the character's emotion, and lead to the next node.
   - Include at least one branch that recontextualizes the scene and one branch that changes the ending.
   - Store the decision tree as readable game data in `src/main.js` or a small module under `src/`.
   - The playable result should feel like a short interactive storytelling game, not a static visualizer.

8. **Build and validate**
   - Produce or update `build/index.html`.
   - Do not start Python, `python -m http.server`, or any ad hoc preview server. Electron owns preview serving through its local Node/Electron bridge.
   - Validate that the Image 2 reference image exists and is the input used by image-blaster, unless the user supplied a reference image.
   - For Babylon.js 3D/HD2D games, validate that generated 3D assets exist and are referenced by the Babylon.js runtime code.
   - For Phaser 2D games, validate that Phaser scenes preload and visibly use generated/imported 2D assets.
   - Validate that all five emotion sprite sheets exist, are referenced by runtime code, and are visible through dialogue-state changes.
   - Validate that the bottom dialogue UI exposes a five-round decision tree.
   - Record validation in `runs/<timestamp>/validation.md`.

## General Agentic Loop

1. Read `manifest.json`, `src/`, `assets/`, and latest `runs/`.
2. Preserve user files and existing project decisions unless the request asks to replace them.
3. Write a concise plan to `runs/<timestamp>/plan.md`.
4. Implement gameplay, scene assets, sprite assets, scripts, manifest updates, build output, and run metadata.
5. Validate the playable result and record known gaps.
6. Report changed files, playable build path, blockers, and the next useful iteration.

## Manifest Requirements

`manifest.json` should include:

```json
{
  "id": "project-slug",
  "title": "Project Title",
  "style": "babylonjs",
  "engine": "babylonjs",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "workspacePath": "project-slug",
  "runtimeEntry": "src/main.js",
  "babylonEntry": "src/main.js",
  "phaserEntry": null,
  "editor": {
    "applyMode": "preview",
    "activeTool": "logic",
    "tools": []
  },
  "logicGraph": {
    "source": "code-derived",
    "updatedAt": "ISO timestamp",
    "nodes": [],
    "edges": []
  },
  "buildPath": "project-slug/build/index.html",
  "promptHistory": [],
  "runHistory": [],
  "assets": []
}
```

Each asset entry should include `id`, `name`, `kind`, `path`, `source`, `previewColor`, `usage`, and a short runtime usage note such as `usedBy` or `runtimeRefs`. Use `kind: "sprite"` for sprite sheets, `kind: "scene"` for generated scene outputs, and `kind: "model"` for generated model outputs. Existing app manifests may still include the legacy `playCanvasEntry` field for compatibility; migrate new writes to `runtimeEntry` plus `babylonEntry` or `phaserEntry`, and do not interpret that legacy field as permission to use PlayCanvas for new generation.
