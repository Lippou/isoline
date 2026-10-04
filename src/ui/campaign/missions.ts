// Campaign missions — the campaign is also the game's tutorial. Each mission has its
// required objectives (all of them must be reached; once reached, an objective stays
// reached), a bonus objective, a step-by-step guide (each step stays on screen until it
// is accomplished; a step asking to build something waits until it can be afforded) and
// contextual hints shared by every mission (capital lost, threatened border, alliance
// offer…). Everything here is pure: functions of a MissionCtx (the client's views plus
// what the director remembered), so it is unit-tested. Texts are i18n keys.
import { defaultConfig, type GameConfig } from '../../core/game/config';
import type { LocalView, PlayerView, WorldView } from '../../engine/protocol';
import type { GameEvent } from '../../core/game/events';
import { B, MAX_TRANSPORTS, N } from '../../core/game/constants';
import { UNLOCK_NODE, isResearched, techId } from '../../core/rules/tech';
import { researchIdle } from '../hud/research';
import type { MissionResult } from '../game/missionResult';

export interface MissionCtx {
  /** Ticks since the start of play (0 during the spawn phase). */
  tick: number;
  local: LocalView | null;
  players: PlayerView[];
  world: WorldView | null;
  me: number;
  /** Events of this tick. */
  events: GameEvent[];
  /** What the director remembers between ticks (see observe()). */
  memory: Record<string, number>;
  usefulLand: number;
  phase: string;
  /** My warships afloat. */
  warships: number;
}

export interface Progress {
  value: number;
  max: number;
  format: 'pct' | 'count' | 'gold' | 'time';
}

export interface Objective {
  key: string;
  check: (c: MissionCtx) => boolean;
  progress?: (c: MissionCtx) => Progress;
}

export interface GuideStep {
  key: string;
  done: (c: MissionCtx) => boolean;
  /** Optional map marker (tile coordinates) pointing at what matters for this step. */
  marker?: (c: MissionCtx) => [number, number] | null;
  /**
   * Gold the step asks to spend (a building, a warship, a bomb). While the treasury falls
   * short, the guide shows how much is missing and for how long instead of the order.
   */
  cost?: (c: MissionCtx) => number;
}

/** Contextual advice: shown once per mission, the first time its situation arises. */
export interface Hint {
  key: string;
  when: (c: MissionCtx) => boolean;
}

export interface Mission {
  id: string;
  mapId: string;
  config: (seed: number, name: string) => GameConfig;
  /** Required objectives: the mission is won once every one of them has been reached. */
  objectives: Objective[];
  bonus: Objective;
  guide: GuideStep[];
  parTicks: number; // 2nd star when completed faster
  outro: string;
}

// ------------------------------------------------------------------ helpers
const meView = (c: MissionCtx) => c.players.find((p) => p.id === c.me);
export const share = (c: MissionCtx): number => {
  const me = meView(c);
  return me ? me.usefulTiles / Math.max(1, c.usefulLand) : 0;
};
const alive = (c: MissionCtx) => c.local?.alive ?? true;
const placed = (c: MissionCtx) => (meView(c)?.tiles ?? 0) > 0;
/**
 * How many buildings of a type I own, counted in levels: building on one of your own
 * buildings stacks it (an upgrade), so a city stacked to level 2 counts as two cities.
 */
const built = (c: MissionCtx, type: number) =>
  c.local?.buildingLevels?.[type] ?? c.local?.buildingCount[type] ?? 0;
const buildCost = (type: number) => (c: MissionCtx) => c.local?.buildCosts[type] ?? 0;
const mem = (c: MissionCtx, k: string) => c.memory[k] ?? 0;
/** Ticks the current guide step has been on screen. */
const shownFor = (c: MissionCtx) => c.tick - mem(c, 'stepAt');
/** An explanation step: it moves on after being shown for `ticks`. */
const read = (ticks: number) => (c: MissionCtx) => shownFor(c) >= ticks;
const pct = (c: MissionCtx, max: number): Progress => ({
  value: share(c) * 100,
  max: max * 100,
  format: 'pct',
});
const count = (value: number, max: number): Progress => ({ value, max, format: 'count' });
/** A technology is under study, queued or already researched. */
const studying = (c: MissionCtx, id: number) =>
  !!c.local &&
  (c.local.researching === id || c.local.researchQueue.includes(id) || isResearched(c.local.tech, id));
const researched = (c: MissionCtx, id: number) => !!c.local && isResearched(c.local.tech, id);
const tradeAndTrains = (c: MissionCtx) => (c.local ? c.local.stats.trainGold + c.local.stats.tradeGold : 0);

/** Weakest living rival nation (target suggestion). */
export function weakest(c: MissionCtx): [number, number] | null {
  const rivals = c.players.filter(
    (p) => p.kind === 'nation' && p.alive && p.tiles > 0 && p.label[2] > 0 && p.id !== c.me,
  );
  rivals.sort((a, b) => a.troops - b.troops);
  const r = rivals[0];
  return r ? [r.label[0], r.label[1]] : null;
}

/** Whether a country (by id) is a nation or a human — not a tribe. Unknown ids count as tribes. */
function isCountry(c: MissionCtx, id: number): boolean {
  const p = c.players.find((x) => x.id === id);
  return !!p && p.kind !== 'tribe';
}

const RAILWAYS = techId('industry.1');
const NUCLEAR_PROGRAMME = UNLOCK_NODE.silo;
const HBOMB = UNLOCK_NODE.hydrogen;
/** Ticks of game time an explanation step stays before the next one (15 s). */
const READ = 150;

/**
 * Remembers what the objectives count across ticks, from this tick's events and views:
 * countries (nations, humans) and tribes eliminated by me, loot, bombs launched,
 * transports launched and landed. Mutates c.memory.
 */
export function observe(c: MissionCtx): void {
  const m = c.memory;
  const inc = (k: string, by = 1) => (m[k] = (m[k] ?? 0) + by);
  let sunkMine = 0;
  for (const e of c.events) {
    if (e.k === 'eliminated' && e.by === c.me && e.player !== c.me)
      inc(isCountry(c, e.player) ? 'nations' : 'tribes');
    else if (e.k === 'nukeLaunch' && e.owner === c.me)
      inc(e.kind === N.Hydrogen ? 'hbomb' : e.kind === N.Atom ? 'abomb' : 'mirv');
    else if (e.k === 'loot' && e.owner === c.me) inc('loot', e.amount);
    else if (e.k === 'shipSunk' && e.owner === c.me) sunkMine++;
  }
  // Transports: one that leaves the sea without turning back nor being sunk has landed.
  const now = c.local?.transports ?? [];
  const seen = new Set<number>();
  for (const b of now) {
    seen.add(b.id);
    const k = `boat:${b.id}`;
    if (m[k] === undefined) inc('launched');
    m[k] = b.retreating ? 2 : 1;
  }
  for (const k of Object.keys(m)) {
    if (!k.startsWith('boat:') || seen.has(Number(k.slice(5)))) continue;
    if (m[k] === 1) {
      if (sunkMine > 0) sunkMine--;
      else inc('landed');
    }
    delete m[k];
  }
}

/**
 * A mission's game. Loyalty and secessions stay off in every mission, as in any new game
 * (1.12.0): a region of your own rising up as a tribe only confused (« une tribu qui
 * réapparaît dans mon territoire »), and the player would rather play solo as in multiplayer.
 */
function base(seed: number, name: string, mapId: string, patch: Partial<GameConfig>): GameConfig {
  const cfg = defaultConfig(seed);
  return {
    ...cfg,
    mapId,
    players: [{ slot: 0, name, kind: 'human', team: 0, general: 'blitz' }],
    spawnSeconds: 90,
    ...patch,
    features: { ...cfg.features, loyalty: false },
    mode: patch.mode ?? 'campaign',
  };
}

const SPAWN: GuideStep = { key: 'guide.spawn', done: placed };

export const MISSIONS: Mission[] = [
  {
    // The basics (the former tutorial): capital, camera, expansion, attack ratio, cities, tribes.
    id: 'm1',
    mapId: 'two-lakes',
    // The first city is paid for: the guide asks for it within the first minutes.
    config: (s, n) =>
      base(s, n, 'two-lakes', { nations: 3, tribes: 24, difficulty: 'easy', startGold: 125_000 }),
    objectives: [
      { key: 'campaign.m1.main', check: (c) => share(c) >= 0.15, progress: (c) => pct(c, 0.15) },
      {
        key: 'campaign.m1.city',
        check: (c) => built(c, B.City) >= 1,
        progress: (c) => count(built(c, B.City), 1),
      },
    ],
    bonus: {
      key: 'campaign.m1.bonusLevels',
      check: (c) => built(c, B.City) >= 2,
      progress: (c) => count(built(c, B.City), 2),
    },
    guide: [
      SPAWN,
      // A few camera moves since the step appeared (the director counts them).
      { key: 'guide.m1.camera', done: (c) => mem(c, 'camMoves') - mem(c, 'stepCam') >= 5 },
      { key: 'guide.m1.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m1.ratio', done: (c) => mem(c, 'ratioChanged') > 0 },
      { key: 'guide.m1.city', done: (c) => built(c, B.City) >= 1, cost: buildCost(B.City) },
      { key: 'guide.m1.tribes', done: (c) => mem(c, 'loot') > 0 || mem(c, 'tribes') > 0 },
      { key: 'guide.m1.capital', done: read(READ) },
      { key: 'guide.m1.goal', done: () => false },
    ],
    parTicks: 9000,
    outro: 'campaign.m1.outro',
  },
  {
    // Defence: posts, threatened borders, alliances (offers at the bottom right), troops.
    id: 'm2',
    mapId: 'europe',
    config: (s, n) =>
      base(s, n, 'europe', { nations: 30, tribes: 10, difficulty: 'hard', startGold: 50_000 }),
    objectives: [
      {
        key: 'campaign.m2.main',
        check: (c) => c.tick >= 12000 && alive(c),
        progress: (c) => ({ value: c.tick / 10, max: 1200, format: 'time' }),
      },
    ],
    bonus: {
      key: 'campaign.m2.bonus',
      check: (c) => built(c, B.DefensePost) >= 3,
      progress: (c) => count(built(c, B.DefensePost), 3),
    },
    guide: [
      { key: 'guide.m2.spawn', done: placed },
      { key: 'guide.m2.expand', done: (c) => share(c) >= 0.015 },
      { key: 'guide.m2.defense', done: (c) => built(c, B.DefensePost) >= 1, cost: buildCost(B.DefensePost) },
      { key: 'guide.m2.threats', done: read(READ * 1.5) },
      { key: 'guide.m2.alliance', done: (c) => (c.local?.allies.length ?? 0) >= 1 },
      { key: 'guide.m2.troops', done: (c) => !!c.local && c.local.troops >= c.local.popCap * 0.5 },
      { key: 'guide.m2.hold', done: () => false },
    ],
    parTicks: 12000,
    outro: 'campaign.m2.outro',
  },
  {
    // The sea: ports, landings (3 transports at most, recall), warships, storms.
    id: 'm3',
    mapId: 'archipelago',
    config: (s, n) =>
      base(s, n, 'archipelago', { nations: 12, tribes: 20, difficulty: 'normal', startGold: 125_000 }),
    objectives: [
      {
        key: 'campaign.m3.land',
        check: (c) => mem(c, 'landed') >= 1,
        progress: (c) => count(mem(c, 'landed'), 1),
      },
      // A nation (or a human): tribes do not count.
      {
        key: 'campaign.m3.main',
        check: (c) => mem(c, 'nations') >= 1,
        progress: (c) => count(mem(c, 'nations'), 1),
      },
    ],
    bonus: {
      key: 'campaign.m3.bonus',
      check: (c) => (c.local?.stats.shipsSunk ?? 0) >= 2,
      progress: (c) => count(c.local?.stats.shipsSunk ?? 0, 2),
    },
    guide: [
      SPAWN,
      { key: 'guide.m3.island', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m3.port', done: (c) => built(c, B.Port) >= 1, cost: buildCost(B.Port) },
      {
        key: 'guide.m3.landing',
        done: (c) => mem(c, 'launched') > 0 || mem(c, 'landed') > 0,
        marker: weakest,
      },
      { key: 'guide.m3.boats', done: read(READ * 1.5) },
      {
        key: 'guide.m3.warship',
        done: (c) => c.warships > 0 || (c.local?.stats.shipsSunk ?? 0) > 0,
        cost: (c) => c.local?.warshipCost ?? 0,
      },
      { key: 'guide.m3.finish', done: () => false, marker: weakest },
    ],
    parTicks: 15000,
    outro: 'campaign.m3.outro',
  },
  {
    // The economy: rails, trade, the trade routes view, research centres and the tech tree, windows.
    id: 'm4',
    mapId: 'pangaea',
    config: (s, n) =>
      base(s, n, 'pangaea', { nations: 16, tribes: 30, difficulty: 'normal', startGold: 250_000 }),
    objectives: [
      {
        key: 'campaign.m4.main',
        check: (c) => tradeAndTrains(c) >= 1_500_000,
        progress: (c) => ({ value: tradeAndTrains(c), max: 1_500_000, format: 'gold' }),
      },
      {
        key: 'campaign.m4.tech',
        check: (c) => researched(c, RAILWAYS),
        progress: (c) => count(researched(c, RAILWAYS) ? 1 : 0, 1),
      },
    ],
    bonus: {
      key: 'campaign.m4.bonusLevels',
      check: (c) => built(c, B.Factory) >= 3,
      progress: (c) => count(built(c, B.Factory), 3),
    },
    guide: [
      SPAWN,
      { key: 'guide.m4.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m4.cities', done: (c) => built(c, B.City) >= 2, cost: buildCost(B.City) },
      { key: 'guide.m4.factory', done: (c) => built(c, B.Factory) >= 1, cost: buildCost(B.Factory) },
      { key: 'guide.m4.port', done: (c) => built(c, B.Port) >= 1, cost: buildCost(B.Port) },
      { key: 'guide.m4.routes', done: (c) => mem(c, 'tradeOpened') > 0 || shownFor(c) >= READ * 3 },
      { key: 'guide.m4.lab', done: (c) => built(c, B.Lab) >= 1, cost: buildCost(B.Lab) },
      { key: 'guide.m4.research', done: (c) => studying(c, RAILWAYS) },
      { key: 'guide.m4.windows', done: read(READ) },
      { key: 'guide.m4.wait', done: () => false },
    ],
    parTicks: 18000,
    outro: 'campaign.m4.outro',
  },
  {
    // The bomb: research centres, the nuclear programme, a silo, the H-bomb; SAM batteries.
    id: 'm5',
    mapId: 'mediterranean',
    config: (s, n) =>
      base(s, n, 'mediterranean', {
        nations: 20,
        tribes: 10,
        difficulty: 'normal',
        goldMultiplier: 1.5,
        startGold: 250_000,
      }),
    objectives: [
      {
        key: 'campaign.m5.main',
        check: (c) => mem(c, 'hbomb') >= 1,
        progress: (c) => ({
          value: mem(c, 'hbomb') > 0 ? 5_000_000 : Math.min(c.local?.gold ?? 0, 5_000_000),
          max: 5_000_000,
          format: 'gold',
        }),
      },
    ],
    bonus: {
      key: 'campaign.m5.bonus',
      check: (c) => (c.local?.stats.nukesIntercepted ?? 0) >= 1,
      progress: (c) => count(c.local?.stats.nukesIntercepted ?? 0, 1),
    },
    guide: [
      SPAWN,
      { key: 'guide.m5.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m5.lab', done: (c) => built(c, B.Lab) >= 1, cost: buildCost(B.Lab) },
      // Tech tree: the nuclear programme (silos) first, its prerequisites queued before it.
      { key: 'guide.m5.research', done: (c) => studying(c, NUCLEAR_PROGRAMME) },
      { key: 'guide.m5.city', done: (c) => built(c, B.City) >= 2, cost: buildCost(B.City) },
      { key: 'guide.m5.silo', done: (c) => built(c, B.Silo) >= 1, cost: buildCost(B.Silo) },
      { key: 'guide.m5.hbomb', done: (c) => studying(c, HBOMB) },
      {
        key: 'guide.m5.launch',
        done: () => false,
        marker: weakest,
        cost: (c) => (mem(c, 'hbomb') > 0 ? 0 : (c.local?.nukeCosts[N.Hydrogen] ?? 0)),
      },
    ],
    parTicks: 21000,
    outro: 'campaign.m5.outro',
  },
  {
    // Everything at once, against the doomsday clock; the weather.
    id: 'm6',
    mapId: 'world',
    config: (s, n) => base(s, n, 'world', { nations: 40, tribes: 40, difficulty: 'hard', mode: 'doomsday' }),
    objectives: [{ key: 'campaign.m6.main', check: (c) => share(c) >= 0.4, progress: (c) => pct(c, 0.4) }],
    bonus: {
      key: 'campaign.m6.bonus',
      check: (c) => share(c) >= 0.4 && c.tick < 27000,
      progress: (c) => ({ value: c.tick / 10, max: 2700, format: 'time' }),
    },
    guide: [
      SPAWN,
      { key: 'guide.m6.expand', done: (c) => share(c) >= 0.03 },
      { key: 'guide.m6.economy', done: (c) => built(c, B.City) >= 3, cost: buildCost(B.City) },
      { key: 'guide.m6.weather', done: read(READ) },
      { key: 'guide.m6.clock', done: (c) => c.tick >= 6000 },
      { key: 'guide.m6.push', done: () => false, marker: weakest },
    ],
    parTicks: 27000,
    outro: 'campaign.m6.outro',
  },
];

/** Contextual advice shared by every mission (each one at most once per mission). */
export const HINTS: Hint[] = [
  {
    key: 'guide.hint.capital',
    when: (c) => c.phase === 'playing' && alive(c) && (c.local?.capital ?? 0) < 0,
  },
  { key: 'guide.hint.threat', when: (c) => (c.local?.threats.length ?? 0) > 0 },
  { key: 'guide.hint.allyOffer', when: (c) => (c.local?.allyRequests.length ?? 0) > 0 },
  { key: 'guide.hint.boats', when: (c) => (c.local?.transports.length ?? 0) >= MAX_TRANSPORTS },
  {
    key: 'guide.hint.storm',
    when: (c) =>
      !!c.local?.transports.some((b) =>
        (c.world?.weather ?? []).some(
          (w) => w.kind === 0 && (w.x - b.x) ** 2 + (w.y - b.y) ** 2 <= (w.r + 12) ** 2,
        ),
      ),
  },
  // Research centres working for nothing (the Technologies button pulses too).
  { key: 'guide.hint.research', when: (c) => researchIdle(c.local, true) && !!c.local?.research.labLevels },
];

export type Outcome = 'playing' | 'won' | 'lost';

/**
 * Latches the objectives reached this tick into `reached` (one flag per objective) and
 * tells where the mission stands: lost when our country fell, won once every required
 * objective has been reached.
 */
export function evaluate(m: Mission, c: MissionCtx, reached: boolean[]): Outcome {
  m.objectives.forEach((o, k) => {
    if (!reached[k] && o.check(c)) reached[k] = true;
  });
  if (c.phase === 'playing' && !alive(c)) return 'lost';
  return m.objectives.every((_, k) => reached[k]) ? 'won' : 'playing';
}

/** Stars of a won mission: one for the success, one under the reference time, one for the bonus. */
export function starsFor(m: Mission, c: MissionCtx, bonusDone: boolean): number {
  return 1 + (c.tick <= m.parTicks ? 1 : 0) + (bonusDone ? 1 : 0);
}

/** What a step asks to spend that the treasury lacks: the cost, the gold held, and seconds to wait. */
export function shortfall(
  step: GuideStep,
  c: MissionCtx,
): { cost: number; gold: number; eta: number } | null {
  if (!step.cost || !c.local) return null;
  const cost = step.cost(c);
  const gold = c.local.gold;
  if (cost <= 0 || gold >= cost) return null;
  const perSecond = c.local.income * 10;
  return { cost, gold, eta: perSecond > 0 ? Math.ceil((cost - gold) / perSecond) : Infinity };
}

type Tr = (key: string, params?: Record<string, string | number>) => string;

const clockOf = (ticks: number) => {
  const s = Math.max(0, Math.floor(ticks / 10));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The mission's result for the final edition (GameController.endMission): the required
 * objectives, the reference time and the bonus, each with the star it is worth, the
 * advisor's debrief and the mission it unlocks.
 */
export function missionResult(
  m: Mission,
  c: MissionCtx,
  o: { reached: boolean[]; bonusDone: boolean; stars: number; best: number },
  t: Tr,
): MissionResult {
  const success = o.stars > 0;
  const k = MISSIONS.indexOf(m);
  const next = success ? MISSIONS[k + 1] : undefined;
  return {
    id: m.id,
    title: t(`campaign.${m.id}.title`),
    success,
    stars: o.stars,
    maxStars: 3,
    best: Math.max(o.best, o.stars),
    objectives: [
      // The success star: on the objective when there is one, the list earns it together otherwise.
      ...m.objectives.map((x, j) => ({
        text: t(x.key),
        done: !!o.reached[j],
        star: m.objectives.length === 1,
      })),
      {
        text: t('end.mission.par', { time: clockOf(m.parTicks) }),
        done: success && c.tick <= m.parTicks,
        star: true,
        detail: clockOf(c.tick),
      },
      { text: t(m.bonus.key), done: o.bonusDone, star: true, bonus: true },
    ],
    debrief: success ? t(m.outro) : t('campaign.failed'),
    speaker: t('campaign.advisor'),
    index: k + 1,
    total: MISSIONS.length,
    next: next ? { id: next.id, title: t(`campaign.${next.id}.title`) } : null,
  };
}
