---
source: https://github.com/neilsonnn/image-blaster/blob/main/.claude/skills/image-blast-project/SKILL.md
---

# Image Blast Project

Create, inspect, and manage an IMAGE-BLAST project envelope under `worlds/<slug>`.

Use before other image-blast skills or whenever active project state is needed.

## Workflow

1. Resolve the project slug.
   - If the input is an existing `worlds/<slug>` directory or slug-like name, use it.
   - Otherwise derive a lowercase hyphenated slug from the description.
   - If no usable input is provided, ask which project/world to use.
2. Run project state from the image-blaster repo root:

```bash
node .claude/scripts/project/project-state.mjs --world "<slug>" --stage-input
```

3. The helper creates and validates:

```text
worlds/<slug>/
  project.json
  scene.json
  image.json
  source/
    <image-name>.json
  output/
    world/
    sfx/
    <object-slug>/
```

4. Report:
   - project slug and display name
   - source file count
   - per-image JSON count
   - staged files moved from `input/`, if any
   - whether World Labs output exists
   - whether `image.json` exists
   - derived object count
   - whether world-level SFX exists
   - whether `scene.json` exists

5. Recommend downstream actions after setup/analysis:
   - clean plate/source cleanup when needed
   - static world generation
   - per-object 3D generation
   - ambient or object SFX generation
