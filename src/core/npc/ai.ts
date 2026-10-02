// Automated nations and tribes. Runs inside the deterministic simulation:
// every decision uses game.rng and a deterministic work budget (no wall clock),
// so all lockstep peers compute identical AI behaviour.
import type { Game } from '../game/state';
import type { Player, Personality } from '../game/player';
import { applyCommand } from '../game/commands';
import { B, N } from '../game/constants';
import { IS_LAND } from '../map/terrain';
import { buildCost, checkPlacement } from '../buildings/buildings';
import { maxLaunchable, nukeCost } from '../units/nukes';
import { U } from '../units/unit';
import { warshipCost } from '../units/ships';
import { castVote } from '../rules/features';
import { populationCap } from '../game/economy';

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
  troopRatio: number;
  aggression: number; // propensity to attack
  attackFactor: number; // required strength ratio
  build: number;
  trade: number;
  diplomacy: number;
  nukes: number;
  naval: number;
  research: number[]; // branch preference order
}

const TRAITS: Record<Personality, Traits> = {
  expansionist: {
    troopRatio: 0.62,
    aggression: 1.2,
    attackFactor: 1.0,
    build: 0.8,
    trade: 0.6,
    diplomacy: 0.5,
    nukes: 0.6,
    naval: 0.6,
    research: [1, 0, 4, 2, 3],
  },
  builder: {
    troopRatio: 0.5,
    aggression: 0.7,
    attackFactor: 1.4,
    build: 1.5,
    trade: 1.0,
    diplomacy: 0.8,
    nukes: 0.5,
    naval: 0.6,
    research: [0, 4, 1, 2, 3],
  },
  merchant: {
    troopRatio: 0.45,
    aggression: 0.6,
    attackFactor: 1.5,
    build: 1.1,
    trade: 1.6,
    diplomacy: 1.0,
    nukes: 0.4,
    naval: 1.3,
    research: [0, 2, 4, 1, 3],
  },
  diplomat: {
    troopRatio: 0.55,
    aggression: 0.6,
    attackFactor: 1.3,
    build: 1.0,
    trade: 1.1,
    diplomacy: 1.8,
    nukes: 0.3,
    naval: 0.8,
    research: [0, 4, 2, 1, 3],
  },
  isolationist: {
    troopRatio: 0.6,
    aggression: 0.5,
    attackFactor: 1.6,
    build: 1.2,
    trade: 0.5,
    diplomacy: 0.4,
    nukes: 0.8,
    naval: 1.0,
    research: [4, 1, 0, 3, 2],
  },
  warmonger: {
    troopRatio: 0.75,
    aggression: 1.6,
    attackFactor: 0.85,
    build: 0.7,
    trade: 0.4,
    diplomacy: 0.3,
    nukes: 1.5,
    naval: 1.0,
    research: [1, 3, 4, 2, 0],
  },
};

const NB = new Int32Array(4);
/** Nations think every 3–6 s (× difficulty): a measured, management-heavy pace. */
const AI_THINK_MIN = 30;
const AI_THINK_MAX = 60;
/** Minimum delay between two expansion orders, and between two wars, in ticks. */
const AI_EXPAND_COOLDOWN = 40;
const AI_WAR_COOLDOWN = 300;
const AI_BUILD_COOLDOWN = 120;
/** Extra strength a nation wants over its target before declaring war. */
const AI_STRENGTH_MARGIN = 1.4;

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

function hasAttack(game: Game, p: Player, target: number): boolean {
  return game.attacks.some((a) => !a.done && a.attacker === p.id && a.target === target);
}

// ------------------------------------------------------------------ tribes
function thinkTribe(game: Game, p: Player, m: Mem): number {
  const nb = neighbors(game, p, 24);
  const cap = populationCap(game, p);
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
  const cap = populationCap(game, p);
  const incoming = incomingAttacks(game, p);
  const underAttack = incoming.size > 0;
  for (const [att, troops] of incoming) m.grudge.set(att, (m.grudge.get(att) ?? 0) + troops / 1000);

  // 1. Troop/worker balance (rebalance under pressure).
  const wanted = Math.min(0.9, t.troopRatio + (underAttack ? 0.15 : 0));
  if (Math.abs(p.troopRatio - wanted) > 0.04) applyCommand(game, p.id, { t: 'troopRatio', ratio: wanted });

  // 2. Research.
  if (game.config.features.tech && p.researching < 0) {
    for (const b of t.research) {
      if (p.tech[b]! < 4) {
        applyCommand(game, p.id, { t: 'research', tech: b });
        break;
      }
    }
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
          ratio: Math.min(0.6, 0.3 * t.aggression),
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
  // Offensives against players are spaced out (20–40 s, shorter for aggressive nations).
  const warCooldown = AI_WAR_COOLDOWN / Math.max(0.5, t.aggression * diff.aggression);
  if (ready && sinceAttack > AI_EXPAND_COOLDOWN) {
    if (nb.has(0) && !hasAttack(game, p, 0)) {
      applyCommand(game, p.id, { t: 'attack', tile: nb.get(0)!.tile, ratio: 0.25 + 0.1 * t.aggression });
      m.lastAttack = game.tick;
    } else {
      const target = game.tick - m.lastWar > warCooldown ? pickTarget(game, p, nb, m, t) : null;
      if (target) {
        const q = game.players[target.id]!;
        const need = (q.troops * 1.1) / Math.max(1, p.troops);
        const ratio = Math.max(0.12, Math.min(0.4, need)) * Math.min(1.2, t.aggression);
        applyCommand(game, p.id, { t: 'attack', tile: target.tile, ratio: Math.min(0.45, ratio) });
        m.lastAttack = game.tick;
        if (q.kind !== 'tribe') m.lastWar = game.tick;
      } else if (nb.size === 0 || (nb.size === 1 && nb.has(0) === false && game.rng.chance(0.3))) {
        cost += tryBoat(game, p, m, t);
      }
    }
  } else if (nb.size === 0 && p.troops > cap * 0.5) {
    cost += tryBoat(game, p, m, t);
  }

  // 5. Economy: build things.
  if (game.tick - m.lastBuild > AI_BUILD_COOLDOWN / t.build) cost += tryBuild(game, p, m, t, underAttack);

  // 6. Diplomacy.
  if (game.tick - m.lastDiplo > 80) {
    m.lastDiplo = game.tick;
    cost += diplomacy(game, p, m, t, nb);
  }
  answerRequests(game, p, m, t);

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

function pickTarget(game: Game, p: Player, nb: Map<number, Neighbor>, m: Mem, t: Traits): Neighbor | null {
  const diff = game.difficulty();
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
    if (strength < t.attackFactor * AI_STRENGTH_MARGIN && q.kind !== 'tribe') continue;
    let score = strength * n.contact;
    if (q.kind === 'tribe') score *= 2.5;
    if (q.kind === 'human') score *= 0.9 + 0.3 * diff.aggression;
    score *= 1 + (m.grudge.get(q.id) ?? 0) * 0.05;
    if (q.isTraitor(game.tick)) score *= 1.5;
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

function tryBuild(game: Game, p: Player, m: Mem, t: Traits, underAttack: boolean): number {
  const counts = p.buildingCount;
  // Weighted wishes: the first port and first factory matter more than the n-th city.
  const scored: [B, number][] = [];
  const cities = counts[B.City]!;
  const cityTarget = 2 + p.tiles / 6000;
  if (cities < cityTarget) scored.push([B.City, (1 + (cityTarget - cities) / cityTarget) * t.build]);
  if (game.config.allowPorts && p.coast.length > 0 && counts[B.Port]! < 1 + cities / 2 && t.trade > 0.3)
    scored.push([B.Port, (counts[B.Port]! === 0 ? 2.2 : 1.1) * t.trade]);
  if (game.config.allowFactories && cities >= 2 && counts[B.Factory]! < cities / 2)
    scored.push([B.Factory, counts[B.Factory]! === 0 ? 1.9 : 1.0]);
  if (
    game.config.allowNukes &&
    p.gold > 2_500_000 &&
    counts[B.Silo]! < (t.nukes > 1 ? 3 : 1) &&
    game.tick - game.startTick > 3000
  )
    scored.push([B.Silo, 1.4 * t.nukes]);
  if (
    game.config.allowNukes &&
    (game.ai.nukedBy.has(p.id) || p.gold > 6_000_000) &&
    counts[B.Sam]! < 1 + cities / 3
  )
    scored.push([B.Sam, game.ai.nukedBy.has(p.id) ? 3 : 1.2]);
  if (game.config.features.radar && counts[B.Radar]! < 1 && p.gold > 1_000_000) scored.push([B.Radar, 0.9]);
  if (game.config.features.air && counts[B.Airfield]! < 1 && p.gold > 3_000_000 && t.aggression > 1)
    scored.push([B.Airfield, 1.1]);
  if (!underAttack && scored.length === 0) scored.push([B.City, 0.5]);
  scored.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const wish = scored.map(([k]) => k);
  for (const kind of wish) {
    const price = buildCost(game, p, kind);
    if (p.gold < price) continue;
    let tile = -1;
    if (kind === B.Port) {
      for (let k = 0; k < 6 && tile < 0; k++) {
        const c = p.coast[game.rng.int(0, p.coast.length - 1)]!;
        if (checkPlacement(game, p, kind, c) === 'ok') tile = c;
      }
    } else {
      for (let k = 0; k < 6 && tile < 0; k++) {
        const c = randomInterior(game, p);
        if (c >= 0 && checkPlacement(game, p, kind, c) === 'ok') tile = c;
      }
    }
    if (tile >= 0) {
      applyCommand(game, p.id, { t: 'build', kind, tile });
      m.lastBuild = game.tick;
      return 60;
    }
  }
  return 30;
}

function tryBoat(game: Game, p: Player, m: Mem, _t: Traits): number {
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
  return 60;
}

function diplomacy(game: Game, p: Player, m: Mem, t: Traits, nb: Map<number, Neighbor>): number {
  // Propose alliances to strong neighbours we have no grudge against.
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (q.kind === 'tribe' || p.allies.has(q.id) || (m.grudge.get(q.id) ?? 0) > 5 || q.isTraitor(game.tick))
      continue;
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
    if (exp - game.tick < 280 && game.rng.chance(0.6 * t.diplomacy))
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

function answerRequests(game: Game, p: Player, m: Mem, t: Traits): void {
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
    applyCommand(game, p.id, {
      t: 'allyAnswer',
      target: from,
      accept: game.rng.chance(Math.max(0.02, Math.min(0.95, pAccept))),
    });
  }
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
        if (s.type === B.Sam && s.owner === enemy && Math.hypot(s.x - b.x, s.y - b.y) < 90) score *= 0.4;
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
  });
  m.lastNuke = game.tick;
  return 120;
}
