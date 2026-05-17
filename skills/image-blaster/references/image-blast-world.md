---
source: https://github.com/neilsonnn/image-blaster/blob/main/.claude/skills/image-blast-world/SKILL.md
---

# Image Blast World

Generate the static 3D environment of a world from a source or plate image.

## Workflow

1. Use `ls -a` before reading generated state.
2. Use an explicit image path or prompt when provided.
3. Without an explicit image, use the highest-index visible image in `worlds/<slug>/source/`.
4. Before generating, synthesize an empty-environment world prompt:
   - preserve original setting, materials, lighting, atmosphere, camera feel, and spatial layout
   - remove confirmed objects from the description
   - do not reintroduce removed foreground objects

Check state:

```bash
node .claude/scripts/project/project-state.mjs --world "<slug>"
```

Run world generation:

```bash
node .claude/scripts/world/generate-world.mjs --world "<slug>" --prompt "<empty-environment world caption>"
```

Pass `--image` only when an explicit image path is provided or the selected source is not the helper default. For explicit regeneration, append `--regenerate`.

## Output Contract

The helper downloads every referenced world asset to local matching files in:

```text
worlds/<slug>/output/world/
```

Expected outputs may include:

- `.spz` static environment splat
- collider `.glb`
- panorama
- thumbnail
- JSON request/response metadata

Runtime must load local files from disk. Provider URLs in response JSON are provenance/resume data only.

If local files are missing, repair from metadata:

```bash
node .claude/scripts/project/ensure-local-assets.mjs --from "worlds/<slug>/output/world/<N>-world.json"
```
