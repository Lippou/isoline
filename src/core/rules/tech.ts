// Technology tree (original feature, GAME_DESIGN.md §15.3): 6 branches × 6 technologies laid
// out on six tiers, then one repeatable technology per branch (column ∞) so that there is
// always something to study. Economy comes first: the war branches' advanced technologies
// require economy or industry levels, and the nuclear programme sits behind atomic physics,
// the central bank and heavy industry. With the feature on, silos and bombs, SAMs, radars
// and airfields are locked until researched; with it off, nothing is locked (pure OpenFront
// rules) and there are no research centres.
// Research points come from research centres (one building type, upgradable by levels) and
// build up even while nothing is being studied; without a centre, only a trickle.
import type { Game } from '../game/state';
import type { Personality, Player } from '../game/player';
import { B, N } from '../game/constants';
import { T } from '../map/terrain';

/** Branch ids: indices into Player.tech, which holds each branch's level (0..LEVELS + repeats). */
export const BRANCHES = ['economy', 'military', 'naval', 'nuclear', 'defense', 'industry'] as const;
export type Branch = (typeof BRANCHES)[number];
const [ECO, MIL, NAV, NUC, DEF, IND] = [0, 1, 2, 3, 4, 5] as const;
/** Columns of the tree, left to right: economy and industry feed the war branches. */
export const BRANCH_ROWS: readonly number[] = [ECO, IND, MIL, NAV, DEF, NUC];
/** Technologies per branch, researched in order (the repeatable one comes after them). */
export const LEVELS = 6;
/** Tiers of the regular technologies (the repeatable ones form a seventh, "∞"). */
export const TIERS = 6;
/** Research cost of a technology by tier (I…VI), in points. */
export const TIER_COST = [150, 400, 1500, 3800, 7000, 11000] as const;
/** Repeatable technologies: REPEAT_COST × REPEAT_GROWTH^(levels already taken), at most MAX_REPEAT levels. */
export const REPEAT_COST = 10000;
export const REPEAT_GROWTH = 1.15;
export const MAX_REPEAT = 20;
/**
 * Research points per second: a trickle without any research centre (the government's own
 * scholars), plus RESEARCH_PER_LAB_LEVEL per level of completed research centres;
 * × (1 + research bonuses). Cities give none: research is a building of its own.
 */
export const RESEARCH_BASE = 0.5;
export const RESEARCH_PER_LAB_LEVEL = 1.5;
/** Research speed bonuses: Universities (economy III) and Atomic physics (nuclear I). */
export const UNIVERSITIES_BONUS = 0.25;
export const ATOMIC_PHYSICS_BONUS = 0.1;
/** Targets the research queue holds after the current one. */
export const MAX_QUEUE = 12;

/** What a technology unlocks when the tech tree is on. */
export type Unlock = 'silo' | 'atom' | 'hydrogen' | 'mirv' | 'sam' | 'radar' | 'airfield';

export interface TechNode {
  /** Regular: branch × LEVELS + level − 1; repeatable: REPEAT_ID + branch. */
  id: number;
  branch: number;
  /** 1…LEVELS for the regular technologies, LEVELS + 1 for the repeatable one. */
  level: number;
  /** 1…TIERS (TIERS + 1 for the repeatable ones): row of the tree, sets the cost. */
  tier: number;
  /** Cost of the first level (repeatable technologies get dearer: costOf). */
  cost: number;
  /** Technologies of other branches required (the previous level of the branch is implied). */
  requires: readonly number[];
  unlocks: readonly Unlock[];
  /** Repeatable: studied again and again, each level adding its effect. */
  repeat: boolean;
}

type Spec = readonly [tier: number, requires: readonly string[], unlocks: readonly Unlock[]];

// prettier-ignore
const SPEC: Record<Branch, readonly Spec[]> = {
  economy: [
    [1, [], []], //                                 Trading posts: +10% base income
    [2, [], []], //                                 Central bank: +15% base income
    [3, [], []], //                                 Universities: +25% research speed
    [4, [], []], //                                 World markets: +20% trade and train income
    [5, ['industry.4'], []], //                     Stock exchange: +10% on all income
    [6, ['naval.4'], []], //                        Globalisation: +20% trade and train income
  ],
  industry: [
    [1, ['economy.1'], []], //                      Railways: +10% train income
    [2, ['economy.2'], []], //                      Heavy industry: −10% building costs
    [3, ['economy.3'], ['airfield']], //            Aerospace: airfields and aircraft
    [4, ['economy.4'], []], //                      Automation: −10% building costs
    [5, ['economy.5'], []], //                      Megaprojects: twice faster construction, +10% train income
    [6, ['economy.5'], []], //                      Robotics: −10% building costs
  ],
  military: [
    [1, [], []], //                                 Mountain troops: −10% losses in hills and mountains
    [2, ['industry.1'], []], //                     Logistics: +10% attack speed
    [3, ['industry.2'], []], //                     Combined arms: −10% losses everywhere
    [4, ['industry.3'], []], //                     Blitzkrieg: +15% attack speed
    [5, ['industry.4'], []], //                     Conscription: +10% troop ceiling
    [6, ['industry.5'], []], //                     Special forces: −10% losses everywhere
  ],
  naval: [
    [1, [], []], //                                 Armour plating: +20% warship hit points
    [2, ['industry.2'], []], //                     Naval gunnery: +20% warship damage
    [3, ['industry.3'], []], //                     Turbines: +25% ship speed
    [4, ['economy.4'], []], //                      Shipping lines: +25% trade income
    [5, ['industry.4'], []], //                     Shipyards: −25% warship cost
    [6, ['economy.5'], []], //                      Container ships: +25% trade income
  ],
  defense: [
    [1, ['economy.1'], ['sam']], //                 Surface-to-air missiles: SAM batteries
    [2, ['economy.2'], ['radar']], //               Fire-control radar: radar towers, SAM range +5
    [3, ['industry.2'], []], //                     Salvos: SAM +1 simultaneous target
    [4, ['industry.3'], []], //                     Shield: SAM +1 target, range +7.5
    [5, ['nuclear.3'], []], //                      Fallout shelters: −30% troops lost to bombs
    [6, ['industry.5'], []], //                     Missile shield: SAM +1 target, range +5
  ],
  nuclear: [
    [1, ['economy.1'], []], //                      Atomic physics: +10% research speed
    [2, ['economy.2', 'industry.2'], ['silo', 'atom']], // Nuclear programme: silos and A-bombs
    [3, ['economy.3'], ['hydrogen']], //            Thermonuclear bomb: H-bombs
    [4, [], []], //                                 Miniaturisation: −20% bomb costs, +25% reload speed
    [5, ['industry.4'], ['mirv']], //               Multiple warheads: MIRVs
    [6, ['economy.5'], []], //                      Mass production: −25% bomb costs
  ],
};

export const nodeId = (branch: number, level: number): number => branch * LEVELS + level - 1;
/** First repeatable technology's id (one per branch, in branch order). */
export const REPEAT_ID = BRANCHES.length * LEVELS;
export const repeatId = (branch: number): number => REPEAT_ID + branch;

/** 'nuclear.1' → node id, 'economy.r' → the branch's repeatable technology (-1 when unknown). */
export function techId(key: string): number {
  const [b, l] = key.split('.');
  const branch = BRANCHES.indexOf(b as Branch);
  if (branch < 0) return -1;
  if (l === 'r') return repeatId(branch);
  const level = Number(l);
  return level >= 1 && level <= LEVELS ? nodeId(branch, level) : -1;
}

export const NODES: readonly TechNode[] = [
  ...BRANCHES.flatMap((br, branch) =>
    SPEC[br].map(([tier, requires, unlocks], k) => ({
      id: nodeId(branch, k + 1),
      branch,
      level: k + 1,
      tier,
      cost: TIER_COST[tier - 1]!,
      requires: requires.map(techId),
      unlocks,
      repeat: false,
    })),
  ),
  ...BRANCHES.map((_, branch) => ({
    id: repeatId(branch),
    branch,
    level: LEVELS + 1,
    tier: TIERS + 1,
    cost: REPEAT_COST,
    requires: [],
    unlocks: [],
    repeat: true,
  })),
];

/** The technology that unlocks each item. */
export const UNLOCK_NODE = Object.fromEntries(
  NODES.flatMap((n) => n.unlocks.map((u) => [u, n.id] as const)),
) as Record<Unlock, number>;

/** i18n key of a technology: tech.<branch>.<level>, tech.<branch>.r when repeatable (.name / .desc). */
export function techKey(id: number): string {
  const n = NODES[id]!;
  return `tech.${BRANCHES[n.branch]}.${n.repeat ? 'r' : n.level}`;
}

export const isRepeat = (id: number): boolean => !!NODES[id]?.repeat;

// ------------------------------------------------------------------ state

/** Levels of `branch`'s repeatable technology taken so far. */
export function repeatCount(levels: ArrayLike<number>, branch: number): number {
  return Math.max(0, (levels[branch] ?? 0) - LEVELS);
}

/** Whether `id` is researched, given each branch's level (Player.tech or LocalView.tech). Never for repeatables. */
export function isResearched(levels: ArrayLike<number>, id: number): boolean {
  const n = NODES[id];
  return !!n && !n.repeat && (levels[n.branch] ?? 0) >= n.level;
}

/** Whether every prerequisite of `id` is researched (it can be studied right now). */
export function isAvailable(levels: ArrayLike<number>, id: number): boolean {
  const n = NODES[id];
  if (!n) return false;
  if (n.repeat) {
    const lv = levels[n.branch] ?? 0;
    return lv >= LEVELS && lv - LEVELS < MAX_REPEAT;
  }
  if (isResearched(levels, id)) return false;
  if (n.level > 1 && !isResearched(levels, id - 1)) return false;
  return n.requires.every((r) => isResearched(levels, r));
}

/** Points the next study of `id` costs (repeatables get dearer with every level). */
export function costOf(levels: ArrayLike<number>, id: number): number {
  const n = NODES[id];
  if (!n) return 0;
  if (!n.repeat) return n.cost;
  return Math.round(REPEAT_COST * REPEAT_GROWTH ** repeatCount(levels, n.branch));
}

/**
 * The next technology to study on the way to `target`: its first missing prerequisite
 * (previous level of the branch first, then the others in order), or the target itself.
 * -1 when the target is already researched (or a repeatable one is maxed out).
 */
export function nextStep(levels: ArrayLike<number>, target: number): number {
  const n = NODES[target];
  if (!n) return -1;
  if (n.repeat) {
    if ((levels[n.branch] ?? 0) < LEVELS) return nextStep(levels, nodeId(n.branch, LEVELS));
    return isAvailable(levels, target) ? target : -1;
  }
  if (isResearched(levels, target)) return -1;
  if (n.level > 1 && !isResearched(levels, target - 1)) return nextStep(levels, target - 1);
  for (const r of n.requires) if (!isResearched(levels, r)) return nextStep(levels, r);
  return target;
}

/** Every technology still to study to reach `target`, in research order (a repeatable one: its next level). */
export function researchPath(levels: ArrayLike<number>, target: number): number[] {
  const lv = Array.from({ length: BRANCHES.length }, (_, b) => levels[b] ?? 0);
  const out: number[] = [];
  for (let s = nextStep(lv, target); s >= 0; s = nextStep(lv, target)) {
    out.push(s);
    if (NODES[s]!.repeat) break;
    lv[NODES[s]!.branch] = NODES[s]!.level;
  }
  return out;
}

/** Research points still needed to reach `target` (whole path). */
export function pathCost(levels: ArrayLike<number>, target: number): number {
  let c = 0;
  for (const s of researchPath(levels, target)) c += costOf(levels, s);
  return c;
}

/** Research speed multiplier from technologies (Universities, Atomic physics). */
export function researchMult(levels: ArrayLike<number>): number {
  let m = 1;
  if ((levels[ECO] ?? 0) >= 3) m += UNIVERSITIES_BONUS;
  if ((levels[NUC] ?? 0) >= 1) m += ATOMIC_PHYSICS_BONUS;
  return m;
}

/** Where research points come from, per second: the base trickle, the centres, the bonus. */
export function researchSources(p: Player): { base: number; labs: number; labLevels: number; mult: number } {
  const labLevels = p.labLevels ?? 0;
  return {
    base: RESEARCH_BASE,
    labs: RESEARCH_PER_LAB_LEVEL * labLevels,
    labLevels,
    mult: researchMult(p.tech),
  };
}

/** Research points per tick produced by a player. */
export function researchRate(p: Player): number {
  const s = researchSources(p);
  return ((s.base + s.labs) * s.mult) / 10;
}

/** Cost of the next technology studied on the way to `target` (0 when there is none). */
export function nextTechCost(p: Player, target: number): number {
  const s = nextStep(p.tech, target);
  return s < 0 ? 0 : costOf(p.tech, s);
}

/** Whether `id` is worth aiming at: a regular technology not yet researched, or a repeatable one not maxed out. */
function aimable(levels: ArrayLike<number>, id: number): boolean {
  const n = NODES[id];
  if (!n) return false;
  return n.repeat ? repeatCount(levels, n.branch) < MAX_REPEAT : !isResearched(levels, id);
}

/** The current goal is reached (or void): the next queued one takes over (-1 when the queue is empty). */
function advanceQueue(p: Player): void {
  p.researching = -1;
  while (p.researchQueue.length > 0) {
    const next = p.researchQueue.shift()!;
    if (aimable(p.tech, next)) {
      p.researching = next;
      return;
    }
  }
}

/**
 * The 'research' command. Without `op`: study `id` now (its prerequisites come first), the
 * queue staying behind it; -1 stops and empties the queue. 'queue': add `id` after the
 * current goal and the queued ones (or study it now when idle). 'unqueue': drop `id` from
 * the plan (the current goal included: the next queued one takes over).
 */
export function setResearch(p: Player, id: number, op?: 'queue' | 'unqueue'): void {
  p.researchQueue ??= [];
  if (op === 'unqueue') {
    p.researchQueue = p.researchQueue.filter((q) => q !== id);
    if (p.researching === id) advanceQueue(p);
    return;
  }
  if (id === -1 && !op) {
    p.researching = -1;
    p.researchQueue = [];
    return;
  }
  if (!aimable(p.tech, id)) return;
  if (op === 'queue') {
    if (p.researching < 0) p.researching = id;
    else if (p.researching !== id && !p.researchQueue.includes(id) && p.researchQueue.length < MAX_QUEUE)
      p.researchQueue.push(id);
    return;
  }
  p.researching = id;
  p.researchQueue = p.researchQueue.filter((q) => q !== id);
}

/** Old saves: 5-branch trees are widened; 4-level trees (before 1.4.0) get the nuclear branch shifted. */
export function migrateTech(p: Player, fourLevels: boolean): void {
  if (p.tech.length < BRANCHES.length) {
    const t = new Uint8Array(BRANCHES.length);
    t.set(p.tech);
    p.tech = t;
  }
  p.researchQueue ??= [];
  if (!fourLevels) return;
  // Atomic physics now opens the nuclear branch: the old levels move up by one.
  if (p.tech[NUC]! > 0) p.tech[NUC] = Math.min(LEVELS, p.tech[NUC]! + 1);
  if (p.researching >= 0) {
    const b = Math.floor(p.researching / 4);
    const l = (p.researching % 4) + 1 + (b === NUC ? 1 : 0);
    p.researching = b < BRANCHES.length ? nodeId(b, l) : -1;
  }
}

/** One tick of research. Returns the technology completed this tick (-1: none). */
export function updateResearch(p: Player, mult = 1): number {
  if (p.tech.length < BRANCHES.length) migrateTech(p, false);
  p.researchQueue ??= [];
  p.researchPoints += researchRate(p) * mult;
  if (p.researching < 0) {
    if (p.researchQueue.length === 0) return -1;
    advanceQueue(p);
    if (p.researching < 0) return -1;
  }
  const step = nextStep(p.tech, p.researching);
  if (step < 0) {
    advanceQueue(p);
    return -1;
  }
  const n = NODES[step]!;
  const cost = costOf(p.tech, step);
  if (p.researchPoints < cost) return -1;
  p.researchPoints -= cost;
  p.tech[n.branch] = n.repeat ? Math.min(255, p.tech[n.branch]! + 1) : n.level;
  // Goal reached: the queue moves on. A repeatable goal with nothing queued keeps going.
  if (step === p.researching && !(n.repeat && p.researchQueue.length === 0 && isAvailable(p.tech, step)))
    advanceQueue(p);
  return step;
}

const plan = (s: string): readonly string[] => s.split(' ');

/**
 * Nations' research plans by personality (missing prerequisites are studied on the way).
 * Every plan starts with the economy and reaches the nuclear programme and SAM batteries
 * in the mid-game, so that nations still build silos and SAMs and use them; expansionists,
 * builders and warmongers also study Aerospace (airfields and aircraft).
 */
export const NATION_RESEARCH: Record<Personality, readonly string[]> = {
  expansionist: plan(
    'military.1 economy.1 industry.1 economy.2 military.2 industry.2 defense.1 nuclear.2 military.3 economy.3 industry.3 nuclear.3 military.4 economy.4 military.5',
  ),
  builder: plan(
    'economy.1 industry.1 economy.2 industry.2 defense.1 economy.3 nuclear.2 industry.3 economy.4 defense.2 nuclear.3 industry.4 economy.5',
  ),
  merchant: plan(
    'economy.1 naval.1 industry.1 economy.2 defense.1 industry.2 nuclear.2 naval.2 economy.3 economy.4 naval.4 nuclear.3 economy.5',
  ),
  diplomat: plan(
    'economy.1 industry.1 economy.2 defense.1 industry.2 nuclear.2 economy.3 defense.2 defense.3 nuclear.3 economy.4 defense.4',
  ),
  isolationist: plan(
    'economy.1 defense.1 economy.2 industry.1 industry.2 nuclear.2 defense.2 defense.3 economy.3 nuclear.3 defense.4 defense.5',
  ),
  warmonger: plan(
    'economy.1 military.1 industry.1 economy.2 industry.2 nuclear.2 defense.1 military.2 economy.3 industry.3 nuclear.3 nuclear.4 industry.4 nuclear.5',
  ),
};

/**
 * What a nation studies next: the first technology of its plan (node keys) not yet
 * researched, then the cheapest one available (repeatables included). -1 when nothing is left.
 */
export function planGoal(levels: ArrayLike<number>, plan: readonly string[]): number {
  for (const key of plan) {
    const id = techId(key);
    if (id >= 0 && !isResearched(levels, id)) return id;
  }
  let best = -1;
  let bestCost = Infinity;
  for (const n of NODES) {
    if (!isAvailable(levels, n.id)) continue;
    const c = costOf(levels, n.id);
    if (c < bestCost) {
      best = n.id;
      bestCost = c;
    }
  }
  return best;
}

// ------------------------------------------------------------------ locks

const BUILDING_UNLOCK: Partial<Record<B, Unlock>> = {
  [B.Silo]: 'silo',
  [B.Sam]: 'sam',
  [B.Radar]: 'radar',
  [B.Airfield]: 'airfield',
};
const NUKE_UNLOCK: Partial<Record<N, Unlock>> = {
  [N.Atom]: 'atom',
  [N.Hydrogen]: 'hydrogen',
  [N.Mirv]: 'mirv',
  [N.MirvWarhead]: 'mirv',
};

export const buildingUnlock = (type: B): Unlock | null => BUILDING_UNLOCK[type] ?? null;
export const nukeUnlock = (kind: N): Unlock | null => NUKE_UNLOCK[kind] ?? null;

/** The technology still missing for `u` given the branch levels (-1: available). */
export function lockFor(levels: ArrayLike<number>, u: Unlock | null): number {
  if (!u) return -1;
  const id = UNLOCK_NODE[u];
  return isResearched(levels, id) ? -1 : id;
}

/** The technology p still lacks to build `type` (-1 when allowed or the tree is off). */
export function buildingLock(game: Game, p: Player, type: B): number {
  return game.config.features.tech ? lockFor(p.tech, buildingUnlock(type)) : -1;
}

/** The technology p still lacks to launch a bomb of `kind` (-1 when allowed or the tree is off). */
export function nukeLock(game: Game, p: Player, kind: N): number {
  return game.config.features.tech ? lockFor(p.tech, nukeUnlock(kind)) : -1;
}

/** The technology p still lacks to fly aircraft (-1 when allowed or the tree is off). */
export function airLock(game: Game, p: Player): number {
  return game.config.features.tech ? lockFor(p.tech, 'airfield') : -1;
}

// ------------------------------------------------------------------ effects

const lv = (p: Player, b: number): number => p.tech[b] ?? 0;
const reps = (p: Player, b: number): number => Math.min(MAX_REPEAT, repeatCount(p.tech, b));

/** Attacker losses. */
export function techMagMultiplier(p: Player, terrain: number): number {
  let m = 1;
  if (lv(p, MIL) >= 1 && (terrain === T.Mountain || terrain === T.Hills || terrain === T.Peaks)) m *= 0.9;
  if (lv(p, MIL) >= 3) m *= 0.9;
  if (lv(p, MIL) >= 6) m *= 0.9;
  return m * (1 - 0.01 * reps(p, MIL)); // Drill: −1% a level
}

export function techSpeedMultiplier(p: Player): number {
  let m = 1;
  if (lv(p, MIL) >= 2) m *= 1.1;
  if (lv(p, MIL) >= 4) m *= 1.15;
  return m;
}

/** Troop ceiling (Conscription). */
export function techTroopCap(p: Player): number {
  return lv(p, MIL) >= 5 ? 1.1 : 1;
}

/** Every source of gold: Stock exchange, then Prosperity (+2% a level). */
export function techIncome(p: Player): number {
  return (lv(p, ECO) >= 5 ? 1.1 : 1) * (1 + 0.02 * reps(p, ECO));
}

/** Base income. */
export function techEconomy(p: Player): number {
  let m = techIncome(p);
  if (lv(p, ECO) >= 1) m *= 1.1;
  if (lv(p, ECO) >= 2) m *= 1.15;
  return m;
}

export function techTrainBonus(p: Player): number {
  let m = techIncome(p);
  if (lv(p, IND) >= 1) m *= 1.1;
  if (lv(p, ECO) >= 4) m *= 1.1;
  if (lv(p, IND) >= 5) m *= 1.1;
  if (lv(p, ECO) >= 6) m *= 1.1;
  return m;
}

export function techBuildCost(p: Player): number {
  let m = 1;
  if (lv(p, IND) >= 2) m *= 0.9;
  if (lv(p, IND) >= 4) m *= 0.9;
  if (lv(p, IND) >= 6) m *= 0.9;
  return m * (1 - 0.01 * reps(p, IND)); // Productivity: −1% a level
}

/** Construction time (Megaprojects). */
export function techBuildTime(p: Player): number {
  return lv(p, IND) >= 5 ? 0.5 : 1;
}

export function techNaval(p: Player): {
  hp: number;
  damage: number;
  speed: number;
  trade: number;
  shipCost: number;
} {
  let trade = techIncome(p) * (1 + 0.03 * reps(p, NAV)); // Freight: +3% a level
  // Kept modest: the full stack (×1.6) must not undo the halved trade pay (GAME_DESIGN §5).
  if (lv(p, NAV) >= 4) trade *= 1.1;
  if (lv(p, ECO) >= 4) trade *= 1.1;
  if (lv(p, NAV) >= 6) trade *= 1.1;
  if (lv(p, ECO) >= 6) trade *= 1.1;
  return {
    hp: lv(p, NAV) >= 1 ? 1.2 : 1,
    damage: lv(p, NAV) >= 2 ? 1.2 : 1,
    speed: lv(p, NAV) >= 3 ? 1.25 : 1,
    trade,
    shipCost: lv(p, NAV) >= 5 ? 0.75 : 1,
  };
}

export function techNukes(p: Player): { cost: number; reload: number } {
  const mini = lv(p, NUC) >= 4;
  const mass = lv(p, NUC) >= 6;
  return {
    cost: (mini ? 0.8 : 1) * (mass ? 0.75 : 1),
    reload: (mini ? 1.25 : 1) * (1 + 0.05 * reps(p, NUC)), // Launch cadence: +5% a level
  };
}

/** Share of the troops a bomb would kill that actually die (Fallout shelters). */
export function techShelter(p: Player): number {
  return lv(p, DEF) >= 5 ? 0.7 : 1;
}

/**
 * SAM research: extra targets and reach. The reach bonuses were halved with the SAMs' own
 * reach in 1.15 (+10, +15, +10 and +1 a level before), so that research keeps its weight.
 */
export function techSam(p: Player): { range: number; targets: number } {
  let range = reps(p, DEF) * 0.5; // Interception: +0.5 tile a level
  let targets = 0;
  if (lv(p, DEF) >= 2) range += 5;
  if (lv(p, DEF) >= 3) targets += 1;
  if (lv(p, DEF) >= 4) {
    targets += 1;
    range += 7.5;
  }
  if (lv(p, DEF) >= 6) {
    targets += 1;
    range += 5;
  }
  return { range, targets };
}
