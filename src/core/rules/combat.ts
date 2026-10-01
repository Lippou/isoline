// Land attacks: a weighted flood-fill frontier per attack (min-heap keyed by
// "arrival time"), terrain/defence/superiority-dependent losses.
import type { Game } from '../game/state';
import {
  ATTACK_MIN_BUDGET,
  ATTACK_RATE,
  ATTACK_RATE_VS_PLAYER,
  CANCEL_PENALTY,
  DEFENDER_LOSS_DENSITY,
  ENEMY_LOSS_BASE,
  ENEMY_LOSS_DENSITY,
  INFERIORITY_PENALTY,
  MAX_ATTACKS_PER_PLAYER,
  SUPERIORITY_GAIN,
  TRAITOR_DEFENSE_MULT,
  TRAITOR_SPEED_MULT,
  WILD_LOSS,
} from '../game/constants';
import { IS_LAND, MAG, SPEED } from '../map/terrain';
import { hash2 } from '../rng';

export class Attack {
  readonly id: number;
  readonly attacker: number;
  readonly target: number;
  troops: number;
  clock = 0;
  createdTick: number;
  heapTiles: number[] = [];
  heapPri: number[] = [];
  /** Tiles that may be taken without an adjacent attacker tile (amphibious beachheads). */
  beachhead: number[] = [];
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

/** Relative cost of crossing tile i for attack `a` (1 = plains). */
function tileCost(game: Game, tile: number, target: number): number {
  const t = game.map.terrain[tile]!;
  let speed = SPEED[t]! / 16.5;
  if (target > 0) speed *= game.defenseSpeedMult(tile, target);
  return speed;
}

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
    if (game.queuedBy[j] === a.id) continue;
    game.queuedBy[j] = a.id;
    // Tiles touching more attacker tiles are taken first (fills concave pockets).
    let adj = 0;
    const m = map.neighbors4(j, NB2);
    for (let q = 0; q < m; q++) if (owner[NB2[q]!] === a.attacker) adj++;
    a.push(j, a.clock + tileCost(game, j, a.target) * jitter(game, j, a.id) - 0.22 * (adj - 1));
  }
}
const NB2 = new Int32Array(4);

/**
 * Creates (or reinforces) a land attack with `troops` already taken from the
 * attacker's pool. On failure the troops are returned to the pool (except
 * those consumed by a clash with an opposing attack). Returns the attack or null.
 */
export function launchAttack(
  game: Game,
  attackerId: number,
  targetId: number,
  troops: number,
  beachhead?: number,
): Attack | null {
  const p = game.players[attackerId]!;
  if (!p.alive) return null;
  if (troops < 1) {
    p.troops += Math.max(0, troops);
    return null;
  }
  // Reinforce an existing attack against the same target.
  let a = game.attacks.find((x) => !x.done && x.attacker === attackerId && x.target === targetId) ?? null;
  const fresh = !a;
  if (!a) {
    if (game.attacks.filter((x) => !x.done && x.attacker === attackerId).length >= MAX_ATTACKS_PER_PLAYER) {
      p.troops += troops;
      return null;
    }
    a = new Attack(game.nextId(), attackerId, targetId, 0, game.tick);
  }
  // Opposing attacks clash and cancel each other's troops first.
  if (targetId > 0) {
    const opp = game.attacks.find((x) => !x.done && x.attacker === targetId && x.target === attackerId);
    if (opp) {
      const m = Math.min(opp.troops, troops);
      opp.troops -= m;
      troops -= m;
      if (opp.troops < 1) finishAttack(game, opp, false);
      if (troops < 1) {
        if (fresh) return null;
        return a;
      }
    }
  }
  a.troops += troops;
  if (beachhead !== undefined) {
    a.beachhead.push(beachhead);
    a.push(beachhead, a.clock);
  } else {
    // Seed the frontier from the attacker's border.
    const owner = game.owner;
    const map = game.map;
    for (const b of p.border) {
      const n = map.neighbors4(b, NB);
      for (let k = 0; k < n; k++) {
        const j = NB[k]!;
        if (owner[j] !== targetId || !IS_LAND[map.terrain[j]!] || game.isDead(j)) continue;
        if (game.queuedBy[j] === a.id) continue;
        game.queuedBy[j] = a.id;
        a.push(j, a.clock + tileCost(game, j, targetId) * jitter(game, j, a.id));
      }
    }
  }
  if (a.frontierSize === 0) {
    // Nothing to attack: refund (a fresh attack holds only these troops).
    p.troops += fresh ? a.troops : troops;
    if (!fresh) a.troops -= troops;
    else a.troops = 0;
    return null;
  }
  if (fresh) game.attacks.push(a);
  return a;
}

export function cancelAttack(game: Game, a: Attack): void {
  if (a.done) return;
  const p = game.players[a.attacker]!;
  p.troops += a.troops * (1 - CANCEL_PENALTY);
  a.troops = 0;
  a.done = true;
}

export function finishAttack(game: Game, a: Attack, refund = true): void {
  if (a.done) return;
  const p = game.players[a.attacker]!;
  if (refund && p.alive) p.troops += a.troops;
  a.troops = 0;
  a.done = true;
  a.heapTiles.length = 0;
  a.heapPri.length = 0;
}

/** Loss (attacker troops) to take tile `tile` from `target` (0 = wilderness). */
export function conquestLoss(game: Game, a: Attack, tile: number): number {
  const t = game.map.terrain[tile]!;
  let mag = MAG[t]! / 80;
  const fo = game.fallout[tile]!;
  if (fo > 0) mag *= 5 - 2 * (1 - fo / 255); // fresh fallout ×5 … decaying towards ×3
  mag *= game.techMagMult(a.attacker, t);
  if (a.target === 0) return WILD_LOSS * mag;
  const T = game.players[a.target]!;
  mag *= game.defenseMagMult(tile, a.target);
  const density = T.troops / Math.max(1, T.tiles);
  let loss = mag * (ENEMY_LOSS_BASE + ENEMY_LOSS_DENSITY * density);
  const ratio = a.troops / Math.max(1, T.troops);
  if (ratio >= 1) loss *= 1 - SUPERIORITY_GAIN * Math.min(1, ratio - 1);
  else loss *= 1 + INFERIORITY_PENALTY * (1 - ratio);
  if (T.debuffUntil > game.tick) loss *= TRAITOR_DEFENSE_MULT;
  loss *= 1 - game.bigEmpireMalus(T);
  loss *= game.eventDefenseMult(a.target);
  return loss;
}

export function processAttacks(game: Game): void {
  const owner = game.owner;
  const map = game.map;
  for (const a of game.attacks) {
    if (a.done) continue;
    const p = game.players[a.attacker]!;
    const T = a.target > 0 ? game.players[a.target]! : null;
    if (!p.alive || (T && !T.alive) || !game.attackAllowed(a.attacker, a.target, false)) {
      finishAttack(game, a);
      continue;
    }
    let speedMult = 1;
    if (p.debuffUntil > game.tick) speedMult *= TRAITOR_SPEED_MULT;
    if (p.blitzUntil > game.tick) speedMult *= 1.3;
    speedMult *= game.techSpeedMult(a.attacker);
    a.clock += speedMult;
    let budget =
      Math.max(ATTACK_MIN_BUDGET, ATTACK_RATE * Math.sqrt(a.troops)) *
      (T ? ATTACK_RATE_VS_PLAYER : 1) *
      speedMult;
    while (budget > 0 && a.frontierSize > 0 && a.peekPri() <= a.clock) {
      const tile = a.pop();
      if (owner[tile] !== a.target || !IS_LAND[map.terrain[tile]!] || game.isDead(tile)) continue;
      // Must touch the attacker (unless it is a beachhead).
      let touches = false;
      const n = map.neighbors4(tile, NB);
      for (let k = 0; k < n; k++) if (owner[NB[k]!] === a.attacker) touches = true;
      if (!touches) {
        const bi = a.beachhead.indexOf(tile);
        if (bi < 0) continue;
        a.beachhead.splice(bi, 1);
      }
      const loss = conquestLoss(game, a, tile);
      if (a.troops < loss) {
        // Out of steam: the remaining handful of troops is lost in the push.
        p.stats.troopsLost += a.troops;
        a.troops = 0;
        break;
      }
      a.troops -= loss;
      p.stats.troopsLost += loss;
      if (T) {
        const density = T.troops / Math.max(1, T.tiles);
        const kill = Math.min(T.troops, density * DEFENDER_LOSS_DENSITY);
        T.troops -= kill;
        T.stats.troopsLost += kill;
        p.stats.enemiesKilled += kill;
      }
      game.setOwner(tile, a.attacker);
      a.conquered++;
      budget -= tileCost(game, tile, a.target);
      enqueueNeighbors(game, a, tile);
    }
    if (a.troops < 1 || a.frontierSize === 0) finishAttack(game, a);
  }
  if (game.attacks.some((a) => a.done)) game.attacks = game.attacks.filter((a) => !a.done);
}
