// Air power (Isoline's own, GAME_DESIGN.md §11). One job per plane, with or without the fog:
// - bombers knock levels off a hostile building (a level-1 one is destroyed);
// - fighters patrol a point and shoot down aircraft and invading transports;
// - reconnaissance gives intelligence on a zone (cheaper attacks, sharper bombing, hidden numbers);
// - airfields keep one free interceptor on alert per level, scrambled at detected intruders;
// - radars extend that detection (and warn the player: src/engine/radarWatch.ts).
import { ashBlocks } from '../rules/worldEvents';
import type { Game, Refusal } from '../game/state';
import type { Player } from '../game/player';
import {
  A,
  AIR_COST,
  AIR_HP,
  AIR_SPEED,
  AIRFIELD_CAPACITY,
  B,
  BOMBER_LEVELS,
  BOMBER_LEVELS_SPOTTED,
  BOMBER_RADIUS,
  BOMBER_RANGE,
  BOMBER_SHIP_DAMAGE,
  BOMBER_SHIP_RADIUS,
  BOMBER_SHIP_SNAP,
  BOMBER_SNAP,
  BUILDING_KEYS,
  FIGHTER_CONTACT,
  FIGHTER_DAMAGE,
  FIGHTER_PATROL_TICKS,
  FIGHTER_RANGE,
  FIGHTER_SIGHT,
  RADAR_RANGE,
  RADAR_RANGE_PER_LEVEL,
  RECON_RADIUS,
  RECON_RANGE,
  RECON_TICKS,
  SCRAMBLE_REARM,
  SCRAMBLE_SIGHT,
  SCRAMBLE_TICKS,
  radarRange,
  sec,
} from '../game/constants';
import { U, UNIT_KEYS, makeUnit, type Unit } from './unit';
import { addUnit, killUnit, unitById } from './ships';
import { IS_LAND } from '../map/terrain';
import { inService, type Building } from '../buildings/building';
import { damageBuilding } from '../buildings/buildings';
import { destroyRailsInRadius } from './trains';
import { samFire, samLoaded, samRangeOf } from './nukes';
import { airLock } from '../rules/tech';
import { airSpeedAt, sightAt } from '../rules/weather';
import { openHostilities } from '../rules/diplomacy';

const TYPE_OF: Record<number, U> = { [A.Fighter]: U.Fighter, [A.Bomber]: U.Bomber, [A.Recon]: U.Recon };
/** How far each plane flies from its airfield. */
const REACH: Record<number, number> = {
  [A.Fighter]: FIGHTER_RANGE,
  [A.Bomber]: BOMBER_RANGE,
  [A.Recon]: RECON_RANGE,
};

/** Plane states (Unit.kind). */
export const AIR_OUTBOUND = 0;
/** Bomber flying home after its drop; reconnaissance orbiting its zone. */
export const AIR_BACK = 1;
/** Fighter scrambled from an airfield's alert (an interceptor). */
export const AIR_INTERCEPTOR = 2;
/** Fighter (patrol or interceptor) flying home. */
export const AIR_HOME = 3;
export const RECON_ORBIT = AIR_BACK;

export const isAircraft = (type: number): boolean => type >= U.Fighter && type <= U.Recon;

/** Planes p has in flight from airfield `b` (interceptors apart: they belong to the alert). */
function inFlight(game: Game, b: Building): number {
  let used = 0;
  for (const u of game.units)
    if (
      u.alive &&
      u.home === b.id &&
      isAircraft(u.type) &&
      !(u.type === U.Fighter && u.kind === AIR_INTERCEPTOR)
    )
      used++;
  return used;
}

/** p's nearest ready airfield with room for one more plane, and its distance to (tx, ty). */
export function airfieldFor(
  game: Game,
  p: Player,
  tx: number,
  ty: number,
): { field: Building; d: number } | null {
  let best: Building | null = null;
  let bestD = Infinity;
  for (const b of game.buildings.values()) {
    if (b.owner !== p.id || b.type !== B.Airfield || !inService(b)) continue;
    const d = Math.hypot(b.x + 0.5 - tx, b.y + 0.5 - ty);
    if (d >= bestD || inFlight(game, b) >= AIRFIELD_CAPACITY * b.level) continue;
    bestD = d;
    best = b;
  }
  return best ? { field: best, d: bestD } : null;
}

/**
 * The structure a bomber of p aimed at `tile` would hit: the nearest building within
 * BOMBER_SNAP of the aim point that is neither p's nor a teammate's (an ally's betrays it).
 * Null when there is none.
 */
export function bomberTarget(game: Game, p: Player, tile: number): Building | null {
  const w = game.map.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  let best: Building | null = null;
  let bestD = BOMBER_SNAP * BOMBER_SNAP;
  game.grid.query(x, y, BOMBER_SNAP, (id) => {
    const b = game.buildings.get(id)!;
    if (b.owner <= 0 || game.sameTeam(b.owner, p.id)) return;
    const d = (b.x - x) ** 2 + (b.y - y) ** 2;
    if (d <= bestD && (!best || d < bestD || b.id < best.id)) {
      bestD = d;
      best = b;
    }
  });
  return best;
}

/**
 * Why a plane of `kind` sent by p at `tile` would not take off ('ok' when it would), in the
 * order the player should hear it (1.16: the real reason, never a catch-all): the rules of
 * the game and research first, then the target (nothing hostile, a teammate, a truce or an
 * immunity), then the airfields (none, all full, too far, behind a volcanic ash cloud), and
 * the gold last.
 */
export type AirError =
  'ok' | 'disabled' | 'locked' | 'noAirfield' | 'full' | 'range' | 'ash' | 'noTarget' | 'gold' | Refusal;

export interface AirPlan {
  error: AirError;
  /** Aim point (a bomber's: its building or ship), the building or ship aimed at (-1: none), the airfield. */
  tx: number;
  ty: number;
  target: number;
  ship: number;
  field: Building | null;
  d: number;
}

export function planAircraft(game: Game, p: Player, kind: A, tile: number): AirPlan {
  const w = game.map.width;
  const plan: AirPlan = {
    error: 'ok',
    tx: (tile % w) + 0.5,
    ty: ((tile / w) | 0) + 0.5,
    target: -1,
    ship: -1,
    field: null,
    d: Infinity,
  };
  const fail = (error: AirError): AirPlan => ((plan.error = error), plan);
  if (!game.config.features.air) return fail('disabled');
  if (game.phase !== 'playing') return fail('phase');
  if (airLock(game, p) >= 0) return fail('locked'); // tech tree: Aerospace (even from a captured airfield)
  if (kind === A.Bomber) {
    // A bomber goes for a hostile ship at sea, a hostile structure near the aim point, or a
    // hostile tile (rails). Bombing an ally betrays it (the command breaks the pact); a
    // teammate, never.
    const aim = bomberAim(game, p, tile);
    const victim = aim ? (aim.ship ?? aim.building).owner : game.owner[tile]!;
    if (victim <= 0) return fail('noTarget');
    const why = victim === p.id ? 'noTarget' : game.attackRefusal(p.id, victim, true);
    if (why) return fail(why);
    if (aim?.ship) {
      plan.tx = aim.ship.x;
      plan.ty = aim.ship.y;
      plan.ship = aim.ship.id;
    } else if (aim?.building) {
      plan.tx = aim.building.x + 0.5;
      plan.ty = aim.building.y + 0.5;
      plan.target = aim.building.id;
    }
  }
  let any = false;
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === B.Airfield && inService(b)) any = true;
  if (!any) return fail('noAirfield');
  const pick = airfieldFor(game, p, plan.tx, plan.ty);
  if (!pick) return fail('full');
  plan.field = pick.field;
  plan.d = pick.d;
  if (pick.d > REACH[kind]!) return fail('range');
  // A volcanic ash cloud (world event): no flight from, to or across it.
  if (ashBlocks(game, pick.field.x + 0.5, pick.field.y + 0.5, plan.tx, plan.ty)) return fail('ash');
  if (p.gold < AIR_COST[kind]) return fail('gold');
  return plan;
}

/** Ships a bomber can sink or damage. */
export const isShip = (type: number): boolean =>
  type === U.Warship || type === U.Transport || type === U.Merchant;

/**
 * The ship a bomber of p aimed at `tile` would go for: the hostile ship (warship, transport,
 * trade ship) nearest the aim point within BOMBER_SHIP_SNAP — neither p's nor a teammate's
 * (an ally's betrays it). Null when there is none.
 */
export function bomberShip(game: Game, p: Player, tile: number): Unit | null {
  const w = game.map.width;
  const x = (tile % w) + 0.5;
  const y = ((tile / w) | 0) + 0.5;
  let best: Unit | null = null;
  let bestD = BOMBER_SHIP_SNAP * BOMBER_SHIP_SNAP;
  for (const v of game.units) {
    if (!v.alive || !isShip(v.type) || v.owner <= 0 || game.sameTeam(v.owner, p.id)) continue;
    const d = (v.x - x) ** 2 + (v.y - y) ** 2;
    if (d < bestD || (d === bestD && best && v.id < best.id)) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

/**
 * What a bomber of p aimed at `tile` goes for: a ship when aimed at sea (or with no building
 * near, or nearer than the building: a ship on a river), else the nearest hostile building;
 * null for neither.
 */
export function bomberAim(
  game: Game,
  p: Player,
  tile: number,
): { ship: Unit; building: null } | { ship: null; building: Building } | null {
  const ship = bomberShip(game, p, tile);
  const b = bomberTarget(game, p, tile);
  const sea = !IS_LAND[game.map.terrain[tile]!];
  // A ship on a river (land tiles) is taken when it lies nearer the aim than the building.
  const w = game.map.width;
  const [x, y] = [(tile % w) + 0.5, ((tile / w) | 0) + 0.5];
  const nearer =
    !!ship && !!b && (ship.x - x) ** 2 + (ship.y - y) ** 2 <= (b.x + 0.5 - x) ** 2 + (b.y + 0.5 - y) ** 2;
  if (ship && (sea || !b || nearer)) return { ship, building: null };
  if (b) return { ship: null, building: b };
  return null;
}

/** Sends a plane (planAircraft says why not when it returns false). */
export function launchAircraft(game: Game, p: Player, kind: A, tile: number): boolean {
  const plan = planAircraft(game, p, kind, tile);
  if (plan.error !== 'ok') return false;
  const w = game.map.width;
  const { tx, ty, target } = plan;
  const field = plan.field!;
  p.gold -= AIR_COST[kind];
  const u = makeUnit(game.nextId(), TYPE_OF[kind]!, p.id, field.x + 0.5, field.y + 0.5);
  u.hp = u.maxHp = AIR_HP[kind];
  u.speed = AIR_SPEED[kind];
  u.home = field.id;
  u.sx = field.x + 0.5;
  u.sy = field.y + 0.5;
  u.tx = tx;
  u.ty = ty;
  u.t0 = game.tick;
  u.target = target;
  // A bomber after a ship follows it (its id in `patrol`, unused by planes otherwise).
  u.patrol = plan.ship;
  u.dest = kind === A.Bomber ? Math.floor(ty) * w + Math.floor(tx) : -1;
  // Flight time at storm speed (×0.75) plus a margin: the plane never lingers forever.
  const leg = Math.ceil(plan.d / (AIR_SPEED[kind] * 0.75)) + sec(10);
  u.t1 =
    game.tick +
    (kind === A.Fighter ? leg + FIGHTER_PATROL_TICKS + leg : kind === A.Recon ? leg + RECON_TICKS : 2 * leg);
  addUnit(game, u);
  return true;
}

/** Fly one tick towards (tx, ty) at `speed` (storms slow aircraft); true on arrival. */
function flyTo(u: Unit, tx: number, ty: number, speed: number): boolean {
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) {
    u.x = tx;
    u.y = ty;
    return true;
  }
  u.x += (dx / d) * speed;
  u.y += (dy / d) * speed;
  return false;
}

/** Whether a radar of `owner` (or of a friend) covers (x, y) right now (solar storms blind them). */
export function radarSees(game: Game, owner: number, x: number, y: number): boolean {
  if (!game.config.features.radar || game.features.radarsOffUntil > game.tick) return false;
  const reach = RADAR_RANGE + RADAR_RANGE_PER_LEVEL * 2;
  let seen = false;
  game.grid.query(x, y, reach, (id) => {
    if (seen) return;
    const b = game.buildings.get(id)!;
    if (b.type !== B.Radar || b.buildLeft > 0 || !game.friendly(b.owner, owner)) return;
    const r = sightAt(game, b.x + 0.5, b.y + 0.5, radarRange(b.level));
    if ((b.x + 0.5 - x) ** 2 + (b.y + 0.5 - y) ** 2 <= r * r) seen = true;
  });
  return seen;
}

/** Whether a reconnaissance zone of `owner` (or of a friend) covers (x, y). */
export function spotted(game: Game, owner: number, x: number, y: number): boolean {
  for (const r of game.features.reveals)
    if (game.friendly(r.owner, owner) && (r.x - x) ** 2 + (r.y - y) ** 2 <= r.r * r.r) return true;
  return false;
}

/**
 * A drop at sea: every hostile ship within BOMBER_SHIP_RADIUS takes BOMBER_SHIP_DAMAGE (twice
 * that when spotted); those that reach 0 hp sink (the sinking of ships.ts). The ship hunted
 * decides the victim; others are hit only if they could be attacked (no friend, no truce).
 */
function bombShips(game: Game, u: Unit): void {
  const p = game.players[u.owner]!;
  const hunted = u.patrol >= 0 ? unitById(game, u.patrol) : undefined;
  const victim = hunted?.alive ? hunted.owner : 0;
  const damage = BOMBER_SHIP_DAMAGE * (spotted(game, u.owner, u.tx, u.ty) ? 2 : 1);
  let sunk = 0;
  let hit = 0;
  let type = -1;
  let owner = victim;
  for (const v of game.units) {
    if (!v.alive || !isShip(v.type) || (v.x - u.tx) ** 2 + (v.y - u.ty) ** 2 > BOMBER_SHIP_RADIUS ** 2)
      continue;
    if (game.friendly(v.owner, u.owner) && v.owner !== victim) continue;
    if (!game.attackAllowed(u.owner, v.owner, true)) continue;
    const q = game.players[v.owner];
    if (!q) continue;
    v.hp -= damage;
    hit++;
    if (type < 0 || v === hunted) [type, owner] = [v.type, v.owner];
    openHostilities(game, p, q);
    game.ai.raidedBy.set(v.owner, [u.owner, game.tick]);
    const params = { by: u.owner, player: v.owner, ship: UNIT_KEYS[v.type]! };
    if (v.hp <= 0) {
      sunk++;
      killUnit(game, v, u.owner);
      game.notify(v.owner, 'notify.raidShipSunk', 'danger', params);
      game.notify(u.owner, 'notify.raidHitShipSunk', 'good', params);
    } else {
      game.notify(v.owner, 'notify.raidShip', 'danger', params);
      game.notify(u.owner, 'notify.raidHitShip', 'good', params);
    }
  }
  game.emit({ k: 'explosion', x: u.tx, y: u.ty, kind: 11, radius: BOMBER_SHIP_RADIUS, owner: u.owner });
  game.emit({
    k: 'airStrike',
    x: u.tx,
    y: u.ty,
    owner: u.owner,
    victim: hit > 0 ? owner : 0,
    type: -1,
    levels: 0,
    destroyed: sunk > 0,
    ship: type,
  });
}

/** The bomber's drop: its building loses one level (two when spotted), rails and trains around are cut. */
function bomb(game: Game, u: Unit): void {
  if (u.patrol >= 0) {
    bombShips(game, u);
    return;
  }
  const p = game.players[u.owner]!;
  let b = u.target >= 0 ? game.buildings.get(u.target) : undefined;
  // The target fell into friendly hands (or was razed): whatever hostile stands there instead.
  if (!b || !b.alive || game.sameTeam(b.owner, u.owner)) {
    const w = game.map.width;
    b = bomberTarget(game, p, Math.floor(u.ty) * w + Math.floor(u.tx)) ?? undefined;
  }
  let levels = 0;
  let destroyed = false;
  let type = -1;
  let victim = 0;
  if (b && game.attackAllowed(u.owner, b.owner, true)) {
    victim = b.owner;
    type = b.type;
    levels = spotted(game, u.owner, u.tx, u.ty) ? BOMBER_LEVELS_SPOTTED : BOMBER_LEVELS;
    const [bx, by, tile] = [b.x, b.y, b.tile];
    destroyed = damageBuilding(game, b, levels);
    const q = game.players[victim]!;
    openHostilities(game, p, q);
    game.ai.raidedBy.set(victim, [u.owner, game.tick]);
    const params = { by: u.owner, player: victim, building: BUILDING_KEYS[type]!, n: levels };
    game.notify(victim, destroyed ? 'notify.raidDestroyed' : 'notify.raidDamaged', 'danger', params, tile);
    game.notify(u.owner, destroyed ? 'notify.raidHitDestroyed' : 'notify.raidHit', 'good', params, tile);
    u.tx = bx + 0.5;
    u.ty = by + 0.5;
  }
  for (const v of game.units) {
    if (
      v.alive &&
      v.type === U.Train &&
      !game.friendly(v.owner, u.owner) &&
      !game.inTruce(v.owner, u.owner) &&
      (v.x - u.tx) ** 2 + (v.y - u.ty) ** 2 <= BOMBER_RADIUS ** 2
    ) {
      v.alive = false;
    }
  }
  destroyRailsInRadius(game, u.tx, u.ty, BOMBER_RADIUS / 2);
  game.emit({ k: 'explosion', x: u.tx, y: u.ty, kind: 11, radius: BOMBER_RADIUS, owner: u.owner });
  game.emit({ k: 'airStrike', x: u.tx, y: u.ty, owner: u.owner, victim, type, levels, destroyed });
}

/** A plane goes down (`by` shot it: a SAM or a fighter). */
function shotDown(game: Game, u: Unit, by: number, cause: 'sam' | 'fighter'): void {
  u.alive = false;
  // A reconnaissance plane shot down over its zone: the intelligence stops with it.
  if (u.type === U.Recon && u.kind === RECON_ORBIT)
    game.features.reveals = game.features.reveals.filter(
      (r) => !(r.owner === u.owner && r.x === u.tx && r.y === u.ty),
    );
  game.emit({ k: 'planeDown', x: u.x, y: u.y, owner: u.owner, kind: u.type, by, cause });
  const params = { by, player: u.owner, plane: UNIT_PLANE[u.type] ?? 'fighter' };
  game.notify(u.owner, 'notify.planeLost', 'warn', params);
  game.notify(by, 'notify.planeDowned', 'good', params);
}
const UNIT_PLANE: Partial<Record<U, string>> = {
  [U.Fighter]: 'fighter',
  [U.Bomber]: 'bomber',
  [U.Recon]: 'recon',
};

/** What a fighter engages first: bombers, fighters, reconnaissance, then transports. */
const PRIORITY: Partial<Record<U, number>> = {
  [U.Bomber]: 0,
  [U.Fighter]: 1,
  [U.Recon]: 2,
  [U.Transport]: 3,
};

/** The best target of a patrolling fighter within FIGHTER_SIGHT, or undefined. */
function fighterPrey(game: Game, u: Unit): Unit | undefined {
  let best: Unit | undefined;
  let bestScore = Infinity;
  const r2 = FIGHTER_SIGHT * FIGHTER_SIGHT;
  for (const v of game.units) {
    if (!v.alive || v.owner === u.owner) continue;
    const pr = PRIORITY[v.type];
    if (pr === undefined) continue;
    const d = (v.x - u.x) ** 2 + (v.y - u.y) ** 2;
    // A ceasefire (peace summit, Council) holds in the air too: patrols only shadow.
    if (d > r2 || game.friendly(v.owner, u.owner) || game.inTruce(v.owner, u.owner)) continue;
    // Transports only when they sail to invade a friend's coast (their landing's owner at launch).
    if (v.type === U.Transport && !(v.dest > 0 && game.friendly(v.dest, u.owner))) continue;
    if (Math.hypot(v.x - u.sx, v.y - u.sy) > FIGHTER_RANGE) continue;
    const score = pr * 1e7 + d;
    if (score < bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/** Engage `tgt`: close in, then FIGHTER_DAMAGE a tick within FIGHTER_CONTACT. */
function engage(game: Game, u: Unit, tgt: Unit, speed: number): void {
  flyTo(u, tgt.x, tgt.y, speed);
  if (game.inTruce(tgt.owner, u.owner)) return; // a ceasefire began during the chase: no shot
  if (Math.hypot(tgt.x - u.x, tgt.y - u.y) > FIGHTER_CONTACT) return;
  tgt.hp -= FIGHTER_DAMAGE;
  if (tgt.hp > 0) return;
  if (tgt.type === U.Transport) {
    tgt.alive = false;
    game.notify(tgt.owner, 'notify.transportSunk', 'danger', { troops: Math.round(tgt.troops) });
    game.emit({ k: 'shipSunk', x: tgt.x, y: tgt.y, owner: tgt.owner, by: u.owner });
  } else shotDown(game, tgt, u.owner, 'fighter');
  u.kills++;
}

/** Ready airfields scramble their alert interceptors at detected hostile bombers and reconnaissance. */
function scramble(game: Game, planes: Unit[]): void {
  const chased = new Set<string>();
  for (const u of planes)
    if (u.alive && u.type === U.Fighter && u.kind === AIR_INTERCEPTOR) chased.add(`${u.owner}:${u.target}`);
  let fields: Building[] | null = null;
  for (const t of planes) {
    if (!t.alive || (t.type !== U.Bomber && t.type !== U.Recon)) continue;
    if (t.type === U.Bomber && t.kind !== AIR_OUTBOUND) continue; // bombs gone: let it fly home
    fields ??= [...game.buildings.values()].filter((b) => b.type === B.Airfield && inService(b));
    // The nearest loaded airfield of each hostile country in range.
    const best = new Map<number, [Building, number, number]>();
    for (const f of fields) {
      if (
        !f.alive ||
        game.friendly(f.owner, t.owner) ||
        game.inTruce(f.owner, t.owner) ||
        chased.has(`${f.owner}:${t.id}`)
      )
        continue;
      const d = Math.hypot(f.x + 0.5 - t.x, f.y + 0.5 - t.y);
      if (d > FIGHTER_RANGE) continue;
      const slot = alertReady(f);
      if (slot < 0) continue;
      const cur = best.get(f.owner);
      if (!cur || d < cur[1]) best.set(f.owner, [f, d, slot]);
    }
    for (const [owner, [f, d, slot]] of best) {
      const p = game.players[owner];
      if (!p || !p.alive || airLock(game, p) >= 0) continue;
      const radar = d > SCRAMBLE_SIGHT;
      if (radar && !radarSees(game, owner, t.x, t.y)) continue;
      f.tubes[slot] = SCRAMBLE_REARM;
      const u = makeUnit(game.nextId(), U.Fighter, owner, f.x + 0.5, f.y + 0.5);
      u.hp = u.maxHp = AIR_HP[A.Fighter];
      u.speed = AIR_SPEED[A.Fighter];
      u.home = f.id;
      u.sx = f.x + 0.5;
      u.sy = f.y + 0.5;
      u.tx = t.x;
      u.ty = t.y;
      u.kind = AIR_INTERCEPTOR;
      u.target = t.id;
      u.t0 = game.tick;
      u.t1 = game.tick + SCRAMBLE_TICKS;
      addUnit(game, u);
      chased.add(`${owner}:${t.id}`);
      game.emit({ k: 'scramble', x: f.x + 0.5, y: f.y + 0.5, owner, radar, target: t.id });
    }
  }
}

/** Index of an airfield's loaded alert slot (one per level), or -1. */
export function alertReady(f: Building): number {
  while (f.tubes.length < f.level) f.tubes.push(0);
  for (let k = 0; k < f.level; k++) if (f.tubes[k] === 0) return k;
  return -1;
}

export function updateAir(game: Game): void {
  if (game.features.reveals.length)
    game.features.reveals = game.features.reveals.filter((r) => r.until > game.tick);
  const planes: Unit[] = [];
  for (const u of game.units) if (u.alive && isAircraft(u.type)) planes.push(u);
  if (planes.length === 0) return;
  scramble(game, planes);
  // SAMs shoot down hostile bombers in range (one missile each), research bonuses included.
  for (const sam of game.buildings.values()) {
    if (sam.type !== B.Sam || !inService(sam)) continue;
    let slot = -2;
    const r = samRangeOf(game, sam);
    for (const u of planes) {
      if (!u.alive || u.type !== U.Bomber || game.friendly(u.owner, sam.owner)) continue;
      if ((u.x - sam.x) ** 2 + (u.y - sam.y) ** 2 > r * r) continue;
      if (slot === -2) slot = samLoaded(game, sam);
      if (slot < 0) break;
      samFire(sam, slot);
      game.emit({ k: 'intercept', x: u.x, y: u.y, owner: sam.owner });
      shotDown(game, u, sam.owner, 'sam');
      break;
    }
  }
  for (const u of game.units) {
    if (!u.alive || !isAircraft(u.type)) continue;
    const owner = game.players[u.owner];
    if (!owner || !owner.alive || u.hp <= 0) {
      u.alive = false;
      continue;
    }
    const speed = u.speed * airSpeedAt(game, u.x, u.y);
    if (u.type === U.Bomber) {
      // After a ship: follow it while it sails (the drop falls where it was last seen).
      if (u.kind === AIR_OUTBOUND && u.patrol >= 0) {
        const ship = unitById(game, u.patrol);
        if (ship?.alive) [u.tx, u.ty] = [ship.x, ship.y];
      }
      if (game.tick >= u.t1) u.alive = false;
      else if (u.kind === AIR_OUTBOUND && flyTo(u, u.tx, u.ty, speed)) {
        bomb(game, u);
        u.kind = AIR_BACK;
      } else if (u.kind === AIR_BACK && flyTo(u, u.sx, u.sy, speed)) u.alive = false;
    } else if (u.type === U.Recon) {
      if (game.tick >= u.t1) u.alive = false;
      else if (u.kind === AIR_OUTBOUND && flyTo(u, u.tx, u.ty, speed)) {
        u.kind = RECON_ORBIT;
        u.t1 = game.tick + RECON_TICKS;
        game.features.reveals.push({ owner: u.owner, x: u.tx, y: u.ty, r: RECON_RADIUS, until: u.t1 });
      } else if (u.kind === RECON_ORBIT) {
        const a = (game.tick - u.t0) * 0.08;
        u.x = u.tx + Math.cos(a) * 10;
        u.y = u.ty + Math.sin(a) * 10;
      }
    } else if (u.kind === AIR_HOME) {
      if (flyTo(u, u.sx, u.sy, speed) || game.tick >= u.t1 + sec(30)) u.alive = false;
    } else if (u.kind === AIR_INTERCEPTOR) {
      const tgt = unitById(game, u.target);
      if (
        !tgt ||
        !tgt.alive ||
        game.tick >= u.t1 ||
        Math.hypot(tgt.x - u.sx, tgt.y - u.sy) > FIGHTER_RANGE + 10
      )
        u.kind = AIR_HOME;
      else engage(game, u, tgt, speed);
    } else {
      // Patrol: engage the best prey in sight, otherwise circle the patrol point.
      if (game.tick >= u.t1 - Math.ceil(Math.hypot(u.x - u.sx, u.y - u.sy) / speed)) {
        u.kind = AIR_HOME;
        continue;
      }
      let tgt = u.target >= 0 ? unitById(game, u.target) : undefined;
      if (
        !tgt ||
        !tgt.alive ||
        Math.hypot(tgt.x - u.sx, tgt.y - u.sy) > FIGHTER_RANGE ||
        (tgt.x - u.x) ** 2 + (tgt.y - u.y) ** 2 > FIGHTER_SIGHT * FIGHTER_SIGHT * 1.5
      )
        tgt = fighterPrey(game, u);
      u.target = tgt ? tgt.id : -1;
      if (tgt) engage(game, u, tgt, speed);
      else {
        const a = (game.tick - u.t0) * 0.06;
        flyTo(u, u.tx + Math.cos(a) * 14, u.ty + Math.sin(a) * 14, speed);
      }
    }
  }
}
