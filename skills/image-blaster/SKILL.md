---
name: image-blaster
description: Vendored reference for generating 3D worlds and object models from image-blaster. Use from the Game Spark asset pipeline when a game needs static 3D environments, object models, or source-image-to-world generation.
source: https://github.com/neilsonnn/image-blaster
---

# Image Blaster

This folder vendors the image-blaster workflow contracts used by Game Spark AI.

Use the references in this order:

1. `references/image-blast-project.md` to create or inspect a world envelope.
2. `references/image-blast-world.md` to generate the static 3D environment.
3. `references/image-blast-3d.md` once per atomic object model.

Game Spark projects must copy successful outputs into the local game project:

- `.glb` and `.obj` object models to `assets/models/`
- static world `.spz`, collider `.glb`, panorama, and thumbnail files to `assets/scenes/` or `assets/models/`
- ambient and object SFX to `assets/audio/`

Do not leave runtime assets pointing at provider URLs. Provider URLs are provenance only.
