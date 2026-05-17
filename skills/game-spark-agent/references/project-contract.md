# Project Contract

## Local Files

The workspace folder contains many project folders. Do not create an extra `projects/` wrapper unless the user asks for it.

Use this pattern:

```text
<workspace>/
├── lantern-grove/
├── clockwork-harbor/
└── new-game/
```

## Required Outputs

When creating or updating a playable game, ensure these exist:

- `manifest.json`
- `src/main.js`
- `assets/`
- `runs/<timestamp>/prompt.md`
- `runs/<timestamp>/plan.md`
- `runs/<timestamp>/changes.md`
- `runs/<timestamp>/validation.md`

If a build is requested or expected by the UI, also ensure:

- `build/index.html`

## Validation Checklist

Before reporting completion:

- `manifest.json` parses as JSON.
- `manifest.assets` paths exist or are explicitly marked as planned placeholders.
- `src/main.js` exists.
- Referenced scripts/assets use relative paths that work from project root.
- Run notes identify changed files.
- Known gaps are stated plainly.

## Versioning

Never delete or overwrite user-authored assets casually.

For large changes:

- Keep prior generated files unless cleanup is requested.
- Add a run record.
- Write changed-file summary to `runs/<timestamp>/changes.md`.

