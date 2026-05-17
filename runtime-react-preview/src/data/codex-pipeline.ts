import type { AgentEvent, CodexRunRequest, GameProjectAsset, GameProjectManifest, PromptBlock, PublishedGame } from "../types/project-types";

export const spriteEmotions = ["idle", "walk", "laugh", "confused", "sad", "angry", "surprised"] as const;

export const defaultPromptBlocks: PromptBlock[] = [
  {
    id: "draft",
    type: "text",
    content:
      "Create a cozy HD2D forest mystery where a lantern keeper explores a 3D village, talks to NPCs, collects moon shards, and unlocks a bridge before dawn.",
  },
];

export const publishedGames: PublishedGame[] = [
  {
    id: "lantern-grove",
    title: "Lantern Grove",
    description: "HD2D village exploration with sprite characters and a soft-focus scene.",
    thumbnailColor: "#3a6f68",
    path: "published/lantern-grove/index.html",
  },
  {
    id: "clockwork-harbor",
    title: "Clockwork Harbor",
    description: "A compact puzzle RPG prototype exported from a local workspace.",
    thumbnailColor: "#8f6d40",
    path: "published/clockwork-harbor/index.html",
  },
  {
    id: "skyline-ruins",
    title: "Skyline Ruins",
    description: "Isometric traversal test with generated props and billboard actors.",
    thumbnailColor: "#596b9a",
    path: "published/skyline-ruins/index.html",
  },
];

export const starterProject = createManifest("Lantern Grove");

export const codexSystemPrompt = [
  "You are the Codex backend for Game Spark AI, an AI-native PlayCanvas HD2D game engine.",
  "You are primarily a conversational game creation assistant. Do not modify files or run game-generation workflows unless the current request clearly asks to create, update, change, add, remove, fix, implement, regenerate, or publish game content.",
  "Treat game generation as an optional tool, not the default response.",
  "For conversational questions, answer normally in chat and do not write files.",
  "When the user has game creation/update intent, generate or modify a complete local PlayCanvas web project that runs from src/main.js and stores assets under assets/.",
  "For MVP, only create HD2D games: 3D environments, 2D billboard sprite-sheet characters, cinematic lighting, and depth-of-field or a PlayCanvas post-effect approximation.",
  "Generate modular JavaScript scripts for player input, camera, NPC interactions, objectives, pickups, world events, and game state.",
  "Create 2D character sprite sheets with Codex Image 2. For every named character, create one 1024x1024 PNG for each emotion: idle, walk, laugh, confused, sad, angry, surprised.",
  "Each sprite sheet must be 4 columns by 3 rows, 12 frames total, each frame treated as 3:4 content inside its cell. Name files [character]_[emotion].png.",
  "Generate 3D world and prop assets through the neilsonnn/image-blaster workflow, then import the resulting model files into assets/models/.",
  "Record all generated assets in manifest.json with source, usage, paths, and prompt provenance.",
  "Save every run under runs/<timestamp>/ with the user prompt, agent log, changed files summary, and generated asset manifest.",
].join("\n");

export const electronBridgeContract = [
  "Renderer calls window.gameSpark.startCodexRun({ projectId, prompt, mode, attachments }).",
  "Electron main creates or opens projects/<project-id>/ and writes the run prompt to runs/<timestamp>/prompt.md.",
  "Electron main launches the local Codex CLI/task runner in the project workspace with the Game Spark system prompt.",
  "Codex owns generation: sprite prompts, Codex Image 2 calls, image-blaster 3D calls, PlayCanvas code, local files, and build output.",
  "Electron main streams structured phase events to the renderer and reloads manifest.json when the run exits.",
].join("\n");

export function createManifest(title: string): GameProjectManifest {
  const now = new Date().toISOString();
  const slug = slugify(title);
  return {
    id: slug,
    title,
    style: "HD2D",
    createdAt: now,
    updatedAt: now,
    workspacePath: slug,
    playCanvasEntry: "src/main.js",
    buildPath: `${slug}/build/index.html`,
    publishedPath: `published/${slug}/index.html`,
    promptHistory: [
      {
        id: "prompt-1",
        content: defaultPromptBlocks[0].type === "text" ? defaultPromptBlocks[0].content : "",
        createdAt: now,
      },
    ],
    runHistory: [
      {
        id: "run-1",
        createdAt: now,
        status: "ready",
        summary: "Generated HD2D scene, placeholder sprite pipeline, game scripts, and local build manifest.",
      },
    ],
    assets: createStarterAssets(slug),
  };
}

export function createMockRunEvents(request: CodexRunRequest): AgentEvent[] {
  const now = Date.now();
  if (request.workflowIntent === "conversation") {
    return [
      event(
        "ready",
        "Agent replied",
        "I can help talk through the game idea, explain mechanics, or plan changes. I will only update the project when you ask me to change the game.",
        now,
      ),
    ];
  }
  const title = request.mode === "create" ? "Creating local game project" : "Iterating existing HD2D project";
  return [
    event("planning", title, "Codex is expanding the prompt into a gameplay loop, level layout, character list, and asset manifest.", now),
    event(
      "generating_assets",
      "Generating sprite sheets",
      `Codex Image 2 queue prepared for ${spriteEmotions.length} emotions per character using 4x3, 12-frame PNG sheets.`,
      now + 1000,
    ),
    event(
      "generating_world",
      "Generating 3D world assets",
      "image-blaster prompt prepared for terrain, buildings, landmark props, and collision-friendly scene pieces.",
      now + 2000,
    ),
    event(
      "writing_code",
      "Writing game scripts",
      "Creating modular player, camera, interaction, objective, sprite animation, and scene bootstrap scripts.",
      now + 3000,
    ),
    event("building", "Building playable preview", "Bundling the local web build and refreshing the game preview.", now + 4000),
    event("ready", "Ready to playtest", "The generated HD2D game is available in the viewport and can be published locally.", now + 5000),
  ];
}

function createStarterAssets(slug: string): GameProjectAsset[] {
  const spriteAssets = spriteEmotions.map((emotion) => ({
    id: `asset-lantern-${emotion}`,
    name: `lantern_keeper_${emotion}.png`,
    kind: "sprite" as const,
    path: `projects/${slug}/assets/sprites/lantern_keeper_${emotion}.png`,
    source: "generated" as const,
    previewColor: emotionColor(emotion),
    usage: `Lantern keeper ${emotion} billboard animation`,
    metadata: {
      columns: 4,
      rows: 3,
      frames: 12,
      generator: "Codex Image 2 prompt",
    },
  }));

  return [
    ...spriteAssets,
    {
      id: "asset-world",
      name: "moonlit_village.glb",
      kind: "model",
      path: `projects/${slug}/assets/models/moonlit_village.glb`,
      source: "generated",
      previewColor: "#667c5f",
      usage: "Primary 3D HD2D environment generated through image-blaster",
      metadata: {
        generator: "neilsonnn/image-blaster",
      },
    },
    {
      id: "asset-scene",
      name: "main.js",
      kind: "script",
      path: `projects/${slug}/src/main.js`,
      source: "system",
      previewColor: "#516071",
      usage: "Game bootstrap, camera, lighting, post effects, and game state",
    },
  ];
}

function event(phase: AgentEvent["phase"], title: string, detail: string, timestamp: number): AgentEvent {
  return {
    id: `${phase}-${timestamp}`,
    phase,
    title,
    detail,
    timestamp: new Date(timestamp).toISOString(),
  };
}

function emotionColor(emotion: (typeof spriteEmotions)[number]) {
  const colors: Record<(typeof spriteEmotions)[number], string> = {
    idle: "#c9ad6a",
    walk: "#9fbd8f",
    laugh: "#d49a70",
    confused: "#7ea3b8",
    sad: "#6f789e",
    angry: "#b85f58",
    surprised: "#d7c66a",
  };
  return colors[emotion];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
