// Campaign missions + tutorial definitions (texts are i18n keys).
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
}

export interface Objective {
  key: string;
  check: (c: MissionCtx) => boolean;
  /** Failing condition (optional): mission lost. */
  fail?: (c: MissionCtx) => boolean;
}

export interface Mission {
  id: string;
  mapId: string;
  config: (seed: number, name: string) => GameConfig;
  intro: string[]; // dialogue keys
  main: Objective;
  bonus: Objective;
  parTicks: number; // 2nd star when completed faster
  outro: string;
}

const share = (c: MissionCtx) => {
  const me = c.players.find((p) => p.id === c.me);
  return me ? me.usefulTiles / Math.max(1, c.usefulLand) : 0;
};
const alive = (c: MissionCtx) => c.local?.alive ?? true;

function base(seed: number, name: string, mapId: string, patch: Partial<GameConfig>): GameConfig {
  const cfg = defaultConfig(seed);
  return {
    ...cfg,
    mapId,
    players: [{ slot: 0, name, kind: 'human', team: 0, general: 'blitz' }],
    spawnSeconds: 20,
    ...patch,
    mode: patch.mode ?? 'campaign',
  };
}

export const MISSIONS: Mission[] = [
  {
    id: 'm1',
    mapId: 'two-lakes',
    config: (s, n) => base(s, n, 'two-lakes', { nations: 3, tribes: 24, difficulty: 'easy' }),
    intro: ['campaign.m1.d1', 'campaign.m1.d2'],
    main: { key: 'campaign.m1.main', check: (c) => share(c) >= 0.15, fail: (c) => !alive(c) },
    bonus: { key: 'campaign.m1.bonus', check: (c) => (c.local?.buildingCount[0] ?? 0) >= 2 },
    parTicks: 4800,
    outro: 'campaign.m1.outro',
  },
  {
    id: 'm2',
    mapId: 'europe',
    config: (s, n) => base(s, n, 'europe', { nations: 30, tribes: 10, difficulty: 'hard' }),
    intro: ['campaign.m2.d1', 'campaign.m2.d2'],
    main: { key: 'campaign.m2.main', check: (c) => c.tick >= 6000 && alive(c), fail: (c) => !alive(c) },
    bonus: { key: 'campaign.m2.bonus', check: (c) => (c.local?.buildingCount[3] ?? 0) >= 3 },
    parTicks: 6000,
    outro: 'campaign.m2.outro',
  },
  {
    id: 'm3',
    mapId: 'archipelago',
    config: (s, n) => base(s, n, 'archipelago', { nations: 12, tribes: 20, difficulty: 'normal' }),
    intro: ['campaign.m3.d1', 'campaign.m3.d2'],
    main: {
      key: 'campaign.m3.main',
      check: (c) => (c.memory.eliminated ?? 0) >= 1,
      fail: (c) => !alive(c),
    },
    bonus: { key: 'campaign.m3.bonus', check: (c) => (c.local?.stats.shipsSunk ?? 0) >= 2 },
    parTicks: 9000,
    outro: 'campaign.m3.outro',
  },
  {
    id: 'm4',
    mapId: 'pangaea',
    config: (s, n) => base(s, n, 'pangaea', { nations: 16, tribes: 30, difficulty: 'normal' }),
    intro: ['campaign.m4.d1', 'campaign.m4.d2'],
    main: {
      key: 'campaign.m4.main',
      check: (c) => (c.local ? c.local.stats.trainGold + c.local.stats.tradeGold : 0) >= 3_000_000,
      fail: (c) => !alive(c),
    },
    bonus: { key: 'campaign.m4.bonus', check: (c) => (c.local?.buildingCount[2] ?? 0) >= 3 },
    parTicks: 12000,
    outro: 'campaign.m4.outro',
  },
  {
    id: 'm5',
    mapId: 'mediterranean',
    config: (s, n) =>
      base(s, n, 'mediterranean', { nations: 20, tribes: 10, difficulty: 'normal', goldMultiplier: 1.5 }),
    intro: ['campaign.m5.d1', 'campaign.m5.d2'],
    main: { key: 'campaign.m5.main', check: (c) => (c.memory.hbomb ?? 0) >= 1, fail: (c) => !alive(c) },
    bonus: { key: 'campaign.m5.bonus', check: (c) => (c.local?.stats.nukesIntercepted ?? 0) >= 1 },
    parTicks: 15000,
    outro: 'campaign.m5.outro',
  },
  {
    id: 'm6',
    mapId: 'world',
    config: (s, n) => base(s, n, 'world', { nations: 40, tribes: 40, difficulty: 'hard', mode: 'doomsday' }),
    intro: ['campaign.m6.d1', 'campaign.m6.d2'],
    main: { key: 'campaign.m6.main', check: (c) => share(c) >= 0.4, fail: (c) => !alive(c) },
    bonus: { key: 'campaign.m6.bonus', check: (c) => share(c) >= 0.4 && c.tick < 18000 },
    parTicks: 18000,
    outro: 'campaign.m6.outro',
  },
];

/** Interactive tutorial (~5 minutes): sequential steps with detection. */
export interface TutorialStep {
  key: string;
  done: (c: MissionCtx) => boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  { key: 'tutorial.spawn', done: (c) => (c.players.find((p) => p.id === c.me)?.tiles ?? 0) > 0 },
  { key: 'tutorial.camera', done: (c) => (c.memory.cameraMoved ?? 0) > 0 },
  { key: 'tutorial.expand', done: (c) => (c.players.find((p) => p.id === c.me)?.tiles ?? 0) > 1200 },
  { key: 'tutorial.ratio', done: (c) => (c.memory.ratioChanged ?? 0) > 0 },
  { key: 'tutorial.city', done: (c) => (c.local?.buildingCount[0] ?? 0) >= 1 },
  { key: 'tutorial.attack', done: (c) => (c.local?.stats.enemiesKilled ?? 0) > 500 },
  { key: 'tutorial.port', done: (c) => (c.local?.buildingCount[1] ?? 0) >= 1 },
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
    spawnSeconds: 60,
    features: { ...defaultConfig(seed).features, events: false, council: false, weather: false },
  });
}
