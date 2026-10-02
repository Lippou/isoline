// Trade routes on the map: the sea lanes merchants sail between two ports (ours in
// brass dashes, the others as faint hairlines), thicker the more gold they paid over the
// last five minutes; busy railways glow under their track; a lane or a railway an
// embargo has just cut flashes as a broken magenta line for ten seconds.
// Batched into a few Graphics, rebuilt only when the data (at most once a second), the
// zoom step, the fog or the drawn area change; lanes far off screen are left out.
import { Graphics } from 'pixi.js';
import type { ClientState } from '../engine/clientState';
import type { RailTrafficView, RailView, TradeRouteView } from '../engine/protocol';
import { ROUTE_CUT_TICKS } from '../engine/tradeRoutes';
import { UI } from './colors';

/** Brand magenta: danger and war (BRAND.md §4). */
const CUT_COLOR = 0xe0456f;
/** Other countries' lanes: paper white, faint. */
const LANE_COLOR = 0xeef3f2;
/** Corners of a lane are rounded over at most this many tiles. */
const CORNER = 6;
/** Lanes and railways are drawn over the view plus this share of it on every side. */
const MARGIN = 0.6;

type Box = [number, number, number, number];

/** A polyline (x, y pairs) and its bounding box. */
interface Shape {
  pts: Float32Array;
  box: Box;
}

function shape(pts: Float32Array): Shape {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < pts.length; k += 2) {
    box[0] = Math.min(box[0], pts[k]!);
    box[1] = Math.min(box[1], pts[k + 1]!);
    box[2] = Math.max(box[2], pts[k]!);
    box[3] = Math.max(box[3], pts[k + 1]!);
  }
  return { pts, box };
}

const meets = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export interface RouteContext {
  /** Ink of a player. */
  ink(id: number): number;
  /** Fog of war: may the viewer see `owner`'s things at (x, y)? */
  seen(owner: number, x: number, y: number): boolean;
}

export class TradeRouteLayer {
  /** Glow under busy railways (added below the rails). */
  readonly railGlow = new Graphics();
  readonly lanes = new Graphics();
  readonly cuts = new Graphics();
  private zoomKey = '';
  private dataKey = '';
  private drawnAt = 0;
  /** World area covered by the last rebuild (the view and a margin). */
  private area: Box = [0, 0, 0, 0];
  private lanePts = new Map<number, Shape>();
  private railPts = new Map<number, Shape>();
  private railById = new Map<number, RailView>();
  private railVersion = -1;
  private cutting = false;
  private cutsVersion = -1;
  private cutSea: TradeRouteView[] = [];
  private cutRail: RailTrafficView[] = [];
  private viewer = 0;

  constructor(
    private readonly state: ClientState,
    private readonly ctx: RouteContext,
  ) {}

  /** `view`: the world rectangle on screen (x0, y0, x1, y1). */
  update(z: number, tickF: number, on: boolean, view: Box): void {
    const s = this.state;
    const show = on && !!s.routes;
    this.lanes.visible = show;
    this.cuts.visible = show;
    this.railGlow.visible = show && z > 0.9; // with the rails
    if (!show) return;
    if (s.viewer !== this.viewer) {
      this.viewer = s.viewer;
      this.lanePts.clear();
    }
    // Rebuilt every 18 % of zoom (dash lengths and widths are in pixels) or when the view
    // leaves the drawn area; new data, new rails and the fog of war at most once a second.
    const now = performance.now();
    const zoomKey = `${Math.round(Math.log(z) / Math.log(1.18))}|${s.viewer}`;
    const dataKey = `${s.routesVersion}|${s.railsVersion}|${s.fog ? s.fogVersion : 0}`;
    const a = this.area;
    const inside = view[0] >= a[0] && view[1] >= a[1] && view[2] <= a[2] && view[3] <= a[3];
    if (zoomKey !== this.zoomKey || !inside || (dataKey !== this.dataKey && now - this.drawnAt > 1000)) {
      this.zoomKey = zoomKey;
      this.dataKey = dataKey;
      this.drawnAt = now;
      const mx = (view[2] - view[0]) * MARGIN;
      const my = (view[3] - view[1]) * MARGIN;
      this.area = [view[0] - mx, view[1] - my, view[2] + mx, view[3] + my];
      this.drawLanes(z);
      this.drawRails(z);
    }
    this.drawCuts(z, tickF);
  }

  /** Force a rebuild (palette or settings changed). */
  invalidate(): void {
    this.zoomKey = '';
  }

  // ------------------------------------------------------------------ lanes
  private drawLanes(z: number): void {
    const s = this.state;
    const data = s.routes!;
    const me = s.viewer;
    const g = this.lanes;
    g.clear();
    const mine = (r: TradeRouteView) => me > 0 && (r.a === me || r.b === me);
    let most = 0;
    for (const r of data.sea) if (r.cut < 0) most = Math.max(most, r.gold);
    const ref = Math.max(most, 150_000);
    // Zoomed out, only our lanes and the busiest of the others: the map must stay legible.
    const cap = z < 0.9 ? 8 : z < 1.8 ? 30 : Infinity;
    const minor = z < 1.8 ? most * 0.12 : 0;
    const others = data.sea
      .filter((r) => r.cut < 0 && !mine(r) && r.gold >= minor && (r.gold > 0 || z >= 1.8))
      .sort((x, y) => y.gold - x.gold || x.id - y.id)
      .slice(0, cap)
      .filter((r) => meets(this.lane(r).box, this.area));
    const live = new Set<number>();
    for (const r of data.sea) live.add(r.id);
    for (const id of this.lanePts.keys()) if (!live.has(id)) this.lanePts.delete(id);
    const fade = (r: TradeRouteView) => {
      const idle = data.tick - r.last;
      return idle <= 600 ? 1 : Math.max(0, 1 - (idle - 600) / 2400);
    };
    // Others first (underneath), as faint hairlines where the viewer can see.
    for (const r of others) {
      const f = fade(r);
      if (f <= 0.02) continue;
      const k = Math.sqrt(Math.min(1, r.gold / ref));
      if (!polyline(g, this.lane(r).pts, (x, y) => this.ctx.seen(r.a, x, y) || this.ctx.seen(r.b, x, y)))
        continue;
      g.stroke({
        width: (0.8 + 1.8 * k) / z,
        color: LANE_COLOR,
        alpha: 0.32 * (0.35 + 0.65 * f),
        cap: 'round',
      });
    }
    // Ours: brass dashes on a dark casing, thicker the more they paid (zoomed out, the
    // minor ones stand down).
    let mostMine = 0;
    for (const r of data.sea) if (r.cut < 0 && mine(r)) mostMine = Math.max(mostMine, r.gold);
    for (const r of data.sea) {
      if (r.cut >= 0 || !mine(r)) continue;
      if (z < 0.9 && r.gold < mostMine * 0.1) continue;
      const f = fade(r);
      if (f <= 0.02) continue;
      const k = Math.sqrt(Math.min(1, r.gold / ref));
      const { pts, box } = this.lane(r);
      if (!meets(box, this.area)) continue;
      const wpx = 1.4 + 3 * k;
      dashed(g, pts, z, 8, 5);
      g.stroke({ width: (wpx + 1.6) / z, color: 0x0c1a26, alpha: 0.35 * f, cap: 'butt' });
      dashed(g, pts, z, 8, 5);
      g.stroke({ width: wpx / z, color: UI.brass, alpha: 0.35 + 0.6 * f, cap: 'butt' });
    }
  }

  /** The lane's waypoints as a polyline with rounded corners (cached per lane). */
  private lane(r: TradeRouteView): Shape {
    let p = this.lanePts.get(r.id);
    if (!p) {
      // Our lanes start at our port: the dashes of lanes sharing a way out line up.
      const path = r.b === this.state.viewer ? r.path.slice().reverse() : r.path;
      p = shape(rounded(path, this.state.width));
      this.lanePts.set(r.id, p);
    }
    return p;
  }

  // ------------------------------------------------------------------ rails
  private rail(id: number): Shape | null {
    const s = this.state;
    if (s.railsVersion !== this.railVersion) {
      this.railVersion = s.railsVersion;
      this.railById = new Map(s.rails.map((r) => [r.id, r]));
      this.railPts.clear();
    }
    let p = this.railPts.get(id);
    if (!p) {
      const r = this.railById.get(id);
      if (!r || r.tiles.length < 2) return null;
      const w = s.width;
      const out: number[] = [];
      for (let k = 0; k < r.tiles.length; k += 3)
        out.push((r.tiles[k]! % w) + 0.5, ((r.tiles[k]! / w) | 0) + 0.5);
      const last = r.tiles[r.tiles.length - 1]!;
      out.push((last % w) + 0.5, ((last / w) | 0) + 0.5);
      p = shape(Float32Array.from(out));
      this.railPts.set(id, p);
    }
    return p;
  }

  /** Busy railways glow under their track: brighter and wider with the trips run. */
  private drawRails(z: number): void {
    const s = this.state;
    const g = this.railGlow;
    g.clear();
    if (z <= 0.9) return; // the rails themselves are hidden that far out
    const data = s.routes!;
    let most = 0;
    for (const r of data.rail) if (r.cut < 0) most = Math.max(most, r.trips);
    const ref = Math.max(most, 8);
    for (const rt of data.rail) {
      if (rt.cut >= 0) continue;
      const sh = this.rail(rt.id);
      const owner = this.railById.get(rt.id)?.owner ?? 0;
      if (!sh || !meets(sh.box, this.area)) continue;
      const pts = sh.pts;
      const mid = (pts.length >> 2) << 1;
      if (owner !== s.viewer && !this.ctx.seen(owner, pts[mid]!, pts[mid + 1]!)) continue;
      const k = Math.sqrt(Math.min(1, rt.trips / ref));
      polyline(g, pts, null);
      g.stroke({
        width: 0.7 + 0.9 * k,
        color: owner === s.viewer ? UI.brass : this.ctx.ink(owner),
        alpha: 0.16 + 0.4 * k,
        cap: 'round',
        join: 'round',
      });
    }
  }

  // ------------------------------------------------------------------- cuts
  /** Lanes and railways an embargo has just cut: broken magenta, fading out over 10 s. */
  private drawCuts(z: number, tickF: number): void {
    const s = this.state;
    const g = this.cuts;
    if (s.routesVersion !== this.cutsVersion) {
      this.cutsVersion = s.routesVersion;
      this.cutSea = s.routes!.sea.filter((r) => r.cut >= 0);
      this.cutRail = s.routes!.rail.filter((r) => r.cut >= 0);
    }
    const age = (cut: number) => (tickF - cut) / ROUTE_CUT_TICKS;
    const active = this.cutSea.some((r) => age(r.cut) <= 1) || this.cutRail.some((r) => age(r.cut) <= 1);
    if (!active) {
      if (this.cutting) g.clear();
      this.cutting = false;
      return;
    }
    this.cutting = true;
    g.clear();
    const draw = (pts: Float32Array, a: number, wpx: number) => {
      const alpha = a < 0.7 ? 1 : Math.max(0, (1 - a) / 0.3);
      // Broken magenta dashes on a dark casing, and a cross half-way: the link is cut.
      dashed(g, pts, z, 6, 7);
      g.stroke({ width: (wpx + 2) / z, color: 0x0c1a26, alpha: 0.55 * alpha, cap: 'round' });
      dashed(g, pts, z, 6, 7);
      g.stroke({ width: wpx / z, color: CUT_COLOR, alpha, cap: 'round' });
      const [x, y] = along(pts, 0.5);
      const d = 6 / z;
      for (const [w, color, k] of [
        [5.5, 0x0c1a26, 0.6],
        [2.8, CUT_COLOR, 1],
      ] as const)
        g.moveTo(x - d, y - d)
          .lineTo(x + d, y + d)
          .moveTo(x + d, y - d)
          .lineTo(x - d, y + d)
          .stroke({ width: w / z, color, alpha: alpha * k, cap: 'round' });
    };
    for (const r of this.cutSea) {
      const a = age(r.cut);
      if (a >= 0 && a <= 1) draw(this.lane(r).pts, a, 2.6);
    }
    for (const r of this.cutRail) {
      const a = age(r.cut);
      const sh = a >= 0 && a <= 1 ? this.rail(r.id) : null;
      if (sh) draw(sh.pts, a, 2.4);
    }
  }
}

/** Waypoints (tile indices) → points with each corner rounded over ≤ CORNER tiles. */
function rounded(path: readonly number[], w: number): Float32Array {
  const p: number[] = [];
  for (const t of path) p.push((t % w) + 0.5, ((t / w) | 0) + 0.5);
  if (p.length <= 4) return Float32Array.from(p.length >= 4 ? p : [...p, ...p]);
  const out: number[] = [p[0]!, p[1]!];
  for (let k = 2; k + 2 < p.length; k += 2) {
    const [px, py, vx, vy, nx, ny] = [p[k - 2]!, p[k - 1]!, p[k]!, p[k + 1]!, p[k + 2]!, p[k + 3]!];
    const la = Math.hypot(px - vx, py - vy) || 1;
    const lb = Math.hypot(nx - vx, ny - vy) || 1;
    const fa = Math.min(0.45, CORNER / la);
    const fb = Math.min(0.45, CORNER / lb);
    const ax = vx + (px - vx) * fa;
    const ay = vy + (py - vy) * fa;
    const bx = vx + (nx - vx) * fb;
    const by = vy + (ny - vy) * fb;
    // Quadratic curve A → B around the corner V, as 4 straight pieces.
    for (let s = 0; s <= 4; s++) {
      const u = s / 4;
      out.push(
        (1 - u) * (1 - u) * ax + 2 * (1 - u) * u * vx + u * u * bx,
        (1 - u) * (1 - u) * ay + 2 * (1 - u) * u * vy + u * u * by,
      );
    }
  }
  out.push(p[p.length - 2]!, p[p.length - 1]!);
  return Float32Array.from(out);
}

/** The point a fraction `f` of the way along a polyline. */
function along(pts: Float32Array, f: number): [number, number] {
  let total = 0;
  for (let k = 0; k + 3 < pts.length; k += 2)
    total += Math.hypot(pts[k + 2]! - pts[k]!, pts[k + 3]! - pts[k + 1]!);
  let left = total * f;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const seg = Math.hypot(pts[k + 2]! - pts[k]!, pts[k + 3]! - pts[k + 1]!);
    if (seg >= left && seg > 0) {
      const u = left / seg;
      return [pts[k]! + (pts[k + 2]! - pts[k]!) * u, pts[k + 1]! + (pts[k + 3]! - pts[k + 1]!) * u];
    }
    left -= seg;
  }
  return [pts[pts.length - 2]!, pts[pts.length - 1]!];
}

/** Trace a polyline, broken wherever `keep` rejects a point; false if nothing was traced. */
function polyline(g: Graphics, pts: Float32Array, keep: ((x: number, y: number) => boolean) | null): boolean {
  let open = false;
  let any = false;
  for (let k = 0; k + 1 < pts.length; k += 2) {
    const x = pts[k]!;
    const y = pts[k + 1]!;
    if (keep && !keep(x, y)) {
      open = false;
      continue;
    }
    if (open) {
      g.lineTo(x, y);
      any = true;
    } else g.moveTo(x, y);
    open = true;
  }
  return any;
}

/** Dashes along a polyline (dash and gap in screen pixels at zoom z). */
function dashed(g: Graphics, pts: Float32Array, z: number, dash: number, gap: number): void {
  const period = dash + gap;
  let run = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!;
    const ay = pts[k + 1]!;
    const bx = pts[k + 2]!;
    const by = pts[k + 3]!;
    const seg = Math.hypot(bx - ax, by - ay) * z;
    if (seg <= 0) continue;
    let t = 0;
    while (t < seg) {
      const ph = (run + t) % period;
      const inDash = ph < dash;
      const t1 = Math.min(seg, t + (inDash ? dash - ph : period - ph));
      if (inDash)
        g.moveTo(ax + ((bx - ax) * t) / seg, ay + ((by - ay) * t) / seg).lineTo(
          ax + ((bx - ax) * t1) / seg,
          ay + ((by - ay) * t1) / seg,
        );
      t = t1;
    }
    run += seg;
  }
}
