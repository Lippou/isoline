// Railways: factories automatically lay track to stations (cities, ports,
// factories) within range; trains wander the network and pay at every stop.
import type { Game } from '../game/state';
import type { Building } from '../buildings/building';
import {
  B,
  RAIL_CONNECT_RANGE,
  RAIL_MAX_SEGMENT,
  RAIL_MIN_GAP,
  STATION_TYPES,
  TRAIN_MAX_STOPS,
  TRAIN_PAY_ALLY,
  TRAIN_PAY_DECAY,
  TRAIN_PAY_DECAY_FROM,
  TRAIN_PAY_FLOOR,
  TRAIN_PAY_OTHER,
  TRAIN_PAY_OWN,
  TRAIN_SPAWN_BASE,
  TRAIN_SPAWN_COOLDOWN,
  TRAIN_SPAWN_MULT,
  TRAIN_SPEED,
  TRAIN_UNITS,
} from '../game/constants';
import { IS_LAND, SPEED } from '../map/terrain';
import { U, makeUnit, type Unit } from './unit';
import { addGold } from '../game/economy';
import { addUnit } from './ships';
import { techTrainBonus } from '../rules/tech';
import { noteTrade } from '../rules/diplomacy';
import type { Player } from '../game/player';

export interface Rail {
  id: number;
  a: number; // building id
  b: number;
  owner: number;
  tiles: number[];
  alive: boolean;
}

/** tile → ids of rails crossing it (sparse). */
const railIndexByGame = new WeakMap<Game, Map<number, number[]>>();
function railIndex(game: Game): Map<number, number[]> {
  let m = railIndexByGame.get(game);
  if (!m) {
    m = new Map();
    railIndexByGame.set(game, m);
    for (const r of game.rails) if (r.alive) for (const t of r.tiles) addIndex(m, t, r.id);
  }
  return m;
}
function addIndex(m: Map<number, number[]>, tile: number, id: number): void {
  const l = m.get(tile);
  if (l) l.push(id);
  else m.set(tile, [id]);
}

/** Rebuild derived rail indices (after loading a snapshot). */
export function rebuildRailIndex(game: Game): void {
  railIndexByGame.delete(game);
  game.railTiles.fill(0);
  for (const r of game.rails) if (r.alive) for (const t of r.tiles) game.railTiles[t] = 1;
}

function railAllowedTile(game: Game, tile: number, owners: number[]): boolean {
  if (!IS_LAND[game.map.terrain[tile]!] || game.isDead(tile)) return false;
  const o = game.owner[tile]!;
  if (o === 0) return false;
  for (const ow of owners) if (o === ow || game.friendly(o, ow)) return true;
  return false;
}

/** Bounded A* over land between two buildings. */
function railPath(game: Game, a: Building, b: Building): number[] | null {
  const map = game.map;
  const w = map.width;
  const margin = 24;
  const x0 = Math.max(0, Math.min(a.x, b.x) - margin);
  const y0 = Math.max(0, Math.min(a.y, b.y) - margin);
  const x1 = Math.min(w - 1, Math.max(a.x, b.x) + margin);
  const y1 = Math.min(map.height - 1, Math.max(a.y, b.y) + margin);
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const n = bw * bh;
  const g = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const owners = [a.owner, b.owner];
  const local = (t: number) => (((t / w) | 0) - y0) * bw + ((t % w) - x0);
  const global = (l: number) => (((l / bw) | 0) + y0) * w + (l % bw) + x0;
  const heapL: number[] = [];
  const heapF: number[] = [];
  const push = (l: number, f: number) => {
    let k = heapL.length;
    heapL.push(l);
    heapF.push(f);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= f) break;
      heapL[k] = heapL[p]!;
      heapF[k] = heapF[p]!;
      k = p;
    }
    heapL[k] = l;
    heapF[k] = f;
  };
  const pop = () => {
    const top = heapL[0]!;
    const ll = heapL.pop()!;
    const lf = heapF.pop()!;
    if (heapL.length) {
      let k = 0;
      while (true) {
        let c = 2 * k + 1;
        if (c >= heapL.length) break;
        if (c + 1 < heapL.length && heapF[c + 1]! < heapF[c]!) c++;
        if (heapF[c]! >= lf) break;
        heapL[k] = heapL[c]!;
        heapF[k] = heapF[c]!;
        k = c;
      }
      heapL[k] = ll;
      heapF[k] = lf;
    }
    return top;
  };
  const s = local(a.tile);
  const goal = local(b.tile);
  g[s] = 0;
  push(s, 0);
  let expanded = 0;
  while (heapL.length) {
    const l = pop();
    if (closed[l]) continue;
    closed[l] = 1;
    if (l === goal) break;
    if (++expanded > 60_000) return null;
    const lx = l % bw;
    const ly = (l / bw) | 0;
    for (let d = 0; d < 8; d++) {
      const dx = d < 4 ? [1, -1, 0, 0][d]! : [1, 1, -1, -1][d - 4]!;
      const dy = d < 4 ? [0, 0, 1, -1][d]! : [1, -1, 1, -1][d - 4]!;
      const nx = lx + dx;
      const ny = ly + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const m = ny * bw + nx;
      if (closed[m]) continue;
      const gt = global(m);
      if (m !== goal && !railAllowedTile(game, gt, owners)) continue;
      const step = (d < 4 ? 1 : 1.41421356) * (SPEED[map.terrain[gt]!]! / 16.5 || 1);
      const ng = g[l]! + step;
      if (ng < g[m]!) {
        g[m] = ng;
        parent[m] = l;
        const hx = Math.abs(nx - (b.x - x0));
        const hy = Math.abs(ny - (b.y - y0));
        push(m, ng + Math.max(hx, hy) + 0.41421356 * Math.min(hx, hy));
      }
    }
  }
  if (parent[goal] === -1) return null;
  const out: number[] = [];
  for (let l = goal; l !== -1; l = parent[l]!) out.push(global(l));
  out.reverse();
  if (out.length > RAIL_MAX_SEGMENT * 1.3) return null;
  return out;
}

function connected(game: Game, a: number, b: number): boolean {
  return game.rails.some((r) => r.alive && ((r.a === a && r.b === b) || (r.a === b && r.b === a)));
}

function connect(game: Game, factory: Building, station: Building): void {
  if (factory.id === station.id || connected(game, factory.id, station.id)) return;
  const d = Math.hypot(factory.x - station.x, factory.y - station.y);
  if (d < RAIL_MIN_GAP || d > RAIL_CONNECT_RANGE) return;
  const fo = game.players[factory.owner]!;
  const so = game.players[station.owner]!;
  if (so.kind === 'tribe' || fo.hasEmbargoWith(so, game.tick)) return;
  const tiles = railPath(game, factory, station);
  if (!tiles) return;
  const r: Rail = {
    id: game.nextId(),
    a: factory.id,
    b: station.id,
    owner: factory.owner,
    tiles,
    alive: true,
  };
  game.rails.push(r);
  const idx = railIndex(game);
  for (const t of tiles) {
    game.railTiles[t] = 1;
    addIndex(idx, t, r.id);
  }
  game.railsDirty = true;
}

export function onStationBuilt(game: Game, b: Building): void {
  if (!game.config.allowFactories) return;
  const near: Building[] = [];
  game.grid.query(b.x, b.y, RAIL_CONNECT_RANGE, (id) => {
    const o = game.buildings.get(id);
    if (!o || o.id === b.id || o.buildLeft > 0 || !STATION_TYPES.includes(o.type)) return;
    if (b.type !== B.Factory && o.type !== B.Factory) return;
    near.push(o);
  });
  near.sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y) || p.id - q.id);
  for (const o of near.slice(0, 8)) {
    if (b.type === B.Factory) connect(game, b, o);
    else connect(game, o, b);
  }
}

function destroyRail(game: Game, r: Rail): void {
  if (!r.alive) return;
  r.alive = false;
  const idx = railIndex(game);
  for (const t of r.tiles) {
    const l = idx.get(t);
    if (l) {
      const k = l.indexOf(r.id);
      if (k >= 0) l.splice(k, 1);
      if (l.length === 0) {
        idx.delete(t);
        game.railTiles[t] = 0;
      }
    }
  }
  for (const u of game.units) if (u.alive && u.type === U.Train && u.rail === r.id) u.alive = false;
  game.railsDirty = true;
}

export function onStationRemoved(game: Game, b: Building): void {
  for (const r of game.rails) if (r.alive && (r.a === b.id || r.b === b.id)) destroyRail(game, r);
}

export function cutRailsAt(game: Game, tile: number, newOwner: number): void {
  const ids = railIndex(game).get(tile);
  if (!ids) return;
  for (const id of [...ids]) {
    const r = game.rails.find((x) => x.id === id);
    if (!r || !r.alive) continue;
    const a = game.buildings.get(r.a);
    const b = game.buildings.get(r.b);
    const ok =
      newOwner > 0 &&
      (game.friendly(newOwner, r.owner) || (a && a.owner === newOwner) || (b && b.owner === newOwner));
    if (!ok) destroyRail(game, r);
  }
}

/** Destroy rails crossing a disc (bombardment / nukes). */
export function destroyRailsInRadius(game: Game, x: number, y: number, radius: number): void {
  const r2 = radius * radius;
  for (const r of game.rails) {
    if (!r.alive) continue;
    for (let k = 0; k < r.tiles.length; k += 2) {
      const t = r.tiles[k]!;
      const tx = t % game.map.width;
      const ty = (t / game.map.width) | 0;
      if ((tx - x) ** 2 + (ty - y) ** 2 <= r2) {
        destroyRail(game, r);
        break;
      }
    }
  }
}

function railsAt(game: Game, stationId: number): Rail[] {
  return game.rails.filter((r) => r.alive && (r.a === stationId || r.b === stationId));
}

/**
 * Gold of a city/port stop: base by relation (own / team or other / ally), minus
 * TRAIN_PAY_DECAY per paying stop beyond the first TRAIN_PAY_DECAY_FROM, floored.
 */
export function trainStopGold(base: number, paidStops: number): number {
  return Math.max(
    TRAIN_PAY_FLOOR,
    base - TRAIN_PAY_DECAY * Math.max(0, paidStops - (TRAIN_PAY_DECAY_FROM - 1)),
  );
}

function payTrain(game: Game, p: Player, amount: number, station: Building): void {
  const gold = amount * (game.config.features.tech ? techTrainBonus(p) : 1);
  addGold(p, gold);
  p.stats.trainGold += gold;
  p.incomeBreakdown.trains += gold;
  game.emit({ k: 'trainPay', x: station.x, y: station.y, owner: p.id, amount: Math.round(gold) });
}

/**
 * Cities and ports pay the train owner AND (the same amount) the station owner; factories are
 * junctions. A station pays a given train once: OpenFront's trains ride a shortest path and
 * never call twice at a station, while a random walk bouncing on a short line (factory, city,
 * factory, the same city…) was paid at every pass (1.11). The stations paid are kept in
 * `train.path`.
 */
function payStop(game: Game, train: Unit, station: Building): void {
  if (station.type !== B.City && station.type !== B.Port) return;
  if (train.path.includes(station.id)) return;
  train.path.push(station.id);
  const p = game.players[train.owner]!;
  const host = game.players[station.owner]!;
  if (!p.alive || !host.alive || p.hasEmbargoWith(host, game.tick)) return;
  const base =
    station.owner === p.id
      ? TRAIN_PAY_OWN
      : game.sameTeam(p.id, station.owner)
        ? TRAIN_PAY_OTHER
        : p.allies.has(station.owner)
          ? TRAIN_PAY_ALLY
          : TRAIN_PAY_OTHER;
  const amount =
    Math.floor(trainStopGold(base, train.level) * game.config.goldMultiplier) * game.features.tradeMult;
  train.level++;
  payTrain(game, p, amount, station);
  if (station.owner !== p.id) {
    payTrain(game, host, amount, station);
    noteTrade(game, p, host);
  }
}

function startOnRail(train: Unit, r: Rail, fromStation: number): void {
  train.rail = r.id;
  train.dir = r.a === fromStation ? 1 : -1;
  train.pathIdx = train.dir === 1 ? 0 : r.tiles.length - 1;
  train.troops = train.pathIdx; // float progress along tiles
}

function chooseNext(game: Game, train: Unit, stationId: number, cameFrom: number): Rail | null {
  const options = railsAt(game, stationId).filter((r) => {
    const other = r.a === stationId ? r.b : r.a;
    const ob = game.buildings.get(other);
    if (!ob) return false;
    return !game.players[train.owner]!.hasEmbargoWith(game.players[ob.owner]!, game.tick);
  });
  if (options.length === 0) return null;
  const notBack = options.filter((r) => r.id !== cameFrom);
  const pool = notBack.length ? notBack : options;
  return pool[game.rng.int(0, pool.length - 1)]!;
}

const sigmoid = (x: number, k: number, mid: number) => 1 / (1 + Math.exp(-k * (x - mid)));

/**
 * OpenFront's global train throttle for `n` train units in the world (a train
 * weighs TRAIN_UNITS): a boost on small networks, damping past ~560 units onto
 * a 25 % plateau, and a hard cap far beyond (~900).
 */
export function trainSaturation(n: number): number {
  const boost = 1 + 0.5 * Math.exp(-n / 30);
  const damping = 1 - sigmoid(n, Math.LN2 / 100, 560);
  const plateau = 0.25 * (1 - sigmoid(n, Math.LN2 / 150, 900));
  return boost * Math.max(damping, plateau);
}

/** One spawn roll of a factory succeeds with probability 1 / rate. */
export function trainSpawnRate(ownerFactoryLevels: number, trainUnits: number): number {
  return Math.max(
    1,
    Math.floor(((ownerFactoryLevels + TRAIN_SPAWN_BASE) * TRAIN_SPAWN_MULT) / trainSaturation(trainUnits)),
  );
}

// Scratch buffer: factory levels per player id, rebuilt every tick.
let factoryLevelsBuf = new Float64Array(0);

export function updateRails(game: Game): void {
  if (!game.config.allowFactories) return;
  let trains = 0;
  for (const u of game.units) if (u.alive && u.type === U.Train) trains++;
  if (factoryLevelsBuf.length < game.players.length)
    factoryLevelsBuf = new Float64Array(game.players.length * 2);
  const factoryLevels = factoryLevelsBuf;
  factoryLevels.fill(0);
  for (const b of game.buildings.values()) if (b.type === B.Factory) factoryLevels[b.owner]! += b.level;
  const w = game.map.width;
  // Spawn trains at factories: one roll per level every tick, TRAIN_SPAWN_COOLDOWN apart.
  for (const f of game.buildings.values()) {
    if (f.type !== B.Factory || f.buildLeft > 0 || game.tick < f.timer) continue;
    const p = game.players[f.owner]!;
    if (!p.alive) continue;
    const rate = trainSpawnRate(factoryLevels[p.id]!, trains * TRAIN_UNITS);
    let go = false;
    for (let k = 0; k < f.level && !go; k++) go = game.rng.chance(1 / rate);
    if (!go) continue;
    const r = chooseNext(game, makeUnit(0, U.Train, p.id, 0, 0), f.id, -1);
    if (!r) continue;
    f.timer = game.tick + TRAIN_SPAWN_COOLDOWN;
    const t = makeUnit(game.nextId(), U.Train, p.id, f.x + 0.5, f.y + 0.5);
    t.speed = TRAIN_SPEED;
    t.home = f.id;
    t.stops = 0;
    t.level = 0;
    startOnRail(t, r, f.id);
    addUnit(game, t);
    trains++;
  }
  // Move trains.
  for (const t of game.units) {
    if (!t.alive || t.type !== U.Train) continue;
    const r = game.rails.find((x) => x.id === t.rail);
    if (!r || !r.alive) {
      t.alive = false;
      continue;
    }
    t.troops += t.dir * t.speed;
    const last = r.tiles.length - 1;
    const arrived = t.dir === 1 ? t.troops >= last : t.troops <= 0;
    const pos = Math.max(0, Math.min(last, t.troops));
    const k = Math.floor(pos);
    const frac = pos - k;
    const ta = r.tiles[k]!;
    const tb = r.tiles[Math.min(last, k + 1)]!;
    t.x = (ta % w) + 0.5 + ((tb % w) - (ta % w)) * frac;
    t.y = ((ta / w) | 0) + 0.5 + (((tb / w) | 0) - ((ta / w) | 0)) * frac;
    if (!arrived) continue;
    const stationId = t.dir === 1 ? r.b : r.a;
    const station = game.buildings.get(stationId);
    if (!station) {
      t.alive = false;
      continue;
    }
    t.stops++;
    payStop(game, t, station);
    if (t.stops >= TRAIN_MAX_STOPS) {
      t.alive = false;
      continue;
    }
    const next = chooseNext(game, t, stationId, r.id);
    if (!next) {
      t.alive = false;
      continue;
    }
    startOnRail(t, next, stationId);
  }
}

/** General ability "Sabotage": destroy the enemy train or merchant closest to a tile. */
export function sabotageNear(game: Game, by: number, tile: number): boolean {
  const w = game.map.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  let best: Unit | null = null;
  let bestD = 40 * 40;
  for (const u of game.units) {
    if (!u.alive || (u.type !== U.Train && u.type !== U.Merchant) || game.friendly(u.owner, by)) continue;
    const d = (u.x - x) ** 2 + (u.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  }
  if (!best) return false;
  best.alive = false;
  game.emit({ k: 'explosion', x: best.x, y: best.y, kind: 10, radius: 3, owner: by });
  game.notify(best.owner, 'notify.sabotaged', 'danger', { by });
  return true;
}
