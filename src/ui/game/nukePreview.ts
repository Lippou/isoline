// Launch preview: what a missile fired at the hovered tile would do — the silo that
// fires, the arc it flies, where a known hostile SAM would catch it, whom the blast
// betrays. Mirrors the simulation rules (src/core/units/nukes.ts) on the client mirror.
import type { ClientState } from '../../engine/clientState';
import {
  B,
  N,
  NUKE_BETRAYAL_TILES,
  NUKE_FALLOUT_RADIUS,
  NUKE_RADIUS,
  NUKE_SPEED,
} from '../../core/game/constants';
import {
  ARC_DOWN,
  ARC_UP,
  Trajectory,
  mirvSplitPoint,
  predictInterception,
} from '../../core/units/trajectory';
import type { NukePreview } from '../../render/renderer';

export interface LaunchInfo {
  overlay: NukePreview;
  /** A loaded silo fires; 'reloading': silos exist but none is loaded; 'none': no silo at all. */
  silo: 'ready' | 'reloading' | 'none';
  intercepted: boolean;
  /** Allies whose alliance this strike would break. */
  betrays: number[];
  /** Owner of the target tile. */
  victim: number;
  /** Teammates' land cannot be targeted. */
  teammate: boolean;
}

export function launchInfo(
  s: ClientState,
  viewer: number,
  kind: number,
  tile: number,
  arcUp: boolean,
  revealed: (owner: number, x: number, y: number) => boolean,
): LaunchInfo {
  const w = s.width;
  const tx = (tile % w) + 0.5;
  const ty = ((tile / w) | 0) + 0.5;
  const me = s.players.get(viewer);
  const allies = new Set(me?.allies ?? []);
  const team = me?.team ?? 0;
  const teammate = (id: number) => team > 0 && s.players.get(id)?.team === team;
  const victim = s.owner[tile] ?? 0;

  // Whom the blast reaches: allies with more than NUKE_BETRAYAL_TILES weighted tiles, or a building.
  const betrays = new Set<number>();
  if (kind === N.Mirv) {
    if (allies.has(victim)) betrays.add(victim);
  } else {
    const r = NUKE_RADIUS[kind as N];
    const rf = NUKE_FALLOUT_RADIUS[kind as N];
    const weight = new Map<number, number>();
    const x0 = Math.floor(tx);
    const y0 = Math.floor(ty);
    for (let dy = -rf; dy <= rf; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= s.height) continue;
      for (let dx = -rf; dx <= rf; dx++) {
        const x = x0 + dx;
        const d2 = dx * dx + dy * dy;
        if (x < 0 || x >= w || d2 > rf * rf) continue;
        const o = s.owner[y * w + x]!;
        if (allies.has(o)) weight.set(o, (weight.get(o) ?? 0) + (d2 <= r * r ? 1 : 0.5));
      }
    }
    for (const [o, n] of weight) if (n > NUKE_BETRAYAL_TILES) betrays.add(o);
    for (const b of s.buildings)
      if (allies.has(b.owner) && (b.x + 0.5 - tx) ** 2 + (b.y + 0.5 - ty) ** 2 < rf * rf)
        betrays.add(b.owner);
  }

  // The silo the simulation would pick: the nearest one with a loaded tube.
  let silo: (typeof s.buildings)[number] | null = null;
  let loaded = false;
  let best = Infinity;
  for (const b of s.buildings) {
    if (b.type !== B.Silo || b.owner !== viewer || !b.ready) continue;
    const d = (b.x - tx) ** 2 + (b.y - ty) ** 2;
    const isLoaded = b.tubesReady > 0;
    if ((isLoaded && !loaded) || (isLoaded === loaded && d < best)) {
      silo = b;
      loaded = isLoaded;
      best = d;
    }
  }

  let path: Trajectory | null = null;
  let interceptF = -1;
  if (silo) {
    const sx = silo.x + 0.5;
    const sy = silo.y + 0.5;
    if (kind === N.Mirv) {
      const [mx, my] = mirvSplitPoint(sx, tx, ty);
      path = new Trajectory(sx, sy, mx, my, ARC_UP, s.height);
    } else {
      path = new Trajectory(sx, sy, tx, ty, arcUp ? ARC_UP : ARC_DOWN, s.height);
      // Known SAMs that would fire: everyone's but ours, our teammates' and allies' we keep.
      const sams: { x: number; y: number; range: number }[] = [];
      for (const b of s.buildings) {
        if (b.type !== B.Sam || !b.ready || b.owner === viewer || teammate(b.owner)) continue;
        if (allies.has(b.owner) && !betrays.has(b.owner)) continue;
        if (!revealed(b.owner, b.x, b.y)) continue;
        sams.push({ x: b.x + 0.5, y: b.y + 0.5, range: s.samReach(b.owner, b.level) });
      }
      interceptF = predictInterception(path, tx, ty, NUKE_SPEED[kind as N], sams);
    }
  }
  return {
    overlay: { kind, path, tx, ty, interceptF, betray: betrays.size > 0, ready: loaded },
    silo: !silo ? 'none' : loaded ? 'ready' : 'reloading',
    intercepted: interceptF >= 0,
    betrays: [...betrays].sort((a, b) => a - b),
    victim,
    teammate: victim > 0 && victim !== viewer && teammate(victim),
  };
}
