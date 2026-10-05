// Our defences' reach, always on the map (1.14.0): the player asked to see where a defence
// post protects without hovering it. Drawn as on a staff map, in ink: the zone a shade
// darker (the union of every zone, never darker where two overlap), hatched, and ringed.
// Each kind has its own pattern, not only its own tint (the player is colour-blind):
//   - defence post: "/" hatching, a solid line with ticks pointing out (a fortified line);
//   - SAM battery: "\" hatching, sparser, a dashed line (as the SAM coverage while aiming);
//     where a post's zone covers it, the post's hatching alone (no cross-hatching);
//   - radar: no shade nor hatching (it guards nothing), a dotted line.
// Overlaps merge: hatch lines are cut to the union of the circles of their kind, rings skip
// the arcs inside another circle of their kind, and the shade is drawn opaque then faded
// as one layer (AlphaFilter), so it never stacks.
import { AlphaFilter, Container, Graphics } from 'pixi.js';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export type ZoneKind = 'post' | 'sam' | 'radar';

/** How each kind is drawn (screen pixels). */
export const ZONE_STYLE: Record<
  ZoneKind,
  {
    /** Hatching: direction ('/' or '\\'), spacing, opacity; null: none. */
    hatch: { dir: '/' | '\\'; px: number; alpha: number } | null;
    /** The ring: dash and gap (gap 0: solid), opacity, outward ticks (every `px`, `len` long). */
    ring: {
      dash: number;
      gap: number;
      alpha: number;
      width: number;
      ticks: { px: number; len: number } | null;
    };
    /** Shaded (the darker zone). */
    shade: boolean;
  }
> = {
  post: {
    hatch: { dir: '/', px: 8, alpha: 0.42 },
    ring: { dash: 1, gap: 0, alpha: 0.85, width: 1.6, ticks: { px: 9, len: 4 } },
    shade: true,
  },
  sam: {
    hatch: { dir: '\\', px: 14, alpha: 0.3 },
    ring: { dash: 10, gap: 5, alpha: 0.8, width: 1.5, ticks: null },
    shade: true,
  },
  radar: {
    hatch: null,
    ring: { dash: 2, gap: 5, alpha: 0.7, width: 1.5, ticks: null },
    shade: false,
  },
};

/** The ink of the zones (the Courier's), and the paper halo that keeps it legible on dark land. */
const INK = 0x10161f;
const HALO = 0xeae6da;
/** How much darker a zone is. */
const SHADE_ALPHA = 0.16;

/**
 * The hatch spacing in world units for a spacing of `px` screen pixels: a power of two, so
 * the lines stay put while zooming (they only double or halve, now and then).
 */
export function hatchStep(px: number, zoom: number): number {
  return 2 ** Math.round(Math.log2(px / Math.max(1e-6, zoom)));
}

/** Merge intervals (sorted in place). */
function union(list: [number, number][]): [number, number][] {
  list.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of list) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** `keep` minus `cut` (both merged and sorted). */
function subtract(keep: [number, number][], cut: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, b0] of keep) {
    let a = a0;
    for (const [c, d] of cut) {
      if (d <= a || c >= b0) continue;
      if (c > a) out.push([a, c]);
      a = Math.max(a, d);
      if (a >= b0) break;
    }
    if (a < b0) out.push([a, b0]);
  }
  return out;
}

/**
 * The hatching of a union of circles: parallel lines `step` apart (anchored to the world, so
 * they do not swim when the map pans), each cut to the union of the circles it crosses —
 * where circles overlap, a line is drawn once — and left out inside the `except` circles.
 * Segments as [x0, y0, x1, y1].
 */
export function hatchSegments(
  circles: readonly Circle[],
  step: number,
  dir: '/' | '\\',
  except: readonly Circle[] = [],
): number[][] {
  // The lines: n·p = k·step; along them, p = n·(k·step) + d·t.
  const s = Math.SQRT1_2;
  const n = dir === '/' ? [s, s] : [s, -s];
  const d = dir === '/' ? [s, -s] : [s, s];
  const chords = (list: readonly Circle[]) => {
    const lines = new Map<number, [number, number][]>();
    for (const c of list) {
      const m = n[0]! * c.x + n[1]! * c.y;
      const tc = d[0]! * c.x + d[1]! * c.y;
      const k0 = Math.ceil((m - c.r) / step);
      const k1 = Math.floor((m + c.r) / step);
      for (let k = k0; k <= k1; k++) {
        const off = k * step - m;
        const h2 = c.r * c.r - off * off;
        if (h2 <= 0) continue;
        const h = Math.sqrt(h2);
        let row = lines.get(k);
        if (!row) lines.set(k, (row = []));
        row.push([tc - h, tc + h]);
      }
    }
    return lines;
  };
  const cut = except.length ? chords(except) : null;
  const out: number[][] = [];
  for (const [k, row] of chords(circles)) {
    const base = [n[0]! * k * step, n[1]! * k * step];
    const hole = cut?.get(k);
    for (const [t0, t1] of hole ? subtract(union(row), union(hole)) : union(row))
      out.push([base[0]! + d[0]! * t0, base[1]! + d[1]! * t0, base[0]! + d[0]! * t1, base[1]! + d[1]! * t1]);
  }
  return out;
}

/** Whether a point lies inside one of the circles other than `self`. */
export function insideOther(circles: readonly Circle[], self: number, x: number, y: number): boolean {
  for (let j = 0; j < circles.length; j++) {
    if (j === self) continue;
    const c = circles[j]!;
    if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r) return true;
  }
  return false;
}

/** The zones' layer: under the units and the overlay, over the map and the buildings' lights. */
export class DefenceZoneLayer {
  readonly container = new Container();
  private shade = new Graphics();
  private shadeBox = new Container();
  private lines = new Graphics();
  private circles: Record<ZoneKind, Circle[]> = { post: [], sam: [], radar: [] };
  /** What the circles were computed from (see setZones), and the view last drawn. */
  version = '';
  private key = '';

  constructor() {
    this.shadeBox.addChild(this.shade);
    // Drawn opaque, faded as one: the union of the zones, one shade however many overlap.
    this.shadeBox.filters = [new AlphaFilter({ alpha: SHADE_ALPHA })];
    this.container.addChild(this.shadeBox, this.lines);
    this.container.eventMode = 'none';
  }

  /** The zones to draw (world tile units; circle centres at the tiles' centres). */
  setZones(circles: Record<ZoneKind, Circle[]>, version: string): void {
    this.circles = circles;
    this.version = version;
    this.key = '';
  }

  /**
   * Redraw for this view if it changed. `fade`: 0..1 (far zoom-outs fade the zones away);
   * `bounds`: the visible world rect, to leave out what is off screen.
   */
  update(zoom: number, bounds: readonly [number, number, number, number], fade: number): void {
    const on = fade > 0.01;
    this.container.visible = on;
    if (!on) return;
    this.container.alpha = fade;
    // Off-screen circles are left out: the view, padded by half a screen, decides.
    const [x0, y0, x1, y1] = bounds;
    const padX = (x1 - x0) / 2;
    const padY = (y1 - y0) / 2;
    const cell = (v: number, p: number) => Math.floor(v / Math.max(1, p));
    const key = `${this.version}#${zoom.toFixed(3)}|${cell(x0, padX)},${cell(y0, padY)},${cell(x1, padX)},${cell(y1, padY)}`;
    if (key === this.key) return;
    this.key = key;
    const vx0 = (cell(x0, padX) - 1) * padX;
    const vy0 = (cell(y0, padY) - 1) * padY;
    const vx1 = (cell(x1, padX) + 2) * padX;
    const vy1 = (cell(y1, padY) + 2) * padY;
    const seen = (c: Circle) => c.x + c.r > vx0 && c.x - c.r < vx1 && c.y + c.r > vy0 && c.y - c.r < vy1;
    const sh = this.shade;
    const g = this.lines;
    sh.clear();
    g.clear();
    const lw = (px: number) => Math.max(0.05, px / zoom);
    // Detail fades in with the zoom: far out, only the shade and a plain ring.
    const detail = Math.max(0, Math.min(1, (zoom - 0.7) / 0.6));
    for (const kind of ['radar', 'sam', 'post'] as const) {
      const style = ZONE_STYLE[kind];
      const all = this.circles[kind];
      if (!all.length) continue;
      const list = all.filter(seen);
      if (!list.length) continue;
      if (style.shade) for (const c of list) sh.circle(c.x, c.y, c.r).fill({ color: INK });
      if (style.hatch && detail > 0) {
        const step = hatchStep(style.hatch.px, zoom);
        // The SAMs' hatching gives way to the posts' (one pattern at a time, never crossed).
        const except = kind === 'sam' ? this.circles.post.filter(seen) : [];
        for (const [ax, ay, bx, by] of hatchSegments(list, step, style.hatch.dir, except))
          g.moveTo(ax!, ay!).lineTo(bx!, by!);
        g.stroke({ width: lw(1), color: INK, alpha: style.hatch.alpha * detail });
      }
      // The ring: a paper halo under the ink, so that it reads on dark land and on the sea.
      for (const pass of ['halo', 'ink'] as const) {
        for (let i = 0; i < list.length; i++) this.ring(g, list, i, zoom, kind, pass === 'halo', detail);
        g.stroke(
          pass === 'halo'
            ? { width: lw(style.ring.width + 2), color: HALO, alpha: 0.28 }
            : { width: lw(style.ring.width), color: INK, alpha: style.ring.alpha },
        );
      }
    }
  }

  /** One circle's ring (its arcs inside another circle of its kind left out), with its ticks. */
  private ring(
    g: Graphics,
    list: readonly Circle[],
    i: number,
    zoom: number,
    kind: ZoneKind,
    halo: boolean,
    detail: number,
  ): void {
    const c = list[i]!;
    const st = ZONE_STYLE[kind].ring;
    const circ = Math.PI * 2 * c.r * zoom;
    const n = Math.max(24, Math.min(900, Math.ceil(circ / 3)));
    const period = st.dash + st.gap;
    let open = false;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const s = ((k + 0.5) / n) * circ;
      const am = (a0 + a1) / 2;
      let on = st.gap <= 0 || s % period < st.dash;
      if (on && insideOther(list, i, c.x + Math.cos(am) * c.r, c.y + Math.sin(am) * c.r)) on = false;
      if (on) {
        if (!open) g.moveTo(c.x + Math.cos(a0) * c.r, c.y + Math.sin(a0) * c.r);
        g.lineTo(c.x + Math.cos(a1) * c.r, c.y + Math.sin(a1) * c.r);
        open = true;
      } else open = false;
    }
    // The ticks, pointing out (a fortified line), once the ring is big enough to carry them.
    const tk = st.ticks;
    if (!tk || detail <= 0.5 || circ < tk.px * 8) return;
    const count = Math.floor(circ / tk.px);
    const len = (tk.len + (halo ? 1 : 0)) / zoom;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const px = c.x + ux * c.r;
      const py = c.y + uy * c.r;
      if (insideOther(list, i, px, py)) continue;
      g.moveTo(px, py).lineTo(px + ux * len, py + uy * len);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
