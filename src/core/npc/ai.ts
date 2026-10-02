// Automated nations and tribes. Runs inside the deterministic simulation:
// every decision uses game.rng and a deterministic work budget (no wall clock),
// so all lockstep peers compute identical AI behaviour.
import type { Game } from '../game/state';
import type { Player, Personality } from '../game/player';
import { applyCommand } from '../game/commands';
import { B, N, NUKE_SPEED, RELATION_HOSTILE } from '../game/constants';
import { IS_LAND } from '../map/terrain';
import { MAX_LEVEL, buildCost, checkPlacement, levelsOwned } from '../buildings/buildings';
import { hostileSams, launchSilo, maxLaunchable, nukeCost, samRangeOf } from '../units/nukes';
import { ARC_DOWN, ARC_UP, Trajectory, predictInterception } from '../units/trajectory';
import { U } from '../units/unit';
import { warshipCost } from '../units/ships';
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
}

export interface AIState {
  mem: Map<number, Mem>;
  nukedBy: Map<number, number>; // victim → last attacker
  cursor: number;
}

export function createAIState(): AIState {
  return { mem: new Map(), nukedBy: new Map(), cursor: 1 };
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
    const goal = sam >= 0 ? sam : p.researching < 0 ? planGoal(p.tech, NATION_RESEARCH[p.personality]) : -1;
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
  answerRequests(game, p, m, t, prey);

  // 7. Nukes.
  if (game.config.allowNukes && game.tick - m.lastNuke > 300 / t.nukes) cost += tryNuke(game, p, m, t);

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
      // Betrayal: rare, only against much weaker allies.
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
    if (b.owner !== p.id || b.type !== kind || b.buildLeft > 0 || b.level >= MAX_LEVEL[kind]) continue;
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
  if (game.config.features.radar && counts[B.Radar]! < 1 && p.gold > 1_000_000) scored.push([B.Radar, 0.9]);
  if (game.config.features.air && counts[B.Airfield]! < 1 && p.gold > 3_000_000 && t.aggression > 1)
    scored.push([B.Airfield, 1.1]);
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

function answerRequests(game: Game, p: Player, m: Mem, t: Traits, prey: number): void {
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
    const diff = game.difficulty();
    const betrayed = p.betrayedBy.has(from) || q.isTraitor(game.tick);
    const grudge = m.grudge.get(from) ?? 0;
    let pAccept = 0.35 * t.diplomacy + (q.troops > p.troops ? 0.25 : -0.1) - grudge * 0.05;
    if (betrayed) pAccept -= 0.6;
    if (q.kind === 'human') pAccept -= 0.1 * diff.aggression;
    // OpenFront: a traitor is nearly always turned down, and so is anyone we feel badly about.
    const distrust = p.relation(from) < 0 || (q.isTraitor(game.tick) && game.rng.chance(AI_TRAITOR_REFUSAL));
    applyCommand(game, p.id, {
      t: 'allyAnswer',
      target: from,
      accept: !distrust && from !== prey && game.rng.chance(Math.max(0.02, Math.min(0.95, pAccept))),
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
