#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const editorRoot = path.resolve(__dirname, "..");
const electronCommandPath =
  process.platform === "win32"
    ? path.join(editorRoot, "node_modules", "electron", "dist", "electron.exe")
    : path.join(editorRoot, "node_modules", ".bin", "electron");
const distIndexPath = path.join(editorRoot, "dist", "index.html");

if (!fs.existsSync(distIndexPath)) {
  console.error("Game Spark editor has not been built. Run `npm run build` in the editor package before launching.");
  process.exit(1);
}

const child = spawn(electronCommandPath, ["."], {
  cwd: editorRoot,
  env: {
    ...process.env,
    GAME_SPARK_EDITOR_DIST: "1",
  },
  stdio: "inherit",
  shell: false,
  windowsHide: false,
});

child.on("error", (error) => {
  console.error(`Failed to launch Game Spark editor: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
