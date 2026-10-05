// Land attacks, ported from OpenFront's AttackExecution and attackLogic: every tick an
// attack takes the tiles of its front until its tick budget is spent, each tile costing
// a share of the tick (troop ratio, terrain, length of the front) and troops on both
// sides. Only the order in which tiles fall is Isoline's own: a weighted flood fill
// (min-heap keyed by an eikonal "arrival time") that grows rounded fronts.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  ANNEX_TILES,
  ATTACKER_LOSS_BASE,
  ATTACKER_LOSS_PER_DENSITY,
  BORDER_JITTER,
  FALLOUT_COMBAT_MULT,
  FALLOUT_COMBAT_SLOPE,
  HOPELESS_MAX,
  HOPELESS_RATIO,
  LARGE_ATTACKER_DEPTH,
  LARGE_ATTACKER_SPEED_DEPTH,
  LARGE_DEFENDER_DEPTH,
  LARGE_TERRITORY_MIDPOINT,
  LARGE_TERRITORY_STEEPNESS,
  LOSS_RATIO_MAX,
  LOSS_RATIO_MIN,
  MAX_ATTACKS_PER_PLAYER,
  RETREAT_DELAY_TICKS,
  RETREAT_MALUS,
  SPEED_COST_DIVISOR,
  SPEED_RATIO_MAX,
  SPEED_RATIO_MIN,
  TERRA_NULLIUS_BUDGET,
  TERRA_NULLIUS_COST_SCALE,
  TERRA_NULLIUS_MAX_COST,
  TERRA_NULLIUS_MIN_COST,
  TRAITOR_DEFENSE_MULT,
  TRAITOR_SPEED_MULT,
  TRIBE_DEFENDER_LOSS_MULT,
  WILD_LOSS_DIV,
  WILD_LOSS_DIV_TRIBE,
  WILD_REACH,
} from '../game/constants';
import { HARSH, IS_LAND, MAG, SPEED } from '../map/terrain';
import { hash2 } from '../rng';
import { addGold } from '../game/economy';
import { capitalSpeedMult } from './capital';
import { guerrilla } from './revolution';

export class Attack {
  readonly id: number;
  readonly attacker: number;
  readonly target: number;
  troops: number;
  /** Arrival time of the last tile taken (the front's progress along the eikonal clock). */
  clock = 0;
  /** Clock value at which the attacker's pre-existing border tiles are considered "reached". */
  seedClock = 0;
  createdTick: number;
  heapTiles: number[] = [];
  heapPri: number[] = [];
  /** Target tiles on the attack's front (OpenFront's attack border): queued and not taken yet. */
  border = new Set<number>();
  /** Started from a transport's landing tile: kept apart from the other attacks on that target. */
  boat = false;
  /** Tick at which an ordered retreat brings the troops home (-1: none); the attack halts meanwhile. */
  retreatAt = -1;
  conquered = 0;
  done = false;

  constructor(id: number, attacker: number, target: number, troops: number, tick: number) {
    this.id = id;
    this.attacker = attacker;
    this.target = target;
    this.troops = troops;
    this.createdTick = tick;
  }

  push(tile: number, pri: number): void {
    const t = this.heapTiles;
    const p = this.heapPri;
    let k = t.length;
    t.push(tile);
    p.push(pri);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (p[parent]! <= pri) break;
      t[k] = t[parent]!;
      p[k] = p[parent]!;
      k = parent;
    }
    t[k] = tile;
    p[k] = pri;
  }

  peekPri(): number {
    return this.heapPri.length ? this.heapPri[0]! : Infinity;
  }

  pop(): number {
    const t = this.heapTiles;
    const p = this.heapPri;
    const top = t[0]!;
    const lastT = t.pop()!;
    const lastP = p.pop()!;
    const n = t.length;
    if (n > 0) {
      let k = 0;
      while (true) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1]! < p[c]!) c++;
        if (p[c]! >= lastP) break;
        t[k] = t[c]!;
        p[k] = p[c]!;
        k = c;
      }
      t[k] = lastT;
      p[k] = lastP;
    }
    return top;
  }

  get frontierSize(): number {
    return this.heapTiles.length;
  }
}

const NB = new Int32Array(4);

/** OpenFront's tile cost on plains (terrain SPEED); the front's shape uses costs relative to it. */
const PLAINS_COST = 16.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * OpenFront's big-territory bonus: ~1 for small countries, easing down to
 * 1 − depth for huge ones, halfway at LARGE_TERRITORY_MIDPOINT tiles (a logistic in log(tiles)).
 */
export function largeTerritoryBonus(tiles: number, depth: number): number {
  return 1 - depth / (1 + Math.pow(LARGE_TERRITORY_MIDPOINT / Math.max(1, tiles), LARGE_TERRITORY_STEEPNESS));
}

/**
 * Fallout on the tile multiplies losses and tile cost by 5 − 2 × (share of the land under
 * fallout), as OpenFront's falloutDefenseModifier (×5 while little land is irradiated).
 */
function falloutMult(game: Game, tile: number): number {
  if (game.fallout[tile] === 0) return 1;
  const land = Math.max(1, game.map.landCount);
  return FALLOUT_COMBAT_MULT - (FALLOUT_COMBAT_SLOPE * Math.max(0, land - game.usefulLand)) / land;
}

/** Relative cost of crossing tile i for the front's shape (1 = plains): terrain, defence posts, fallout. */
function tileCost(game: Game, tile: number, target: number): number {
  const t = game.map.terrain[tile]!;
  let cost = (SPEED[t]! / PLAINS_COST) * falloutMult(game, tile);
  if (target > 0) cost *= game.defenseSpeedMult(tile, target);
  return cost;
}

/**
 * Speed of the attacker (general Blitz, technologies, disorganisation after losing its
 * capital): divides the cost of every tile.
 */
function attackSpeedMult(game: Game, p: Player): number {
  return (p.blitzUntil > game.tick ? 1.3 : 1) * game.techSpeedMult(p.id) * capitalSpeedMult(game, p);
}

export interface TileOutcome {
  /** Troops the attack loses taking the tile. */
  attackerLoss: number;
  /** Troops the defender loses (its troops per tile). */
  defenderLoss: number;
  /** Share of the tick's budget (1) the tile uses up. */
  tickFraction: number;
}

/**
 * OpenFront's attackLogic for attack `a` taking `tile`, with `borderSize` tiles on its
 * front this tick. mag and tile cost come from the terrain, ×5 / ×3 near an enemy
 * defence post, ×(5 − 2 × fallout share) on fallout; mag ×0.75 inside the attacker's
 * reconnaissance zone (Isoline's aviation); both × the guerrilla's on a revolution's land
 * (rules/revolution.ts).
 * - Wilderness: loss mag / 5 (tribes mag / 10); fraction clamp(2,000 × cost / troops, 5, 100) / (2 × border),
 *   the bounds × cost / 16.5 on glaciers and high peaks.
 * - Player: loss mag × clamp(r, 0.6, 2) × (0.463 × bonus(A, 0.7) × bonus(D, 0.3) + 0.0039 × D troops per tile),
 *   ×0.7 against a tribe, ×0.5 against a traitor; the defender loses its troops per tile;
 *   fraction clamp(r, 0.82, 7.5) × clamp(r / 20, 1, 50) / 8.55 × cost × bonus(A, 0.73) × bonus(D, 0.3)
 *   (×0.8 against a traitor) / border.
 */
export function attackLogic(game: Game, a: Attack, tile: number, borderSize: number): TileOutcome {
  const t = game.map.terrain[tile]!;
  const A = game.players[a.attacker]!;
  const T = a.target > 0 ? game.players[a.target]! : null;
  let mag = MAG[t]! * game.techMagMult(a.attacker, t);
  let cost = SPEED[t]!;
  if (T) {
    mag *= game.defenseMagMult(tile, a.target) * game.reconLossMult(a.attacker, tile);
    cost *= game.defenseSpeedMult(tile, a.target);
    // Revolutions (1.16): guerrilla in every street, barricades right after the outbreak.
    if (T.revolution) {
      const g = guerrilla(game, T, a.attacker);
      mag *= g.mag;
      cost *= g.speed;
    }
  }
  const fo = falloutMult(game, tile);
  mag *= fo;
  cost *= fo;
  const troops = Math.max(1, a.troops);
  const border = Math.max(1, borderSize) * attackSpeedMult(game, A);
  if (!T) {
    // OpenFront's floor makes every wild tile cost the same to a large army. Glaciers and
    // high peaks (Isoline's) keep their slowness at any size: the floor and the ceiling
    // scale with their cost (×1.9 and ×2.2 the plains), so they stay slow to settle.
    const harsh = HARSH[t] ? SPEED[t]! / PLAINS_COST : 1;
    return {
      attackerLoss: mag / (A.kind === 'tribe' ? WILD_LOSS_DIV_TRIBE : WILD_LOSS_DIV),
      defenderLoss: 0,
      tickFraction:
        clamp(
          (TERRA_NULLIUS_COST_SCALE * cost) / troops,
          TERRA_NULLIUS_MIN_COST * harsh,
          TERRA_NULLIUS_MAX_COST * harsh,
        ) /
        (TERRA_NULLIUS_BUDGET * border),
    };
  }
  // (Revolutionaries defend like a country: rules/revolution.ts.)
  if (T.kind === 'tribe' && A.kind !== 'tribe' && !T.revolution) mag *= TRIBE_DEFENDER_LOSS_MULT;
  const traitor = T.debuffUntil > game.tick;
  const bonusD = largeTerritoryBonus(T.tiles, LARGE_DEFENDER_DEPTH);
  const defenderLoss = T.troops / Math.max(1, T.tiles);
  const r = T.troops / troops;
  const attackerLoss =
    mag *
    (traitor ? TRAITOR_DEFENSE_MULT : 1) *
    clamp(r, LOSS_RATIO_MIN, LOSS_RATIO_MAX) *
    (ATTACKER_LOSS_BASE * largeTerritoryBonus(A.tiles, LARGE_ATTACKER_DEPTH) * bonusD +
      ATTACKER_LOSS_PER_DENSITY * defenderLoss) *
    game.eventDefenseMult(a.target);
  const speedCost =
    (clamp(r, SPEED_RATIO_MIN, SPEED_RATIO_MAX) * clamp(r / HOPELESS_RATIO, 1, HOPELESS_MAX)) /
    SPEED_COST_DIVISOR;
  return {
    attackerLoss,
    defenderLoss,
    tickFraction:
      (speedCost *
        cost *
        largeTerritoryBonus(A.tiles, LARGE_ATTACKER_SPEED_DEPTH) *
        bonusD *
        (traitor ? TRAITOR_SPEED_MULT : 1)) /
      border,
  };
}

/** Border size of `a` this tick: its front plus OpenFront's 0–4 jitter (hash-based, deterministic). */
export function borderSizeOf(game: Game, a: Attack): number {
  return a.border.size + (hash2(a.id, game.tick, game.config.seed) % BORDER_JITTER);
}

const FRONT_SHAPE = 0.02;

function jitter(game: Game, tile: number, attackId: number): number {
  return 0.65 + (hash2(tile, attackId, game.config.seed) & 1023) / 1460;
}

function enqueueNeighbors(game: Game, a: Attack, tile: number): void {
  const owner = game.owner;
  const map = game.map;
  const n = map.neighbors4(tile, NB);
  for (let k = 0; k < n; k++) {
    const j = NB[k]!;
    if (owner[j] !== a.target || !IS_LAND[map.terrain[j]!] || game.isDead(j)) continue;
    pushFrontier(game, a, j);
  }
}

/** Queues (or re-queues earlier) frontier tile j at its eikonal arrival time; it joins the attack's border. */
function pushFrontier(game: Game, a: Attack, j: number): void {
  const t = Math.fround(arrivalTime(game, a, j));
  if (a.border.has(j) && game.queuedBy[j] === a.id && t >= game.frontTime[j]!) return;
  game.queuedBy[j] = a.id;
  game.frontTime[j] = t;
  a.border.add(j);
  a.push(j, t);
}

/**
 * Arrival time of the attack at tile j, from its conquered orthogonal neighbours,
 * solved like a fast-marching eikonal update: with one horizontal and one vertical
 * neighbour reached at times th and tv, T = (th + tv + sqrt(2c² − (th − tv)²)) / 2,
 * which makes diagonal fronts advance at the same Euclidean speed as straight
 * ones (a plain 4-neighbour wave grows Manhattan diamonds). A small 5×5 term
 * fills concave pockets first and slows convex tips, keeping fronts organic.
 */
function arrivalTime(game: Game, a: Attack, j: number): number {
  const map = game.map;
  const owner = game.owner;
  const w = map.width;
  const x = j % w;
  const y = (j - x) / w;
  const reached = (q: number): number =>
    owner[q] !== a.attacker ? Infinity : game.queuedBy[q] === a.id ? game.frontTime[q]! : a.seedClock;
  const th = Math.min(x > 0 ? reached(j - 1) : Infinity, x < w - 1 ? reached(j + 1) : Infinity);
  const tv = Math.min(y > 0 ? reached(j - w) : Infinity, y < map.height - 1 ? reached(j + w) : Infinity);
  const c = tileCost(game, j, a.target) * jitter(game, j, a.id);
  let t: number;
  if (th === Infinity && tv === Infinity) t = a.clock + c;
  else if (th === Infinity || tv === Infinity) t = Math.min(th, tv) + c;
  else {
    const d = th - tv;
    t = Math.abs(d) >= c ? Math.min(th, tv) + c : (th + tv + Math.sqrt(2 * c * c - d * d)) / 2;
  }
  const x0 = Math.max(0, x - 2);
  const x1 = Math.min(w - 1, x + 2);
  const y0 = Math.max(0, y - 2);
  const y1 = Math.min(map.height - 1, y + 2);
  let n = 0;
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
    for (let xx = x0; xx <= x1; xx++) if (owner[row + xx] === a.attacker) n++;
  }
  return t - FRONT_SHAPE * (n - 10);
}

// ------------------------------------------------------------ attack orders
/**
 * OpenFront's canAttack: a country must share a land border with the attacker; the
 * wilderness must be linked to the attacker's land by unowned land within WILD_REACH
 * (Manhattan) of the clicked tile. Anything else needs a transport.
 */
export function hasFrontier(game: Game, p: Player, target: number, tile: number): boolean {
  return target > 0 ? sharesBorder(game, p, game.players[target]!) : wildernessReachable(game, p, tile);
}

/** Whether p and q touch by land (scans the shorter of the two border lists). */
export function sharesBorder(game: Game, p: Player, q: Player): boolean {
  const [a, b] = p.border.length <= q.border.length ? [p, q] : [q, p];
  const map = game.map;
  const owner = game.owner;
  for (const t of a.border) {
    const n = map.neighbors4(t, NB);
    for (let k = 0; k < n; k++) {
      const j = NB[k]!;
      if (owner[j] === b.id && IS_LAND[map.terrain[j]!] && !game.isDead(j)) return true;
    }
  }
  return false;
}

function wildernessReachable(game: Game, p: Player, tile: number): boolean {
  const map = game.map;
  const owner = game.owner;
  const w = map.width;
  const free = (t: number) => owner[t] === 0 && IS_LAND[map.terrain[t]!] === 1 && !game.isDead(t);
  if (!free(tile)) return false;
  const x0 = tile % w;
  const y0 = (tile / w) | 0;
  const seen = new Set<number>([tile]);
  const queue = [tile];
  const nb = new Int32Array(4);
  for (let qi = 0; qi < queue.length; qi++) {
    const t = queue[qi]!;
    const n = map.neighbors4(t, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k]!;
      if (owner[j] === p.id) return true;
      if (seen.has(j) || !free(j)) continue;
      if (Math.abs((j % w) - x0) + Math.abs(((j / w) | 0) - y0) > WILD_REACH) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return false;
}

/** Whether p may open (or reinforce) a land attack on `target` (at most MAX_ATTACKS_PER_PLAYER at once). */
export function attackSlotFree(game: Game, attackerId: number, target: number): boolean {
  let n = 0;
  for (const x of game.attacks) {
    if (x.done || x.attacker !== attackerId) continue;
    if (x.target === target && !x.boat) return true;
    n++;
  }
  return n < MAX_ATTACKS_PER_PLAYER;
}

/**
 * OpenFront's AttackExecution.init, `troops` being already taken from the attacker's
 * pool. The new troops first clash with the target's attacks on the attacker: each
 * side loses the smaller stack. A land attack then absorbs the attacks already sent at
 * that target (transport landings included) and fronts on the whole shared border; an
 * attack from a transport's `landing` tile (already taken) starts apart, from that tile.
 * Returns the attack, or null when nothing is left to push (troops refunded, except
 * those lost in the clash).
 */
export function launchAttack(
  game: Game,
  attackerId: number,
  targetId: number,
  troops: number,
  landing?: number,
): Attack | null {
  const p = game.players[attackerId]!;
  if (!p.alive) return null;
  if (troops < 1) {
    p.troops += Math.max(0, troops);
    return null;
  }
  const boat = landing !== undefined;
  let a = boat
    ? null
    : (game.attacks.find((x) => !x.done && x.attacker === attackerId && x.target === targetId && !x.boat) ??
      null);
  const fresh = !a;
  if (!a) {
    if (!attackSlotFree(game, attackerId, boat ? -1 : targetId)) {
      p.troops += troops;
      return null;
    }
    a = new Attack(game.nextId(), attackerId, targetId, 0, game.tick);
    a.boat = boat;
  }
  // A riposte: the target was already attacking us when this attack began (the clash below
  // may end its attack, so this is read first). The wave is the target's defence answered,
  // not an invasion: the target's screen shows it apart (no red edges).
  let riposte = false;
  if (targetId > 0) {
    for (const opp of game.attacks)
      if (
        !opp.done &&
        opp.attacker === targetId &&
        opp.target === attackerId &&
        opp.createdTick <= a.createdTick
      )
        riposte = true;
  }
  // Opposing attacks clash: the bigger stack goes on, minus the smaller one.
  if (targetId > 0) {
    for (const opp of game.attacks) {
      if (opp.done || opp.attacker !== targetId || opp.target !== attackerId) continue;
      if (opp.troops > troops) {
        opp.troops -= troops;
        troops = 0;
        break;
      }
      troops -= opp.troops;
      opp.troops = 0;
      finishAttack(game, opp, false);
    }
    if (troops < 1 && fresh) return null;
  }
  a.troops += Math.max(0, troops);
  a.seedClock = a.clock;
  const owner = game.owner;
  const map = game.map;
  if (boat) {
    enqueueNeighbors(game, a, landing);
  } else {
    // A land attack absorbs the landings already pushing into the same target.
    for (const x of game.attacks) {
      if (x === a || x.done || x.attacker !== attackerId || x.target !== targetId) continue;
      a.troops += x.troops;
      x.troops = 0;
      finishAttack(game, x, false);
    }
    // Front: every target tile along the attacker's border.
    for (const b of p.border) {
      const n = map.neighbors4(b, NB);
      for (let k = 0; k < n; k++) {
        const j = NB[k]!;
        if (owner[j] !== targetId || !IS_LAND[map.terrain[j]!] || game.isDead(j)) continue;
        pushFrontier(game, a, j);
      }
    }
  }
  if (a.frontierSize === 0) {
    // Nothing to attack: the troops go home.
    p.troops += a.troops;
    a.troops = 0;
    if (!fresh) finishAttack(game, a, false);
    return null;
  }
  if (fresh) game.attacks.push(a);
  if (targetId > 0)
    game.emit({
      k: 'attackWave',
      attacker: attackerId,
      target: targetId,
      troops: Math.round(troops),
      tile: landing ?? a.heapTiles[0] ?? -1,
      riposte,
    });
  return a;
}

/** OpenFront's RetreatExecution: the attack halts, its troops come home RETREAT_DELAY_TICKS later. */
export function cancelAttack(game: Game, a: Attack): void {
  if (a.done || a.retreatAt >= 0) return;
  a.retreatAt = game.tick + RETREAT_DELAY_TICKS;
}

/** The troops of `a` come home, `malus` of them lost on the way. */
function retreat(game: Game, a: Attack, malus: number): void {
  const p = game.players[a.attacker]!;
  const deaths = a.troops * malus;
  if (p.alive) {
    p.troops += a.troops - deaths;
    p.stats.troopsLost += deaths;
  }
  a.troops = 0;
  finishAttack(game, a, false);
}

export function finishAttack(game: Game, a: Attack, refund = true): void {
  if (a.done) return;
  const p = game.players[a.attacker]!;
  if (refund && p.alive) p.troops += a.troops;
  a.troops = 0;
  a.done = true;
  a.heapTiles.length = 0;
  a.heapPri.length = 0;
  a.border.clear();
}

// ------------------------------------------------------------------ ticking
/** Tiles of p (fewer than ANNEX_TILES), flood-filled from its border and coast, in index order. */
function tilesOf(game: Game, p: Player): number[] {
  const owner = game.owner;
  const seen = new Set<number>([...p.border, ...p.coast]);
  const stack = [...seen];
  const nb = new Int32Array(4);
  while (stack.length) {
    const t = stack.pop()!;
    const n = game.map.neighbors4(t, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k]!;
      if (owner[j] === p.id && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return [...seen].sort((x, y) => x - y);
}

/**
 * OpenFront's handleDeadDefender: a country cut below ANNEX_TILES tiles is annexed whole.
 * Pass after pass, its tiles touching the conqueror go to the conqueror, the others to a
 * neighbour that is not its friend.
 */
function annex(game: Game, conqueror: Player, T: Player): void {
  const owner = game.owner;
  const tiles = tilesOf(game, T);
  const nb = new Int32Array(4);
  for (let pass = 0; pass < 100 && T.tiles > 0; pass++) {
    let progressed = false;
    for (const t of tiles) {
      if (owner[t] !== T.id) continue;
      const n = game.map.neighbors4(t, nb);
      let other = 0;
      let mine = false;
      for (let k = 0; k < n && !mine; k++) {
        const o = owner[nb[k]!]!;
        if (o === conqueror.id) mine = true;
        else if (other === 0 && o > 0 && o !== T.id && !game.friendly(o, T.id)) other = o;
      }
      if (mine || other > 0) {
        game.setOwner(t, mine ? conqueror.id : other);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
}

/** One tick of attack `a`: take tiles in front order until the tick budget (1) is spent. */
function advance(game: Game, a: Attack, p: Player, T: Player | null): void {
  const owner = game.owner;
  const map = game.map;
  const borderSize = borderSizeOf(game, a);
  let budget = 1;
  let loot = 0;
  let lootTile = 0;
  while (budget > 0) {
    if (a.troops < 1) {
      // Spent: the last handful of troops dies in the push.
      p.stats.troopsLost += a.troops;
      a.troops = 0;
      finishAttack(game, a, false);
      break;
    }
    if (a.frontierSize === 0 || (T && !T.alive)) {
      // Nothing left to take: the attack is over and its troops go home.
      finishAttack(game, a);
      break;
    }
    a.clock = Math.max(a.clock, a.peekPri());
    const tile = a.pop();
    a.border.delete(tile);
    if (owner[tile] !== a.target || !IS_LAND[map.terrain[tile]!] || game.isDead(tile)) continue;
    let touches = false;
    const n = map.neighbors4(tile, NB);
    for (let k = 0; k < n; k++) if (owner[NB[k]!] === a.attacker) touches = true;
    if (!touches) continue;
    enqueueNeighbors(game, a, tile);
    const o = attackLogic(game, a, tile, borderSize);
    budget -= o.tickFraction;
    const loss = Math.min(a.troops, o.attackerLoss);
    a.troops -= loss;
    p.stats.troopsLost += loss;
    if (T) {
      // The defender loses its troops per tile.
      const kill = Math.min(T.troops, o.defenderLoss);
      T.troops -= kill;
      T.stats.troopsLost += kill;
      p.stats.enemiesKilled += kill;
      // Tribes hoard gold: each conquered tile yields its share of the treasury.
      if (T.kind === 'tribe' && T.gold > 0) {
        const share = T.gold / Math.max(1, T.tiles);
        T.gold -= share;
        addGold(p, share);
        loot += share;
        lootTile = tile;
      }
    }
    game.setOwner(tile, a.attacker);
    a.conquered++;
    // Revolutionaries hold out to the last street: never annexed in one go.
    if (T && T.alive && T.tiles < ANNEX_TILES && !T.revolution) annex(game, p, T);
  }
  if (loot >= 1) {
    const w = map.width;
    game.emit({ k: 'loot', x: lootTile % w, y: (lootTile / w) | 0, owner: p.id, amount: Math.round(loot) });
  }
}

export function processAttacks(game: Game): void {
  for (const a of game.attacks) {
    if (a.done) continue;
    const p = game.players[a.attacker]!;
    const T = a.target > 0 ? game.players[a.target]! : null;
    if (!p.alive || (T && !T.alive) || !game.attackAllowed(a.attacker, a.target, false)) {
      finishAttack(game, a);
      continue;
    }
    if (a.retreatAt >= 0) {
      if (game.tick >= a.retreatAt) retreat(game, a, a.target > 0 ? RETREAT_MALUS : 0);
      continue;
    }
    advance(game, a, p, T);
  }
  if (game.attacks.some((a) => a.done)) game.attacks = game.attacks.filter((a) => !a.done);
}
