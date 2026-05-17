import type { GameCategory, GenerationMode, RuntimeProject } from "../types/project-types";

const projectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entry", "files", "assets"],
  properties: {
    entry: {
      type: "string",
      description: "Absolute virtual path to the entry React component, usually /src/App.tsx.",
    },
    files: {
      type: "array",
      description: "Virtual source files.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "Absolute virtual source path such as /src/App.tsx.",
          },
          content: {
            type: "string",
            description: "Complete source text for the file.",
          },
        },
      },
    },
    assets: {
      type: "array",
      description: "Virtual assets. Use an empty array if there are no assets.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "mime", "data"],
        properties: {
          path: {
            type: "string",
            description: "Absolute virtual asset path such as /assets/player.png.",
          },
          mime: { type: "string" },
          data: { type: "string" },
        },
      },
    },
  },
};

type GenerateProjectArgs = {
  apiKey: string;
  model: string;
  prompt: string;
  category: GameCategory;
  mode: GenerationMode;
  currentProject?: RuntimeProject;
};

type LLMProjectResponse = {
  entry: string;
  files: Array<{ path: string; content: string }>;
  assets: Array<{ path: string; mime: string; data: string }>;
};

const engineReference = [
  'Import Phaser helpers from "@runtime/phaser-2d".',
  "Available exports: PhaserGame, createArcadeScene, Phaser.",
  "PhaserGame props: width, height, backgroundColor, scene, config, className.",
  "createArcadeScene accepts { preload(scene, Phaser), create(scene, Phaser), update(scene, time, delta, Phaser) }.",
  "Use Phaser scene APIs for display objects, input, arcade physics, text, tweens, timers, and collisions.",
  'A valid entry usually imports: import { PhaserGame, createArcadeScene } from "@runtime/phaser-2d";',
].join("\n");

export async function generateProjectWithOpenAIKey(args: GenerateProjectArgs): Promise<RuntimeProject> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      input: [
        {
          role: "system",
          content: [
            "You generate small offline 2D games for an AI-native browser game engine.",
            "Return only JSON matching the schema.",
            "The project runs in a virtual filesystem bundled by esbuild-wasm.",
            "Use absolute paths like /src/App.tsx and /src/scenes/Level.ts.",
            "The entry file must default-export a React component.",
            "React is available as a global named React, so code may use React.useMemo/useState without importing React.",
            "Do not import npm packages other than react, react-dom, react-dom/client, phaser, or @runtime/phaser-2d.",
            "Do not use browser APIs that require permissions, network, backend services, storage, or Node.js.",
            "Make a complete playable 2D game with clear controls, score/state, and win/lose or progression.",
            "Use Phaser through PhaserGame/createArcadeScene and keep generated code compact and readable.",
            engineReference,
          ].join("\n"),
        },
        {
          role: "user",
          content: buildUserPrompt(args),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "runtime_project",
          strict: true,
          schema: projectSchema,
        },
      },
    }),
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI API request failed.");
  }

  const outputText = extractOutputText(payload);
  if (!outputText) {
    throw new Error("OpenAI response did not include JSON text.");
  }

  return validateRuntimeProject(normalizeProject(JSON.parse(outputText)));
}

function buildUserPrompt(args: GenerateProjectArgs) {
  const lines = [
    `Mode: ${args.mode === "create" ? "Create a new game." : "Modify the current game and return the full updated project."}`,
    `2D category: ${args.category}.`,
    `User request: ${args.prompt}`,
  ];

  if (args.mode === "modify" && args.currentProject) {
    lines.push("Current project JSON:");
    lines.push(JSON.stringify(args.currentProject, null, 2));
  }

  return lines.join("\n\n");
}

function validateRuntimeProject(project: unknown): RuntimeProject {
  if (!project || typeof project !== "object") {
    throw new Error("LLM response did not include a project object.");
  }

  const candidate = project as RuntimeProject;

  if (typeof candidate.entry !== "string" || !candidate.entry.startsWith("/")) {
    throw new Error("LLM project entry must be an absolute virtual path.");
  }

  if (!candidate.files || typeof candidate.files !== "object") {
    throw new Error("LLM project must include a files object.");
  }

  if (typeof candidate.files[candidate.entry] !== "string") {
    throw new Error(`LLM project is missing entry file ${candidate.entry}.`);
  }

  return {
    entry: candidate.entry,
    files: candidate.files,
    assets: candidate.assets && typeof candidate.assets === "object" ? candidate.assets : {},
  };
}

function normalizeProject(project: LLMProjectResponse): RuntimeProject {
  return {
    entry: project.entry,
    files: Object.fromEntries(project.files.map((file) => [file.path, file.content])),
    assets: Object.fromEntries(
      project.assets.map((asset) => [
        asset.path,
        {
          mime: asset.mime,
          data: asset.data,
        },
      ]),
    ),
  };
}

function extractOutputText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return "";
}
