// Aiming an aircraft: what a plane sent at the hovered tile would do — the airfield it takes
// off from, its reach, the building a bomber would hit and what is left of it, the hostile
// SAMs and interceptors waiting on the way. Mirrors the simulation (src/core/units/air.ts)
// on the client mirror; fog of war hides what the viewer cannot see.
import type { ClientState } from '../../engine/clientState';
import {
  A,
  AIRFIELD_CAPACITY,
  B,
  BOMBER_LEVELS,
  BOMBER_LEVELS_SPOTTED,
  BOMBER_RANGE,
  BOMBER_SNAP,
  FIGHTER_RANGE,
  FIGHTER_SIGHT,
  RECON_RADIUS,
  RECON_RANGE,
  SCRAMBLE_SIGHT,
  radarRange,
} from '../../core/game/constants';
import { UNIT_STRIDE } from '../../engine/protocol';
import { U } from '../../core/units/unit';
import { AIR_INTERCEPTOR, RECON_ORBIT } from '../../core/units/air';
import type { AirPreview } from '../../render/renderer';

export const AIR_REACH = [FIGHTER_RANGE, BOMBER_RANGE, RECON_RANGE] as const;
const MAX_LEVEL_ONE = new Set<number>([B.DefensePost]);

export interface AirAim {
  overlay: AirPreview;
  /** Why the order would be refused ('' when it would fly). */
  problem: '' | 'noAirfield' | 'full' | 'range' | 'noTarget' | 'teammate';
  /** Bomber: the building it would hit, and its level after the hit (0: destroyed). */
  target: { type: number; owner: number; level: number; after: number } | null;
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
  const spotted = reconZones(s, viewer).some((z) => (z.x - tx) ** 2 + (z.y - ty) ** 2 <= z.r * z.r);
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

  let problem: AirAim['problem'] = '';
  if (!field) problem = 'noAirfield';
  else if (flying >= room) problem = 'full';
  else if (fd > reach) problem = 'range';
  else if (kind === A.Bomber && (victim <= 0 || mate(victim))) problem = victim > 0 ? 'teammate' : 'noTarget';
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
    target: kind === A.Bomber && target ? { destroy: target.after === 0 } : null,
    samF: samF <= 1 ? samF : -1,
    danger: samMissiles > 0 || interceptors > 0,
  };
  return { overlay, problem, target, samMissiles, interceptors, spotted, victim, betrays, flying, room };
}
