// Automated nations and tribes. Runs inside the deterministic simulation:
// every decision uses game.rng and a deterministic work budget (no wall clock),
// so all lockstep peers compute identical AI behaviour.
import type { Game } from '../game/state';
import type { Player, Personality } from '../game/player';
import { applyCommand } from '../game/commands';
import {
  A,
  AIR_COST,
  B,
  BOMBER_RANGE,
  DEFENSE_POST_RANGE,
  FIGHTER_RANGE,
  N,
  NUKE_SPEED,
  RECON_RANGE,
  RELATION_HOSTILE,
  SCRAMBLE_SIGHT,
} from '../game/constants';
import { IS_LAND } from '../map/terrain';
import { MAX_LEVEL, buildCost, checkPlacement, levelsOwned } from '../buildings/buildings';
import {
  hostileSams,
  launchSilo,
  maxLaunchable,
  nukeCost,
  samMissilesReady,
  samRangeOf,
} from '../units/nukes';
import { alertReady, airfieldFor, radarSees, spotted } from '../units/air';
import { airLock } from '../rules/tech';
import { ARC_DOWN, ARC_UP, Trajectory, predictInterception } from '../units/trajectory';
import { U } from '../units/unit';
import { planBoat, warshipCost } from '../units/ships';
import { pathLength } from '../map/nav';
import { castVote } from '../rules/features';
import { NATION_RESEARCH, lockFor, planGoal } from '../rules/tech';
import { maxTroops } from '../game/economy';
import type { Building } from '../buildings/building';

interface Mem {
  nextThink: number;
  lastAttack: number;
  /** Last offensive against another player (wars are deliberate, not continuous). */
  lastWar: number;
  lastBoat: number;
  lastBuild: number;
  lastNuke: number;
  lastDiplo: number;
  grudge: Map<number, number>; // player → grudge score
  pendingAnswers: Map<number, number>; // requester → tick to answer
  /** Ally whose alliance is left to lapse (boxed in by allies with an idle army), -1 none. */
  prey?: number;
  /** Last bombing raid, reconnaissance flight and fighter sortie (absent in older saves). */
  lastRaid?: number;
  lastRecon?: number;
  lastFighter?: number;
}

export interface AIState {
  mem: Map<number, Mem>;
  nukedBy: Map<number, number>; // victim → last attacker
  /** Victim of a bombing raid → its last raider and when (units/air.ts). */
  raidedBy: Map<number, [by: number, tick: number]>;
  cursor: number;
}

export function createAIState(): AIState {
  return { mem: new Map(), nukedBy: new Map(), raidedBy: new Map(), cursor: 1 };
}

interface Traits {
  aggression: number; // propensity to attack
  attackFactor: number; // required strength ratio
  build: number;
  trade: number;
  diplomacy: number;
  nukes: number;
  naval: number;
  /** Research centre levels wanted per city level. */
  research: number;
}

const TRAITS: Record<Personality, Traits> = {
  expansionist: {
    aggression: 1.2,
    attackFactor: 1.0,
    build: 0.8,
    trade: 0.6,
    diplomacy: 0.5,
    nukes: 0.6,
    naval: 0.6,
    research: 0.3,
  },
  builder: {
    aggression: 0.7,
    attackFactor: 1.4,
    build: 1.5,
    trade: 1.0,
    diplomacy: 0.8,
    nukes: 0.5,
    naval: 0.6,
    research: 0.55,
  },
  merchant: {
    aggression: 0.6,
    attackFactor: 1.5,
    build: 1.1,
    trade: 1.6,
    diplomacy: 1.0,
    nukes: 0.4,
    naval: 1.3,
    research: 0.45,
  },
  diplomat: {
    aggression: 0.6,
    attackFactor: 1.3,
    build: 1.0,
    trade: 1.1,
    diplomacy: 1.8,
    nukes: 0.3,
    naval: 0.8,
    research: 0.5,
  },
  isolationist: {
    aggression: 0.5,
    attackFactor: 1.6,
    build: 1.2,
    trade: 0.5,
    diplomacy: 0.4,
    nukes: 0.8,
    naval: 1.0,
    research: 0.5,
  },
  warmonger: {
    aggression: 1.6,
    attackFactor: 0.85,
    build: 0.7,
    trade: 0.4,
    diplomacy: 0.3,
    nukes: 1.5,
    naval: 1.0,
    research: 0.35,
  },
};

/** Research centre wishes × difficulty: harder nations invest more in research. */
const AI_RESEARCH = { easy: 0.8, normal: 1, hard: 1.15, impossible: 1.3 } as const;

const NB = new Int32Array(4);
/** Nations think every 3–6 s (× difficulty): a measured, management-heavy pace. */
const AI_THINK_MIN = 30;
const AI_THINK_MAX = 60;
/**
 * Minimum delay between two expansion orders, and between two wars, in ticks. With
 * OpenFront's combat (fronts ~2.5× faster than Isoline's former ones) wars are spaced a
 * little more to keep AI games around 25–60 min (100 s; 130 s before the troop ceilings were
 * lowered: smaller armies take less land per offensive); an idle army shortens it by
 * AI_WAR_IDLE_SPEEDUP.
 */
const AI_EXPAND_COOLDOWN = 40;
const AI_WAR_COOLDOWN = 1000;
const AI_WAR_IDLE_SPEEDUP = 1.5;
const AI_BUILD_COOLDOWN = 120;
/** Extra strength a nation wants over its target before declaring war. */
const AI_STRENGTH_MARGIN = 1.0;
/** Troops above this share of the ceiling barely regenerate: even peaceful nations use them. */
const AI_IDLE_ARMY = 0.85;
/** Nations attack a neighbouring traitor with fewer troops than this many times theirs (OpenFront). */
const AI_TRAITOR_MARGIN = 1.2;
/** Nations turn down 90 % of a traitor's alliance requests (OpenFront). */
const AI_TRAITOR_REFUSAL = 0.9;
/** Goodwill (positive relation) adds this much acceptance per point (+60 → +0.24). */
const AI_GOODWILL_ODDS = 0.004;
/** Nations never stab an ally they feel this friendly towards (OpenFront's « Friendly »). */
const AI_FRIENDLY = 50;
/**
 * An offensive's size, as a share of the target's army. With OpenFront's losses an attack
 * as big as the defender's whole army sweeps it away; nations bite instead (a fifth to a
 * quarter of the land per offensive), so that wars last several offensives. Three quarters
 * since the troop ceilings were lowered (half before): per-tile losses do not shrink with
 * the armies, so the same share of the target's army took less land.
 */
const AI_BITE = 0.75;

function mem(game: Game, p: Player): Mem {
  let m = game.ai.mem.get(p.id);
  if (!m) {
    m = {
      nextThink: game.tick + game.rng.int(0, 20),
      lastAttack: -1000,
      lastWar: -1000,
      lastBoat: -1000,
      lastBuild: -1000,
      lastNuke: -10_000,
      lastDiplo: -1000,
      grudge: new Map(),
      pendingAnswers: new Map(),
    };
    game.ai.mem.set(p.id, m);
  }
  return m;
}

export function updateAI(game: Game): void {
  if (game.phase !== 'playing') return;
  const diff = game.difficulty();
  // Deterministic work budget: each think costs units; stop when exhausted.
  let budget = game.aiBudget;
  const n = game.players.length;
  for (let k = 1; k < n && budget > 0; k++) {
    const id = ((game.ai.cursor + k - 1) % (n - 1)) + 1;
    const p = game.players[id]!;
    if (!p.alive || p.kind === 'human') continue;
    const m = mem(game, p);
    if (game.tick < m.nextThink) continue;
    if (p.kind === 'tribe') {
      budget -= thinkTribe(game, p, m);
      m.nextThink = game.tick + game.rng.int(40, 70);
    } else {
      budget -= thinkNation(game, p, m);
      m.nextThink = game.tick + Math.round(game.rng.int(AI_THINK_MIN, AI_THINK_MAX) * diff.think);
    }
    game.ai.cursor = id;
  }
}

// ------------------------------------------------------------ perception
interface Neighbor {
  id: number;
  contact: number;
  tile: number;
}

/** Sample border tiles to find adjacent owners (0 = wilderness). Cost ≈ samples. */
function neighbors(game: Game, p: Player, samples: number): Map<number, Neighbor> {
  const out = new Map<number, Neighbor>();
  const border = p.border;
  if (border.length === 0) return out;
  const step = Math.max(1, Math.floor(border.length / samples));
  const offset = game.rng.int(0, step - 1);
  for (let k = offset; k < border.length; k += step) {
    const t = border[k]!;
    const c = game.map.neighbors4(t, NB);
    for (let j = 0; j < c; j++) {
      const v = NB[j]!;
      const o = game.owner[v]!;
      if (o === p.id || !IS_LAND[game.map.terrain[v]!] || game.isDead(v)) continue;
      const e = out.get(o);
      if (e) e.contact++;
      else out.set(o, { id: o, contact: 1, tile: v });
    }
  }
  return out;
}

function incomingAttacks(game: Game, p: Player): Map<number, number> {
  const m = new Map<number, number>();
  for (const a of game.attacks)
    if (!a.done && a.target === p.id) m.set(a.attacker, (m.get(a.attacker) ?? 0) + a.troops);
  return m;
}

/** Troop ceiling (refreshed every tick by the economy). */
function troopCap(game: Game, p: Player): number {
  return p.popCap > 0 ? p.popCap : maxTroops(game, p);
}

function hasAttack(game: Game, p: Player, target: number): boolean {
  return game.attacks.some((a) => !a.done && a.attacker === p.id && a.target === target);
}

// ------------------------------------------------------------------ tribes
function thinkTribe(game: Game, p: Player, m: Mem): number {
  const nb = neighbors(game, p, 24);
  const cap = troopCap(game, p);
  // OpenFront's tribes fall on a neighbouring traitor, one think in three.
  const traitors = [...nb.values()].filter(
    (n) => n.id > 0 && game.players[n.id]!.isTraitor(game.tick) && game.attackAllowed(p.id, n.id, true),
  );
  if (traitors.length > 0 && game.rng.chance(1 / 3)) {
    applyCommand(game, p.id, {
      t: 'attack',
      tile: traitors[game.rng.int(0, traitors.length - 1)]!.tile,
      ratio: 0.25,
    });
    m.lastAttack = game.tick;
    return 30;
  }
  if (nb.has(0) && !hasAttack(game, p, 0) && p.troops > cap * 0.25) {
    applyCommand(game, p.id, { t: 'attack', tile: nb.get(0)!.tile, ratio: 0.12 });
    m.lastAttack = game.tick;
  } else if (game.rng.chance(0.08)) {
    // Occasionally raid a weaker non-human neighbour.
    for (const n of nb.values()) {
      if (n.id === 0) continue;
      const q = game.players[n.id]!;
      if (q.kind !== 'human' && q.troops < p.troops * 0.5 && game.attackAllowed(p.id, q.id, true)) {
        applyCommand(game, p.id, { t: 'attack', tile: n.tile, ratio: 0.25 });
        break;
      }
    }
  }
  return 30;
}

// ----------------------------------------------------------------- nations
function thinkNation(game: Game, p: Player, m: Mem): number {
  const t = TRAITS[p.personality];
  const diff = game.difficulty();
  let cost = 40;
  const cap = troopCap(game, p);
  const incoming = incomingAttacks(game, p);
  const underAttack = incoming.size > 0;
  for (const [att, troops] of incoming) m.grudge.set(att, (m.grudge.get(att) ?? 0) + troops / 1000);

  // 1-2. Research: the personality's plan, economy first (prerequisites are studied on the
  // way); a nation under nuclear fire switches to SAM batteries until it has them.
  if (game.config.features.tech) {
    const sam = game.ai.nukedBy.has(p.id) ? lockFor(p.tech, 'sam') : -1;
    // Bombed (normal and up): interceptors need an airfield, so Aerospace comes next.
    const air =
      sam < 0 && game.config.features.air && diff.aggression >= 1 && raider(game, p, AI_RAID_MEMORY) > 0
        ? lockFor(p.tech, 'airfield')
        : -1;
    const urgent = sam >= 0 ? sam : air;
    const goal =
      urgent >= 0 ? urgent : p.researching < 0 ? planGoal(p.tech, NATION_RESEARCH[p.personality]) : -1;
    if (goal >= 0 && goal !== p.researching) applyCommand(game, p.id, { t: 'research', tech: goal });
  }

  const nb = neighbors(game, p, 80);
  cost += 80;

  // 3. Counter-attack / defend chokepoints.
  if (underAttack) {
    let worst = -1;
    let worstTroops = 0;
    for (const [att, troops] of incoming) {
      if (troops > worstTroops) {
        worst = att;
        worstTroops = troops;
      }
    }
    const enemy = game.players[worst];
    if (enemy && nb.has(worst) && game.attackAllowed(p.id, worst, true)) {
      if (p.troops > worstTroops * 0.8 && !hasAttack(game, p, worst)) {
        applyCommand(game, p.id, {
          t: 'attack',
          tile: nb.get(worst)!.tile,
          ratio: counterRatio(p, enemy, worstTroops),
        });
        m.lastAttack = game.tick;
      } else if (p.gold > buildCost(game, p, B.DefensePost) && game.tick - m.lastBuild > 30) {
        // Fortify the contact zone.
        const tile = innerTile(game, p, nb.get(worst)!.tile, 3);
        if (tile >= 0 && checkPlacement(game, p, B.DefensePost, tile) === 'ok') {
          applyCommand(game, p.id, { t: 'build', kind: B.DefensePost, tile });
          m.lastBuild = game.tick;
        }
      }
    }
  }

  // 4. Expansion & offensive choice.
  const sinceAttack = game.tick - m.lastAttack;
  const ready = p.troops > cap * (0.36 / Math.max(0.5, t.aggression * diff.aggression));
  // Offensives against players are spaced out (51–260 s, shorter for aggressive nations);
  // an idle army (near its ceiling, no longer regenerating) is sent 1.5 times as often.
  const idle = p.troops > cap * AI_IDLE_ARMY;
  const warCooldown =
    AI_WAR_COOLDOWN / Math.max(0.5, t.aggression * diff.aggression) / (idle ? AI_WAR_IDLE_SPEEDUP : 1);
  if (ready && sinceAttack > AI_EXPAND_COOLDOWN) {
    // A neighbouring traitor is fair game whatever the war cooldown (OpenFront's findTraitor).
    const traitor = traitorTarget(game, p, nb);
    if (traitor) {
      applyCommand(game, p.id, {
        t: 'attack',
        tile: traitor.tile,
        ratio: offensiveRatio(p, game.players[traitor.id]!, t),
      });
      m.lastAttack = game.tick;
      m.lastWar = game.tick;
    } else if (nb.has(0) && !hasAttack(game, p, 0)) {
      applyCommand(game, p.id, { t: 'attack', tile: nb.get(0)!.tile, ratio: 0.25 + 0.1 * t.aggression });
      m.lastAttack = game.tick;
    } else {
      const target = game.tick - m.lastWar > warCooldown ? pickTarget(game, p, nb, m, t, cap) : null;
      if (target) {
        const q = game.players[target.id]!;
        applyCommand(game, p.id, { t: 'attack', tile: target.tile, ratio: offensiveRatio(p, q, t) });
        m.lastAttack = game.tick;
        if (q.kind !== 'tribe') m.lastWar = game.tick;
      } else if (idle || nb.size === 0 || (nb.size === 1 && nb.has(0) === false && game.rng.chance(0.3))) {
        cost += tryBoat(game, p, m, t, idle);
      }
    }
  } else if (nb.size === 0 && p.troops > cap * 0.5) {
    cost += tryBoat(game, p, m, t, idle);
  }

  // 5. Economy: build things.
  if (game.tick - m.lastBuild > AI_BUILD_COOLDOWN / t.build) cost += tryBuild(game, p, m, t, underAttack);

  // 6. Diplomacy. Boxed in by allies with an idle army, a nation lets the alliance with
  // its weakest neighbour lapse (and courts nobody new) so that it can fight again.
  if (m.prey === undefined || m.prey < 0 || !p.allies.has(m.prey))
    m.prey = p.troops > cap * AI_IDLE_ARMY ? lapsingAlly(game, p, nb) : -1;
  const prey = m.prey;
  if (game.tick - m.lastDiplo > 80) {
    m.lastDiplo = game.tick;
    cost += diplomacy(game, p, m, t, nb, prey);
  }
  answerRequests(game, p, m, prey);

  // 7. Nukes.
  if (game.config.allowNukes && game.tick - m.lastNuke > 300 / t.nukes) cost += tryNuke(game, p, m, t);

  // 7b. Air power (normal and up): raids, reconnaissance before offensives, fighters at landings.
  if (game.config.features.air && diff.aggression >= 1 && p.buildingCount[B.Airfield]! > 0)
    cost += tryAir(game, p, m, t, nb, incoming);

  // 8. Warships against threats.
  if (game.config.allowPorts && p.buildingCount[B.Port]! > 0 && game.rng.chance(0.05 * t.naval)) {
    const c = warshipCost(game, p);
    let fleet = 0;
    for (const u of game.units) if (u.alive && u.owner === p.id && u.type === U.Warship) fleet++;
    if (p.gold > c * 2 && fleet < 2 + p.buildingCount[B.Port]! * 2 && p.coast.length) {
      const wt = game.map.adjacentWater(p.coast[game.rng.int(0, p.coast.length - 1)]!);
      if (wt >= 0) applyCommand(game, p.id, { t: 'warship', tile: wt });
    }
  }

  // 9. Council vote.
  if (game.features.council && !game.features.council.votes.has(p.id)) {
    const leaderId = leader(game);
    const option = leaderId === p.id ? 2 : underAttack ? 2 : m.grudge.size && t.nukes < 1 ? 1 : 0;
    castVote(game, p, option);
  }
  return cost;
}

/**
 * Counter-attack size: enough to wipe out the incoming push in the clash (opposing attacks
 * cancel out), plus a strike at the attacker's home army only when we clearly outnumber it
 * (a leftover facing a bigger army would just crawl and bleed).
 */
function counterRatio(p: Player, enemy: Player, incoming: number): number {
  let send = incoming * 1.1;
  if (p.troops - send > enemy.troops * 1.5) send += enemy.troops;
  return Math.min(0.6, send / Math.max(1, p.troops));
}

/**
 * Share of the army sent on an offensive against q: a bite of AI_BITE of its army, within
 * limits (12–50 %, 55 % for aggressive nations; 40 / 45 % before the troop ceilings were
 * lowered, when late-game wars between large empires stalled).
 */
function offensiveRatio(p: Player, q: Player, t: Traits): number {
  const need = (q.troops * AI_BITE) / Math.max(1, p.troops);
  return Math.min(0.55, Math.max(0.12, Math.min(0.5, need)) * Math.min(1.2, t.aggression));
}

/**
 * The weakest neighbouring traitor not markedly stronger than p (OpenFront's findTraitor,
 * troops under ×AI_TRAITOR_MARGIN), allies included except on easy: they drop it first
 * (no betrayal: it is a traitor). Null when there is none, or p already attacks it.
 */
function traitorTarget(game: Game, p: Player, nb: Map<number, Neighbor>): Neighbor | null {
  let best: Neighbor | null = null;
  let bestTroops = Infinity;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!q.isTraitor(game.tick) || q.troops >= p.troops * AI_TRAITOR_MARGIN) continue;
    if (p.allies.has(q.id) && game.config.difficulty === 'easy') continue;
    if (!game.attackAllowed(p.id, q.id, true) || hasAttack(game, p, q.id)) continue;
    if (q.troops < bestTroops) {
      bestTroops = q.troops;
      best = n;
    }
  }
  return best;
}

function leader(game: Game): number {
  let best = -1;
  let bt = -1;
  for (const p of game.alivePlayers()) {
    if (p.kind !== 'tribe' && p.tiles > bt) {
      bt = p.tiles;
      best = p.id;
    }
  }
  return best;
}

function pickTarget(
  game: Game,
  p: Player,
  nb: Map<number, Neighbor>,
  m: Mem,
  t: Traits,
  cap: number,
): Neighbor | null {
  const diff = game.difficulty();
  const factor = p.troops > cap * AI_IDLE_ARMY ? Math.min(1, t.attackFactor) : t.attackFactor;
  let best: Neighbor | null = null;
  let bestScore = 0;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!game.attackAllowed(p.id, q.id, true)) continue;
    const allied = p.allies.has(q.id);
    if (allied) {
      // Betrayal: rare, only against much weaker allies, and never a friend of long standing.
      if (p.relation(q.id) >= AI_FRIENDLY) continue;
      if (!(game.rng.chance(diff.betrayal * 0.1 * t.aggression) && q.troops < p.troops * 0.35)) continue;
    }
    const strength = p.troops / Math.max(1, q.troops);
    if (strength < factor * AI_STRENGTH_MARGIN && q.kind !== 'tribe') continue;
    let score = strength * n.contact;
    if (q.kind === 'tribe') score *= 2.5;
    if (q.kind === 'human') score *= 0.9 + 0.3 * diff.aggression;
    score *= 1 + (m.grudge.get(q.id) ?? 0) * 0.05;
    if (q.isTraitor(game.tick)) score *= 1.5;
    // OpenFront's "hated" players (relation below −50: betrayed us, attacked us hard).
    if (p.relation(q.id) < RELATION_HOSTILE) score *= 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** A tile of p a few steps from `near` towards p's centroid (interior placement). */
function innerTile(game: Game, p: Player, near: number, steps: number): number {
  const w = game.map.width;
  const [cx, cy] = p.centroid(w);
  let x = near % w;
  let y = (near / w) | 0;
  const d = Math.hypot(cx - x, cy - y) || 1;
  x = Math.round(x + ((cx - x) / d) * steps);
  y = Math.round(y + ((cy - y) / d) * steps);
  if (!game.map.inBounds(x, y)) return -1;
  const tile = y * w + x;
  return game.owner[tile] === p.id ? tile : -1;
}

/** A random owned interior tile (sample border tile, walk towards the centroid). */
function randomInterior(game: Game, p: Player): number {
  if (p.border.length === 0) return p.spawnTile;
  for (let tries = 0; tries < 6; tries++) {
    const b = p.border[game.rng.int(0, p.border.length - 1)]!;
    const tile = innerTile(game, p, b, game.rng.int(6, 30));
    if (tile >= 0 && IS_LAND[game.map.terrain[tile]!]) return tile;
  }
  return -1;
}

/** Above this many structures per owned tile, nations upgrade rather than build (OpenFront). */
const AI_UPGRADE_DENSITY = 1 / 1500;

/** p's completed building of `kind` with the lowest level that can still be upgraded. */
function upgradeTarget(game: Game, p: Player, kind: B): Building | null {
  let best: Building | null = null;
  for (const b of game.buildings.values()) {
    if (
      b.owner !== p.id ||
      b.type !== kind ||
      b.buildLeft > 0 ||
      b.upgradeLeft > 0 ||
      b.level >= MAX_LEVEL[kind]
    )
      continue;
    if (!best || b.level < best.level) best = b;
  }
  return best;
}

/** A valid tile for a new `kind` (a few random tries), or -1. */
function findSpot(game: Game, p: Player, kind: B): number {
  for (let k = 0; k < 6; k++) {
    const c = kind === B.Port ? p.coast[game.rng.int(0, p.coast.length - 1)]! : randomInterior(game, p);
    if (c >= 0 && checkPlacement(game, p, kind, c) === 'ok') return c;
  }
  return -1;
}

function tryBuild(game: Game, p: Player, m: Mem, t: Traits, underAttack: boolean): number {
  const counts = p.buildingCount;
  // Cities come first (every level adds 60k troops to the ceiling); ports and
  // factories follow the city levels, silos and SAMs once the treasury allows.
  const scored: [B, number][] = [[B.City, 1.5 * t.build]];
  const cities = p.cityLevels;
  const ports = levelsOwned(game, p, B.Port);
  if (game.config.allowPorts && p.coast.length > 0 && t.trade > 0.3 && ports < Math.max(1, 0.75 * cities))
    scored.push([B.Port, (ports === 0 ? 2.2 : 1.2) * t.trade]);
  const factories = levelsOwned(game, p, B.Factory);
  if (game.config.allowFactories && cities >= 2 && factories < cities / 2)
    scored.push([B.Factory, factories === 0 ? 1.9 : 1.0]);
  // Wishes count levels: an upgrade fulfils them as well as a new building.
  if (
    game.config.allowNukes &&
    p.gold > 2_500_000 &&
    levelsOwned(game, p, B.Silo) < (t.nukes > 1 ? 3 : 1) &&
    game.tick - game.startTick > 3000
  )
    scored.push([B.Silo, 1.4 * t.nukes]);
  if (
    game.config.allowNukes &&
    (game.ai.nukedBy.has(p.id) || p.gold > 6_000_000) &&
    levelsOwned(game, p, B.Sam) < 1 + cities / 5
  )
    scored.push([B.Sam, game.ai.nukedBy.has(p.id) ? 3 : 1.2]);
  // Air power (normal and up, GAME_DESIGN.md §11): an airfield once at war (bombers, and
  // interceptors on alert), a second for aggressive nations or after a raid; a radar to guide
  // the interceptors (or, with the fog, to see).
  const raided = raider(game, p, AI_RAID_MEMORY) > 0;
  const flies = game.config.features.air && game.difficulty().aggression >= 1;
  const atWar = raided || m.grudge.size > 0 || game.tick - m.lastWar < 3000;
  if (flies && atWar && p.gold > 1_500_000) {
    const want = raided || (t.aggression > 1 && p.gold > 6_000_000) ? 2 : 1;
    if (levelsOwned(game, p, B.Airfield) < want) scored.push([B.Airfield, raided ? 2 : 1.1 * t.aggression]);
  }
  const radarUse = game.config.features.fog || (flies && (counts[B.Airfield]! > 0 || raided));
  if (game.config.features.radar && radarUse && counts[B.Radar]! < 1 && p.gold > 1_000_000)
    scored.push([B.Radar, raided ? 1.8 : 0.9]);
  // Research centres: their levels follow the city levels, by personality and difficulty.
  if (game.config.features.tech && cities >= 1) {
    const labs = levelsOwned(game, p, B.Lab);
    const want = Math.max(1, Math.round(cities * t.research * AI_RESEARCH[game.config.difficulty]));
    if (labs < want) scored.push([B.Lab, labs === 0 ? 1.8 : 0.6 + t.research]);
  }
  if (underAttack) scored[0]![1] *= 0.5;
  let structures = 0;
  for (let k = 0; k < counts.length; k++) structures += counts[k]!;
  const crowded = structures > p.tiles * AI_UPGRADE_DENSITY;
  // Weighted draw among what the treasury allows: cities stay the likeliest, but with
  // capped prices a rich nation would otherwise buy nothing but cities, never a SAM.
  const affordable = scored.filter(([kind]) => p.gold >= buildCost(game, p, kind));
  while (affordable.length > 0) {
    let total = 0;
    for (const [, w] of affordable) total += w;
    let r = game.rng.next() * total;
    let pick = 0;
    while (pick < affordable.length - 1 && r > affordable[pick]![1]) r -= affordable[pick++]![1];
    const [kind] = affordable.splice(pick, 1)[0]!;
    // Crowded land: upgrades cost the same and need no room.
    const upgradeFirst = crowded && counts[kind]! > 0 && MAX_LEVEL[kind] > 1;
    const tile = upgradeFirst ? -1 : findSpot(game, p, kind);
    if (tile >= 0) {
      applyCommand(game, p.id, { t: 'build', kind, tile });
      m.lastBuild = game.tick;
      return 60;
    }
    // No room (or crowded): upgrade an existing one instead.
    const up = upgradeTarget(game, p, kind);
    if (up) {
      applyCommand(game, p.id, { t: 'upgrade', id: up.id });
      m.lastBuild = game.tick;
      return 60;
    }
  }
  return 30;
}

/** Ticks between two raids (÷ aggression × difficulty), reconnaissance flights and fighter sorties. */
const AI_RAID_COOLDOWN = 450;
const AI_RECON_COOLDOWN = 600;
const AI_FIGHTER_COOLDOWN = 200;
/** A raid is remembered this long (airfield, radar, Aerospace)… */
const AI_RAID_MEMORY = 6000;
/** …and avenged by bombers this long after it. */
const AI_RETALIATION = 1800;

/** Who bombed p within the last `window` ticks (-1: nobody). */
function raider(game: Game, p: Player, window: number): number {
  const r = game.ai.raidedBy.get(p.id);
  return r && game.tick - r[1] <= window ? r[0] : -1;
}

/** Gold a nation keeps for its economy before paying for planes. */
const AI_AIR_RESERVE = 1_000_000;

/**
 * Air power. Raids on the country we fight (the defence post holding our offensive first,
 * SAMs before a nuclear strike, then silos, airfields, cities, labs, factories, ports): smart
 * nations see the SAMs and interceptors guarding a target and send enough bombers to empty
 * the SAMs, or look elsewhere. A reconnaissance plane over the front of an offensive (always
 * from hard, one in two on normal). A fighter at a transport sailing for our coast.
 */
function tryAir(
  game: Game,
  p: Player,
  m: Mem,
  t: Traits,
  nb: Map<number, Neighbor>,
  incoming: Map<number, number>,
): number {
  if (airLock(game, p) >= 0) return 0;
  const diff = game.difficulty();
  const w = game.map.width;
  let cost = 20;
  // Fighters: a hostile transport sailing for our coast, within reach of an airfield.
  if (
    game.tick - (m.lastFighter ?? -10_000) > AI_FIGHTER_COOLDOWN &&
    p.gold > AIR_COST[A.Fighter] + AI_AIR_RESERVE / 2
  ) {
    for (const u of game.units) {
      if (!u.alive || u.type !== U.Transport || u.dest !== p.id || game.friendly(u.owner, p.id)) continue;
      if (u.troops < Math.max(2_000, p.troops * 0.03)) continue;
      const f = airfieldFor(game, p, u.x, u.y);
      if (!f || f.d > FIGHTER_RANGE) continue;
      applyCommand(game, p.id, { t: 'air', kind: A.Fighter, tile: Math.floor(u.y) * w + Math.floor(u.x) });
      m.lastFighter = game.tick;
      cost += 30;
      break;
    }
  }
  // Whom we fight: our offensive's target, else the biggest attacker, else whoever bombed us.
  let enemy = -1;
  for (const a of game.attacks)
    if (!a.done && a.attacker === p.id && a.target > 0 && game.players[a.target]!.kind !== 'tribe')
      enemy = a.target;
  if (enemy < 0) {
    let most = 0;
    for (const [att, troops] of incoming) {
      if (troops > most && game.players[att]?.kind !== 'tribe') {
        enemy = att;
        most = troops;
      }
    }
  }
  if (enemy < 0) enemy = raider(game, p, AI_RETALIATION);
  const q = enemy > 0 ? game.players[enemy] : null;
  if (!q || !q.alive || game.friendly(p.id, q.id) || !game.attackAllowed(p.id, q.id, true)) return cost;

  // Reconnaissance over the front of an offensive under way.
  const front = nb.get(q.id);
  if (
    front &&
    hasAttack(game, p, q.id) &&
    game.tick - (m.lastRecon ?? -10_000) > AI_RECON_COOLDOWN &&
    p.gold > AIR_COST[A.Recon] + AI_AIR_RESERVE &&
    game.rng.chance(diff.targeting >= 0.9 ? 1 : 0.5)
  ) {
    const fx = (front.tile % w) + 0.5;
    const fy = Math.floor(front.tile / w) + 0.5;
    const f = airfieldFor(game, p, fx, fy);
    if (f && f.d <= RECON_RANGE && !spotted(game, p.id, fx, fy)) {
      applyCommand(game, p.id, { t: 'air', kind: A.Recon, tile: front.tile });
      m.lastRecon = game.tick;
      cost += 30;
    }
  }

  // Bombing raid.
  const raidEvery = AI_RAID_COOLDOWN / Math.max(0.5, t.aggression * diff.aggression);
  const bomber = AIR_COST[A.Bomber];
  if (game.tick - (m.lastRaid ?? -10_000) < raidEvery || p.gold < bomber + AI_AIR_RESERVE) return cost;
  m.lastRaid = game.tick;
  cost += 80;
  const fields: Building[] = [];
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === B.Airfield && b.buildLeft === 0) fields.push(b);
  // Our offensive's front against q (a few frontier tiles), to find the defence post holding it.
  const frontTiles: number[] = [];
  for (const a of game.attacks) {
    if (a.done || a.attacker !== p.id || a.target !== q.id) continue;
    const h = a.heapTiles;
    const step = Math.max(1, Math.floor(h.length / 8));
    for (let k = 0; k < h.length; k += step) frontTiles.push(h[k]!);
  }
  const nukes = game.config.allowNukes && p.buildingCount[B.Silo]! > 0;
  const sams: { b: Building; range: number }[] = [];
  for (const b of game.buildings.values())
    if (b.type === B.Sam && b.buildLeft === 0 && !game.friendly(b.owner, p.id))
      sams.push({ b, range: samRangeOf(game, b) });
  let best: Building | null = null;
  let bestScore = 0;
  let bestNeed = 1;
  for (const b of game.buildings.values()) {
    if (b.owner !== q.id) continue;
    if (!fields.some((f) => Math.hypot(f.x - b.x, f.y - b.y) <= BOMBER_RANGE)) continue;
    let score: number;
    switch (b.type) {
      case B.DefensePost: {
        const r2 = (DEFENSE_POST_RANGE + 5) ** 2;
        const onFront = frontTiles.some((ft) => ((ft % w) - b.x) ** 2 + (((ft / w) | 0) - b.y) ** 2 <= r2);
        score = onFront ? 9 : 0.5;
        break;
      }
      case B.Sam:
        score = nukes ? 6 : 2;
        break;
      case B.Silo:
        score = 4 + b.level;
        break;
      case B.Airfield:
        score = 4;
        break;
      case B.City:
        score = 2 + 0.6 * b.level;
        break;
      case B.Lab:
        score = 2.5;
        break;
      case B.Factory:
      case B.Port:
        score = 1.5 + 0.3 * b.level;
        break;
      default:
        score = 1;
    }
    // Defences on the way: loaded SAM missiles covering the target (each takes a bomber),
    // interceptors that would rise against it. Smart nations see them, dumb ones do not.
    // Defences: every nation sees the SAMs guarding the target itself (one bomber per loaded
    // missile); the smart ones also those along the route and the interceptors on alert.
    let need = 1;
    const smart = game.rng.chance(diff.targeting);
    let f0 = fields[0]!;
    for (const f of fields) if (Math.hypot(f.x - b.x, f.y - b.y) < Math.hypot(f0.x - b.x, f0.y - b.y)) f0 = f;
    for (const s of sams) {
      const d = smart
        ? segmentDist(s.b.x, s.b.y, f0.x, f0.y, b.x, b.y)
        : Math.hypot(s.b.x - b.x, s.b.y - b.y);
      if (d <= s.range) need += samMissilesReady(game, s.b);
    }
    if (smart) {
      game.grid.query(b.x, b.y, FIGHTER_RANGE, (id) => {
        const s = game.buildings.get(id)!;
        if (s.type !== B.Airfield || s.buildLeft > 0 || game.friendly(s.owner, p.id) || alertReady(s) < 0)
          return;
        const d = Math.hypot(s.x - b.x, s.y - b.y);
        if (d <= (radarSees(game, s.owner, b.x, b.y) ? FIGHTER_RANGE : SCRAMBLE_SIGHT)) score *= 0.5;
      });
    }
    score = score / need + game.rng.next() * (1 - diff.targeting) * 3;
    if (score > bestScore) {
      bestScore = score;
      best = b;
      bestNeed = need;
    }
  }
  if (!best || bestScore < 1) return cost;
  // Emptying a SAM takes a bomber per loaded missile, plus the one that gets through.
  const send = Math.min(
    bestNeed,
    diff.targeting >= 0.9 ? 4 : 2,
    Math.floor((p.gold - AI_AIR_RESERVE) / bomber),
  );
  if (send < bestNeed) return cost;
  for (let k = 0; k < send; k++) applyCommand(game, p.id, { t: 'air', kind: A.Bomber, tile: best.tile });
  return cost;
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}

function tryBoat(game: Game, p: Player, m: Mem, _t: Traits, idle = false): number {
  if (game.tick - m.lastBoat < 250 || p.coast.length === 0 || !game.config.allowPorts) return 0;
  m.lastBoat = game.tick;
  // Look for a weak foreign coast within ~250 tiles of one of our coastal tiles.
  const w = game.map.width;
  const from = p.coast[game.rng.int(0, p.coast.length - 1)]!;
  const fx = from % w;
  const fy = (from / w) | 0;
  for (let tries = 0; tries < 30; tries++) {
    const x = fx + game.rng.int(-250, 250);
    const y = fy + game.rng.int(-150, 150);
    if (!game.map.inBounds(x, y)) continue;
    const tile = y * w + x;
    if (!IS_LAND[game.map.terrain[tile]!]) continue;
    const o = game.owner[tile]!;
    if (o === p.id || (o > 0 && (game.friendly(o, p.id) || !game.attackAllowed(p.id, o, true)))) continue;
    if (o > 0 && game.players[o]!.troops > p.troops * 0.7) continue;
    // A shore in sight can lie thousands of tiles away by water (around a spiral, up a
    // long river): such a landing kept a third of the army at sea for over ten minutes.
    const plan = planBoat(game, p, tile);
    if (plan.path && pathLength(plan.path, w) > 4 * Math.hypot(x - fx, y - fy) + 200) continue;
    applyCommand(game, p.id, { t: 'boat', tile, ratio: 0.3 });
    return 400;
  }
  // An idle army with nothing in reach crosses the ocean: the weakest coastal country anywhere.
  if (idle) {
    let best: Player | null = null;
    for (const q of game.alivePlayers()) {
      if (q.id === p.id || q.coast.length === 0 || q.troops > p.troops * 0.9) continue;
      if (game.friendly(p.id, q.id) || !game.attackAllowed(p.id, q.id, true)) continue;
      if (!best || q.troops < best.troops) best = q;
    }
    if (best) {
      const before = game.units.length;
      applyCommand(game, p.id, {
        t: 'boat',
        tile: best.coast[game.rng.int(0, best.coast.length - 1)]!,
        ratio: 0.35,
      });
      if (game.units.length > before) return 400;
    }
  }
  return 60;
}

/** The weakest allied land neighbour when every neighbouring country is an ally (-1 otherwise). */
function lapsingAlly(game: Game, p: Player, nb: Map<number, Neighbor>): number {
  let weakest = -1;
  let weakestTroops = Infinity;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!p.allies.has(q.id)) {
      if (game.attackAllowed(p.id, q.id, true)) return -1; // an open front already
      continue;
    }
    if (q.troops < weakestTroops) {
      weakestTroops = q.troops;
      weakest = q.id;
    }
  }
  return weakest;
}

function diplomacy(
  game: Game,
  p: Player,
  m: Mem,
  t: Traits,
  nb: Map<number, Neighbor>,
  prey: number,
): number {
  // Propose alliances to strong neighbours we have no grudge against (nor a bad relation, OpenFront).
  for (const n of nb.values()) {
    if (n.id === 0 || prey >= 0) continue;
    const q = game.players[n.id]!;
    if (q.kind === 'tribe' || p.allies.has(q.id) || (m.grudge.get(q.id) ?? 0) > 5 || q.isTraitor(game.tick))
      continue;
    if (p.relation(q.id) < 0) continue;
    const exp = p.allies.get(q.id);
    if (exp !== undefined) continue;
    const strongerThanMe = q.troops > p.troops * 1.1;
    if (game.rng.chance(0.15 * t.diplomacy * (strongerThanMe ? 1.6 : 0.6))) {
      applyCommand(game, p.id, { t: 'allyRequest', target: q.id });
      return 20;
    }
  }
  // Renew alliances about to expire.
  for (const [ally, exp] of p.allies) {
    if (ally !== prey && exp - game.tick < 280 && game.rng.chance(0.6 * t.diplomacy))
      applyCommand(game, p.id, { t: 'allyRequest', target: ally });
  }
  // Help allies under attack.
  if (game.config.allowDonations && p.gold > 3_000_000 && game.rng.chance(0.1 * t.diplomacy)) {
    for (const ally of p.allies.keys()) {
      if (game.attacks.some((a) => !a.done && a.target === ally)) {
        applyCommand(game, p.id, { t: 'donate', target: ally, gold: p.gold * 0.1, troops: 0 });
        break;
      }
    }
  }
  return 20;
}

/** What weighs on a nation's answer to an alliance offer (shares of probability). */
export type OddsFactor = 'temper' | 'stronger' | 'weaker' | 'grudge' | 'betrayed' | 'human' | 'goodwill';

/**
 * How likely nation p is to accept q's alliance offer, and why. `p` is the probability of
 * the roll (0.02 … 0.95); `refusal` a reason that turns the offer down whatever the roll:
 * p resents q (relation below 0, OpenFront) — or q is a traitor, refused 9 times in 10.
 * `chance` combines them: the honest odds of an offer sent now.
 */
export function allianceOdds(
  game: Game,
  p: Player,
  q: Player,
): { p: number; chance: number; refusal: 'resent' | 'traitor' | null; factors: [OddsFactor, number][] } {
  const t = TRAITS[p.personality];
  const diff = game.difficulty();
  const grudge = game.ai.mem.get(p.id)?.grudge.get(q.id) ?? 0;
  const factors: [OddsFactor, number][] = [['temper', 0.35 * t.diplomacy]];
  factors.push(q.troops > p.troops ? ['stronger', 0.25] : ['weaker', -0.1]);
  if (grudge > 0) factors.push(['grudge', -grudge * 0.05]);
  if (p.betrayedBy.has(q.id) || q.isTraitor(game.tick)) factors.push(['betrayed', -0.6]);
  if (q.kind === 'human') factors.push(['human', -0.1 * diff.aggression]);
  // Isoline's goodwill (alliances, trade, gifts, common enemies) makes a yes likelier.
  const rel = p.relation(q.id);
  if (rel > 0) factors.push(['goodwill', rel * AI_GOODWILL_ODDS]);
  let sum = 0;
  for (const [, v] of factors) sum += v;
  const roll = Math.max(0.02, Math.min(0.95, sum));
  const refusal = rel < 0 ? 'resent' : q.isTraitor(game.tick) ? 'traitor' : null;
  const chance = refusal === 'resent' ? 0 : refusal === 'traitor' ? roll * (1 - AI_TRAITOR_REFUSAL) : roll;
  return { p: roll, chance, refusal, factors };
}

function answerRequests(game: Game, p: Player, m: Mem, prey: number): void {
  for (const [from] of p.allyRequests) {
    if (!m.pendingAnswers.has(from)) m.pendingAnswers.set(from, game.tick + game.rng.int(20, 60));
  }
  for (const [from, at] of m.pendingAnswers) {
    if (!p.allyRequests.has(from)) {
      m.pendingAnswers.delete(from);
      continue;
    }
    if (game.tick < at) continue;
    m.pendingAnswers.delete(from);
    const q = game.players[from]!;
    const pAccept = allianceOdds(game, p, q).p;
    // OpenFront: a traitor is nearly always turned down, and so is anyone we feel badly about.
    const distrust = p.relation(from) < 0 || (q.isTraitor(game.tick) && game.rng.chance(AI_TRAITOR_REFUSAL));
    applyCommand(game, p.id, {
      t: 'allyAnswer',
      target: from,
      accept: !distrust && from !== prey && game.rng.chance(pAccept),
    });
  }
}

/** Smart AIs flip the arc when the default one flies into an enemy SAM and the other doesn't. */
function arcAvoidingSams(game: Game, p: Player, kind: N, tile: number, smart: number): boolean {
  const silo = launchSilo(game, p, tile);
  if (!silo || !game.rng.chance(smart)) return true;
  const sams = hostileSams(game, p);
  const w = game.map.width;
  const [sx, sy, tx, ty] = [silo.x + 0.5, silo.y + 0.5, (tile % w) + 0.5, ((tile / w) | 0) + 0.5];
  const caught = (arc: number) =>
    predictInterception(
      new Trajectory(sx, sy, tx, ty, arc, game.map.height),
      tx,
      ty,
      NUKE_SPEED[kind],
      sams,
    ) >= 0;
  return !(caught(ARC_UP) && !caught(ARC_DOWN));
}

function tryNuke(game: Game, p: Player, m: Mem, t: Traits): number {
  if (p.buildingCount[B.Silo] === 0) return 0;
  const diff = game.difficulty();
  // Who deserves it? Revenge first, then the biggest grudge, then the leader (warmongers).
  let enemy = -1;
  for (const [victim, by] of game.ai.nukedBy) if (victim === p.id && game.players[by]?.alive) enemy = by;
  if (enemy < 0) {
    let g = 8 / t.nukes;
    for (const [id, v] of m.grudge) {
      if (v > g && game.players[id]?.alive && !p.allies.has(id)) {
        g = v;
        enemy = id;
      }
    }
  }
  if (enemy < 0 && t.nukes > 1.2 && game.tick - game.startTick > 9000) {
    const l = leader(game);
    if (l !== p.id && !p.allies.has(l)) enemy = l;
  }
  if (enemy < 0 || !game.attackAllowed(p.id, enemy, true)) return 10;
  const kind =
    p.gold > nukeCost(game, p, N.Hydrogen) * 1.5 && maxLaunchable(game, p, N.Hydrogen) > 0
      ? N.Hydrogen
      : N.Atom;
  if (maxLaunchable(game, p, kind) === 0) return 10;
  // Target quality: densest cluster of enemy cities/silos (difficulty-dependent accuracy).
  let best = -1;
  let bestScore = -1;
  for (const b of game.buildings.values()) {
    if (b.owner !== enemy) continue;
    let score =
      b.type === B.Silo
        ? 6
        : b.type === B.City
          ? 3 + b.level
          : b.type === B.Factory || b.type === B.Port
            ? 2
            : 1;
    // Avoid SAM-covered targets when the AI is smart enough.
    if (game.rng.chance(diff.targeting)) {
      game.grid.query(b.x, b.y, 140, (id) => {
        const s = game.buildings.get(id)!;
        if (s.type === B.Sam && s.owner === enemy && Math.hypot(s.x - b.x, s.y - b.y) < samRangeOf(game, s))
          score *= 0.4;
      });
    }
    score += game.rng.next() * (1 - diff.targeting) * 4;
    if (score > bestScore) {
      bestScore = score;
      best = b.tile;
    }
  }
  if (best < 0) {
    const q = game.players[enemy]!;
    if (q.border.length === 0) return 10;
    best = q.border[game.rng.int(0, q.border.length - 1)]!;
  }
  applyCommand(game, p.id, {
    t: 'nuke',
    kind,
    tile: best,
    count: kind === N.Atom ? Math.min(3, maxLaunchable(game, p, kind)) : 1,
    up: arcAvoidingSams(game, p, kind, best, diff.targeting),
  });
  m.lastNuke = game.tick;
  return 120;
}
