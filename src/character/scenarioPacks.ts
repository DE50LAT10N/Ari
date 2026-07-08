import type { Scenario } from "./scenarioEngine";
import type { PresenceScene } from "./presence";
import type { CharacterEmotion } from "../types/character";
import { pickDeterministic } from "./deterministicSelector";

export type ScenarioPackReaction = {
  emotion: CharacterEmotion;
  overlay?: string;
  line: string;
};

export type ScenarioPackEntry = {
  trigger: {
    scenario: Scenario;
    scene?: PresenceScene[];
    hour?: [number, number];
    focusSessionActive?: boolean;
  };
  reaction: ScenarioPackReaction;
  cooldownMinutes: number;
};

export type ScenarioPack = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scenarios: ScenarioPackEntry[];
};

const PACKS_KEY = "desktop-character.scenario-packs.v1";
const COOLDOWN_KEY = "desktop-character.scenario-pack-cooldowns.v1";

import defaultPack from "./defaultPacks/default.json";
import quietWorkPack from "./defaultPacks/quiet-work.json";
import nightOwlPack from "./defaultPacks/night-owl.json";

const bundledPacks: ScenarioPack[] = [
  defaultPack as ScenarioPack,
  quietWorkPack as ScenarioPack,
  nightOwlPack as ScenarioPack,
];

function loadPackOverrides(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PACKS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function savePackOverrides(overrides: Record<string, boolean>): void {
  localStorage.setItem(PACKS_KEY, JSON.stringify(overrides));
}

function loadCooldowns(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COOLDOWN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveCooldown(key: string): void {
  localStorage.setItem(
    COOLDOWN_KEY,
    JSON.stringify({ ...loadCooldowns(), [key]: Date.now() }),
  );
}

export function loadScenarioPacks(): ScenarioPack[] {
  const overrides = loadPackOverrides();
  return bundledPacks.map((pack) => ({
    ...pack,
    enabled: overrides[pack.id] ?? pack.enabled,
  }));
}

export function setScenarioPackEnabled(id: string, enabled: boolean): void {
  const overrides = loadPackOverrides();
  overrides[id] = enabled;
  savePackOverrides(overrides);
}

export function loadActivePacks(): ScenarioPack[] {
  return loadScenarioPacks().filter((pack) => pack.enabled);
}

export type PackReactionContext = {
  scenario: Scenario;
  scene: PresenceScene;
  hour: number;
  focusSessionActive: boolean;
};

function matchesHourRange(hour: number, range: [number, number]): boolean {
  const [start, end] = range;
  if (start <= end) {
    return hour >= start && hour <= end;
  }
  return hour >= start || hour <= end;
}

export function pickPackReaction(
  ctx: PackReactionContext,
): ScenarioPackReaction | null {
  const cooldowns = loadCooldowns();
  const now = Date.now();
  const matched: { key: string; reaction: ScenarioPackReaction }[] = [];

  for (const pack of loadActivePacks()) {
    for (const entry of pack.scenarios) {
      if (entry.trigger.scenario !== ctx.scenario) continue;
      if (
        entry.trigger.scene &&
        !entry.trigger.scene.includes(ctx.scene)
      ) {
        continue;
      }
      if (entry.trigger.focusSessionActive && !ctx.focusSessionActive) {
        continue;
      }
      if (entry.trigger.hour && !matchesHourRange(ctx.hour, entry.trigger.hour)) {
        continue;
      }

      const key = `${pack.id}:${entry.trigger.scenario}:${entry.reaction.line.slice(0, 24)}`;
      const last = cooldowns[key] ?? 0;
      if (now - last < entry.cooldownMinutes * 60_000) continue;

      matched.push({ key, reaction: entry.reaction });
    }
  }

  if (!matched.length) {
    return null;
  }

  const picked = pickDeterministic(
    `scenario-pack:${ctx.scenario}:${ctx.scene}:${ctx.focusSessionActive}`,
    matched,
  );
  if (!picked) {
    return null;
  }
  saveCooldown(picked.key);
  return picked.reaction;
}
