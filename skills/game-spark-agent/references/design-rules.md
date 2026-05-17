# Game Design Rules

## Supported Game Categories

For MVP, prioritize:

- Platformer
- Top down RPG
- Isometric strategy
- First person shooter

Supported presentation styles:

- 2D
- HD2D
- 3D

Default to HD2D unless the user clearly asks otherwise.

## Gameplay Quality Bar

A generated game must have:

- A clear player verb.
- A short-term objective.
- A readable failure or friction point.
- A reward, unlock, or progression loop.
- At least one interactive element.
- A next-iteration hook that the user can ask to improve.

Useful mechanics:

- Storytelling: NPCs, dialogue, cutscenes, authored events.
- Challenges: hazards, enemies, timers, navigation friction.
- Numbers and progression: levels, resources, upgrades, collections.
- Puzzles: logic, pattern recognition, spatial reasoning.

## HD2D Direction

HD2D means:

- 3D scene geometry and lighting.
- 2D sprite-sheet characters as camera-facing billboards, with generated sprite textures visibly applied in runtime.
- Cinematic camera, depth layering, bloom/soft focus or depth-of-field approximation.
- Strong silhouettes and readable interaction targets.

Avoid a finished scene that reads as a primitive blockout. Boxes, cones, spheres, and capsules are acceptable for collision, rough prototypes, or supplemental simple props, but generated 3D scene/object assets should carry the visible environment when available.

## Level Design

Every level should define:

- Environment theme.
- Landmarks.
- Navigable paths.
- Obstacles or gates.
- Interactables.
- Events triggered by player actions.

Prefer small but complete spaces over large empty maps.
