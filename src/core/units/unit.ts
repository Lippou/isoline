// Moving entities (ships, trains, missiles, aircraft, projectiles).
// One flat numeric struct keeps serialization and hashing trivial.

export const enum U {
  Transport = 0,
  Warship = 1,
  Merchant = 2,
  Train = 3,
  Nuke = 4,
  Interceptor = 5,
  Shell = 6,
  Fighter = 7,
  Bomber = 8,
  Recon = 9,
}
export const UNIT_KEYS = [
  'transport',
  'warship',
  'merchant',
  'train',
  'nuke',
  'interceptor',
  'shell',
  'fighter',
  'bomber',
  'recon',
] as const;

export interface Unit {
  id: number;
  type: U;
  owner: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Waypoints (tile indices) and progress along them. */
  path: number[];
  pathIdx: number;
  speed: number;
  /** Transport troops / merchant: tiles sailed / train: progress along its rail. */
  troops: number;
  /** Generic target: unit id, tile or building id depending on type. */
  target: number;
  /** Destination tile (or building id for merchants/trains). */
  dest: number;
  /** Home building id (port / airfield / silo). */
  home: number;
  /** Warship veterancy / merchant port level / train: paying (city or port) stops so far. */
  level: number;
  kills: number;
  cooldown: number;
  patrol: number;
  /** Nukes / shells / interceptors: launch & impact ticks and endpoints. */
  t0: number;
  t1: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  kind: number;
  /** Train: current rail id, direction and stations reached so far. */
  rail: number;
  dir: number;
  stops: number;
  alive: boolean;
}

export function makeUnit(id: number, type: U, owner: number, x: number, y: number): Unit {
  return {
    id,
    type,
    owner,
    x,
    y,
    hp: 1,
    maxHp: 1,
    path: [],
    pathIdx: 0,
    speed: 1,
    troops: 0,
    target: -1,
    dest: -1,
    home: -1,
    level: 0,
    kills: 0,
    cooldown: 0,
    patrol: -1,
    t0: 0,
    t1: 0,
    sx: 0,
    sy: 0,
    tx: 0,
    ty: 0,
    kind: 0,
    rail: -1,
    dir: 1,
    stops: 0,
    alive: true,
  };
}

/**
 * Sail a ship `steps` tiles along its waypoint path, counted like OpenFront's
 * 4-connected water routes: a leg from one waypoint to the next costs |dx| + |dy|
 * steps (the hull glides along the straight leg). Returns the steps actually sailed;
 * the end is reached when u.pathIdx >= u.path.length.
 */
export function sailOnPath(u: Unit, steps: number, width: number): number {
  let remaining = steps;
  while (remaining > 0 && u.pathIdx < u.path.length) {
    const wp = u.path[u.pathIdx]!;
    const wx = (wp % width) + 0.5;
    const wy = ((wp / width) | 0) + 0.5;
    const dx = wx - u.x;
    const dy = wy - u.y;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d <= remaining) {
      u.x = wx;
      u.y = wy;
      remaining -= d;
      u.pathIdx++;
    } else {
      u.x += (dx / d) * remaining;
      u.y += (dy / d) * remaining;
      remaining = 0;
    }
  }
  return steps - remaining;
}
