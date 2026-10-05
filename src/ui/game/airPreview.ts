// Aiming an aircraft: what a plane sent at the hovered tile would do — the airfield it takes
// off from, its reach, the building a bomber would hit and what is left of it, the hostile
// SAMs and interceptors waiting on the way. Mirrors the simulation (src/core/units/air.ts)
// on the client mirror; fog of war hides what the viewer cannot see.
import { ashOnRoute } from '../hud/worldEvents';
import type { ClientState } from '../../engine/clientState';
import {
  A,
  AIRFIELD_CAPACITY,
  B,
  BOMBER_LEVELS,
  BOMBER_LEVELS_SPOTTED,
  BOMBER_RANGE,
  BOMBER_SHIP_DAMAGE,
  BOMBER_SHIP_RADIUS,
  BOMBER_SHIP_SNAP,
  BOMBER_SNAP,
  FIGHTER_RANGE,
  FIGHTER_SIGHT,
  RECON_RADIUS,
  RECON_RANGE,
  SCRAMBLE_SIGHT,
  TRANSPORT_HP,
  MERCHANT_HP,
  WARSHIP_HP,
  radarRange,
} from '../../core/game/constants';
import { IS_LAND } from '../../core/map/terrain';
import { truceCovers, truceOf, type Truce } from './truce';
import { UNIT_STRIDE } from '../../engine/protocol';
import { U } from '../../core/units/unit';
import { AIR_INTERCEPTOR, RECON_ORBIT } from '../../core/units/air';
import type { AirPreview } from '../../render/renderer';

export const AIR_REACH = [FIGHTER_RANGE, BOMBER_RANGE, RECON_RANGE] as const;
const MAX_LEVEL_ONE = new Set<number>([B.DefensePost]);

export interface AirAim {
  overlay: AirPreview;
  /**
   * Why the order would be refused ('' when it would fly), in the simulation's order
   * (units/air.ts planAircraft): the target first (a truce, an immunity), then the airfields
   * (none, full, too far, a volcanic ash cloud on the way).
   */
  problem: '' | 'noAirfield' | 'full' | 'range' | 'noTarget' | 'teammate' | 'truce' | 'immune' | 'ash';
  /** The truce refusing a bomber (problem 'truce'), or holding a fighter's fire. */
  truce: Truce | null;
  /** Bomber: the building it would hit, and its level after the hit (0: destroyed). */
  target: { type: number; owner: number; level: number; after: number } | null;
  /**
   * Bomber at sea (1.16): the ship it would follow (unit type, owner), its hull before and
   * after the bombs (shares of its hp; after 0: sunk) and the other hostile ships in the blast.
   */
  ship: { type: number; owner: number; hp: number; after: number; others: number } | null;
  /** Loaded hostile SAM missiles reaching the bomber's route (each one downs a bomber). */
  samMissiles: number;
  /** Hostile airfields that would scramble an interceptor at the plane over its target. */
  interceptors: number;
  /** Bomber inside one of our reconnaissance zones: two levels instead of one. */
  spotted: boolean;
  /** Owner of the target (the building's, or the tile's). */
  victim: number;
  /** The strike would betray this ally (0: none). */
  betrays: number;
  /** Planes in flight and the room of our airfields. */
  flying: number;
  room: number;
}

/** Our reconnaissance zones (orbiting planes), read from the unit buffer. */
export function reconZones(
  s: ClientState,
  owner: number,
): { x: number; y: number; r: number; left: number }[] {
  const out: { x: number; y: number; r: number; left: number }[] = [];
  for (let k = 0; k < s.unitCount; k++) {
    const o = k * UNIT_STRIDE;
    if (s.units[o + 1] !== U.Recon || s.units[o + 2] !== owner || s.units[o + 6] !== RECON_ORBIT) continue;
    out.push({ x: s.units[o + 10]!, y: s.units[o + 11]!, r: RECON_RADIUS, left: s.units[o + 13]! - s.tick });
  }
  return out;
}

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return [Math.hypot(px - ax - k * dx, py - ay - k * dy), k] as const;
};

export function airAim(
  s: ClientState,
  viewer: number,
  kind: A,
  tile: number,
  revealed: (owner: number, x: number, y: number) => boolean,
): AirAim {
  const w = s.width;
  let tx = (tile % w) + 0.5;
  let ty = ((tile / w) | 0) + 0.5;
  const me = s.players.get(viewer);
  const team = me?.team ?? 0;
  const mate = (id: number) => id === viewer || (team > 0 && s.players.get(id)?.team === team);
  const friend = (id: number) => mate(id) || !!me?.allies.includes(id);
  let victim = s.owner[tile] ?? 0;

  // Bomber: the nearest structure within BOMBER_SNAP that is neither ours nor a teammate's.
  let target: AirAim['target'] = null;
  if (kind === A.Bomber) {
    let best = BOMBER_SNAP * BOMBER_SNAP + 1;
    const [x0, y0] = [tile % w, (tile / w) | 0];
    for (const b of s.buildings) {
      if (b.owner <= 0 || mate(b.owner) || !revealed(b.owner, b.x, b.y)) continue;
      const d = (b.x - x0) ** 2 + (b.y - y0) ** 2;
      if (d < best) {
        best = d;
        target = { type: b.type, owner: b.owner, level: b.level, after: 0 };
        tx = b.x + 0.5;
        ty = b.y + 0.5;
        victim = b.owner;
      }
    }
  }
  // At sea (or with no building near): the hostile ship nearest the aim point, followed.
  let ship: AirAim['ship'] = null;
  if (kind === A.Bomber) {
    const ax = (tile % w) + 0.5;
    const ay = ((tile / w) | 0) + 0.5;
    let best = BOMBER_SHIP_SNAP * BOMBER_SHIP_SNAP;
    let pick = -1;
    for (let k = 0; k < s.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      const type = s.units[o + 1]!;
      const owner = s.units[o + 2]!;
      if (type !== U.Warship && type !== U.Transport && type !== U.Merchant) continue;
      if (owner <= 0 || mate(owner)) continue;
      const x = s.units[o + 3]!;
      const y = s.units[o + 4]!;
      if (!revealed(owner, x, y)) continue;
      const d = (x - ax) ** 2 + (y - ay) ** 2;
      if (d < best) {
        best = d;
        pick = o;
      }
    }
    const sea = !IS_LAND[s.terrain[tile] ?? 0];
    // As the simulation (units/air.ts bomberAim): at sea, or nearer than the building.
    const nearer = !!target && best <= (tx - 0.5 - (tile % w)) ** 2 + (ty - 0.5 - ((tile / w) | 0)) ** 2;
    if (pick >= 0 && (sea || !target || nearer)) {
      const type = s.units[pick + 1]!;
      const owner = s.units[pick + 2]!;
      tx = s.units[pick + 3]!;
      ty = s.units[pick + 4]!;
      ship = { type, owner, hp: s.units[pick + 5]!, after: 0, others: 0 };
      target = null;
      victim = owner;
      for (let k = 0; k < s.unitCount; k++) {
        const o = k * UNIT_STRIDE;
        const t2 = s.units[o + 1]!;
        if (o === pick || (t2 !== U.Warship && t2 !== U.Transport && t2 !== U.Merchant)) continue;
        if (friend(s.units[o + 2]!)) continue;
        if ((s.units[o + 3]! - tx) ** 2 + (s.units[o + 4]! - ty) ** 2 <= BOMBER_SHIP_RADIUS ** 2)
          ship.others++;
      }
    }
  }
  const spotted = reconZones(s, viewer).some((z) => (z.x - tx) ** 2 + (z.y - ty) ** 2 <= z.r * z.r);
  if (ship) {
    // Hull left, as a share of a standard hull (research may toughen warships a little).
    const max = ship.type === U.Warship ? WARSHIP_HP : ship.type === U.Transport ? TRANSPORT_HP : MERCHANT_HP;
    const dmg = (BOMBER_SHIP_DAMAGE * (spotted ? 2 : 1)) / max;
    ship.after = Math.max(0, ship.hp - dmg);
  }
  if (target) {
    const hit = spotted ? BOMBER_LEVELS_SPOTTED : BOMBER_LEVELS;
    target.after = MAX_LEVEL_ONE.has(target.type) ? 0 : Math.max(0, target.level - hit);
  }

  // The airfield: the nearest of ours (the simulation skips full ones).
  let field: (typeof s.buildings)[number] | null = null;
  let room = 0;
  let fd = Infinity;
  for (const b of s.buildings) {
    if (b.type !== B.Airfield || b.owner !== viewer || !b.ready) continue;
    room += AIRFIELD_CAPACITY * b.level;
    const d = Math.hypot(b.x + 0.5 - tx, b.y + 0.5 - ty);
    if (d < fd) {
      fd = d;
      field = b;
    }
  }
  let flying = 0;
  for (let k = 0; k < s.unitCount; k++) {
    const o = k * UNIT_STRIDE;
    const type = s.units[o + 1]!;
    if (s.units[o + 2] !== viewer || type < U.Fighter || type > U.Recon) continue;
    if (type === U.Fighter && s.units[o + 6] === AIR_INTERCEPTOR) continue;
    flying++;
  }
  const reach = AIR_REACH[kind];

  // Defences: loaded SAM missiles reaching a bomber's route; airfields scrambling over the target.
  let samMissiles = 0;
  let samF = 2;
  let interceptors = 0;
  if (field && kind !== A.Fighter) {
    const fx = field.x + 0.5;
    const fy = field.y + 0.5;
    const radarsOn = (s.world?.radarsOffUntil ?? -1) <= s.tick;
    for (const b of s.buildings) {
      if (!b.ready || friend(b.owner) || !revealed(b.owner, b.x, b.y)) continue;
      if (b.type === B.Sam && kind === A.Bomber) {
        const r = s.samReach(b.owner, b.level);
        const [d, k] = segDist(b.x + 0.5, b.y + 0.5, fx, fy, tx, ty);
        if (d > r || b.tubesReady === 0) continue;
        samMissiles += b.tubesReady;
        // Where the route enters its reach (first along the way).
        const seg = Math.hypot(tx - fx, ty - fy) || 1;
        const back = Math.sqrt(Math.max(0, r * r - d * d)) / seg;
        samF = Math.min(samF, Math.max(0, k - back));
      } else if (b.type === B.Airfield && b.tubesReady > 0) {
        const d = Math.hypot(b.x + 0.5 - tx, b.y + 0.5 - ty);
        if (d > FIGHTER_RANGE) continue;
        const radar =
          radarsOn &&
          s.buildings.some(
            (r) =>
              r.type === B.Radar &&
              r.ready &&
              (r.owner === b.owner || !!s.players.get(b.owner)?.allies.includes(r.owner)) &&
              Math.hypot(r.x - tx, r.y - ty) <= radarRange(r.level),
          );
        if (d <= SCRAMBLE_SIGHT || radar) interceptors++;
      }
    }
  }

  // A truce (peace summit, Council's ceasefire) between two countries: no bomb, no shot.
  const world = truceOf(s.world, s.tick);
  const truce = world && victim > 0 && truceCovers(s.players, viewer, victim) ? world : null;
  let problem: AirAim['problem'] = '';
  // Our own land is no target (not a "teammate"); a teammate's never is.
  if (kind === A.Bomber && (victim <= 0 || victim === viewer)) problem = 'noTarget';
  else if (kind === A.Bomber && mate(victim)) problem = 'teammate';
  else if (kind === A.Bomber && truce) problem = 'truce';
  else if (kind === A.Bomber && s.players.get(victim)?.immune) problem = 'immune';
  else if (!field) problem = 'noAirfield';
  else if (flying >= room) problem = 'full';
  else if (fd > reach) problem = 'range';
  // A volcanic ash cloud (world event) on the way: the flight is refused.
  else if (ashOnRoute(s.world, s.tick, field.x + 0.5, field.y + 0.5, tx, ty)) problem = 'ash';
  const betrays = kind === A.Bomber && victim > 0 && !!me?.allies.includes(victim) ? victim : 0;
  const ok = problem === '';
  const overlay: AirPreview = {
    kind,
    fx: field ? field.x + 0.5 : NaN,
    fy: field ? field.y + 0.5 : NaN,
    tx,
    ty,
    reach,
    ok,
    zone: kind === A.Fighter ? FIGHTER_SIGHT : kind === A.Recon ? RECON_RADIUS : 0,
    target:
      kind === A.Bomber && (target || ship)
        ? { destroy: target ? target.after === 0 : ship!.after === 0 }
        : null,
    blast: ship ? BOMBER_SHIP_RADIUS : 0,
    samF: samF <= 1 ? samF : -1,
    danger: samMissiles > 0 || interceptors > 0,
  };
  return {
    overlay,
    problem,
    truce: kind === A.Fighter ? world : truce,
    target,
    ship,
    samMissiles,
    interceptors,
    spotted,
    victim,
    betrays,
    flying,
    room,
  };
}
