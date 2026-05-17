---
source: https://github.com/neilsonnn/image-blaster/blob/main/.claude/skills/image-blast-3d/SKILL.md
---

# Image Blast 3D

Generate exactly one specified atomic 3D object.

Use when one object instance is clearly named, or one image plus one object name/description is provided.

## Object Setup

If the object has no `object.json`, create a minimal durable intent:

```json
{
  "schema_version": 1,
  "world": "<world-slug>",
  "object": {
    "id": "<object-slug>",
    "name": "<object name>",
    "description": "<literal object description>",
    "materials": [],
    "source_images": [],
    "evidence": [],
    "generate_as_3d_object": true,
    "working_dir": "worlds/<world-slug>/output/<object-slug>"
  },
  "updated_at": "ISO timestamp"
}
```

Preserve available `description`, `materials`, `source_images`, and `evidence`.

## Extraction Prompt

Use one atomic physical instance only. Not a pair, set, cluster, category example, or adjacent duplicate.

Base prompt:

```text
Isolate the <target object> from this image. Reproduce it exactly as shown -- same colors, materials, and proportions. White background, centered, tight crop, studio lighting. No other objects, no scene, no people, no text, no shadows on the ground. Isolate the object and remove all clustered, adjacent, overlapping, or items resting on the target object. Create a clean render of that one single object that is true to the source image.
```

## Generation

Run:

```bash
node .claude/scripts/asset-pipeline/generate-single-asset.mjs --world "<world-slug>" --object-id "<object-id>" --image-edit-prompt "<object-specific extraction prompt>"
```

For direct single-image generation:

```bash
node .claude/scripts/asset-pipeline/generate-single-asset.mjs --world "<world-slug>" --image "<image-path>" --object-name "<object-name>" --description "<description>" --image-edit-prompt "<object-specific extraction prompt>"
```

## Provider Options

Hunyuan is the default 3D provider.

Hunyuan defaults:

- `--face-count 50000`
- `--enable-pbr true`
- `--generate-type Normal`

Hunyuan options:

- `--face-count <40000-1500000>`
- `--generate-type Normal|LowPoly|Geometry`
- `--polygon-type triangle|quadrilateral` for `LowPoly`
- `--enable-pbr true|false`

Use `--provider meshy` only when explicitly requested.

Meshy defaults:

```json
{
  "topology": "triangle",
  "target_polycount": 30000,
  "symmetry_mode": "auto",
  "should_remesh": true,
  "should_texture": true,
  "rigging_height_meters": 1.7,
  "animation_action_id": 12,
  "enable_safety_checker": true,
  "enable_animation": false,
  "enable_rigging": false,
  "enable_pbr": true
}
```

For regeneration from an existing reference, append `--regenerate`. For a new source extraction and model, append `--regenerate-reference`. For reference extraction only, pass `--reference-only`.

## Output Contract

Report:

- object id
- output directory
- generated model files
- any failed or resumable request metadata

Copy usable model files into the Game Spark project under `assets/models/`.
