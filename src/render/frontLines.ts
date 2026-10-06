// Front lines on the map (core/rules/lines.ts) — battle plans in the spirit of Hearts of
// Iron IV (1.19), drawn for Isoline: smooth lines (the drawing's corners rounded), readable
// on any country's colour, the kinds told apart by their shapes (the player is colour-blind).
//   - Defensive: a dark front line with a fine light rim, bristling towards the enemy with a
//     close fringe of small teeth (a held front); in front of it its zone, a soft ink shade
//     fading out over LINE_REACH tiles, its far edge a fine dotted line. Being laid (3 s):
//     dashed, no teeth; emptied: grey, dashed.
//   - Offensive: a jump-off line (dark, a dashed light rail along it) and sweeping
//     battle-plan arrows out of it across its zone (LINE_OFFENSE_REACH): tapered, curved,
//     with a flared head; while it prepares (30 s) they are amber and fill from tail to head
//     as the time runs, then turn green: ready. Its zone is a warm shade.
//   - Unit counters along each line, as in HOI4: a dark tab with the owner's flag, the
//     troops it holds (and the time left while it prepares) and a strength bar.
//   - A stretch lost to the enemy (a breach): a faint dotted trace, no shade, no counter.
// The line being drawn (input.ts LineDraft) is previewed in brass the same way: solid over
// our land within the length its troops allow, dotted elsewhere, red and crossed out past
// that length; then, picking the side, with its zone and teeth or arrow.
// Lines and zones are redrawn when they change or the zoom moves on; counters keep their
// size on screen and follow the camera every frame.
import { BitmapText, Container, Graphics, Sprite, TextStyle, type Texture } from 'pixi.js';
import type { LineView } from '../engine/protocol';
import { LINE_OFFENSE_REACH, LINE_OFFENSE_SETUP, LINE_REACH } from '../core/game/constants';
import { traceTiles } from '../core/rules/lines';
import type { AssaultDraft, LineDraft } from '../ui/game/input';

const CORE = 0x14202c;
const RIM = 0xf3ead6;
const SHADE = 0x0b1824;
const WARM = 0xe0a23a;
const BRASS = 0xf2b84b;
const READY = 0x5fbf6a;
const PREPARING = 0xf0b43c;
const OVER = 0xd2453a;
const GREY = 0x9aa1a8;

const PION_STYLE = new TextStyle({
  fontFamily: '"IBM Plex Sans", sans-serif',
  fontSize: 30,
  fontWeight: '600',
  fill: 0xffffff,
});
/** Counter text size on screen (px). */
const PION_TEXT = 11;

export interface FrontLineContext {
  zoom: number;
  tick: number;
  viewer: number;
  zones: boolean;
  reducedMotion: boolean;
  /** The owner's colour on the map. */
  color: (owner: number) => number;
  /** The owner's flag (null: none, or still loading). */
  flag: (owner: number) => Texture | null;
  /** Whether the viewer sees this line (fog of war). */
  visible: (l: LineView, x: number, y: number) => boolean;
  /** Whether the viewer owns this tile (the drawing's preview). */
  mine: (x: number, y: number) => boolean;
  /** The camera's view, in tiles: [x0, y0, x1, y1]. */
  bounds: [number, number, number, number];
  /** My line under the pointer (lit), -1 none. */
  hover: number;
  /** An offensive line's assault being aimed: its sector and the brush. */
  assault: AssaultDraft | null;
}

/** A point along a polyline, with the unit normal pointing to the side faced. */
interface Sample {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Along the line (tiles). */
  s: number;
}

/** The drawing's corners rounded (Chaikin, three passes; its ends kept). */
export function smooth(pts: readonly number[]): number[] {
  let p = pts.slice();
  for (let pass = 0; pass < 3 && p.length >= 6; pass++) {
    const out = [p[0]!, p[1]!];
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!];
      out.push(ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25, ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75);
    }
    out.push(p[p.length - 2]!, p[p.length - 1]!);
    p = out;
  }
  return p;
}

/** Points every `step` tiles along `pts`, normals towards `side` (core/rules/lines.ts locate's sign). */
export function sampleLine(pts: readonly number[], side: number, step: number): Sample[] {
  const out: Sample[] = [];
  let s = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!];
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    const [dx, dy] = [(bx - ax) / len, (by - ay) / len];
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = out.length ? 1 : 0; k <= n; k++) {
      const u = (k / n) * len;
      out.push({ x: ax + dx * u, y: ay + dy * u, nx: side * dy, ny: -side * dx, s: s + u });
    }
    s += len;
  }
  // Normals averaged over neighbours: no kink where two segments meet.
  for (let k = 1; k + 1 < out.length; k++) {
    const [a, b, c] = [out[k - 1]!, out[k]!, out[k + 1]!];
    const [nx, ny] = [a.nx + b.nx + c.nx, a.ny + b.ny + c.ny];
    const len = Math.hypot(nx, ny) || 1;
    b.nx = nx / len;
    b.ny = ny / len;
  }
  return out;
}

/** A unit counter: where, what it holds, how strong. */
interface Pion {
  x: number;
  y: number;
  owner: number;
  troops: number;
  strength: number;
  color: number;
  /** Time left to dig in (ticks), 0 when ready. */
  left: number;
  empty: boolean;
}

interface PionView {
  root: Container;
  box: Graphics;
  flag: Sprite;
  text: BitmapText;
  key: string;
}

/** One line's drawing, cached: rebuilt only when what it shows changes. */
interface LineGfx {
  root: Container;
  zone: Graphics;
  ink: Graphics;
  arrows: Graphics;
  /** What its static drawing shows (shape, held tiles, state, zoom step, zones). */
  sig: string;
  /** Its preparation step (the arrows' fill), redrawn on its own. */
  arrowSig: string;
  box: [number, number, number, number];
  mid: [number, number];
  pions: Pion[];
  runs: Sample[][];
}

export class FrontLineLayer {
  readonly container = new Container();
  private readonly lineLayer = new Container();
  private readonly draft = new Graphics();
  private readonly lit = new Graphics();
  private readonly pions = new Container();
  private readonly pool: PionView[] = [];
  private readonly gfx = new Map<number, LineGfx>();

  constructor() {
    this.container.addChild(this.lineLayer, this.lit, this.draft, this.pions);
  }

  /** Map width (tile keys), set by the renderer. */
  width = 1;

  /**
   * Every frame. Each line keeps its own drawing (no line's change redraws the others); a
   * line off screen is neither drawn nor built; far out, other countries' lines are drawn
   * plain (no teeth, no zone) — only ours carry their zone at every zoom.
   */
  update(lines: readonly LineView[], _version: number, ctx: FrontLineContext, draft: LineDraft | null): void {
    const z = ctx.zoom;
    const [x0, y0, x1, y1] = ctx.bounds;
    // Zoom steps of ~40 %: line widths stay right without a rebuild at every wheel notch.
    const step = Math.round(Math.log2(z) * 2);
    const seen = new Set<number>();
    for (const l of lines) {
      seen.add(l.id);
      let v = this.gfx.get(l.id);
      if (!v) {
        const root = new Container();
        const zone = new Graphics();
        const ink = new Graphics();
        const arrows = new Graphics();
        root.addChild(zone, ink, arrows);
        this.lineLayer.addChild(root);
        v = {
          root,
          zone,
          ink,
          arrows,
          sig: '',
          arrowSig: '',
          box: lineBox(l),
          mid: middle(l),
          pions: [],
          runs: [],
        };
        this.gfx.set(l.id, v);
      }
      const [bx0, by0, bx1, by1] = v.box;
      const onScreen = bx1 >= x0 && bx0 <= x1 && by1 >= y0 && by0 <= y1;
      v.root.visible = onScreen && ctx.visible(l, v.mid[0], v.mid[1]);
      if (!v.root.visible) continue;
      const mine = l.owner === ctx.viewer;
      const lod = !mine && z < 1.6 ? 'far' : 'near';
      const left = Math.max(0, l.readyTick - ctx.tick);
      const empty = l.troops < 1;
      const sig = `${step}|${lod}|${ctx.zones && mine}|${l.tiles.length}|${l.tiles[0]}|${empty}|${left > 0}`;
      if (sig !== v.sig) {
        v.sig = sig;
        v.arrowSig = '';
        this.build(v, l, ctx, lod, mine, left, empty);
      }
      if (l.kind === 1) {
        const progress = left > 0 ? 1 - left / LINE_OFFENSE_SETUP : 1;
        const arrowSig = `${step}|${empty}|${Math.floor(progress * 40)}`;
        if (arrowSig !== v.arrowSig) {
          v.arrowSig = arrowSig;
          this.buildArrows(v, ctx, empty, progress);
        }
      }
      for (const pn of v.pions) {
        pn.troops = l.troops / Math.max(1, v.pions.length);
        pn.strength = l.strength;
        pn.left = left;
        pn.empty = empty;
      }
    }
    for (const [id, v] of this.gfx)
      if (!seen.has(id)) {
        v.root.destroy({ children: true });
        this.gfx.delete(id);
      }
    this.placePions(ctx);
    this.drawDraft(draft, ctx);
    this.drawLit(lines, ctx);
  }

  /**
   * Lit on top: the line under the pointer (a brass glow along it: a click opens it), and an
   * assault being aimed — its line, the sector traced (brass tiles), the brush, and an arrow
   * from the line to the sector.
   */
  private drawLit(lines: readonly LineView[], ctx: FrontLineContext): void {
    const g = this.lit;
    g.clear();
    const px = (n: number) => Math.max(0.04, n / ctx.zoom);
    const glow = (id: number) => {
      const v = this.gfx.get(id);
      if (!v || !v.root.visible) return;
      for (const run of v.runs) {
        polyline(g, run, BRASS, px(14), 0.35);
        polyline(g, run, BRASS, px(3), 0.9);
      }
    };
    if (ctx.hover >= 0) glow(ctx.hover);
    const a = ctx.assault;
    if (!a) return;
    glow(a.line);
    const w = this.width;
    let [cx, cy, n] = [0, 0, 0];
    for (const t of a.tiles) {
      const [x, y] = [t % w, Math.floor(t / w)];
      g.rect(x, y, 1, 1);
      [cx, cy, n] = [cx + x + 0.5, cy + y + 0.5, n + 1];
    }
    if (n) g.fill({ color: BRASS, alpha: 0.7 });
    if (a.brush) {
      const [bx, by, r] = a.brush;
      g.circle(bx, by, r).stroke({ color: CORE, width: px(2.5), alpha: 0.8 });
      g.circle(bx, by, r).stroke({ color: BRASS, width: px(1.2), alpha: 1 });
    }
    // From the line to the sector (or to the brush, before anything is traced).
    const line = lines.find((l) => l.id === a.line);
    const v = this.gfx.get(a.line);
    const run = v?.runs[0];
    if (!line || !run || run.length < 2) return;
    const from = pointAt(run, (run[0]!.s + run[run.length - 1]!.s) / 2);
    const to: [number, number] | null = n ? [cx / n, cy / n] : a.brush ? [a.brush[0], a.brush[1]] : null;
    if (!to) return;
    const d = Math.hypot(to[0] - from.x, to[1] - from.y);
    if (d < 2) return;
    const [nx, ny] = [(to[0] - from.x) / d, (to[1] - from.y) / d];
    battleArrow(g, { x: from.x, y: from.y, nx, ny, s: 0 }, 1.6, d, 0, 1, px, BRASS);
  }

  /** A line's static drawing: its zone (ours), its body, its counters' places. */
  private build(
    v: LineGfx,
    l: LineView,
    ctx: FrontLineContext,
    lod: 'far' | 'near',
    mine: boolean,
    left: number,
    empty: boolean,
  ): void {
    const z = ctx.zoom;
    const px = (n: number) => Math.max(0.04, n / z);
    v.zone.clear();
    v.ink.clear();
    v.pions = [];
    const held = new Set(l.tiles);
    const samples = sampleLine(smooth(l.pts), l.side, lod === 'far' ? 1 : 0.5);
    const isHeld = (p: Sample) => heldAt(held, p.x, p.y, this.width);
    const reach = l.kind === 0 ? LINE_REACH : LINE_OFFENSE_REACH;
    let heldRuns: Sample[][] = [];
    runs(samples, isHeld, (run, on) => {
      if (on) heldRuns.push(run);
      else if (lod === 'near') dotted(v.ink, run, px(5), px(1.3), CORE, 0.55);
    });
    heldRuns = heldRuns.filter((r) => r.length >= 2);
    v.runs = heldRuns;
    if (ctx.zones && mine && !empty)
      for (const run of heldRuns) zoneShade(v.zone, run, reach, l.kind === 0 ? SHADE : WARM, px, left > 0);
    for (const run of heldRuns) {
      if (lod === 'far') {
        polyline(v.ink, run, CORE, px(4), 0.9);
        continue;
      }
      if (l.kind === 0) defensiveLine(v.ink, run, px, empty ? 'empty' : left > 0 ? 'laying' : 'held');
      else jumpOffLine(v.ink, run, px, empty);
    }
    if (lod === 'far') return;
    // Counters: one every ~22 tiles of held line, sharing its troops, just behind it.
    const total = heldRuns.reduce((s, r) => s + (r[r.length - 1]!.s - r[0]!.s), 0);
    const count = Math.max(1, Math.min(6, Math.round(total / 22)));
    let k = 0;
    for (const run of heldRuns) {
      const len = run[run.length - 1]!.s - run[0]!.s;
      const here = Math.max(1, Math.round((count * len) / Math.max(1e-6, total)));
      for (let j = 0; j < here && k < count; j++, k++) {
        const p = pointAt(run, run[0]!.s + ((j + 0.5) / here) * len);
        v.pions.push({
          x: p.x - p.nx * px(17),
          y: p.y - p.ny * px(17),
          owner: l.owner,
          troops: l.troops / count,
          strength: l.strength,
          color: ctx.color(l.owner),
          left,
          empty,
        });
      }
    }
  }

  /** An offensive line's planned assault: its arrows, filling while its troops wait. */
  private buildArrows(v: LineGfx, ctx: FrontLineContext, empty: boolean, progress: number): void {
    const px = (n: number) => Math.max(0.04, n / ctx.zoom);
    v.arrows.clear();
    if (empty || v.sig.includes('far')) return;
    for (const run of v.runs) {
      const len = run[run.length - 1]!.s - run[0]!.s;
      const n = Math.max(1, Math.round(len / 20));
      for (let k = 0; k < n; k++) {
        const base = pointAt(run, run[0]!.s + ((k + 0.5) / n) * len);
        const width = Math.min(2.4, Math.max(1.1, (len / n) * 0.09));
        battleArrow(v.arrows, base, width, LINE_OFFENSE_REACH, (k % 2 ? 1 : -1) * 0.12, progress, px);
      }
    }
  }

  /** The counters of the lines on screen, at a steady size; hidden far out. */
  private placePions(ctx: FrontLineContext): void {
    const z = ctx.zoom;
    let used = 0;
    if (z >= 1.2)
      for (const g of this.gfx.values()) {
        if (!g.root.visible) continue;
        for (const a of g.pions) {
          let v = this.pool[used];
          if (!v) {
            const root = new Container();
            const box = new Graphics();
            const flag = new Sprite();
            flag.anchor.set(0, 0.5);
            const text = new BitmapText({ text: '', style: PION_STYLE });
            text.anchor.set(0, 0.5);
            root.addChild(box, flag, text);
            this.pions.addChild(root);
            v = this.pool[used] = { root, box, flag, text, key: '' };
          }
          used++;
          const label =
            a.left > 0
              ? `${compact(a.troops)}  ${Math.floor(a.left / 600)}:${String(Math.ceil(a.left / 10) % 60).padStart(2, '0')}`
              : compact(a.troops);
          const tex = ctx.flag(a.owner);
          // Rebuilt only when what it shows changes; moved with the camera every frame.
          const key = `${label}|${!!tex}|${a.empty}|${Math.round(a.strength * 20)}|${a.left > 0}|${a.color}`;
          if (key !== v.key) {
            v.key = key;
            if (v.text.text !== label) v.text.text = label;
            v.text.scale.set(PION_TEXT / 30);
            const flagW = tex ? Math.round((11 * tex.width) / tex.height) : 0;
            if (tex && v.flag.texture !== tex) v.flag.texture = tex;
            v.flag.visible = !!tex;
            if (tex) v.flag.setSize(flagW, 11);
            v.flag.position.set(6, -1.5);
            const x0 = 6 + (tex ? flagW + 5 : 0);
            v.text.position.set(x0, -1.5);
            const w = x0 + v.text.width + 7;
            drawPion(v.box, a, w);
            v.root.pivot.set(w / 2, 0);
          }
          v.root.visible = true;
          v.root.position.set(a.x, a.y);
          v.root.scale.set(1 / z);
        }
      }
    for (let k = used; k < this.pool.length; k++) this.pool[k]!.root.visible = false;
  }

  private drawDraft(d: LineDraft | null, ctx: FrontLineContext): void {
    const g = this.draft;
    g.clear();
    if (!d || d.pts.length === 0) return;
    const z = ctx.zoom;
    const px = (v: number) => Math.max(0.04, v / z);
    const pts = d.stage === 'trace' ? [...d.pts, d.cursor[0], d.cursor[1]] : d.pts;
    const samples = sampleLine(smooth(pts), d.side, 0.35);
    // Our tiles along the drawing, in order: past the length its troops allow, over.
    const w = this.width;
    const order = traceTiles(w, 1e9, pts).filter((t) => ctx.mine((t % w) + 0.5, Math.floor(t / w) + 0.5));
    const within = new Set(order.slice(0, Math.max(0, d.maxTiles)));
    const over = new Set(order.slice(Math.max(0, d.maxTiles)));
    const state = (p: Sample): number => {
      const fx = Math.floor(p.x);
      const fy = Math.floor(p.y);
      let best = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const t = (fy + dy) * w + fx + dx;
          if (within.has(t)) return 1;
          if (over.has(t)) best = 2;
        }
      return best;
    };
    const ok: Sample[][] = [];
    let start = 0;
    for (let k = 1; k <= samples.length; k++) {
      if (k < samples.length && state(samples[k]!) === state(samples[start]!)) continue;
      const run = samples.slice(start, Math.min(samples.length, k + 1));
      const kind = state(samples[start]!);
      if (run.length >= 2) {
        if (kind === 1) ok.push(run);
        else if (kind === 2) {
          // Too long for its troops: red, dashed, crossed out.
          dashed(g, run, px(7), px(5), OVER, px(3.5), 0.95);
          for (let i = 0; i < run.length; i += 14) {
            const p = run[i]!;
            const s = px(4);
            g.moveTo(p.x - s, p.y - s)
              .lineTo(p.x + s, p.y + s)
              .moveTo(p.x + s, p.y - s)
              .lineTo(p.x - s, p.y + s)
              .stroke({ width: px(1.8), color: OVER });
          }
        } else dotted(g, run, px(6), px(1.8), BRASS, 0.95);
      }
      start = k;
    }
    for (const run of ok) {
      if (d.stage === 'side') {
        const reach = d.kind === 0 ? LINE_REACH : LINE_OFFENSE_REACH;
        zoneShade(g, run, reach, BRASS, px, false);
        if (d.kind === 0) teeth(g, run, px, BRASS);
        else {
          const mid = pointAt(run, (run[0]!.s + run[run.length - 1]!.s) / 2);
          battleArrow(g, mid, 1.8, reach, 0.12, 1, px, BRASS);
        }
      }
      polyline(g, run, CORE, px(7), 0.9);
      polyline(g, run, BRASS, px(4), 1);
    }
    for (let i = 0; i < d.pts.length; i += 2)
      g.circle(d.pts[i]!, d.pts[i + 1]!, px(4))
        .fill({ color: BRASS })
        .stroke({ color: CORE, width: px(1.5) });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** A HOI4 counter: a dark tab rimmed in the owner's colour (its flag and troops on it), a strength bar. */
function drawPion(g: Graphics, a: Pion, w: number): void {
  const h = 21;
  g.clear();
  g.roundRect(0, -h / 2 + 1.5, w, h, 3).fill({ color: 0x000000, alpha: 0.35 }); // drop shadow
  g.roundRect(0, -h / 2, w, h, 3).fill({ color: 0x1b2734, alpha: 0.95 });
  g.roundRect(0, -h / 2, w, h, 3).stroke({ color: a.empty ? GREY : a.color, width: 1.5, alpha: 0.95 });
  // Strength: the bar's length (green while it holds, amber while it prepares).
  const bar = Math.max(0, Math.min(1, a.empty ? 0 : a.strength));
  g.rect(4, h / 2 - 4.5, w - 8, 2.5).fill({ color: 0x000000, alpha: 0.6 });
  if (bar > 0) g.rect(4, h / 2 - 4.5, (w - 8) * bar, 2.5).fill({ color: a.left > 0 ? PREPARING : READY });
}

/** The zone in front of a held stretch: a soft shade fading out, its far edge a fine dotted line. */
function zoneShade(
  g: Graphics,
  run: Sample[],
  reach: number,
  color: number,
  px: (v: number) => number,
  faint: boolean,
): void {
  const steps = 18;
  for (let k = 0; k < steps; k++) {
    const [d0, d1] = [(k / steps) * reach, ((k + 1) / steps) * reach];
    const alpha = 0.26 * Math.pow(1 - k / steps, 1.4) * (faint ? 0.5 : 1);
    const poly: number[] = [];
    for (const p of run) poly.push(p.x + p.nx * d0, p.y + p.ny * d0);
    for (let i = run.length - 1; i >= 0; i--) {
      const p = run[i]!;
      poly.push(p.x + p.nx * d1, p.y + p.ny * d1);
    }
    g.poly(poly).fill({ color, alpha });
  }
  const edge = run.map((p) => ({ ...p, x: p.x + p.nx * reach, y: p.y + p.ny * reach }));
  dotted(g, edge, px(6), px(1.2), color === SHADE ? RIM : color, 0.55);
}

/** A defensive stretch: dark core, light rim, a close fringe of teeth towards the enemy. */
function defensiveLine(
  g: Graphics,
  run: Sample[],
  px: (v: number) => number,
  state: 'held' | 'laying' | 'empty',
): void {
  if (state !== 'held') {
    dashed(g, run, px(9), px(6), CORE, px(6), 0.85);
    dashed(g, run, px(9), px(6), state === 'empty' ? GREY : RIM, px(2.2), 0.9);
    return;
  }
  teeth(g, run, px, CORE);
  polyline(g, run, CORE, px(6.5), 0.95);
  // The rim on the back side: the line reads as an edge, not a stroke.
  polyline(
    g,
    run.map((p) => ({ ...p, x: p.x - p.nx * px(1.6), y: p.y - p.ny * px(1.6) })),
    RIM,
    px(1.6),
    0.85,
  );
}

/** A close fringe of small teeth on the front side. */
function teeth(g: Graphics, run: Sample[], px: (v: number) => number, color: number): void {
  const len = run[run.length - 1]!.s - run[0]!.s;
  const every = px(9);
  const [b, h] = [px(3.4), px(6.5)];
  for (let at = every / 2; at < len; at += every) {
    const p = pointAt(run, run[0]!.s + at);
    const [tx, ty] = [-p.ny, p.nx];
    g.poly([p.x + tx * b, p.y + ty * b, p.x + p.nx * h, p.y + p.ny * h, p.x - tx * b, p.y - ty * b]).fill({
      color,
      alpha: 0.95,
    });
  }
}

/** An offensive stretch: a dark jump-off line with a dashed light rail along it. */
function jumpOffLine(g: Graphics, run: Sample[], px: (v: number) => number, empty: boolean): void {
  polyline(g, run, CORE, px(6), empty ? 0.5 : 0.95);
  dashed(g, run, px(7), px(5), empty ? GREY : RIM, px(1.8), 0.9);
}

/**
 * A battle-plan arrow out of `base` across the zone (`reach` tiles), `width` tiles half-wide
 * at its tail, sweeping sideways by `bend` × reach: a tapered curved shaft with a rounded
 * tail and a flared head; translucent, edged dark with a light inner line, filled from the
 * tail to `progress` (amber while it prepares, green once ready).
 */
function battleArrow(
  g: Graphics,
  base: Sample,
  width: number,
  reach: number,
  bend: number,
  progress: number,
  px: (v: number) => number,
  tint?: number,
): void {
  const [tx, ty] = [-base.ny, base.nx];
  const L = reach * 0.95;
  // Centreline: a quadratic curve from the line out to the tip, bowed sideways.
  const p0 = [base.x + base.nx * 0.8, base.y + base.ny * 0.8];
  const p2 = [base.x + base.nx * L + tx * bend * L * 0.6, base.y + base.ny * L + ty * bend * L * 0.6];
  const p1 = [base.x + base.nx * L * 0.5 + tx * bend * L, base.y + base.ny * L * 0.5 + ty * bend * L];
  const at = (u: number): [number, number, number, number] => {
    const x = (1 - u) * (1 - u) * p0[0]! + 2 * (1 - u) * u * p1[0]! + u * u * p2[0]!;
    const y = (1 - u) * (1 - u) * p0[1]! + 2 * (1 - u) * u * p1[1]! + u * u * p2[1]!;
    const dx = 2 * (1 - u) * (p1[0]! - p0[0]!) + 2 * u * (p2[0]! - p1[0]!);
    const dy = 2 * (1 - u) * (p1[1]! - p0[1]!) + 2 * u * (p2[1]! - p1[1]!);
    const len = Math.hypot(dx, dy) || 1;
    return [x, y, -dy / len, dx / len];
  };
  const neck = 0.74;
  const shape = (upTo: number, scale = 1): number[] => {
    const end = Math.min(1, upTo);
    const steps = 18;
    const leftSide: number[] = [];
    const rightSide: number[] = [];
    const shaftEnd = Math.min(end, neck);
    for (let i = 0; i <= steps; i++) {
      const u = (i / steps) * shaftEnd;
      const [x, y, nx, ny] = at(u);
      const w = width * scale * (1 - 0.25 * (u / neck));
      leftSide.push(x + nx * w, y + ny * w);
      rightSide.unshift(x - nx * w, y - ny * w);
    }
    const head: number[] = [];
    if (end > neck) {
      const [hx, hy, hnx, hny] = at(neck);
      const barb = width * scale * 2.3;
      const [ex, ey, enx, eny] = at(end);
      const tip = end >= 1;
      const wEnd = tip ? 0 : barb * (1 - (end - neck) / (1 - neck));
      head.push(hx + hnx * barb, hy + hny * barb);
      if (tip) head.push(ex, ey);
      else head.push(ex + enx * wEnd, ey + eny * wEnd, ex - enx * wEnd, ey - eny * wEnd);
      head.push(hx - hnx * barb, hy - hny * barb);
    }
    // The rounded tail.
    const [sx, sy, snx, sny] = at(0);
    const [bx, by] = [-(p1[0]! - p0[0]!), -(p1[1]! - p0[1]!)];
    const bl = Math.hypot(bx, by) || 1;
    const tail: number[] = [];
    for (let i = 1; i < 8; i++) {
      const a = Math.PI * (i / 8);
      const w = width * scale;
      tail.push(
        sx - snx * Math.cos(a) * w + (bx / bl) * Math.sin(a) * w * 0.8,
        sy - sny * Math.cos(a) * w + (by / bl) * Math.sin(a) * w * 0.8,
      );
    }
    return [...leftSide, ...head, ...rightSide, ...tail];
  };
  const color = tint ?? (progress >= 1 ? READY : PREPARING);
  g.poly(shape(1)).fill({ color, alpha: 0.2 });
  if (progress > 0) g.poly(shape(progress)).fill({ color, alpha: 0.5 });
  g.poly(shape(1, 0.45)).fill({ color: 0xffffff, alpha: 0.12 });
  g.poly(shape(1)).stroke({ color: CORE, width: px(2.4), alpha: 0.9, join: 'round' });
  g.poly(shape(1, 0.86)).stroke({ color: RIM, width: px(1), alpha: 0.45, join: 'round' });
}

/** Whether a tile of the line is held within a tile of (x, y). */
function heldAt(held: Set<number>, x: number, y: number, w: number): boolean {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (held.has((fy + dy) * w + fx + dx)) return true;
  return false;
}

/** A line's bounding box with its reach and counters around it. */
function lineBox(l: LineView): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < l.pts.length; i += 2) {
    x0 = Math.min(x0, l.pts[i]!);
    x1 = Math.max(x1, l.pts[i]!);
    y0 = Math.min(y0, l.pts[i + 1]!);
    y1 = Math.max(y1, l.pts[i + 1]!);
  }
  const m = Math.max(LINE_REACH, LINE_OFFENSE_REACH) + 4;
  return [x0 - m, y0 - m, x1 + m, y1 + m];
}

function middle(l: LineView): [number, number] {
  const s = sampleLine(l.pts, l.side, 1);
  const total = s.at(-1)?.s ?? 0;
  const m = s.find((p) => p.s >= total / 2) ?? s[0];
  return m ? [m.x, m.y] : [l.pts[0]!, l.pts[1]!];
}

/** The point at arc length `at` along a run of samples (clamped), with its normal. */
function pointAt(run: Sample[], at: number): Sample {
  let k = 1;
  while (k < run.length - 1 && run[k]!.s < at) k++;
  const [a, b] = [run[k - 1]!, run[k]!];
  const u = b.s > a.s ? Math.min(1, Math.max(0, (at - a.s) / (b.s - a.s))) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, nx: b.nx, ny: b.ny, s: at };
}

/** Consecutive samples split into runs where `on` holds or not. */
function runs(
  samples: Sample[],
  on: (p: Sample) => boolean,
  draw: (run: Sample[], on: boolean) => void,
): void {
  let start = 0;
  for (let k = 1; k <= samples.length; k++) {
    if (k < samples.length && on(samples[k]!) === on(samples[start]!)) continue;
    const run = samples.slice(start, Math.min(samples.length, k + 1));
    if (run.length >= 2) draw(run, on(samples[start]!));
    start = k;
  }
}

function polyline(
  g: Graphics,
  run: { x: number; y: number }[],
  color: number,
  width: number,
  alpha: number,
): void {
  if (run.length < 2) return;
  g.moveTo(run[0]!.x, run[0]!.y);
  for (let k = 1; k < run.length; k++) g.lineTo(run[k]!.x, run[k]!.y);
  g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
}

function dashed(
  g: Graphics,
  run: { x: number; y: number }[],
  dash: number,
  gap: number,
  color: number,
  width: number,
  alpha: number,
): void {
  let on = true;
  let left = dash;
  for (let k = 1; k < run.length; k++) {
    let [ax, ay] = [run[k - 1]!.x, run[k - 1]!.y];
    const [bx, by] = [run[k]!.x, run[k]!.y];
    let len = Math.hypot(bx - ax, by - ay);
    while (len > 0) {
      const step = Math.min(left, len);
      const [cx, cy] = [ax + ((bx - ax) * step) / len, ay + ((by - ay) * step) / len];
      if (on) g.moveTo(ax, ay).lineTo(cx, cy);
      [ax, ay] = [cx, cy];
      len -= step;
      left -= step;
      if (left <= 1e-9) {
        on = !on;
        left = on ? dash : gap;
      }
    }
  }
  g.stroke({ width, color, alpha, cap: 'round' });
}

/** Round dots every `every` along a run. */
function dotted(g: Graphics, run: Sample[], every: number, r: number, color: number, alpha: number): void {
  const len = run[run.length - 1]!.s - run[0]!.s;
  for (let at = 0; at <= len; at += every) {
    const p = pointAt(run, run[0]!.s + at);
    g.circle(p.x, p.y, r);
  }
  g.fill({ color, alpha });
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}
