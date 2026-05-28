export const iframeHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f8fb;
        color: #172033;
      }
      #root {
        min-height: 100vh;
      }
      button, input {
        font: inherit;
      }
      button {
        border: 0;
        border-radius: 6px;
        padding: 0.65rem 0.9rem;
        background: #2563eb;
        color: white;
        cursor: pointer;
      }
      button:disabled {
        background: #9aa4b2;
        cursor: not-allowed;
      }
      input {
        min-width: 0;
        border: 1px solid #cfd7e3;
        border-radius: 6px;
        padding: 0.65rem 0.75rem;
      }
      .mini-app {
        width: min(100%, 520px);
        margin: 0 auto;
        padding: 2rem;
      }
      .mini-app h1 {
        margin: 0 0 1rem;
        font-size: 1.6rem;
      }
      .row {
        display: flex;
        gap: 0.5rem;
      }
      .row input {
        flex: 1;
      }
      ul {
        padding-left: 1.25rem;
      }
      .profile {
        text-align: center;
      }
      .avatar {
        display: grid;
        width: 72px;
        height: 72px;
        margin: 0 auto 1rem;
        place-items: center;
        border-radius: 50%;
        background: #14b8a6;
        color: white;
        font-weight: 800;
      }
      .dashboard section {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.75rem;
      }
      .dashboard article {
        border: 1px solid #d9e0ea;
        border-radius: 8px;
        padding: 1rem;
        background: white;
      }
      .dashboard span,
      .dashboard strong {
        display: block;
      }
      .dashboard strong {
        margin-top: 0.4rem;
        font-size: 1.5rem;
      }
      .preview-error {
        padding: 1rem;
        color: #991b1b;
        white-space: pre-wrap;
      }
      .game-shell {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 1rem;
        background: #020617;
      }
      .runtime-game-canvas {
        box-shadow: 0 18px 50px rgba(2, 6, 23, 0.35);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      const React = window.parent.__GameSparkAIReact;
      const ReactDOM = window.parent.__GameSparkAIReactDOM;
      const rootElement = document.getElementById("root");
      if (!React || !ReactDOM) {
        rootElement.innerHTML = '<pre class="preview-error">Preview runtime bridge was not initialized.</pre>';
        throw new Error("Preview runtime bridge was not initialized.");
      }
      const root = ReactDOM.createRoot(rootElement);

      function showError(error) {
        rootElement.innerHTML = '<pre class="preview-error"></pre>';
        rootElement.querySelector("pre").textContent = error && error.stack ? error.stack : String(error);
      }

      window.addEventListener("message", (event) => {
        if (!event.data || event.data.type !== "RUN_PROJECT_BUNDLE") return;

        try {
          window.__GeneratedApp = undefined;
          window.__RuntimeReact = React;
          window.__RuntimeReactDOM = ReactDOM;
          window.__RuntimeAssets = event.data.bundle.assets || {};

          // Sandbox loading happens here. The parent sends a bundled virtual
          // project, and this iframe evaluates it without refreshing the page.
          const run = new Function(event.data.bundle.js);
          run();

          if (typeof window.__GeneratedApp !== "function") {
            throw new Error("Generated code did not define a default App component.");
          }

          root.render(React.createElement(window.__GeneratedApp));
        } catch (error) {
          showError(error);
          window.parent.postMessage({
            type: "PREVIEW_ERROR",
            message: error && error.stack ? error.stack : String(error)
          }, "*");
        }
      });
    </script>
  </body>
</html>`;
