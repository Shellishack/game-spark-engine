# Game Spark CLI Tools

Agents can operate Game Spark projects without the Electron UI through the `game-spark` CLI in `cli`.

All commands write JSON to stdout. Treat non-zero exits or `{ "ok": false }` as failures.

## Commands

```powershell
node cli/dist/game-spark.js start --preview [--project <id-or-path>] [--workspace <path>] [--port <number|0>] [--open]
node cli/dist/game-spark.js preview start [--project <id-or-path>] [--workspace <path>] [--port <number|0>] [--open]
node cli/dist/game-spark.js preview rebuild --project <id-or-path> [--workspace <path>]
node cli/dist/game-spark.js scene read [--project <id-or-path>] [--workspace <path>] [--scene <path>]
node cli/dist/game-spark.js scene context [--project <id-or-path>] [--workspace <path>] [--scene <path>]
```

Use `start --preview --open` when the user wants the Electron edit livepreview window. Keep the command running while the preview is in use because the CLI owns the local preview server.

Use `scene context` before editing selected objects or groups. It writes `.game-spark/agent-context.md` from the current scene and selection files.
