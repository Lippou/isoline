// Campaign missions + tutorial: objectives with progress meters, and a step-by-step
// guide (each step stays on screen until it is accomplished). Texts are i18n keys.
import { defaultConfig, type GameConfig } from '../../core/game/config';
import type { LocalView, PlayerView, WorldView } from '../../engine/protocol';
import type { GameEvent } from '../../core/game/events';

export interface MissionCtx {
  tick: number; // ticks since game start (after spawn)
  local: LocalView | null;
  players: PlayerView[];
  world: WorldView | null;
  me: number;
  events: GameEvent[];
  memory: Record<string, number>;
  usefulLand: number;
  phase: string;
}

export interface Progress {
  value: number;
  max: number;
  format: 'pct' | 'count' | 'gold' | 'time';
}

export interface Objective {
  key: string;
  check: (c: MissionCtx) => boolean;
  /** Failing condition (optional): mission lost. */
  fail?: (c: MissionCtx) => boolean;
  progress?: (c: MissionCtx) => Progress;
}

export interface GuideStep {
  key: string;
  done: (c: MissionCtx) => boolean;
  /** Optional map marker (tile coordinates) pointing at what matters for this step. */
  marker?: (c: MissionCtx) => [number, number] | null;
}

export interface Mission {
  id: string;
  mapId: string;
  config: (seed: number, name: string) => GameConfig;
  main: Objective;
  bonus: Objective;
  guide: GuideStep[];
  parTicks: number; // 2nd star when completed faster
  outro: string;
}

const meView = (c: MissionCtx) => c.players.find((p) => p.id === c.me);
const share = (c: MissionCtx) => {
  const me = meView(c);
  return me ? me.usefulTiles / Math.max(1, c.usefulLand) : 0;
};
const alive = (c: MissionCtx) => c.local?.alive ?? true;
const placed = (c: MissionCtx) => (meView(c)?.tiles ?? 0) > 0;
const built = (c: MissionCtx, type: number) => c.local?.buildingCount[type] ?? 0;
const pct = (c: MissionCtx, max: number): Progress => ({
  value: share(c) * 100,
  max: max * 100,
  format: 'pct',
});
/** Weakest living rival nation (target suggestion). */
function weakest(c: MissionCtx): [number, number] | null {
  const rivals = c.players.filter((p) => p.kind === 'nation' && p.alive && p.tiles > 0 && p.id !== c.me);
  rivals.sort((a, b) => a.troops - b.troops);
  const r = rivals[0];
  return r ? [r.label[0], r.label[1]] : null;
}

function base(seed: number, name: string, mapId: string, patch: Partial<GameConfig>): GameConfig {
  const cfg = defaultConfig(seed);
  return {
    ...cfg,
    mapId,
    players: [{ slot: 0, name, kind: 'human', team: 0, general: 'blitz' }],
    spawnSeconds: 90,
    ...patch,
    mode: patch.mode ?? 'campaign',
  };
}

const SPAWN: GuideStep = { key: 'guide.spawn', done: placed };

export const MISSIONS: Mission[] = [
  {
    id: 'm1',
    mapId: 'two-lakes',
    config: (s, n) => base(s, n, 'two-lakes', { nations: 3, tribes: 24, difficulty: 'easy' }),
    main: {
      key: 'campaign.m1.main',
      check: (c) => share(c) >= 0.15,
      fail: (c) => !alive(c),
      progress: (c) => pct(c, 0.15),
    },
    bonus: {
      key: 'campaign.m1.bonus',
      check: (c) => built(c, 0) >= 2,
      progress: (c) => ({ value: built(c, 0), max: 2, format: 'count' }),
    },
    guide: [
      SPAWN,
      { key: 'guide.m1.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m1.city', done: (c) => built(c, 0) >= 1 },
      { key: 'guide.m1.tribes', done: (c) => (c.memory.loot ?? 0) > 0 },
      { key: 'guide.m1.goal', done: () => false },
    ],
    parTicks: 9000,
    outro: 'campaign.m1.outro',
  },
  {
    id: 'm2',
    mapId: 'europe',
    config: (s, n) => base(s, n, 'europe', { nations: 30, tribes: 10, difficulty: 'hard' }),
    main: {
      key: 'campaign.m2.main',
      check: (c) => c.tick >= 12000 && alive(c),
      fail: (c) => !alive(c),
      progress: (c) => ({ value: c.tick / 10, max: 1200, format: 'time' }),
    },
    bonus: {
      key: 'campaign.m2.bonus',
      check: (c) => built(c, 3) >= 3,
      progress: (c) => ({ value: built(c, 3), max: 3, format: 'count' }),
    },
    guide: [
      { key: 'guide.m2.spawn', done: placed },
      { key: 'guide.m2.expand', done: (c) => share(c) >= 0.015 },
      { key: 'guide.m2.defense', done: (c) => built(c, 3) >= 1 },
      { key: 'guide.m2.troops', done: (c) => (c.local?.troopRatio ?? 0) >= 0.5 },
      { key: 'guide.m2.alliance', done: (c) => (c.local?.allies.length ?? 0) >= 1 },
      { key: 'guide.m2.hold', done: () => false },
    ],
    parTicks: 12000,
    outro: 'campaign.m2.outro',
  },
  {
    id: 'm3',
    mapId: 'archipelago',
    config: (s, n) => base(s, n, 'archipelago', { nations: 12, tribes: 20, difficulty: 'normal' }),
    main: {
      key: 'campaign.m3.main',
      check: (c) => (c.memory.eliminated ?? 0) >= 1,
      fail: (c) => !alive(c),
      progress: (c) => ({ value: c.memory.eliminated ?? 0, max: 1, format: 'count' }),
    },
    bonus: {
      key: 'campaign.m3.bonus',
      check: (c) => (c.local?.stats.shipsSunk ?? 0) >= 2,
      progress: (c) => ({ value: c.local?.stats.shipsSunk ?? 0, max: 2, format: 'count' }),
    },
    guide: [
      SPAWN,
      { key: 'guide.m3.island', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m3.port', done: (c) => built(c, 1) >= 1 },
      { key: 'guide.m3.landing', done: (c) => (c.memory.landing ?? 0) > 0, marker: weakest },
      { key: 'guide.m3.finish', done: () => false, marker: weakest },
    ],
    parTicks: 15000,
    outro: 'campaign.m3.outro',
  },
  {
    id: 'm4',
    mapId: 'pangaea',
    config: (s, n) => base(s, n, 'pangaea', { nations: 16, tribes: 30, difficulty: 'normal' }),
    main: {
      key: 'campaign.m4.main',
      check: (c) => (c.local ? c.local.stats.trainGold + c.local.stats.tradeGold : 0) >= 3_000_000,
      fail: (c) => !alive(c),
      progress: (c) => ({
        value: c.local ? c.local.stats.trainGold + c.local.stats.tradeGold : 0,
        max: 3_000_000,
        format: 'gold',
      }),
    },
    bonus: {
      key: 'campaign.m4.bonus',
      check: (c) => built(c, 2) >= 3,
      progress: (c) => ({ value: built(c, 2), max: 3, format: 'count' }),
    },
    guide: [
      SPAWN,
      { key: 'guide.m4.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m4.cities', done: (c) => built(c, 0) >= 2 },
      { key: 'guide.m4.factory', done: (c) => built(c, 2) >= 1 },
      { key: 'guide.m4.port', done: (c) => built(c, 1) >= 1 },
      { key: 'guide.m4.wait', done: () => false },
    ],
    parTicks: 18000,
    outro: 'campaign.m4.outro',
  },
  {
    id: 'm5',
    mapId: 'mediterranean',
    config: (s, n) =>
      base(s, n, 'mediterranean', { nations: 20, tribes: 10, difficulty: 'normal', goldMultiplier: 1.5 }),
    main: {
      key: 'campaign.m5.main',
      check: (c) => (c.memory.hbomb ?? 0) >= 1,
      fail: (c) => !alive(c),
      progress: (c) => ({ value: Math.min(c.local?.gold ?? 0, 5_000_000), max: 5_000_000, format: 'gold' }),
    },
    bonus: {
      key: 'campaign.m5.bonus',
      check: (c) => (c.local?.stats.nukesIntercepted ?? 0) >= 1,
      progress: (c) => ({ value: c.local?.stats.nukesIntercepted ?? 0, max: 1, format: 'count' }),
    },
    guide: [
      SPAWN,
      { key: 'guide.m5.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m5.city', done: (c) => built(c, 0) >= 2 },
      { key: 'guide.m5.silo', done: (c) => built(c, 4) >= 1 },
      { key: 'guide.m5.save', done: (c) => (c.local?.gold ?? 0) >= 5_000_000 },
      { key: 'guide.m5.launch', done: () => false, marker: weakest },
    ],
    parTicks: 21000,
    outro: 'campaign.m5.outro',
  },
  {
    id: 'm6',
    mapId: 'world',
    config: (s, n) => base(s, n, 'world', { nations: 40, tribes: 40, difficulty: 'hard', mode: 'doomsday' }),
    main: {
      key: 'campaign.m6.main',
      check: (c) => share(c) >= 0.4,
      fail: (c) => !alive(c),
      progress: (c) => pct(c, 0.4),
    },
    bonus: {
      key: 'campaign.m6.bonus',
      check: (c) => share(c) >= 0.4 && c.tick < 27000,
      progress: (c) => ({ value: c.tick / 10, max: 2700, format: 'time' }),
    },
    guide: [
      SPAWN,
      { key: 'guide.m6.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m6.economy', done: (c) => built(c, 0) >= 3 },
      { key: 'guide.m6.clock', done: (c) => c.tick >= 6000 },
      { key: 'guide.m6.push', done: () => false, marker: weakest },
    ],
    parTicks: 27000,
    outro: 'campaign.m6.outro',
  },
];

/** Interactive tutorial (~6 minutes): the same guide, with no other objective. */
export const TUTORIAL_STEPS: GuideStep[] = [
  { key: 'tutorial.spawn', done: placed },
  { key: 'tutorial.camera', done: (c) => (c.memory.cameraMoved ?? 0) > 0 },
  { key: 'tutorial.expand', done: (c) => (meView(c)?.tiles ?? 0) > 1200 },
  { key: 'tutorial.ratio', done: (c) => (c.memory.ratioChanged ?? 0) > 0 },
  { key: 'tutorial.city', done: (c) => built(c, 0) >= 1 },
  {
    key: 'tutorial.attack',
    done: (c) => (c.memory.loot ?? 0) > 0 || (c.local?.stats.enemiesKilled ?? 0) > 500,
  },
  { key: 'tutorial.port', done: (c) => built(c, 1) >= 1 },
  { key: 'tutorial.alliance', done: (c) => (c.local?.allies.length ?? 0) >= 1 },
  {
    key: 'tutorial.tech',
    done: (c) => (c.local?.researching ?? -1) >= 0 || (c.local?.tech.some((x) => x > 0) ?? false),
  },
  { key: 'tutorial.done', done: () => false },
];

export function tutorialConfig(seed: number, name: string): GameConfig {
  return base(seed, name, 'black-sea', {
    nations: 2,
    tribes: 8,
    difficulty: 'easy',
    spawnSeconds: 120,
    features: { ...defaultConfig(seed).features, events: false, council: false, weather: false },
  });
}
