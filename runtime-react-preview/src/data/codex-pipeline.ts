import type { AgentEvent, CodexRunRequest, GameProjectAsset, GameProjectManifest, PromptBlock, PublishedGame } from "../types/project-types";

export const spriteEmotions = ["idle", "surprised", "happy", "sad", "laugh"] as const;

export const defaultPromptBlocks: PromptBlock[] = [
  {
    id: "draft",
    type: "text",
    content:
      "Create a storytelling-heavy image-blaster scene adventure about two characters, a lantern keeper and a memory archivist, exploring a quiet 3D forest village before dawn. Make it feel like a playable novel adventure: the two characters should take turns speaking in emotional dialogue, reveal secrets through conversation, and react to each other's choices. The player can inspect meaningful objects such as moon shards, old letters, lantern charms, and bridge keys to trigger new dialogue, emotional sprite changes, memory reveals, and story branches. The goal is to uncover why the bridge is sealed and decide which memory should be restored before dawn.",
  },
];

export const publishedGames: PublishedGame[] = [
  {
    id: "lantern-grove",
    title: "Lantern Grove",
    description: "Image-blaster village exploration with sprite characters and a soft-focus scene.",
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
    description: "Isometric traversal test with generated props and overlay actors.",
    thumbnailColor: "#596b9a",
    path: "published/skyline-ruins/index.html",
  },
];

export const starterProject = createManifest("Lantern Grove");

export const codexSystemPrompt = [
  "You are the Codex backend for Game Spark AI, an AI-native local web game engine built around image-blaster generated scenes.",
  "You are primarily a conversational game creation assistant. Do not modify files or run game-generation workflows unless the current request clearly asks to create, update, change, add, remove, fix, implement, regenerate, or publish game content.",
  "Treat game generation as an optional tool, not the default response.",
  "For conversational questions, answer normally in chat and do not write files.",
  "When the user has game creation/update intent, generate or modify a complete local image-blaster-based web project that runs from src/main.js and stores assets under assets/.",
  "For MVP, create image-blaster scenes with a 2D character and dialogue overlay. Use the runtime, viewer, framework, and file structure produced or recommended by image-blaster, not PlayCanvas.",
  "Generate modular JavaScript overlay/runtime scripts for dialogue, emotion state, decision tree progression, scene loading, and game state.",
  "Create 2D character sprite sheets with OpenAI Image 2. For the main story character, create one 1024x1024 PNG for each emotion: idle, surprised, happy, sad, laugh.",
  "Each sprite sheet must be 4 columns by 3 rows, 12 frames total, each frame treated as 3:4 content inside its cell. Name files [character]_[emotion].png.",
  "For new game generation, first use OpenAI Image 2 to create a clean background/environment reference image from the user's prompt with no character sprite, dialogue UI, buttons, HUD, captions, logos, or UI text. Save it under assets/scenes/ or assets/textures/, then clone https://github.com/neilsonnn/image-blaster when the local skills/image-blaster folder is missing, run it with that reference image plus the required World Labs API and fal API credentials, and import the resulting scene/model files into assets/scenes/ or assets/models/.",
  "Overlay the generated 2D character on top of the image-blaster scene, add a bottom dialogue interface, and implement about five rounds of branching story decisions that change emotion state and ending.",
  "Record all generated assets in manifest.json with source, usage, paths, and prompt provenance.",
  "Save every run under runs/<timestamp>/ with the user prompt, agent log, changed files summary, and generated asset manifest.",
].join("\n");

export const electronBridgeContract = [
  "Renderer calls window.gameSpark.startCodexRun({ projectId, prompt, mode, attachments }).",
  "Electron main creates or opens <workspace>/<project-id>/ and writes the run prompt to runs/<timestamp>/prompt.md.",
  "Electron main launches the local Codex CLI/task runner in the project workspace with the Game Spark Agent skill prompt.",
  "Codex owns generation: sprite prompts, OpenAI Image 2 calls, image-blaster 3D calls, overlay/runtime code, local files, and build output.",
  "Electron main streams structured phase events to the renderer and reloads manifest.json when the run exits.",
].join("\n");

export function createManifest(title: string): GameProjectManifest {
  const now = new Date().toISOString();
  const slug = slugify(title);
  return {
    id: slug,
    title,
    style: "image-blaster",
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
        summary: "Generated image-blaster scene, placeholder sprite pipeline, overlay scripts, and local build manifest.",
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
  const title = request.mode === "create" ? "Creating local game project" : "Iterating existing image-blaster project";
  return [
    event("planning", title, "Codex is expanding the prompt into a gameplay loop, level layout, character list, and asset manifest.", now),
    event(
      "generating_assets",
      "Generating sprite sheets",
      `OpenAI Image 2 queue prepared for ${spriteEmotions.length} emotions per character using 4x3, 12-frame PNG sheets.`,
      now + 1000,
    ),
    event(
      "generating_world",
      "Generating 3D world assets",
      "image-blaster reference image and world prompt prepared for the generated scene runtime.",
      now + 2000,
    ),
    event(
      "writing_code",
      "Writing game scripts",
      "Creating modular overlay, dialogue, emotion, decision tree, and scene bootstrap scripts.",
      now + 3000,
    ),
    event("building", "Building playable preview", "Bundling the local web build and refreshing the game preview.", now + 4000),
    event("ready", "Ready to playtest", "The generated image-blaster story scene is available in the viewport and can be published locally.", now + 5000),
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
    usage: `Lantern keeper ${emotion} overlay animation`,
    metadata: {
      columns: 4,
      rows: 3,
      frames: 12,
      generator: "OpenAI Image 2 prompt",
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
      usage: "Primary 3D environment generated through image-blaster",
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
      usage: "Scene bootstrap, overlay UI, dialogue, and game state",
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
    surprised: "#d7c66a",
    happy: "#9fbd8f",
    sad: "#6f789e",
    laugh: "#d49a70",
  };
  return colors[emotion];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
