import { gameCreationTemplates } from "../data/game-templates";
import type { AgentPhase, GameEngine } from "../types/project-types";

export const phaseLabels: Record<AgentPhase, string> = {
  idle: "Idle",
  planning: "Planning",
  generating_assets: "Sprites",
  generating_world: "World",
  writing_code: "Code",
  building: "Build",
  ready: "Ready",
  error: "Error",
};

export const supportedStyles = ["2D", "HD2D", "3D"];
export const supportedEngines: GameEngine[] = ["babylonjs", "phaser"];
export const supportedGameTypes = Array.from(new Set(gameCreationTemplates.map((template) => template.type)));

export const randomGameIdeas = [
  {
    title: "Rainy Neon Courier",
    prompt: "Create a neon city delivery game where a scooter courier dodges drones, upgrades routes, and uncovers a mystery package network.",
  },
  {
    title: "Mushroom Kingdom Cafe",
    prompt: "Create a cozy fantasy cafe builder where mushroom villagers request recipes, decorate rooms, and unlock forest festivals.",
  },
  {
    title: "Clocktower Spell School",
    prompt: "Create a magical academy RPG where students bend time in puzzle rooms, duel rivals, and repair a broken clocktower.",
  },
  {
    title: "Sky Whale Rescue",
    prompt: "Create an airborne exploration game where pilots rescue sky whales, gather storm crystals, and upgrade a floating base.",
  },
  {
    title: "Dungeon Gardening Club",
    prompt: "Create a dungeon gardening roguelike where players plant traps, grow monster allies, and survive adventurer waves.",
  },
  {
    title: "Tiny Mech Postal Service",
    prompt: "Create a miniature mech delivery game where players cross oversized kitchens, repair routes, and upgrade stamp-powered gadgets.",
  },
  {
    title: "Ghost Museum Night Shift",
    prompt: "Create a spooky comedy adventure where a night guard interviews ghosts, rearranges cursed exhibits, and solves old mysteries.",
  },
  {
    title: "Solarpunk Train Village",
    prompt: "Create a solarpunk life sim on a moving train where players grow gardens, befriend passengers, and choose new rail destinations.",
  },
  {
    title: "Bubble Mage Aquarium",
    prompt: "Create an underwater spellcasting puzzle game where a bubble mage redirects currents, rescues sea creatures, and restores coral gates.",
  },
  {
    title: "Paper Dragon Tactics",
    prompt: "Create a paper-craft tactics game where foldable dragons change shapes, capture wind shrines, and combo terrain effects.",
  },
  {
    title: "Midnight Snack Heist",
    prompt: "Create a stealth comedy game where tiny kitchen creatures steal snacks, avoid sleepy humans, and build a secret pantry base.",
  },
  {
    title: "Crystal Radio Rangers",
    prompt: "Create an exploration RPG where rangers tune crystal radios to reveal hidden paths, recruit signal spirits, and stop a static storm.",
  },
  {
    title: "Cloud Orchard Keeper",
    prompt: "Create a sky-farming game where players grow floating fruit trees, tame weather, and trade harvests with airship towns.",
  },
  {
    title: "Robot Theater Troupe",
    prompt: "Create a narrative management game where robot actors rehearse plays, improvise dialogue, and win over different audience factions.",
  },
  {
    title: "Library of Living Maps",
    prompt: "Create a mystery adventure where players explore animated maps, rewrite landmarks, and chase a cartographer who vanished between pages.",
  },
  {
    title: "Frog Knight Tournament",
    prompt: "Create a whimsical action RPG where frog knights joust on lily pads, collect pond relics, and defend a rainy kingdom.",
  },
  {
    title: "Asteroid Bakery League",
    prompt: "Create a resource-management game where bakers mine asteroid flour, dodge meteor storms, and compete in zero-gravity pastry contests.",
  },
  {
    title: "Dream Elevator Bureau",
    prompt: "Create a surreal puzzle adventure where players operate an elevator between dreams, resolve strange requests, and repair broken memories.",
  },
  {
    title: "Lantern Bug Expedition",
    prompt: "Create a tiny exploration game where glowing beetle scouts map a giant backyard, solve dew puzzles, and protect their lantern queen.",
  },
  {
    title: "Volcano Spa Resort",
    prompt: "Create a cozy management game where players run a spa on a sleepy volcano, calm lava spirits, and craft mineral treatments.",
  },
];
