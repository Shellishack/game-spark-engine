const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function gameSparkDataPath() {
  if (process.env.GAME_SPARK_DATA_PATH) {
    return process.env.GAME_SPARK_DATA_PATH;
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "game-spark-ai");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "game-spark-ai");
  }

  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "game-spark-ai");
}

function timestampFromLogName(fileName) {
  const match = fileName.match(/_([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z)\.json$/);
  if (!match) return 0;
  return Date.parse(match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z")) || 0;
}

function latestLogFile(logDir) {
  if (!fs.existsSync(logDir)) return null;

  const files = fs
    .readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(logDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        fullPath,
        timestamp: timestampFromLogName(entry.name) || stat.mtimeMs,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp || b.mtimeMs - a.mtimeMs);

  return files[0]?.fullPath ?? null;
}

function summarizeInteraction(interaction) {
  const payload = interaction.payload || {};
  return {
    timestamp: interaction.timestamp,
    type: interaction.type,
    projectId: payload.projectId,
    projectTitle: payload.projectTitle,
    phase: payload.phase,
    title: payload.title,
    source: payload.source,
    content: typeof payload.content === "string" ? payload.content.slice(0, 500) : undefined,
    workflowIntent: payload.workflowIntent,
    mode: payload.mode,
  };
}

const dataPath = gameSparkDataPath();
const logDir = path.join(dataPath, "logs");
const logPath = latestLogFile(logDir);

if (!logPath) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        dataPath,
        logDir,
        error: "No log JSON files found.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const log = JSON.parse(fs.readFileSync(logPath, "utf8"));
const interactions = Array.isArray(log.interactions) ? log.interactions : [];

console.log(
  JSON.stringify(
    {
      ok: true,
      dataPath,
      logDir,
      logPath,
      project: log.project,
      createdAt: log.createdAt,
      interactionCount: interactions.length,
      latestInteraction: interactions.length > 0 ? summarizeInteraction(interactions[interactions.length - 1]) : null,
      interactions: interactions.map(summarizeInteraction),
    },
    null,
    2,
  ),
);
