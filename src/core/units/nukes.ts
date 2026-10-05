// Nuclear weapons: silo launch queues, ballistic arcs (flippable up/down), MIRV
// separation, SAM interception along the predicted path, detonation and fallout.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  B,
  DECONTAMINATION_TICKS,
  MAX_NUKE_BATCH,
  MIRV_COST_STEP,
  MIRV_FLIGHT_TICKS,
  MIRV_MAX_WARHEADS,
  MIRV_MIN_SPREAD,
  MIRV_RANGE,
  N,
  NUKE_BETRAYAL_TILES,
  NUKE_COST,
  NUKE_FALLOUT_RADIUS,
  NUKE_MIN_FLIGHT,
  NUKE_RADIUS,
  NUKE_SPEED,
  NUKE_TARGETABLE_RANGE,
  NUKE_TROOP_EXP,
  SAM_COOLDOWN,
  SAM_INTERCEPTOR_SPEED,
  SILO_RELOAD_TICKS,
  WARHEAD_TROOP_FLOOR,
  WARHEAD_TROOP_LOSS,
  samRange,
} from '../game/constants';
import { U, makeUnit, type Unit } from './unit';
import { addUnit } from './ships';
import { inService, type Building } from '../buildings/building';
import { removeBuilding } from '../buildings/buildings';
import { destroyRailsInRadius } from './trains';
import { IS_LAND } from '../map/terrain';
import { hash2 } from '../rng';
import { resourceBonus } from '../rules/resources';
import { nukeLock, techNukes, techSam, techShelter } from '../rules/tech';
import { betray } from '../rules/diplomacy';
import { doomNukeMult } from '../rules/victory';
import { ARC_DOWN, ARC_STRAIGHT, ARC_UP, Trajectory, flightTicks, mirvSplitPoint } from './trajectory';

export function nukeCost(game: Game, p: Player, kind: N): number {
  let c: number = NUKE_COST[kind];
  if (kind === N.Mirv) c += MIRV_COST_STEP * game.features.mirvLaunches;
  if (game.config.features.resources) c *= 1 - resourceBonus(game, p).nukeDiscount;
  if (game.config.features.tech) c *= techNukes(p).cost;
  // Doomsday clock: the arms race.
  c *= doomNukeMult(game);
  return Math.round(c);
}

function readySilos(game: Game, p: Player): Building[] {
  const out: Building[] = [];
  for (const b of game.buildings.values()) {
    if (b.owner !== p.id || b.type !== B.Silo || !inService(b)) continue;
    out.push(b);
  }
  return out;
}

/**
 * Why nobody may launch a nuclear weapon right now, null when launches are free: the World
 * Council's nuclear ban, or a peace summit (its forced truce covers the silos too, tribes or
 * not). Missiles already in flight are not recalled.
 */
export function nuclearHalt(game: Game): 'nukeBan' | 'peaceSummit' | null {
  const f = game.features;
  if (f.nukeBanUntil > game.tick) return 'nukeBan';
  if (f.event?.id === 'peaceSummit' && f.event.until > game.tick) return 'peaceSummit';
  return null;
}

/** How many bombs of `kind` p could launch right now (research, gold, loaded tubes, batch cap). */
export function maxLaunchable(game: Game, p: Player, kind: N): number {
  if (!game.config.allowNukes || game.phase !== 'playing' || nuclearHalt(game)) return 0;
  if (nukeLock(game, p, kind) >= 0) return 0;
  const cost = nukeCost(game, p, kind);
  let tubes = 0;
  for (const s of readySilos(game, p)) for (const t of s.tubes) if (t === 0) tubes++;
  if (kind === N.Mirv) tubes = Math.min(tubes, 1);
  return Math.max(0, Math.min(MAX_NUKE_BATCH, tubes, Math.floor(p.gold / Math.max(1, cost))));
}

// ------------------------------------------------------------------ paths

const paths = new WeakMap<Unit, Trajectory>();

/** The flight path of a missile or interceptor (rebuilt on demand from the unit's fields). */
export function missilePath(game: Game, u: Unit): Trajectory {
  let t = paths.get(u);
  if (!t) {
    t = new Trajectory(u.sx, u.sy, u.tx, u.ty, u.dir, game.map.height);
    paths.set(u, t);
  }
  return t;
}

function nukePos(game: Game, u: Unit, tick: number): [number, number] {
  const f = (tick - u.t0) / Math.max(1, u.t1 - u.t0);
  return missilePath(game, u).at(Math.max(0, Math.min(1, f)));
}

/** Carrier flight time: pulled towards MIRV_FLIGHT_TICKS (square-root compression of long flights). */
function mirvTicks(path: Trajectory): number {
  const ideal = Math.floor((path.length / NUKE_SPEED[N.Mirv]) * 100);
  const base = MIRV_FLIGHT_TICKS * 100;
  let t = base;
  if (ideal > base) t = base + Math.floor(Math.sqrt(ideal - base)) * 14 + Math.floor((ideal - base) / 10);
  else if (ideal < base) t = base - Math.floor(Math.sqrt(base - ideal)) * 10;
  return Math.ceil(Math.max(100, t) / 100);
}

/** SAMs can only reach a missile near its launch point or near its target. */
function targetable(m: Unit, x: number, y: number): boolean {
  const r2 = NUKE_TARGETABLE_RANGE * NUKE_TARGETABLE_RANGE;
  return (x - m.sx) ** 2 + (y - m.sy) ** 2 <= r2 || (x - m.tx) ** 2 + (y - m.ty) ** 2 <= r2;
}

// ------------------------------------------------------------------ launch

/** Land tiles of each player under the blast (inner tiles weigh 1, outer tiles ½) and whose buildings it hits. */
function blastFootprint(
  game: Game,
  kind: N,
  cx: number,
  cy: number,
): { weight: Map<number, number>; hit: Set<number> } {
  const r = NUKE_RADIUS[kind];
  const rf = NUKE_FALLOUT_RADIUS[kind];
  const w = game.map.width;
  const weight = new Map<number, number>();
  const hit = new Set<number>();
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -rf; dy <= rf; dy++) {
    for (let dx = -rf; dx <= rf; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > rf * rf || !game.map.inBounds(x0 + dx, y0 + dy)) continue;
      const o = game.owner[(y0 + dy) * w + x0 + dx]!;
      if (o > 0) weight.set(o, (weight.get(o) ?? 0) + (d2 <= r * r ? 1 : 0.5));
    }
  }
  game.grid.query(cx, cy, rf, (id) => {
    const b = game.buildings.get(id)!;
    if ((b.x + 0.5 - cx) ** 2 + (b.y + 0.5 - cy) ** 2 < rf * rf) hit.add(b.owner);
  });
  return { weight, hit };
}

/**
 * Who a strike at `tile` threatens (the players whose land lies under the blast, or the
 * MIRV's target country) and which allies it betrays (more than NUKE_BETRAYAL_TILES
 * weighted tiles of theirs, or any of their buildings). Shared with the launch preview.
 */
export function strikeVictims(
  game: Game,
  p: Player,
  kind: N,
  tile: number,
): { victims: number[]; betrayed: number[] } {
  const w = game.map.width;
  if (kind === N.Mirv) {
    const o = game.owner[tile]!;
    const victims = o > 0 && o !== p.id ? [o] : [];
    return { victims, betrayed: victims.filter((v) => p.allies.has(v)) };
  }
  const { weight, hit } = blastFootprint(game, kind, (tile % w) + 0.5, ((tile / w) | 0) + 0.5);
  const victims: number[] = [];
  const betrayed: number[] = [];
  for (const [o, n] of weight) {
    if (o === p.id) continue;
    victims.push(o);
    if (p.allies.has(o) && (n > NUKE_BETRAYAL_TILES || hit.has(o))) betrayed.push(o);
  }
  for (const o of hit) if (o !== p.id && !weight.has(o) && p.allies.has(o)) betrayed.push(o);
  return { victims: victims.sort((a, b) => a - b), betrayed: betrayed.sort((a, b) => a - b) };
}

export function launchNukes(game: Game, p: Player, kind: N, tile: number, count: number, up = true): number {
  const n = Math.min(count, maxLaunchable(game, p, kind));
  if (n <= 0) return 0;
  const w = game.map.width;
  const tx = (tile % w) + 0.5;
  const ty = ((tile / w) | 0) + 0.5;
  const silos = readySilos(game, p).sort(
    (a, b) => (a.x - tx) ** 2 + (a.y - ty) ** 2 - ((b.x - tx) ** 2 + (b.y - ty) ** 2) || a.id - b.id,
  );
  const { victims, betrayed } = strikeVictims(game, p, kind, tile);
  let launched = 0;
  let impact = 0;
  const queue = new Map<number, number>();
  for (const s of silos) {
    for (let k = 0; k < s.tubes.length && launched < n; k++) {
      if (s.tubes[k] !== 0) continue;
      const cost = nukeCost(game, p, kind);
      if (p.gold < cost) break;
      p.gold -= cost;
      const reloadTech = game.config.features.tech ? techNukes(p).reload : 1;
      s.tubes[k] = Math.round(SILO_RELOAD_TICKS / reloadTech);
      if (kind === N.Mirv) game.features.mirvLaunches++;
      const delay = queue.get(s.id) ?? 0;
      queue.set(s.id, delay + 1);
      const sx = s.x + 0.5;
      const sy = s.y + 0.5;
      const u = makeUnit(game.nextId(), U.Nuke, p.id, sx, sy);
      u.kind = kind;
      u.sx = sx;
      u.sy = sy;
      u.dest = tile;
      if (kind === N.Mirv) {
        [u.tx, u.ty] = mirvSplitPoint(sx, tx, ty);
        u.dir = ARC_UP;
      } else {
        u.tx = tx;
        u.ty = ty;
        u.dir = up ? ARC_UP : ARC_DOWN;
      }
      const path = missilePath(game, u);
      u.t0 = game.tick + delay;
      u.t1 =
        u.t0 + (kind === N.Mirv ? mirvTicks(path) : flightTicks(path, NUKE_SPEED[kind], NUKE_MIN_FLIGHT));
      u.home = s.id;
      addUnit(game, u);
      if (launched === 0) impact = u.t1;
      launched++;
      p.stats.nukesLaunched++;
      game.emit({
        k: 'nukeLaunch',
        id: u.id,
        owner: p.id,
        kind,
        sx,
        sy,
        tx,
        ty,
        impact: u.t1,
        threatened: victims,
      });
    }
    if (launched >= n) break;
  }
  if (launched === 0) return 0;
  // Betrayal only once a missile actually flies.
  for (const id of betrayed) betray(game, p, game.players[id]!);
  for (const v of victims) {
    game.notify(
      v,
      kind === N.Mirv ? 'alert.mirv' : 'alert.nuke',
      'danger',
      { by: p.id, eta: impact - game.tick },
      tile,
    );
    game.ai.nukedBy.set(v, p.id);
  }
  return launched;
}

// ------------------------------------------------------------------ MIRV

/** Warhead targets: random land of the target country, at least MIRV_MIN_SPREAD apart (Manhattan). */
function warheadTargets(game: Game, u: Unit): number[] {
  const w = game.map.width;
  const dest = u.dest;
  const victim = game.owner[dest]!;
  const out = [dest];
  if (victim <= 0) return out;
  const bx = dest % w;
  const by = (dest / w) | 0;
  const candidates: number[] = [];
  const own = game.owner;
  for (let t = 0; t < own.length; t++) {
    if (own[t] !== victim) continue;
    const x = t % w;
    const y = (t / w) | 0;
    if ((x - bx) ** 2 + (y - by) ** 2 <= MIRV_RANGE * MIRV_RANGE) candidates.push(t);
  }
  const rng = game.rng;
  for (let a = 0; a < 4000 && out.length < MIRV_MAX_WARHEADS && candidates.length > 0; a++) {
    const t = candidates[rng.int(0, candidates.length - 1)]!;
    const x = t % w;
    const y = (t / w) | 0;
    let ok = true;
    for (const o of out) {
      if (Math.abs((o % w) - x) + Math.abs(((o / w) | 0) - y) < MIRV_MIN_SPREAD) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(t);
  }
  return out;
}

function splitMirv(game: Game, u: Unit): void {
  const rng = game.rng;
  const w = game.map.width;
  const targets = warheadTargets(game, u);
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k]!;
    const h = makeUnit(game.nextId(), U.Nuke, u.owner, u.tx, u.ty);
    h.kind = N.MirvWarhead;
    h.sx = u.tx;
    h.sy = u.ty;
    h.tx = (t % w) + 0.5;
    h.ty = ((t / w) | 0) + 0.5;
    h.dest = t;
    h.dir = ARC_UP;
    h.t0 = game.tick + rng.int(0, 15);
    const speed = NUKE_SPEED[N.MirvWarhead] + Math.min(4, Math.floor(k / 70));
    h.t1 = h.t0 + flightTicks(missilePath(game, h), speed, 4);
    h.home = u.home;
    addUnit(game, h);
  }
}

// ------------------------------------------------------------------ SAMs

/** Missiles a SAM holds: one per level, plus tech. */
function samSlots(game: Game, sam: Building): number {
  const tech = game.config.features.tech ? techSam(game.players[sam.owner]!) : { range: 0, targets: 0 };
  return sam.level + tech.targets;
}

export function samRangeOf(game: Game, sam: Building): number {
  const tech = game.config.features.tech ? techSam(game.players[sam.owner]!) : { range: 0, targets: 0 };
  return samRange(sam.level) + tech.range;
}

/** A SAM's missile slots follow its level: a finished SAM starts loaded, upgrades add a reloading slot. */
function ensureSamSlots(game: Game, sam: Building): number {
  const slots = samSlots(game, sam);
  while (sam.tubes.length < slots) sam.tubes.push(sam.tubes.length === 0 ? 0 : SAM_COOLDOWN);
  return slots;
}

/** Index of a loaded SAM missile, or -1. */
export function samLoaded(game: Game, sam: Building): number {
  if (!inService(sam)) return -1;
  const slots = ensureSamSlots(game, sam);
  for (let k = 0; k < slots; k++) if (sam.tubes[k] === 0) return k;
  return -1;
}

/** Loaded SAM missiles (a bomber raid's planners count them). */
export function samMissilesReady(game: Game, sam: Building): number {
  if (!inService(sam)) return 0;
  const slots = ensureSamSlots(game, sam);
  let n = 0;
  for (let k = 0; k < slots; k++) if (sam.tubes[k] === 0) n++;
  return n;
}

export function samFire(sam: Building, slot: number): void {
  sam.tubes[slot] = SAM_COOLDOWN;
}

interface Plan {
  /** Ticks to wait before firing so the interceptor meets the missile (≤ 0: fire now). */
  wait: number;
  /** Tick of the meeting. */
  at: number;
}

/**
 * Pre-aim: the first future point of the missile's path that is reachable (targetable
 * zone, inside the SAM's range, and close enough for the interceptor to get there in
 * time). Failing that, a SAM covering the target aims at the last moment.
 */
function interceptPlan(game: Game, sx: number, sy: number, range: number, m: Unit): Plan | null {
  const [bx0, by0, bx1, by1] = missilePath(game, m).bounds;
  if (sx < bx0 - range || sx > bx1 + range || sy < by0 - range || sy > by1 + range) return null;
  for (let k = 1; game.tick + k < m.t1; k++) {
    const [x, y] = nukePos(game, m, game.tick + k);
    const d = Math.hypot(x - sx, y - sy);
    if (d > range || !targetable(m, x, y)) continue;
    const need = Math.ceil(d / SAM_INTERCEPTOR_SPEED);
    if (k >= need) return { wait: k - need, at: game.tick + k };
  }
  const last = m.t1 - 1;
  if (last > game.tick && Math.hypot(m.tx - sx, m.ty - sy) <= range) return { wait: 0, at: last };
  return null;
}

function updateSams(game: Game, missiles: Unit[]): void {
  for (const sam of game.buildings.values()) {
    if (sam.type !== B.Sam || sam.buildLeft > 0) continue;
    ensureSamSlots(game, sam);
    for (let k = 0; k < sam.tubes.length; k++) if (sam.tubes[k]! > 0) sam.tubes[k]!--;
  }
  if (missiles.length === 0) return;
  for (const sam of game.buildings.values()) {
    if (sam.type !== B.Sam || !inService(sam)) continue;
    const owner = game.players[sam.owner]!;
    if (!owner.alive || samLoaded(game, sam) < 0) continue;
    const range = samRangeOf(game, sam);
    const sx = sam.x + 0.5;
    const sy = sam.y + 0.5;
    const ready: { m: Unit; at: number; score: number }[] = [];
    for (const m of missiles) {
      if (!m.alive || m.t0 > game.tick || m.kind === N.Mirv || m.target >= 0) continue;
      if (game.friendly(sam.owner, m.owner)) continue;
      const plan = interceptPlan(game, sx, sy, range, m);
      if (!plan || plan.wait > 0) continue;
      const score =
        (m.kind === N.Hydrogen ? 70_001 : 0) +
        Math.max(0, 200_000 - 1_000 * (Math.abs(m.tx - sx) + Math.abs(m.ty - sy))) +
        Math.max(0, 10_000 - 100 * (m.t1 - game.tick));
      ready.push({ m, at: plan.at, score });
    }
    ready.sort((a, b) => b.score - a.score || a.m.id - b.m.id);
    for (const r of ready) {
      const slot = samLoaded(game, sam);
      if (slot < 0) break;
      samFire(sam, slot);
      const [ix, iy] = nukePos(game, r.m, r.at);
      const i = makeUnit(game.nextId(), U.Interceptor, sam.owner, sx, sy);
      i.sx = sx;
      i.sy = sy;
      i.tx = ix;
      i.ty = iy;
      i.dir = ARC_STRAIGHT;
      i.t0 = game.tick;
      i.t1 = r.at;
      i.target = r.m.id;
      addUnit(game, i);
      r.m.target = i.id;
    }
  }
}

/** The SAMs that would shoot at p's missiles (neither p's, a teammate's nor an ally's). */
export function hostileSams(game: Game, p: Player): { x: number; y: number; range: number }[] {
  const out: { x: number; y: number; range: number }[] = [];
  for (const b of game.buildings.values())
    if (b.type === B.Sam && inService(b) && !game.friendly(b.owner, p.id))
      out.push({ x: b.x + 0.5, y: b.y + 0.5, range: samRangeOf(game, b) });
  return out;
}

/** The silo p would fire from at `tile` (nearest with a loaded tube), or null. */
export function launchSilo(game: Game, p: Player, tile: number): Building | null {
  const w = game.map.width;
  const tx = (tile % w) + 0.5;
  const ty = ((tile / w) | 0) + 0.5;
  let best: Building | null = null;
  let bd = Infinity;
  for (const s of readySilos(game, p)) {
    if (!s.tubes.includes(0)) continue;
    const d = (s.x - tx) ** 2 + (s.y - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

// ------------------------------------------------------------------ tick

export function updateNukes(game: Game): void {
  const missiles: Unit[] = [];
  for (const u of game.units) if (u.alive && u.type === U.Nuke) missiles.push(u);
  updateSams(game, missiles);
  for (const u of game.units) {
    if (!u.alive) continue;
    if (u.type === U.Interceptor) {
      const [x, y] = nukePos(game, u, game.tick);
      u.x = x;
      u.y = y;
      if (game.tick >= u.t1) {
        u.alive = false;
        const m = game.units.find((v) => v.id === u.target);
        if (m && m.alive) {
          m.alive = false;
          game.emit({ k: 'intercept', x: u.x, y: u.y, owner: u.owner });
          const sp = game.players[u.owner]!;
          sp.stats.nukesIntercepted++;
          game.notify(u.owner, 'notify.intercepted', 'good');
          game.notify(m.owner, 'notify.nukeIntercepted', 'warn');
        }
      }
      continue;
    }
    if (u.type !== U.Nuke) continue;
    if (game.tick < u.t0) continue;
    const [x, y] = nukePos(game, u, game.tick);
    u.x = x;
    u.y = y;
    if (game.tick >= u.t1) {
      u.alive = false;
      if (u.kind === N.Mirv) splitMirv(game, u);
      else detonate(game, u.kind, u.tx, u.ty, u.owner);
    }
  }
  if (game.config.decontamination && game.tick % Math.max(1, Math.round(DECONTAMINATION_TICKS / 255)) === 0) {
    decayFallout(game);
  }
}

// ------------------------------------------------------------- detonation

export function detonate(game: Game, kind: N, cx: number, cy: number, by: number): void {
  const r = NUKE_RADIUS[kind];
  const rf = NUKE_FALLOUT_RADIUS[kind];
  const w = game.map.width;
  const lost = new Map<number, number>();
  const before = new Map<number, number>();
  const water = game.config.waterNukes;
  const seed = game.config.seed + game.tick;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let dy = -rf; dy <= rf; dy++) {
    for (let dx = -rf; dx <= rf; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!game.map.inBounds(x, y)) continue;
      const d2 = dx * dx + dy * dy;
      if (d2 > rf * rf) continue;
      const t = y * w + x;
      if (IS_LAND[game.map.terrain[t]!] !== 1) continue;
      // Every tile of the inner radius is destroyed, half of those of the outer ring
      // (a smooth disc with the "water nukes" option).
      if (d2 > r * r && (water ? d2 > ((r + rf) / 2) ** 2 : (hash2(x, y, seed) & 1) === 1)) continue;
      const o = game.owner[t]!;
      if (o > 0) {
        if (!before.has(o)) before.set(o, game.players[o]!.tiles);
        lost.set(o, (lost.get(o) ?? 0) + 1);
        game.setOwner(t, 0);
      }
      game.setFallout(t, 255);
    }
  }
  // Every building and unit inside the outer radius, and the rails, are destroyed.
  const doomed: Building[] = [];
  game.grid.query(cx, cy, rf, (id) => {
    const b = game.buildings.get(id)!;
    if ((b.x + 0.5 - cx) ** 2 + (b.y + 0.5 - cy) ** 2 < rf * rf) doomed.push(b);
  });
  for (const b of doomed) removeBuilding(game, b, false);
  for (const u of game.units) {
    if (!u.alive || u.type === U.Nuke || u.type === U.Interceptor) continue;
    if ((u.x - cx) ** 2 + (u.y - cy) ** 2 < rf * rf) u.alive = false;
  }
  destroyRailsInRadius(game, cx, cy, rf);
  // Troop losses for every player hit, also felt by its attacks and transports at sea.
  for (const [o, n] of lost) {
    const p = game.players[o]!;
    const t0 = p.troops;
    if (kind === N.MirvWarhead) {
      const cap = Math.max(1, p.popCap);
      for (let k = 0; k < n; k++)
        p.troops -=
          WARHEAD_TROOP_LOSS * (1 - Math.exp((-2 * Math.max(0, p.troops - WARHEAD_TROOP_FLOOR * cap)) / cap));
    } else {
      const tiles = Math.max(1, before.get(o) ?? 1);
      const q = Math.max(0, (tiles - n) / tiles);
      let keep = 1;
      for (let e = 0; e < NUKE_TROOP_EXP; e++) keep *= q;
      p.troops *= keep;
    }
    // Fallout shelters (tech): part of the victims survive.
    if (game.config.features.tech) p.troops = t0 - (t0 - p.troops) * techShelter(p);
    if (p.troops < 0) p.troops = 0;
    const ratio = t0 > 0 ? p.troops / t0 : 1;
    for (const a of game.attacks) if (a.attacker === o && !a.done) a.troops *= ratio;
    for (const u of game.units) if (u.alive && u.owner === o && u.type === U.Transport) u.troops *= ratio;
    p.stats.troopsLost += t0 - p.troops;
    if (o !== by) game.ai.nukedBy.set(o, by);
  }
  game.emit({ k: 'explosion', x: cx, y: cy, kind, radius: r, owner: by });
}

function decayFallout(game: Game): void {
  const f = game.fallout;
  for (let i = game.tick % 4; i < f.length; i += 4) {
    const v = f[i]!;
    if (v > 0) game.setFallout(i, v > 4 ? v - 4 : 0);
  }
}
