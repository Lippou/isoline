// Ballistic flight paths, shared by the simulation (SAM interception) and the
// client (in-flight arcs, launch preview). A cubic Bézier bowed along the map's
// Y axis — towards the top of the map ("arc up") or the bottom ("arc down") —
// travelled at constant speed (arc-length parameterisation).
import {
  MIRV_SPLIT_HEIGHT,
  NUKE_MIN_FLIGHT,
  NUKE_TARGETABLE_RANGE,
  SAM_INTERCEPTOR_SPEED,
} from '../game/constants';

/** Arc direction stored in Unit.dir for missiles: straight line, bowed up, bowed down. */
export const ARC_STRAIGHT = 0;
export const ARC_UP = -1;
export const ARC_DOWN = 1;

/** Minimum bow height in tiles; longer flights bow by a third of their length. */
export const ARC_MIN_HEIGHT = 50;

const SAMPLES = 64;

export class Trajectory {
  readonly length: number;
  /** Axis-aligned bounds of the whole path: x0, y0, x1, y1. */
  readonly bounds: [number, number, number, number];
  private readonly c: number[]; // control points x0 y0 x1 y1 x2 y2 x3 y3
  private readonly cum: Float64Array; // cumulative length at each sample

  constructor(sx: number, sy: number, tx: number, ty: number, arc: number, mapHeight: number) {
    const dx = tx - sx;
    const dy = ty - sy;
    const h = arc === ARC_STRAIGHT ? 0 : Math.max(Math.sqrt(dx * dx + dy * dy) / 3, ARC_MIN_HEIGHT) * arc;
    const clampY = (y: number) => Math.max(0, Math.min(mapHeight - 1, y));
    this.c = [
      sx,
      sy,
      sx + dx / 4,
      arc === ARC_STRAIGHT ? sy + dy / 4 : clampY(sy + dy / 4 + h),
      sx + (dx * 3) / 4,
      arc === ARC_STRAIGHT ? sy + (dy * 3) / 4 : clampY(sy + (dy * 3) / 4 + h),
      tx,
      ty,
    ];
    this.cum = new Float64Array(SAMPLES + 1);
    let [px, py] = this.bezier(0);
    let x0 = px;
    let y0 = py;
    let x1 = px;
    let y1 = py;
    for (let k = 1; k <= SAMPLES; k++) {
      const [x, y] = this.bezier(k / SAMPLES);
      this.cum[k] = this.cum[k - 1]! + Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      px = x;
      py = y;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    this.length = this.cum[SAMPLES]!;
    this.bounds = [x0, y0, x1, y1];
  }

  private bezier(t: number): [number, number] {
    const c = this.c;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const d = 3 * u * t * t;
    const e = t * t * t;
    return [a * c[0]! + b * c[2]! + d * c[4]! + e * c[6]!, a * c[1]! + b * c[3]! + d * c[5]! + e * c[7]!];
  }

  /** Position after travelling the fraction f (0…1) of the path length. */
  at(f: number): [number, number] {
    if (f <= 0) return [this.c[0]!, this.c[1]!];
    if (f >= 1) return [this.c[6]!, this.c[7]!];
    const want = f * this.length;
    let lo = 0;
    let hi = SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! < want) lo = mid;
      else hi = mid;
    }
    const span = this.cum[hi]! - this.cum[lo]!;
    const k = span > 0 ? (want - this.cum[lo]!) / span : 0;
    return this.bezier((lo + k) / SAMPLES);
  }
}

/** Flight time of a missile: constant speed along the path, never under `minTicks`. */
export function flightTicks(path: Trajectory, speed: number, minTicks: number): number {
  return Math.max(minTicks, Math.ceil(path.length / speed));
}

/** MIRV carriers climb to a separation point halfway, high above the target. */
export function mirvSplitPoint(sx: number, tx: number, ty: number): [number, number] {
  return [Math.floor((sx + tx) / 2) + 0.5, Math.max(0, Math.floor(ty) - MIRV_SPLIT_HEIGHT) + 50.5];
}

/**
 * Launch preview and AI: the first point (as a fraction of the path) where one of `sams`
 * would catch a missile flying along `path` from (sx, sy) to (tx, ty), or -1 for clear sky.
 * Mirrors the simulation: SAMs only reach missiles near their launch point or their
 * target, and their interceptors fly SAM_INTERCEPTOR_SPEED tiles per tick.
 */
export function predictInterception(
  path: Trajectory,
  tx: number,
  ty: number,
  speed: number,
  sams: readonly { x: number; y: number; range: number }[],
): number {
  if (sams.length === 0) return -1;
  const [sx, sy] = path.at(0);
  const ticks = flightTicks(path, speed, NUKE_MIN_FLIGHT);
  const r2 = NUKE_TARGETABLE_RANGE * NUKE_TARGETABLE_RANGE;
  for (let k = 1; k < ticks; k++) {
    const f = k / ticks;
    const [x, y] = path.at(f);
    if ((x - sx) ** 2 + (y - sy) ** 2 > r2 && (x - tx) ** 2 + (y - ty) ** 2 > r2) continue;
    for (const s of sams) {
      const d = Math.hypot(x - s.x, y - s.y);
      if (d <= s.range && k >= Math.ceil(d / SAM_INTERCEPTOR_SPEED)) return f;
    }
  }
  for (const s of sams) if (Math.hypot(tx - s.x, ty - s.y) <= s.range) return (ticks - 1) / ticks;
  return -1;
}
