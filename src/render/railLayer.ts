// Railways on the map (1.16: « un vrai visuel de rails et les rails qui se construisent »).
//
// The track changes with the zoom, as a printed map's railway turns into a real one:
//  - far out (zoom < SYMBOL_BELOW): the atlas railway symbol, an ink line cased in paper
//    with alternating black and white dashes;
//  - mid zoom: two thin rails on a ladder of ties over a faint ballast bed;
//  - close up: steel rails with a highlight on wooden ties at a real spacing, on a gravel bed.
// A railway reads by its shape (ties, alternating dashes) in every colour vision; the owner's
// ink only tints the ballast and the ties a little.
//
// New rails are laid before your eyes: ballast, then ties, then the rails run from the factory
// to the station over a few seconds, with a crew and dust at the railhead. Render only: the
// simulation lays the whole line at once (as OpenFront does), and a train that takes it early
// pushes the railhead ahead of it so it never runs on bare ground. Lost rails are torn up (rails broken off in
// pieces, ties knocked askew, the bed fading). Reduced motion: a plain fade in / out.
//
// Static track is batched into chunk Graphics (rails grouped by their midpoint, CHUNK tiles) in
// three layers (bed, ties, rails), rebuilt only when their rails change or the zoom moves a
// step (a bounded amount per frame) and culled with the view; rails being built or torn up are
// redrawn every frame in one live Graphics. Trains ride the drawn curve (trainAt).
import { Container, Graphics } from 'pixi.js';
import type { ClientState } from '../engine/clientState';
import type { RailView } from '../engine/protocol';

export interface RailContext {
  /** Ink of a player. */
  ink(id: number): number;
  /** Fog of war: may the viewer see `owner`'s things at (x, y)? */
  seen(owner: number, x: number, y: number): boolean;
  /** Particle density, 0..1 (the railhead's dust). */
  particles(): number;
  reducedMotion(): boolean;
  /** Changes whenever the inks change (colour-vision setting). */
  inkKey(): string;
}

type Box = [number, number, number, number];
type G3 = [Graphics, Graphics, Graphics];

/** Rails are hidden below this zoom (too fine to read; as before 1.16). */
export const RAIL_MIN_ZOOM = 0.9;
/** Below this zoom the track is drawn as the map symbol. */
const SYMBOL_BELOW = 2;
/** From this zoom: steel highlights and wooden ties. */
const DETAIL_FROM = 11;
/** Rails are batched by the chunk (CHUNK × CHUNK tiles) holding their midpoint. */
const CHUNK = 64;
/** Path points drawn per frame for zoom-step rebuilds (changed chunks are always rebuilt). */
const OPS_BUDGET = 30_000;
/** Construction: tiles of track a second, and its bounds (seconds). */
const BUILD_SPEED = 13;
const BUILD_MIN = 2.2;
const BUILD_MAX = 5;
/** Tearing up (seconds), the fade of reduced motion, and the most animated at once. */
const TEAR = 1.7;
const FADE = 0.8;
const MAX_ANIMATED = 16;
/** Ties are laid this far (tiles, at most) ahead of the rails. */
const LAG = 3;

const INK = 0x1a1612;
const PAPER = 0xf4efe2;
const GRAVEL = 0xa29a8b;
const WOOD = 0x5b4532;
const TIE_MID = 0x2e2924;
const STEEL = 0x2a2e33;
const SHINE = 0xcfd6dc;
const DUST = 0xcdb994;

function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Stable pseudo-random 0..1 for an integer (tie, piece, puff). */
function hash(k: number, seed = 0): number {
  const v = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

const meets = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * The drawn line of a rail: one point per tile of its path (so a train's progress along the
 * tiles maps straight onto it), the A* staircase smoothed by two moving averages, the two
 * ends (the stations) kept in place.
 */
export function railCurve(tiles: readonly number[], w: number): Float32Array {
  const n = tiles.length;
  let p = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    p[i * 2] = (tiles[i]! % w) + 0.5;
    p[i * 2 + 1] = ((tiles[i]! / w) | 0) + 0.5;
  }
  for (const R of [3, 2]) {
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const r = Math.min(R, i, n - 1 - i);
      let x = 0;
      let y = 0;
      for (let j = i - r; j <= i + r; j++) {
        x += p[j * 2]!;
        y += p[j * 2 + 1]!;
      }
      out[i * 2] = x / (2 * r + 1);
      out[i * 2 + 1] = y / (2 * r + 1);
    }
    p = out;
  }
  return p;
}

interface Track {
  id: number;
  owner: number;
  n: number;
  pts: Float32Array;
  /** Unit normals at each point. */
  nrm: Float32Array;
  /** Arc length at each point. */
  cum: Float32Array;
  len: number;
  box: Box;
  chunk: number;
}

function makeTrack(r: RailView, w: number): Track {
  const pts = railCurve(r.tiles, w);
  const n = pts.length / 2;
  const nrm = new Float32Array(n * 2);
  const cum = new Float32Array(n);
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const tx = pts[b * 2]! - pts[a * 2]!;
    const ty = pts[b * 2 + 1]! - pts[a * 2 + 1]!;
    const l = Math.hypot(tx, ty) || 1;
    nrm[i * 2] = -ty / l;
    nrm[i * 2 + 1] = tx / l;
    if (i > 0)
      cum[i] = cum[i - 1]! + Math.hypot(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!);
    box[0] = Math.min(box[0], pts[i * 2]!);
    box[1] = Math.min(box[1], pts[i * 2 + 1]!);
    box[2] = Math.max(box[2], pts[i * 2]!);
    box[3] = Math.max(box[3], pts[i * 2 + 1]!);
  }
  const m = n >> 1;
  const chunk = Math.floor(pts[m * 2]! / CHUNK) * 65536 + Math.floor(pts[m * 2 + 1]! / CHUNK);
  return { id: r.id, owner: r.owner, n, pts, nrm, cum, len: cum[n - 1]!, box, chunk };
}

/** Index i of the segment holding arc length s (cum[i] ≤ s ≤ cum[i + 1]). */
function seek(tr: Track, s: number): number {
  let lo = 0;
  let hi = tr.n - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tr.cum[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Point and normal at arc length s: [x, y, nx, ny]. */
const P = [0, 0, 0, 0];
function at(tr: Track, s: number): number[] {
  const i = seek(tr, s);
  const j = Math.min(tr.n - 1, i + 1);
  const seg = tr.cum[j]! - tr.cum[i]!;
  const f = seg > 0 ? Math.max(0, Math.min(1, (s - tr.cum[i]!) / seg)) : 0;
  const { pts, nrm } = tr;
  P[0] = pts[i * 2]! + (pts[j * 2]! - pts[i * 2]!) * f;
  P[1] = pts[i * 2 + 1]! + (pts[j * 2 + 1]! - pts[i * 2 + 1]!) * f;
  const nx = nrm[i * 2]! + (nrm[j * 2]! - nrm[i * 2]!) * f;
  const ny = nrm[i * 2 + 1]! + (nrm[j * 2 + 1]! - nrm[i * 2 + 1]!) * f;
  const l = Math.hypot(nx, ny) || 1;
  P[2] = nx / l;
  P[3] = ny / l;
  return P;
}

/** The curve from arc length a to b, offset by `off` along the normal; returns points drawn. */
function pathRange(g: Graphics, tr: Track, a: number, b: number, off: number): number {
  if (b - a <= 1e-3) return 0;
  let p = at(tr, a);
  g.moveTo(p[0]! + p[2]! * off, p[1]! + p[3]! * off);
  let ops = 2;
  const { pts, nrm, cum } = tr;
  for (let i = seek(tr, a) + 1; i < tr.n && cum[i]! < b; i++, ops++)
    g.lineTo(pts[i * 2]! + nrm[i * 2]! * off, pts[i * 2 + 1]! + nrm[i * 2 + 1]! * off);
  p = at(tr, b);
  g.lineTo(p[0]! + p[2]! * off, p[1]! + p[3]! * off);
  return ops;
}

/** Sizes (tiles) for one zoom step: real proportions close up, a few pixels at least. */
interface Style {
  symbol: boolean;
  detail: boolean;
  /** One screen pixel, in tiles. */
  px: number;
  gauge: number;
  steel: number;
  tieLen: number;
  tieW: number;
  tieGap: number;
  bed: number;
  bedAlpha: number;
  /** The symbol's opacity (lighter far out: a readable map first). */
  ink: number;
  casing: number;
  core: number;
  dash: number;
}

function styleAt(bucket: number): Style {
  const z = 2 ** (bucket / 4);
  const px = 1 / z;
  const gauge = Math.max(0.2, 2.4 * px);
  const tieLen = Math.max(0.37, gauge * 1.8);
  // The symbol thins out towards the farthest zoom.
  const k = Math.max(0, Math.min(1, z - 1));
  return {
    symbol: z < SYMBOL_BELOW,
    detail: z >= DETAIL_FROM,
    px,
    gauge,
    steel: Math.max(0.032, 0.9 * px),
    tieLen,
    tieW: Math.max(0.045, 1.05 * px),
    tieGap: Math.max(0.1, 3.4 * px),
    bed: tieLen * 1.5,
    bedAlpha: z >= 6 ? 0.7 : 0.45,
    ink: 0.6 + 0.4 * Math.max(0, Math.min(1, (z - 0.9) / 0.9)),
    casing: (2.5 + 0.9 * k) * px,
    core: (1.2 + 0.6 * k) * px,
    dash: (4 + 1.2 * k) * px,
  };
}

/** How much of a track to draw (arc lengths) and how. */
interface Span {
  bed: number;
  ties: number;
  steel: number;
  alpha: number;
  /** Tearing up, 0..1 (0: whole). */
  tear: number;
}

interface Chunk {
  ids: Set<number>;
  box: Box;
  g: G3;
  /** Zoom step it was drawn for (NaN: to redraw). */
  bucket: number;
  /** Its rails changed: redrawn at once, out of the frame budget. */
  must: boolean;
}

interface TrainPos {
  tick: number;
  rail: number;
  prog: number;
  pRail: number;
  pProg: number;
  frame: number;
}

export class RailLayer {
  readonly container = new Container();
  private layers = [new Container(), new Container(), new Container()];
  private live = new Graphics();
  /** The live Graphics holds something (cleared once when the animations end). */
  private liveDrawn = false;
  private tracks = new Map<number, Track>();
  private chunks = new Map<number, Chunk>();
  /** Rails under construction: progress 0..1 and duration (s). */
  private builds = new Map<number, { f: number; dur: number }>();
  /** Rails torn up; `qa`: a QA replay of a rail still there (hidden meanwhile). */
  private tears: { tr: Track; f: number; qa?: boolean }[] = [];
  private qaHidden = new Set<number>();
  private styles = new Map<number, Style>();
  private trains = new Map<number, TrainPos>();
  private version = -1;
  /** Rails seen once: from then on, new ones are built before our eyes. */
  private primed = false;
  private inkKey = '';
  private time = 0;
  private frame = 0;
  private view: Box = [0, 0, 0, 0];

  constructor(
    private readonly state: ClientState,
    private readonly ctx: RailContext,
  ) {
    this.container.addChild(...this.layers, this.live);
  }

  /** Start over without animation (the map surface was rebuilt: replay rewind, resync). */
  reset(): void {
    for (const c of this.chunks.values()) for (const g of c.g) g.destroy();
    this.chunks.clear();
    this.tracks.clear();
    this.builds.clear();
    this.tears = [];
    this.qaHidden.clear();
    this.trains.clear();
    this.clearLive();
    this.version = -1;
    this.primed = false;
  }

  /** Rails being laid and torn up now (QA). */
  get animating(): { building: number; tearing: number } {
    return { building: this.builds.size, tearing: this.tears.length };
  }

  /** QA: lay a rail again (`build`) or tear up a copy of it (`tear`), render only. */
  qaReplay(id: number, kind: 'build' | 'tear'): boolean {
    const tr = this.tracks.get(id);
    if (!tr) return false;
    if (kind === 'tear') {
      this.tears.push({ tr, f: 0, qa: true });
      this.qaHidden.add(id);
    } else this.builds.set(id, { f: 0, dur: buildTime(tr.len) });
    this.chunkOf(tr).must = true;
    this.chunkOf(tr).bucket = NaN;
    return true;
  }

  /** `view`: the world rectangle on screen (x0, y0, x1, y1); dt in seconds. */
  update(z: number, view: Box, dt: number): void {
    this.frame++;
    this.time += dt;
    const on = z > RAIL_MIN_ZOOM;
    this.container.visible = on;
    this.sync();
    const key = this.ctx.inkKey();
    if (key !== this.inkKey) {
      this.inkKey = key;
      for (const c of this.chunks.values()) c.bucket = NaN;
    }
    this.advance(dt);
    if (this.frame % 120 === 0)
      for (const [id, e] of this.trains) if (e.frame < this.frame - 60) this.trains.delete(id);
    if (!on) {
      this.clearLive();
      return;
    }
    const bucket = Math.round(Math.log2(z) * 4);
    let st = this.styles.get(bucket);
    if (!st) this.styles.set(bucket, (st = styleAt(bucket)));
    const pad = 4 + 8 * st.px;
    this.view = [view[0] - pad, view[1] - pad, view[2] + pad, view[3] + pad];
    this.cull(bucket, st);
    this.drawLive(st);
  }

  /**
   * Where to draw a train: on the drawn track of rail `rail`, `prog` tiles along its path
   * (interpolated between ticks like the other units); null when the rail is unknown.
   */
  trainAt(id: number, rail: number, prog: number, tick: number, alpha: number): [number, number] | null {
    let e = this.trains.get(id);
    if (!e) this.trains.set(id, (e = { tick, rail, prog, pRail: rail, pProg: prog, frame: 0 }));
    else if (e.tick !== tick) {
      e.pRail = e.rail;
      e.pProg = e.prog;
      e.rail = rail;
      e.prog = prog;
      e.tick = tick;
    }
    e.frame = this.frame;
    const tr = this.tracks.get(rail);
    if (!tr) return null;
    const p = Math.max(0, Math.min(tr.n - 1, e.pRail === rail ? e.pProg + (prog - e.pProg) * alpha : prog));
    const k = Math.min(tr.n - 2, Math.floor(p));
    const f = p - k;
    const { pts } = tr;
    const x = pts[k * 2]! + (pts[k * 2 + 2]! - pts[k * 2]!) * f;
    const y = pts[k * 2 + 1]! + (pts[k * 2 + 3]! - pts[k * 2 + 1]!) * f;
    // A train on unfinished track pushes the railhead: the rails always run ahead of it.
    const b = this.builds.get(rail);
    if (b) {
      const s = tr.cum[k]! + (tr.cum[k + 1]! - tr.cum[k]!) * f;
      const lag = Math.min(LAG, tr.len * 0.3);
      b.f = Math.max(b.f, (Math.min(tr.len, s + 2) + lag) / (tr.len + lag));
    }
    return [x, y];
  }

  // ------------------------------------------------------------------ data
  private sync(): void {
    const s = this.state;
    if (s.railsVersion === this.version) return;
    this.version = s.railsVersion;
    const seen = new Set<number>();
    const fresh: Track[] = [];
    for (const r of s.rails) {
      seen.add(r.id);
      const old = this.tracks.get(r.id);
      if (old && old.n === r.tiles.length && old.owner === r.owner) continue;
      if (old) this.detach(old);
      if (r.tiles.length < 2) continue;
      const tr = makeTrack(r, s.width);
      this.tracks.set(r.id, tr);
      fresh.push(tr);
    }
    const gone: Track[] = [];
    for (const [id, tr] of this.tracks) if (!seen.has(id)) gone.push(tr);
    for (const tr of gone) {
      this.tracks.delete(tr.id);
      this.builds.delete(tr.id);
      this.detach(tr);
      if (this.primed && gone.length <= MAX_ANIMATED * 2) this.tears.push({ tr, f: 0 });
    }
    const animate = this.primed && fresh.length <= MAX_ANIMATED;
    for (const tr of fresh) {
      this.attach(tr);
      if (animate) this.builds.set(tr.id, { f: 0, dur: buildTime(tr.len) });
    }
    this.primed = true;
  }

  private chunkOf(tr: Track): Chunk {
    let c = this.chunks.get(tr.chunk);
    if (!c) {
      const g: G3 = [new Graphics(), new Graphics(), new Graphics()];
      for (let k = 0; k < 3; k++) this.layers[k]!.addChild(g[k]!);
      c = { ids: new Set(), box: [0, 0, 0, 0], g, bucket: NaN, must: false };
      this.chunks.set(tr.chunk, c);
    }
    return c;
  }

  private attach(tr: Track): void {
    const c = this.chunkOf(tr);
    c.ids.add(tr.id);
    this.reshape(c);
  }

  private detach(tr: Track): void {
    const c = this.chunks.get(tr.chunk);
    if (!c) return;
    c.ids.delete(tr.id);
    if (c.ids.size === 0) {
      for (const g of c.g) g.destroy();
      this.chunks.delete(tr.chunk);
      return;
    }
    this.reshape(c);
  }

  private reshape(c: Chunk): void {
    const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const id of c.ids) {
      const t = this.tracks.get(id);
      if (!t) continue;
      b[0] = Math.min(b[0], t.box[0] - 1);
      b[1] = Math.min(b[1], t.box[1] - 1);
      b[2] = Math.max(b[2], t.box[2] + 1);
      b[3] = Math.max(b[3], t.box[3] + 1);
    }
    c.box = b;
    c.bucket = NaN;
    c.must = true;
  }

  // ------------------------------------------------------------- animation
  private advance(dt: number): void {
    const rm = this.ctx.reducedMotion();
    for (const [id, b] of this.builds) {
      b.f += dt / (rm ? FADE : b.dur);
      if (b.f < 1) continue;
      this.builds.delete(id);
      const tr = this.tracks.get(id);
      if (tr) {
        const c = this.chunkOf(tr);
        c.bucket = NaN;
        c.must = true;
      }
    }
    if (this.tears.length) {
      for (const t of this.tears) {
        t.f += dt / (rm ? FADE : TEAR);
        if (t.f < 1 || !t.qa || !this.tracks.has(t.tr.id)) continue;
        this.qaHidden.delete(t.tr.id);
        const c = this.chunkOf(t.tr);
        c.bucket = NaN;
        c.must = true;
      }
      this.tears = this.tears.filter((t) => t.f < 1);
    }
  }

  /** Arc lengths reached by the bed, the ties and the rails at build progress f. */
  private heads(tr: Track, f: number): { bed: number; ties: number; steel: number } {
    const lag = Math.min(LAG, tr.len * 0.3);
    const h = f * (tr.len + lag);
    return {
      bed: Math.min(tr.len, h + lag * 0.5),
      ties: Math.min(tr.len, h),
      steel: Math.max(0, Math.min(tr.len, h - lag)),
    };
  }

  // ----------------------------------------------------------------- static
  private cull(bucket: number, st: Style): void {
    const stale: Chunk[] = [];
    for (const c of this.chunks.values()) {
      const vis = meets(c.box, this.view);
      for (const g of c.g) g.visible = vis;
      if (!vis || c.bucket === bucket) continue;
      if (c.must) this.redraw(c, bucket, st);
      else stale.push(c);
    }
    if (!stale.length) return;
    const cx = (this.view[0] + this.view[2]) / 2;
    const cy = (this.view[1] + this.view[3]) / 2;
    const d = (c: Chunk) => Math.hypot((c.box[0] + c.box[2]) / 2 - cx, (c.box[1] + c.box[3]) / 2 - cy);
    stale.sort((a, b) => d(a) - d(b));
    let ops = 0;
    for (const c of stale) {
      ops += this.redraw(c, bucket, st);
      if (ops > OPS_BUDGET) break;
    }
  }

  private redraw(c: Chunk, bucket: number, st: Style): number {
    for (const g of c.g) g.clear();
    c.bucket = bucket;
    c.must = false;
    let ops = 0;
    for (const id of c.ids) {
      const tr = this.tracks.get(id);
      if (!tr || this.builds.has(id) || this.qaHidden.has(id)) continue;
      ops += this.drawTrack(c.g, tr, st, { bed: tr.len, ties: tr.len, steel: tr.len, alpha: 1, tear: 0 });
    }
    return ops;
  }

  // ------------------------------------------------------------------ track
  private drawTrack(g: G3, tr: Track, st: Style, sp: Span): number {
    const ink = this.ctx.ink(tr.owner);
    const a = sp.alpha * (st.symbol ? st.ink : 1);
    const tear = sp.tear;
    let ops = 0;
    if (st.symbol) {
      // The atlas railway: ink casing, paper core, ink dashes every other stretch.
      ops += pathRange(g[0], tr, 0, sp.ties, 0);
      g[0].stroke({ width: st.casing, color: INK, alpha: 0.88 * a, cap: 'round', join: 'round' });
      ops += pathRange(g[1], tr, 0, sp.ties, 0);
      g[1].stroke({ width: st.core, color: PAPER, alpha: a, cap: 'butt', join: 'round' });
      let k = 0;
      for (let s = 0; s < sp.steel; s += st.dash * 2, k++) {
        if (tear > 0 && hash(k, tr.id) < tear * 1.4) continue;
        ops += pathRange(g[2], tr, s, Math.min(s + st.dash, sp.steel), 0);
      }
      if (ops)
        g[2].stroke({ width: st.core + 0.2 * st.px, color: INK, alpha: a, cap: 'butt', join: 'round' });
      return ops;
    }
    // Ballast bed (lightly in the owner's ink).
    if (sp.bed > 0) {
      ops += pathRange(g[0], tr, 0, sp.bed, 0);
      g[0].stroke({
        width: st.bed,
        color: mix(GRAVEL, ink, 0.22),
        alpha: st.bedAlpha * a * (1 - tear * 0.5),
        cap: 'round',
        join: 'round',
      });
    }
    // Ties across the curve, evenly spaced; torn up: knocked askew, then gone.
    if (sp.ties > 0) {
      const half = st.tieLen / 2;
      let k = 0;
      let n = 0;
      for (let s = st.tieGap / 2; s < sp.ties; s += st.tieGap, k++) {
        if (tear > 0 && hash(k, tr.id) < tear * 1.2 - 0.15) continue;
        const p = at(tr, s);
        let nx = p[2]!;
        let ny = p[3]!;
        if (tear > 0) {
          const r = (hash(k, tr.id + 7) - 0.5) * tear * 1.8;
          const c = Math.cos(r);
          const si = Math.sin(r);
          [nx, ny] = [nx * c - ny * si, nx * si + ny * c];
        }
        g[1].moveTo(p[0]! - nx * half, p[1]! - ny * half).lineTo(p[0]! + nx * half, p[1]! + ny * half);
        n++;
      }
      if (n) {
        g[1].stroke({
          width: st.tieW,
          color: mix(st.detail ? WOOD : TIE_MID, ink, 0.14),
          alpha: (st.detail ? 0.95 : 0.85) * a,
          cap: 'butt',
        });
        ops += n * 2;
      }
    }
    // The two rails (torn up: broken off piece by piece).
    if (sp.steel > 0) {
      const piece = 1.4;
      let n = 0;
      for (const side of [-0.5, 0.5]) {
        const off = side * st.gauge;
        if (tear <= 0) n += pathRange(g[2], tr, 0, sp.steel, off);
        else
          for (let s = 0, k = 0; s < sp.steel; s += piece, k++)
            if (hash(k, tr.id + side * 31) >= tear * 1.6)
              n += pathRange(g[2], tr, s + piece * 0.08, Math.min(s + piece * 0.92, sp.steel), off);
      }
      if (n) {
        g[2].stroke({ width: st.steel, color: STEEL, alpha: a, cap: 'butt', join: 'round' });
        ops += n;
        if (st.detail) {
          for (const side of [-0.5, 0.5]) {
            const off = side * st.gauge - side * st.steel * 0.15;
            if (tear <= 0) ops += pathRange(g[2], tr, 0, sp.steel, off);
            else
              for (let s = 0, k = 0; s < sp.steel; s += piece, k++)
                if (hash(k, tr.id + side * 31) >= tear * 1.6)
                  ops += pathRange(g[2], tr, s + piece * 0.08, Math.min(s + piece * 0.92, sp.steel), off);
          }
          g[2].stroke({ width: st.steel * 0.38, color: SHINE, alpha: 0.8 * a, cap: 'butt', join: 'round' });
        }
      }
    }
    return ops;
  }

  // ------------------------------------------------------------------- live
  private drawLive(st: Style): void {
    const g = this.live;
    this.clearLive();
    if (!this.builds.size && !this.tears.length) return;
    this.liveDrawn = true;
    const rm = this.ctx.reducedMotion();
    const g3: G3 = [g, g, g];
    for (const t of this.tears) {
      if (!meets(t.tr.box, this.view)) continue;
      const fade = rm ? 1 - t.f : 1 - Math.max(0, (t.f - 0.45) / 0.55);
      const L = t.tr.len;
      this.drawTrack(g3, t.tr, st, { bed: L, ties: L, steel: L, alpha: fade, tear: rm ? 0 : t.f });
    }
    for (const [id, b] of this.builds) {
      const tr = this.tracks.get(id);
      if (!tr || !meets(tr.box, this.view)) continue;
      if (rm) {
        const L = tr.len;
        this.drawTrack(g3, tr, st, { bed: L, ties: L, steel: L, alpha: Math.min(1, b.f), tear: 0 });
        continue;
      }
      const h = this.heads(tr, Math.min(1, b.f));
      this.drawTrack(g3, tr, st, { ...h, alpha: 1, tear: 0 });
      if (h.ties < tr.len - 0.05 || h.steel < tr.len - 0.05) this.railhead(g, tr, st, h.ties, h.steel);
    }
  }

  private clearLive(): void {
    if (this.liveDrawn) this.live.clear();
    this.liveDrawn = false;
  }

  /** The crew at the railhead: two workers at the ties, one at the rails, and dust. */
  private railhead(g: Graphics, tr: Track, st: Style, ties: number, steel: number): void {
    const [x, y, nx, ny] = at(tr, ties);
    if (!this.ctx.seen(tr.owner, x!, y!)) return;
    const tx = ny!;
    const ty = -nx!;
    const t = this.time;
    if (st.symbol) {
      const r = 2.6 * st.px * (1 + 0.15 * Math.sin(t * 6));
      g.circle(x!, y!, r).fill({ color: INK, alpha: 0.9 });
      g.circle(x!, y!, r * 0.45).fill({ color: PAPER });
      return;
    }
    // Dust kicked up behind the head, drifting back and thinning.
    const n = Math.round(6 * this.ctx.particles());
    for (let i = 0; i < n; i++) {
      const ph = (t * 0.9 + i / n) % 1;
      const back = ph * st.tieLen * 2.2;
      const side = (hash(i, tr.id) - 0.5) * st.tieLen * 1.6;
      const r = Math.max(st.tieLen * (0.3 + ph * 0.9), (2 + ph * 4) * st.px);
      g.circle(x! - tx * back + nx! * side, y! - ty * back + ny! * side, r).fill({
        color: DUST,
        alpha: 0.55 * (1 - ph) * Math.min(1, ph * 6),
      });
    }
    // Workers: ink figures with a brass helmet, bobbing as they swing.
    const r = Math.max(0.085, 1.9 * st.px);
    const crew: [number, number, number][] = [
      [ties, 0.5, 0],
      [ties, -0.5, 1.7],
      [Math.max(0, steel), 0.5, 3.1],
    ];
    for (const [s, side, ph] of crew) {
      const p = at(tr, s);
      const bob = Math.sin(t * 8 + ph) * r * 0.7;
      const off = side * (st.tieLen + r * 2.4);
      const cx = p[0]! + p[2]! * off + p[3]! * bob;
      const cy = p[1]! + p[3]! * off - p[2]! * bob;
      g.circle(cx, cy, r * 1.25).fill({ color: PAPER, alpha: 0.75 });
      g.circle(cx, cy, r).fill({ color: INK });
      if (st.detail) g.circle(cx, cy, r * 0.55).fill({ color: 0xf2b84b });
    }
  }
}

function buildTime(len: number): number {
  return Math.max(BUILD_MIN, Math.min(BUILD_MAX, len / BUILD_SPEED));
}
