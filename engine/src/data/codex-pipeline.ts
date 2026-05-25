import type {
  AgentEvent,
  CodexRunRequest,
  EditorToolId,
  GameEngine,
  GameProjectAsset,
  GameProjectManifest,
  LogicGraph,
  ProjectEditorState,
  PromptBlock,
  PublishedGame,
} from "../types/project-types";

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
  "You are the Codex backend for Game Spark AI, an AI-native local web game engine that supports Babylon.js and Phaser.",
  "You are primarily a conversational game creation assistant. Do not modify files or run game-generation workflows unless the current request clearly asks to create, update, change, add, remove, fix, implement, regenerate, or publish game content.",
  "Treat game generation as an optional tool, not the default response.",
  "For conversational questions, answer normally in chat and do not write files.",
  "When the user has game creation/update intent, generate or modify a complete local web project that runs from src/main.js and stores assets under assets/.",
  "Use Babylon.js for all HD2D and 3D games. For 2D games, use the selected engine: Phaser or Babylon.js.",
  "When ENGINE is babylonjs, create Babylon.js scenes using image-blaster generated scene/model assets when relevant, with 2D characters and dialogue overlays as needed.",
  "When ENGINE is phaser, create Phaser scenes, preload assets, arcade/input systems, camera/world setup, and 2D gameplay/UI code. Do not run image-blaster for pure Phaser 2D games unless the user explicitly asks for 3D asset generation.",
  "Generated src/main.js must be directly browser-runnable from build/index.html. Do not use bare npm imports in generated game source. Use the global Phaser object for Phaser projects and the global BABYLON object for Babylon.js projects.",
  "Generate modular JavaScript runtime scripts for scene setup, asset loading, dialogue, emotion state, decision tree progression, and game state.",
  "Create 2D character sprite sheets with OpenAI Image 2. For the main story character, create one 1024x1024 PNG for each emotion: idle, surprised, happy, sad, laugh.",
  "Each sprite sheet must be 4 columns by 3 rows, 12 frames total, each frame treated as 3:4 content inside its cell. Name files [character]_[emotion].png.",
  "For Babylon.js 3D/HD2D game generation, first use OpenAI Image 2 to create a clean background/environment reference image from the user's prompt with no character sprite, dialogue UI, buttons, HUD, captions, logos, or UI text. Save it under assets/scenes/ or assets/textures/, then clone https://github.com/neilsonnn/image-blaster when the local skills/image-blaster folder is missing, run it with that reference image plus the required World Labs API and fal API credentials, and import the resulting scene/model files into assets/scenes/ or assets/models/.",
  "For Babylon.js games, load generated scene/model assets into a Babylon.js Engine and Scene. For Phaser games, build a Phaser.Game config and Phaser.Scene classes. Add UI and story/gameplay systems appropriate to the selected engine.",
  "The editor is chat-led. Respect editor.applyMode: preview means propose file/asset changes before applying; auto means apply changes and validate immediately.",
  "Generated game code is canonical. logicGraph is an editable visual projection of code. When a user changes graph nodes or edges, treat it as a structured change request, update source code, and refresh logicGraph metadata from the new code.",
  "Scene layout and object transforms must be data-driven through assets/scenes/main.scene.json. Generated game code must load that scene file so Edit mode changes appear in Play mode.",
  "Edit mode writes scene object transforms directly to main.scene.json. Play mode is the actual game runtime and must not expose editing controls.",
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

export function createManifest(title: string, engine: GameEngine = "babylonjs"): GameProjectManifest {
  const now = new Date().toISOString();
  const slug = slugify(title);
  return {
    id: slug,
    title,
    style: engine === "phaser" ? "2D" : "babylonjs",
    engine,
    editor: createDefaultEditorState(),
    logicGraph: createDefaultLogicGraph(now),
    createdAt: now,
    updatedAt: now,
    workspacePath: slug,
    runtimeEntry: "src/main.js",
    babylonEntry: engine === "babylonjs" ? "src/main.js" : undefined,
    phaserEntry: engine === "phaser" ? "src/main.js" : undefined,
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
        summary: `Generated ${engine === "phaser" ? "Phaser" : "Babylon.js"} scene, placeholder sprite pipeline, overlay scripts, and local build manifest.`,
      },
    ],
    assets: createStarterAssets(slug),
  };
}

export function createDefaultEditorState(): ProjectEditorState {
  return {
    applyMode: "preview",
    previewMode: "edit",
    playStartMode: "fresh",
    activeScenePath: "assets/scenes/main.scene.json",
    activeTool: "logic",
    tools: [
      toolState("character-2d", "2D Character", "needs-generation", "Chat-generated sprite sheets with emotion animation preview.", ["asset-lantern-idle"]),
      toolState("character-3d", "3D Character", "empty", "Chat-generated or imported Babylon.js character model preview.", []),
      toolState("world", "World", "needs-generation", "Scene, object placement, camera, and lighting direction.", ["asset-world"]),
      toolState("logic", "Logic", "ready", "Node graph projection of triggers, conditions, actions, state, dialogue, and endings.", ["asset-scene"]),
      toolState("ui-dialogue", "UI & Dialogue", "ready", "Dialogue tree, HUD, menus, prompts, and choice flow.", ["asset-scene"]),
      toolState("audio", "Audio", "empty", "Sound plan, music, ambience, event bindings, and volume groups.", []),
      toolState("publish", "Publish", "ready", "Validation, local build, export, and playable preview readiness.", []),
    ],
  };
}

export function createDefaultLogicGraph(updatedAt = new Date().toISOString()): LogicGraph {
  return {
    source: "code-derived",
    updatedAt,
    nodes: [
      {
        id: "node-start",
        kind: "trigger",
        title: "Start game",
        summary: "Initialize scene, player state, and opening objective.",
        codeRefs: ["src/main.js"],
        x: 40,
        y: 80,
      },
      {
        id: "node-choice",
        kind: "dialogue",
        title: "Story choice",
        summary: "Present two or three player decisions and update emotion/state.",
        codeRefs: ["src/main.js"],
        x: 260,
        y: 40,
      },
      {
        id: "node-state",
        kind: "state",
        title: "Update state",
        summary: "Track flags, inventory, score, or relationship changes.",
        codeRefs: ["src/main.js"],
        x: 260,
        y: 180,
      },
      {
        id: "node-ending",
        kind: "ending",
        title: "Resolve ending",
        summary: "Branch to the ending that matches accumulated state.",
        codeRefs: ["src/main.js"],
        x: 500,
        y: 110,
      },
    ],
    edges: [
      { id: "edge-start-choice", from: "node-start", to: "node-choice", label: "opens" },
      { id: "edge-choice-state", from: "node-choice", to: "node-state", label: "sets" },
      { id: "edge-state-ending", from: "node-state", to: "node-ending", label: "resolves" },
    ],
  };
}

function toolState(id: EditorToolId, title: string, status: ProjectEditorState["tools"][number]["status"], summary: string, assetRefs: string[]) {
  return { id, title, status, summary, assetRefs };
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
