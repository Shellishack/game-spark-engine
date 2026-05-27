import { phaseLabels } from "../app-constants";
import { logInteraction } from "../app-telemetry";
import type { AgentPhase } from "../../types/project-types";
export function WindowFrame({ phase, onHome, showHome }: { phase: AgentPhase; onHome: () => void; showHome: boolean }) {
  return (
    <header className="window-frame">
      <div className="window-drag-region">
        <span className="window-badge">GS</span>
        <div>
          <strong>Game Spark AI</strong>
          <small>{phaseLabels[phase]}</small>
        </div>
        <nav className="window-nav" aria-label="Top navigation">
          {showHome ? (
            <button type="button" onClick={onHome}>
              Home
            </button>
          ) : null}
        </nav>
      </div>
      <div className="window-controls">
        <button
          type="button"
          aria-label="Minimize window"
          onClick={() => {
            logInteraction("window_control_clicked", { action: "minimize" });
            window.gameSpark?.minimizeWindow?.();
          }}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Maximize window"
          onClick={() => {
            logInteraction("window_control_clicked", { action: "toggle-maximize" });
            window.gameSpark?.toggleMaximizeWindow?.();
          }}
        >
          □
        </button>
        <button
          type="button"
          aria-label="Close window"
          onClick={() => {
            logInteraction("window_control_clicked", { action: "close" });
            window.gameSpark?.closeWindow?.();
          }}
        >
          ×
        </button>
      </div>
    </header>
  );
}

