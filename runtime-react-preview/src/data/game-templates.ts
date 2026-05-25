export type GameCreationTemplate = {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: string;
  style: "2D" | "HD2D" | "3D";
  prompt: string;
};

export const gameCreationTemplates: GameCreationTemplate[] = [
  {
    id: "hd2d-story-rpg",
    title: "HD2D Story RPG",
    description: "Roleplay, dialogue, draggable 3D objects, and memory-driven scene interactions.",
    icon: "SR",
    type: "Top down RPG",
    style: "HD2D",
    prompt: `Create a story-driven HD2D RPG scene where a young lantern keeper arrives in a forgotten village whose memories are trapped inside enchanted objects.

Focus on roleplay, dialogue, and scene interaction. Build a small 3D village square with 2D sprite-sheet characters as billboard actors, cinematic lighting, soft depth-of-field, and a cozy mystery atmosphere.

The scene should include:
- A playable lantern keeper character.
- Three NPCs with distinct personalities, secrets, emotional states, and branching dialogue.
- A 3D village environment with generated objects such as a cracked moon statue, sealed bridge gate, old well, memory lanterns, shrine table, and villager keepsakes.
- Several draggable 3D objects, such as a moon shard, old key, flower charm, broken mask, and sealed letter.

Gameplay:
- The player can walk around, talk to NPCs, inspect objects, and drag/drop 3D objects onto characters or scene targets.
- Dropping an object on a character should trigger a story interaction, dialogue response, emotional sprite change, or memory reveal.
- Some objects should unlock new dialogue choices or change the environment.
- The player's goal is to discover which object belongs to which villager, restore their memories, and open the sealed bridge.

Make it feel like a playable vertical slice of a narrative RPG, not a tech demo. Include clear player feedback, interaction prompts, dialogue UI, inventory/object holding, object-to-character reactions, and a short story arc with a beginning, discovery, and resolution.`,
  },
  {
    id: "hd2d-exploration-rpg",
    title: "Exploration RPG",
    description: "NPC clues, collectible relics, gates, and a compact world mystery.",
    icon: "ER",
    type: "Top down RPG",
    style: "HD2D",
    prompt: `Create an HD2D exploration RPG vertical slice with a compact 3D world, 2D sprite-sheet characters, NPC clues, collectibles, and a gated route that unlocks through story discovery.

The player should explore a readable area with landmarks, talk to NPCs, collect meaningful objects, and use those discoveries to unlock a new path. Include a beginning objective, mid-scene discovery, and clear resolution.`,
  },
  {
    id: "hd2d-puzzle-adventure",
    title: "Puzzle Adventure",
    description: "Object manipulation, spatial puzzles, NPC hints, and environmental changes.",
    icon: "PA",
    type: "Top down RPG",
    style: "HD2D",
    prompt: `Create an HD2D puzzle adventure scene with a 3D environment, 2D sprite-sheet characters, draggable objects, puzzle targets, and NPC hints.

The player should inspect objects, move or drop items onto scene targets, trigger environmental changes, and solve a compact puzzle chain that reveals a story moment.`,
  },
  {
    id: "platformer-relic-run",
    title: "Relic Platformer",
    description: "Jumping, hazards, checkpoints, collectible relics, and a short level arc.",
    icon: "PF",
    type: "Platformer",
    style: "2D",
    prompt: `Create a polished 2D platformer level with a clear character verb, hazards, collectibles, checkpoints, and a small story premise.

The level should teach movement, introduce one challenge twist, reward exploration, and end with a clear goal or escape sequence.`,
  },
  {
    id: "isometric-strategy-outpost",
    title: "Isometric Strategy",
    description: "Small tactical map, units, resources, objectives, and strategic choices.",
    icon: "IS",
    type: "Isometric strategy",
    style: "HD2D",
    prompt: `Create an isometric strategy prototype with a small 3D tactical map, readable units, resource points, and one objective that requires positioning and timing.

Include a simple turn or command loop, enemy pressure, clear feedback, and a win condition based on smart use of the map.`,
  },
  {
    id: "first-person-mystery",
    title: "First Person Mystery",
    description: "Exploration, interactable props, clues, locked doors, and atmospheric discovery.",
    icon: "FP",
    type: "First person shooter",
    style: "3D",
    prompt: `Create a first-person mystery exploration prototype with a compact 3D environment, interactable props, clues, locked routes, and a clear objective.

The player should move through the space, inspect objects, uncover clues, and use discoveries to unlock the next area. Prioritize atmosphere and interaction over combat.`,
  },
];

export function buildPromptFromTemplate(templateId: string, userMessage: string) {
  const template = gameCreationTemplates.find((item) => item.id === templateId) ?? gameCreationTemplates[0];
  const customization = userMessage.trim();
  return [
    `Template: ${template.title}`,
    `Game type: ${template.type}`,
    `Style: ${template.style}`,
    "",
    template.prompt.trim(),
    customization ? ["", "User customization:", customization].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function templateSupportsPhaser(templateId: string) {
  const template = gameCreationTemplates.find((item) => item.id === templateId) ?? gameCreationTemplates[0];
  return template?.style === "2D";
}
