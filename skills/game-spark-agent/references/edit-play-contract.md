# Edit And Play Mode Contract

Game Spark projects support two core modes:

- Edit mode: livepreview is selectable, draggable, and AI-addressable through scene objects, groups, and `.game-spark/` context files.
- Play mode: the game runs as real runtime code with no editor controls exposed to the player.

The UI is optional. Users and agents can operate the project through CLI tools alone.

## Agent Context Files

Each project may contain:

```text
.game-spark/
  selection.json
  editor-state.json
  agent-context.md
```

`selection.json` stores active selected object and group IDs. `agent-context.md` summarizes the selected scene state for Codex or other coding agents.

Before responding to requests such as "move this", "make the selected group darker", or "change this object's behavior", read `.game-spark/agent-context.md` or run the CLI `scene context` command to refresh it.
