// Deterministic organic contour lines: the logo's motif (BRAND.md §3-§4), shared by the
// menu components (Isolines, ScreenSweep, campaign route).

/** [amplitude, frequency, phase] of one harmonic of r(θ). */
export type Harm = [number, number, number];

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

/**
 * Smooth path through samples of r(θ) = r·(1 + Σ a·sin(fθ + p)), joined with Catmull-Rom
 * splines expressed as cubic Béziers. A full turn (span = 1) gives a closed contour; a
 * smaller span gives an open arc that starts at angle `start` (radians, screen axes).
 */
export function contourPath(
  cx: number,
  cy: number,
  r: number,
  harm: readonly Harm[],
  n = 64,
  start = 0,
  span = 1,
): string {
  const closed = span >= 1;
  const count = closed ? n : Math.max(4, Math.round(n * span)) + 1;
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const t = start + (closed ? i / n : (i / (count - 1)) * span) * Math.PI * 2;
    let k = 1;
    for (const [a, f, p] of harm) k += a * Math.sin(f * t + p);
    pts.push([cx + Math.cos(t) * r * k, cy + Math.sin(t) * r * k]);
  }
  const p = (i: number) => (closed ? pts[(i + count) % count]! : pts[Math.min(count - 1, Math.max(0, i))]!);
  let d = `M${f1(p(0)[0])},${f1(p(0)[1])}`;
  const segs = closed ? count : count - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    d +=
      `C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ` +
      `${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return closed ? d + 'Z' : d;
}

export interface FamilyOptions {
  /** Summit (centre of the innermost ring). */
  cx: number;
  cy: number;
  /** Number of rings. */
  count: number;
  /** Radius of the innermost ring. */
  r0: number;
  /** Spacing between the first two rings. */
  step: number;
  /** Spacing multiplier per ring (> 1: the slope gets gentler outward). */
  growth?: number;
  /** Centre drift per ring, in units of the spacing (the slope is steeper on the opposite side). */
  drift?: [number, number];
  /** Shape irregularity (0 = circles). */
  wobble?: number;
  seed?: number;
  /** Open arcs instead of closed rings: start angle (radians) and span (fraction of a turn). */
  start?: number;
  span?: number;
}

/**
 * A nested family of contours around a summit. Rings share their harmonics (with a slow
 * phase drift), so they stay parallel and never cross, like real terrain contours.
 */
export function contourFamily(o: FamilyOptions): { d: string; r: number }[] {
  const rand = rng(o.seed ?? 7);
  const wob = o.wobble ?? 1;
  const harm: Harm[] = [
    [0.075 * wob, 2, rand() * 6.28],
    [0.045 * wob, 3, rand() * 6.28],
    [0.022 * wob, 5, rand() * 6.28],
    [0.01 * wob, 7, rand() * 6.28],
  ];
  const twist = (rand() - 0.5) * 0.16;
  const [dx, dy] = o.drift ?? [0.25, 0.18];
  const out: { d: string; r: number }[] = [];
  let r = o.r0;
  let step = o.step;
  let cx = o.cx;
  let cy = o.cy;
  for (let k = 0; k < o.count; k++) {
    const h = harm.map(([a, f, p], j) => [a, f, p + k * twist * (j + 1)] as Harm);
    out.push({ d: contourPath(cx, cy, r, h, 64, o.start ?? 0, o.span ?? 1), r });
    cx += dx * step;
    cy += dy * step;
    r += step;
    step *= o.growth ?? 1.06;
  }
  return out;
}
