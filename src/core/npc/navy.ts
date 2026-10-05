// The nations' fleets (GAME_DESIGN.md §9.4). Warships fight on their own (ships.ts: they
// shell the transports, warships and merchants that come within range of their patrol, and
// break off to repair below half their hit points); a nation decides where they patrol and
// how many it needs. By difficulty (TACTICS.navy):
//   0 (easy)       a warship now and then, left where it was built (before 1.12);
//   1 (normal)     + the transports sailing at it are hunted, ships kept near its ports;
//   2 (hard)       + enemy warships near its ports are met by the whole fleet (or it falls
//                    back on its ports when outnumbered), transports escorted;
//   3 (impossible) + raids on the ports and merchants of the country it fights.
// A ship is only ever given orders while healthy (≥ NAVY_HEALTHY of its hit points): a
// move order would call off its repair retreat (ships.ts).
import { portsClosed } from '../rules/worldEvents';
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import type { Building } from '../buildings/building';
import type { Unit } from '../units/unit';
import { U } from '../units/unit';
import { B, WARSHIP_RANGE } from '../game/constants';
import { WS, unitTile, warshipCost } from '../units/ships';
import { applyCommand } from '../game/commands';
import { TACTICS } from './tactics';

/** Hit points share below which a ship gets no order (it may have to retreat and repair). */
export const NAVY_HEALTHY = 0.75;
/** Ticks between two orders to the same ship (each order makes it plot a new route). */
export const NAVY_ORDER_GAP = 100;
/** A new patrol point closer than this (tiles) to the current one is not worth an order. */
export const NAVY_MOVE_MIN = 25;
/** Fleet ceiling: per port, and overall (OpenFront caps its nations at 10). */
export const NAVY_PER_PORT = 2;
export const NAVY_MAX = 10;
/** Treasury kept for the economy when buying a warship (× its price). */
export const NAVY_GOLD_MARGIN = 1.5;

export interface NavyContext {
  /** Countries p fights (its offensives' targets, its attackers, the runaway). */
  enemies: Set<number>;
  /** The country p fights hardest (raids, level 3), -1 none. */
  war: number;
  /** Naval inclination of the personality (1 = average). */
  naval: number;
  /** Gold the war chest keeps for another purchase (npc/arsenal.ts); a transport bound for us overrides it. */
  reserve?: number;
}

interface Order {
  ids: number[];
  tile: number;
}

function waterOf(game: Game, u: Unit): number {
  const t = unitTile(game, u);
  return game.map.isNavigable(t) ? t : -1;
}

function bodyOf(game: Game, tile: number): number {
  return tile >= 0 ? game.map.navBody[tile]! : -1;
}

const dist2 = (game: Game, a: number, b: number): number => {
  const w = game.map.width;
  return ((a % w) - (b % w)) ** 2 + (((a / w) | 0) - ((b / w) | 0)) ** 2;
};

/** Whether ship u may take an order now: patrolling, healthy, not ordered just before. */
function orderable(game: Game, u: Unit): boolean {
  // t1: the end of the last order's lock (ships.ts sets it 50 ticks after an order; 0: never ordered).
  return (
    u.kind === WS.Patrolling &&
    u.hp >= u.maxHp * NAVY_HEALTHY &&
    (u.t1 === 0 || game.tick >= u.t1 + NAVY_ORDER_GAP - 50)
  );
}

/**
 * Warships of nation p: buy what the threats call for, then give the healthy ships their
 * patrol points. Returns the work done (AI budget units).
 */
export function thinkNavy(game: Game, p: Player, ctx: NavyContext): number {
  if (!game.config.allowPorts || p.buildingCount[B.Port]! === 0) return 0;
  const level = TACTICS[game.config.difficulty].navy;
  // Easy (level 0): OpenFront's occasional warship on a random coast tile, left there (before 1.12).
  if (level === 0) {
    if (!game.rng.chance(0.05 * ctx.naval)) return 5;
    const c = warshipCost(game, p);
    let fleet = 0;
    for (const u of game.units) if (u.alive && u.owner === p.id && u.type === U.Warship) fleet++;
    if (p.gold > c * 2 && fleet < 2 + p.buildingCount[B.Port]! * 2 && p.coast.length && !portsClosed(game)) {
      const wt = game.map.adjacentWater(p.coast[game.rng.int(0, p.coast.length - 1)]!);
      if (wt >= 0) applyCommand(game, p.id, { t: 'warship', tile: wt });
    }
    return 30;
  }
  const w = game.map.width;
  let cost = 30;

  const ports: Building[] = [];
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === B.Port && b.buildLeft === 0 && game.map.adjacentWater(b.tile) >= 0)
      ports.push(b);
  if (ports.length === 0) return cost;
  const portWater = ports.map((b) => game.map.adjacentWater(b.tile));

  // What sails around: our fleet and transports, transports bound for us, foreign warships near our ports.
  const fleet: Unit[] = [];
  const ours: Unit[] = [];
  const raiders: Unit[] = [];
  const hostile: Unit[] = [];
  const near2 = (WARSHIP_RANGE * 1.5) ** 2;
  for (const u of game.units) {
    if (!u.alive) continue;
    if (u.owner === p.id) {
      if (u.type === U.Warship) fleet.push(u);
      else if (u.type === U.Transport && u.kind === 0) ours.push(u);
      continue;
    }
    if (u.type !== U.Transport && u.type !== U.Warship) continue;
    if (game.friendly(u.owner, p.id)) continue;
    if (u.type === U.Transport) {
      if (u.dest === p.id && u.troops >= Math.max(1000, p.troops * 0.02)) raiders.push(u);
      continue;
    }
    if (u.kind === WS.Docked) continue;
    for (const pw of portWater)
      if ((u.x - (pw % w)) ** 2 + (u.y - ((pw / w) | 0)) ** 2 <= near2) {
        hostile.push(u);
        break;
      }
  }
  cost += game.units.length >> 4;

  // 1. Buy (from normal): one ship per two ports in peace, one more per threat (transport bound for us,
  // foreign warship near a port: as many as they are, plus one, from hard).
  const price = warshipCost(game, p);
  const ceiling = Math.min(NAVY_MAX, ports.length * NAVY_PER_PORT + 2);
  const want = Math.min(
    ceiling,
    Math.ceil(ports.length / 2 + ctx.naval * 0.5) +
      raiders.length +
      (level >= 2 ? hostile.length + (hostile.length > 0 ? 1 : 0) : 0) +
      (level >= 3 && ctx.war > 0 ? 1 : 0),
  );
  const kept = raiders.length > 0 ? 0 : (ctx.reserve ?? 0);
  // (Not while a hurricane closes the ports: the order would be refused.)
  if (fleet.length < want && p.gold - kept > price * NAVY_GOLD_MARGIN && !portsClosed(game)) {
    // Laid down at the port nearest the threat (else a random port).
    const threat = raiders[0] ?? hostile[0];
    let at = portWater[game.rng.int(0, portWater.length - 1)]!;
    if (threat) {
      const tt = unitTile(game, threat);
      let best = Infinity;
      for (const pw of portWater) {
        const d = dist2(game, pw, tt);
        if (d < best) [best, at] = [d, pw];
      }
    }
    applyCommand(game, p.id, { t: 'warship', tile: at });
    cost += 20;
  }

  // 2. Orders, by priority. Each ship gets at most one; points close to its patrol are skipped.
  const free = fleet.filter((u) => orderable(game, u));
  if (free.length === 0) return cost;
  const used = new Set<number>();
  const orders: Order[] = [];
  const nearestFree = (tile: number, body: number): Unit | null => {
    let best: Unit | null = null;
    let bd = Infinity;
    for (const u of free) {
      if (used.has(u.id) || bodyOf(game, waterOf(game, u)) !== body) continue;
      const d = dist2(game, unitTile(game, u), tile);
      if (d < bd) [bd, best] = [d, u];
    }
    return best;
  };
  const send = (ids: Unit[], tile: number) => {
    const go = ids.filter((u) => u.patrol < 0 || dist2(game, u.patrol, tile) > NAVY_MOVE_MIN ** 2);
    for (const u of ids) used.add(u.id);
    if (go.length) orders.push({ ids: go.map((u) => u.id), tile });
  };

  // a) Transports sailing at us: the nearest ship (two from hard) heads for them.
  for (const r of raiders) {
    const wt = waterOf(game, r);
    if (wt < 0) continue;
    const body = bodyOf(game, wt);
    const hunters: Unit[] = [];
    for (let k = 0; k < (level >= 2 ? 2 : 1); k++) {
      const u = nearestFree(wt, body);
      if (u) {
        hunters.push(u);
        used.add(u.id);
      }
    }
    if (hunters.length) send(hunters, wt);
  }

  // b) Hard: foreign warships near our ports. Outnumbering them, the fleet meets them together;
  //    outnumbered, it gathers on the threatened port (repairs, and the port's own cover).
  if (level >= 2 && hostile.length > 0) {
    const e = hostile[0]!;
    const et = waterOf(game, e);
    if (et >= 0) {
      const body = bodyOf(game, et);
      const group = free.filter((u) => !used.has(u.id) && bodyOf(game, waterOf(game, u)) === body);
      let enemies = 0;
      for (const h of hostile) if (bodyOf(game, waterOf(game, h)) === body) enemies++;
      if (group.length > 0) {
        if (group.length >= enemies) send(group, et);
        else {
          let pw = portWater[0]!;
          for (const x of portWater)
            if (bodyOf(game, x) === body && dist2(game, x, et) < dist2(game, pw, et)) pw = x;
          if (bodyOf(game, pw) === body) send(group, pw);
        }
      }
    }
  }

  // c) Hard: a ship escorts our largest transport at sea to its landing.
  if (level >= 2 && ours.length > 0) {
    let big = ours[0]!;
    for (const u of ours) if (u.troops > big.troops) big = u;
    const land = big.target >= 0 ? game.map.adjacentWater(big.target) : -1;
    if (land >= 0) {
      const u = nearestFree(land, bodyOf(game, land));
      if (u) send([u], land);
    }
  }

  // d) Impossible: two ships or more raid the main port of the enemy we fight (its merchants,
  //    its warships, the transports it sends), when it is on the same sea.
  const rest = () => free.filter((u) => !used.has(u.id));
  if (level >= 3 && ctx.war > 0) {
    let target: Building | null = null;
    for (const b of game.buildings.values())
      if (
        b.owner === ctx.war &&
        b.type === B.Port &&
        b.buildLeft === 0 &&
        (!target || b.level > target.level)
      )
        target = b;
    const tw = target ? game.map.adjacentWater(target.tile) : -1;
    if (tw >= 0) {
      const group = rest().filter((u) => bodyOf(game, waterOf(game, u)) === bodyOf(game, tw));
      if (group.length >= 2) send(group, tw);
    }
  }

  // e) Otherwise ships patrol off our ports, together (on the port with the most levels of their sea).
  for (const u of rest()) {
    const body = bodyOf(game, waterOf(game, u));
    let home: Building | null = null;
    for (let k = 0; k < ports.length; k++)
      if (bodyOf(game, portWater[k]!) === body && (!home || ports[k]!.level > home.level)) home = ports[k]!;
    if (!home) continue;
    const hw = game.map.adjacentWater(home.tile);
    // Already patrolling near one of our ports on this sea: left alone.
    if (u.patrol >= 0 && portWater.some((pw) => dist2(game, pw, u.patrol) <= NAVY_MOVE_MIN ** 2)) {
      used.add(u.id);
      continue;
    }
    send([u], hw);
  }

  for (const o of orders) {
    applyCommand(game, p.id, { t: 'shipMove', ids: o.ids, tile: o.tile, patrol: true });
    cost += 15 * o.ids.length;
  }
  return cost;
}
