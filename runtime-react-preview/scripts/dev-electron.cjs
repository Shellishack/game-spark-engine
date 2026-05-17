const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const electronPath = require("electron");

const root = path.resolve(__dirname, "..");
const rendererUrl = "http://127.0.0.1:5050";
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");

const vite = spawn(process.execPath, [viteBin, "--host", "0.0.0.0", "--port", "5050", "--strictPort", "--configLoader", "native"], {
  cwd: root,
  stdio: "inherit",
});

vite.on("exit", (code) => {
  if (!electronStarted) {
    console.error(`Renderer process exited before Electron started with code ${code ?? 0}.`);
    process.exit(code ?? 1);
  }
});

vite.on("error", (error) => {
  console.error(`Failed to start Vite: ${error.message}`);
  process.exit(1);
});

let electronStarted = false;

waitForServer(rendererUrl, 20000)
  .then(() => {
    electronStarted = true;
    const electron = spawn(electronPath, ["."], {
      cwd: root,
      stdio: "inherit",
    });

    electron.on("error", (error) => {
      console.error(`Failed to start Electron: ${error.message}`);
      shutdown(vite);
      process.exit(1);
    });

    electron.on("exit", (code) => {
      if (code && code !== 0) {
        console.error(`Electron exited with code ${code}.`);
      }
      shutdown(vite);
      process.exit(code ?? 0);
    });
  })
  .catch((error) => {
    console.error(error.message);
    shutdown(vite);
    process.exit(1);
  });

process.on("SIGINT", () => shutdown(vite));
process.on("SIGTERM", () => shutdown(vite));

function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for renderer at ${url}.`));
          return;
        }

        setTimeout(check, 250);
      });

      request.setTimeout(1000, () => {
        request.destroy();
      });
    };

    check();
  });
}

function shutdown(child) {
  if (!child.killed) {
    child.kill();
  }
}
