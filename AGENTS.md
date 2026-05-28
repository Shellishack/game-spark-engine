# Game Spark AI Agent Guide

## Project Shape

Game Spark AI is a skill-first local game engine workflow. Reusable agent instructions live in `skills/`, and the npm package workspaces live at the repo root.

Use the existing app structure before adding new directories:

- `cli/` for `@game-spark/cli`, terminal/agent commands, preview serving, and scene context generation.
- `editor/` for `@game-spark/editor`, Electron main/preload code, and the React editor UI.
- `editor/web/app/` for the React app shell and primary UI.
- `editor/web/data/` for mocked pipeline data and app copy.
- `editor/web/runtime/` for generated preview/runtime helpers.
- `editor/web/types/` for current UI TypeScript contracts.
- `skills/game-spark-agent/` for the backend agent loop and game-generation behavior.

## Development

Run editor commands from `editor` unless the task clearly targets repo-level files or CLI tooling.

Common checks:

```powershell
npm run build
```

`npm run dev` starts the Electron app through `scripts/dev-electron.cjs`.

## Agent Behavior

The UI should not blindly trigger game generation for every user message. Treat the generation/update workflow as a tool:

- Conversational or exploratory user messages should receive a normal agent response.
- Messages with clear intent to create, modify, rebuild, or update the game may run the workflow.
- Keep project files local-first under the selected workspace folder.
- Keep user-facing UI copy generic to Game Spark AI; avoid exposing implementation details unless needed for debugging.

When changing core agent behavior, update `skills/game-spark-agent/SKILL.md` and any relevant files in `skills/game-spark-agent/references/`.

## Debugging User-Agent Interactions

Use the debug helper instead of manually reasoning through log paths:

```powershell
node scripts/read-latest-log.cjs
```

The script resolves the Game Spark app data directory, reads only the newest file in `logs/*.json` based on the filename timestamp, and prints a summarized JSON view of the interaction history.

The Electron settings file is stored in the app data directory and contains the selected workspace pointer:

```text
%APPDATA%\game-spark-ai\settings.json
```

Read `workspaceRoot` from that file to find the active workspace. If `workspaceRoot` is missing, the default workspace is:

```text
%USERPROFILE%\Game Spark AI
```

Interaction logs are saved inside the app data logs folder:

```text
%APPDATA%\game-spark-ai\logs\log_[project]_[timestamp].json
```

Each log file contains metadata plus an `interactions` array with timestamped UI and agent events. Before changing agent-routing, workflow-triggering, prompt classification, or interrupt behavior, inspect the latest relevant `log_*.json` file to understand the user-agent conversation history and what interaction produced the bug.

Use these logs to answer questions such as:

- Did the user ask for conversation or a game update?
- Which project was active?
- Which UI action started the run?
- Did the user interrupt Codex?
- Which workspace was selected when the issue happened?

Do not commit or copy private user logs into source files. Summarize only the relevant event sequence when reporting findings.

## Editing Rules

Keep changes scoped to the requested behavior. Do not revert user edits. Prefer existing component patterns, naming style, and local helper APIs. Use `apply_patch` for manual edits.
