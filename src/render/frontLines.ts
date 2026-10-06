// Front lines on the map (core/rules/lines.ts), drawn as on a staff map, in ink (1.18:
// « plus réaliste et plus soigné »):
//   - a defensive line: a crenellated trench (its traverses jut towards the front) behind a
//     belt of barbed wire, the wire paler as the line weakens; laid in 3 s (dashed, no wire
//     yet); emptied, a grey dotted trench with no wire;
//   - an offensive line: a jump-off line with broad assault arrows pointing where it pushes;
//     while it digs in (30 s) it is dashed and its arrows hollow, the time left on its label;
//   - a stretch lost to the enemy (a breach): dotted, no wire, no arrows;
//   - its reach (settings: front-line zones), shaded in front of the stretches held, the far
//     edge dashed; the back stays bare.
// The kinds differ by shape, not by colour (the player is colour-blind). Drawn in the
// Courier's ink on a paper edge, readable on any country's colour (a line in its owner's
// colour vanished on its own land); its reach is shaded in ink too. Its troops
// ride a small label just behind its middle. The line being drawn (input.ts LineDraft)
// is previewed in brass: solid over our land, dotted elsewhere; then, picking the side,
// as the trench and wire or the arrows it will be, with its reach.
// Built lines are redrawn only when they change or the zoom moves on (many lines, long
// ones: not every frame); the drawing and the countdowns are cheap and redrawn each frame.
import { BitmapText, Container, Graphics, type TextStyle } from 'pixi.js';
import type { LineView } from '../engine/protocol';
import { LINE_REACH } from '../core/game/constants';
import type { LineDraft } from '../ui/game/input';

const INK_DARK = 0x0b1824;
const INK = 0x172a3c;
const PAPER = 0xf6f1e4;
const BRASS = 0xf2b84b;

export interface FrontLineContext {
  zoom: number;
  tick: number;
  viewer: number;
  zones: boolean;
  reducedMotion: boolean;
  /** Whether the viewer sees this line (fog of war). */
  visible: (l: LineView, x: number, y: number) => boolean;
  /** Whether the viewer owns this tile (the drawing's preview). */
  mine: (x: number, y: number) => boolean;
}

/** A point along a polyline, with the unit normal of its segment pointing to the side faced. */
interface Sample {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Along the line (tiles). */
  s: number;
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
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const u = (k / n) * len;
      out.push({ x: ax + dx * u, y: ay + dy * u, nx: side * dy, ny: -side * dx, s: s + u });
    }
    s += len;
  }
  return out;
}

export class FrontLineLayer {
  readonly container = new Container();
  private readonly zone = new Graphics();
  private readonly ink = new Graphics();
  private readonly draft = new Graphics();
  private readonly labels = new Container();
  private readonly pool = new Map<number, BitmapText>();
  private key = '';

  constructor(private readonly style: TextStyle) {
    this.zone.alpha = 0.9;
    this.container.addChild(this.zone, this.ink, this.draft, this.labels);
  }

  update(lines: readonly LineView[], version: number, ctx: FrontLineContext, draft: LineDraft | null): void {
    const z = ctx.zoom;
    // Redrawn when the lines change, the zoom moves by a tenth, a line digs in, the fog changes.
    const digging = lines.some((l) => l.readyTick > ctx.tick);
    const zb = Math.round(Math.log(z) * 10);
    const key = `${version}|${zb}|${ctx.zones}|${ctx.viewer}|${digging ? ctx.tick : 0}`;
    if (key !== this.key) {
      this.key = key;
      this.redraw(lines, ctx);
    }
    this.place(lines, ctx);
    this.drawDraft(draft, ctx);
  }

  private redraw(lines: readonly LineView[], ctx: FrontLineContext): void {
    const z = ctx.zoom;
    const px = (v: number) => Math.max(0.04, v / z);
    this.zone.clear();
    this.ink.clear();
    for (const l of lines) {
      const mid = middle(l);
      if (!ctx.visible(l, mid[0], mid[1])) continue;
      const held = new Set(l.tiles);
      const ready = l.readyTick <= ctx.tick;
      const samples = sampleLine(l.pts, l.side, 0.5);
      const isHeld = (p: Sample) => heldAt(held, p.x, p.y, this.width);
      // The reach in front of what is held, faint, its far edge dashed.
      if (ctx.zones && ready) {
        for (let k = 1; k < samples.length; k++) {
          const [a, b] = [samples[k - 1]!, samples[k]!];
          if (!isHeld(a) || !isHeld(b)) continue;
          this.zone
            .poly([
              a.x,
              a.y,
              b.x,
              b.y,
              b.x + b.nx * LINE_REACH,
              b.y + b.ny * LINE_REACH,
              a.x + a.nx * LINE_REACH,
              a.y + a.ny * LINE_REACH,
            ])
            .fill({ color: INK, alpha: 0.08 });
        }
        dashed(
          this.zone,
          samples.map((p) => [p.x + p.nx * LINE_REACH, p.y + p.ny * LINE_REACH]),
          px(5),
          px(4),
          INK,
          px(1.2),
          0.55,
        );
      }
      // The line: held stretches as trench and wire, or jump-off line and arrows; breaches dotted.
      const look: Look = {
        ink: INK,
        edge: PAPER,
        ready,
        empty: l.troops < 1,
        strength: l.strength,
      };
      runs(samples, isHeld, (run, on) => {
        if (!on) {
          dashed(
            this.ink,
            run.map((p) => [p.x, p.y]),
            px(1.5),
            px(4),
            INK,
            px(1.6),
            0.7,
          );
          return;
        }
        if (l.kind === 0) trench(this.ink, run, px, look);
        else jumpOff(this.ink, run, px, look);
      });
    }
  }

  /** Map width (tile keys), set by the renderer. */
  width = 1;

  /** Labels: the troops at the middle of each line seen, and the time left while it digs in. */
  private place(lines: readonly LineView[], ctx: FrontLineContext): void {
    const seen = new Set<number>();
    const z = ctx.zoom;
    for (const l of lines) {
      const [x, y] = middle(l);
      if (z < 1.5 || !ctx.visible(l, x, y)) continue;
      seen.add(l.id);
      let t = this.pool.get(l.id);
      if (!t) {
        t = new BitmapText({ text: '', style: this.style });
        t.anchor.set(0.5);
        this.pool.set(l.id, t);
        this.labels.addChild(t);
      }
      const left = l.readyTick - ctx.tick;
      const text =
        (l.kind === 0 ? '▲ ' : '» ') +
        compact(l.troops) +
        (left > 0
          ? ` · ${Math.floor(left / 600)}:${String(Math.ceil(left / 10) % 60).padStart(2, '0')}`
          : '');
      if (t.text !== text) t.text = text;
      t.tint = INK;
      // Just behind the line (its front stays clear), small and steady on screen.
      const [nx, ny] = backward(l);
      t.position.set(x - (nx * 16) / z, y - (ny * 16) / z);
      t.scale.set(0.27 / z);
    }
    for (const [id, t] of this.pool)
      if (!seen.has(id)) {
        t.destroy();
        this.pool.delete(id);
      }
  }

  private drawDraft(d: LineDraft | null, ctx: FrontLineContext): void {
    const g = this.draft;
    g.clear();
    if (!d || d.pts.length === 0) return;
    const z = ctx.zoom;
    const px = (v: number) => Math.max(0.04, v / z);
    const pts = d.stage === 'trace' ? [...d.pts, d.cursor[0], d.cursor[1]] : d.pts;
    const samples = sampleLine(pts, d.side, 0.5);
    // Tracing: over our land solid, elsewhere dotted (a line stands only on our own tiles).
    if (d.stage !== 'side') {
      runs(
        samples,
        (p) => ctx.mine(p.x, p.y),
        (run, on) => {
          const xy = run.map((p): [number, number] => [p.x, p.y]);
          if (on) {
            polyline(g, xy, INK_DARK, px(5), 0.5);
            polyline(g, xy, BRASS, px(2.6), 1);
          } else dashed(g, xy, px(2), px(4), BRASS, px(2), 0.9);
        },
      );
    } else {
      // The side picked: its reach shaded, and the line as it will stand.
      for (let k = 1; k < samples.length; k++) {
        const [a, b] = [samples[k - 1]!, samples[k]!];
        g.poly([
          a.x,
          a.y,
          b.x,
          b.y,
          b.x + b.nx * LINE_REACH,
          b.y + b.ny * LINE_REACH,
          a.x + a.nx * LINE_REACH,
          a.y + a.ny * LINE_REACH,
        ]).fill({ color: BRASS, alpha: 0.1 });
      }
      const look: Look = { ink: BRASS, edge: INK_DARK, ready: true, empty: false, strength: 1 };
      if (d.kind === 0) trench(g, samples, px, look);
      else jumpOff(g, samples, px, look);
    }
    for (let i = 0; i < d.pts.length; i += 2)
      g.circle(d.pts[i]!, d.pts[i + 1]!, px(3.5))
        .fill({ color: BRASS })
        .stroke({ color: INK_DARK, width: px(1.2) });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Whether a tile of the line is held within a tile of (x, y). */
function heldAt(held: Set<number>, x: number, y: number, w: number): boolean {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (held.has((fy + dy) * w + fx + dx)) return true;
  return false;
}

/** The unit normal at the middle of a line, towards the side it faces. */
function backward(l: LineView): [number, number] {
  const s = sampleLine(l.pts, l.side, 1);
  const total = s.at(-1)?.s ?? 0;
  const m = s.find((p) => p.s >= total / 2) ?? s[0];
  return m ? [m.nx, m.ny] : [0, 0];
}

function middle(l: LineView): [number, number] {
  const s = sampleLine(l.pts, l.side, 1);
  const total = s.at(-1)?.s ?? 0;
  const m = s.find((p) => p.s >= total / 2) ?? s[0];
  return m ? [m.x, m.y] : [l.pts[0]!, l.pts[1]!];
}

/** Consecutive samples split into runs where `on` holds or not. */
function runs(
  samples: Sample[],
  on: (p: Sample) => boolean,
  draw: (run: Sample[], on: boolean) => void,
): void {
  let start = 0;
  for (let k = 1; k <= samples.length; k++) {
    const cur = k < samples.length ? on(samples[k]!) : !on(samples[k - 1]!);
    if (k === samples.length || cur !== on(samples[start]!)) {
      const run = samples.slice(start, Math.min(samples.length, k + 1));
      if (run.length >= 2) draw(run, on(samples[start]!));
      start = k;
    }
  }
}

function polyline(g: Graphics, xy: [number, number][], color: number, width: number, alpha: number): void {
  if (xy.length < 2) return;
  g.moveTo(xy[0]![0], xy[0]![1]);
  for (let k = 1; k < xy.length; k++) g.lineTo(xy[k]![0], xy[k]![1]);
  g.stroke({ width, color, alpha, cap: 'round', join: 'round' });
}

function dashed(
  g: Graphics,
  xy: number[][],
  dash: number,
  gap: number,
  color: number,
  width: number,
  alpha: number,
): void {
  let on = true;
  let left = dash;
  for (let k = 1; k < xy.length; k++) {
    let [ax, ay] = [xy[k - 1]![0]!, xy[k - 1]![1]!];
    const [bx, by] = [xy[k]![0]!, xy[k]![1]!];
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
  g.stroke({ width, color, alpha, cap: 'butt' });
}

/** How a line is inked: its ink and paper edge, laid or not, emptied, its strength (0–1). */
interface Look {
  ink: number;
  edge: number;
  ready: boolean;
  empty: boolean;
  strength: number;
}

/** The point at arc length `at` along a run of samples (clamped), with its normal. */
function pointAt(run: Sample[], at: number): Sample {
  let k = 1;
  while (k < run.length - 1 && run[k]!.s < at) k++;
  const [a, b] = [run[k - 1]!, run[k]!];
  const u = b.s > a.s ? Math.min(1, Math.max(0, (at - a.s) / (b.s - a.s))) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, nx: b.nx, ny: b.ny, s: at };
}

/**
 * A defensive stretch: a crenellated trench (traverses jutting towards the front every
 * few pixels) in ink on a paper edge, and in front of it a belt of barbed wire — a strand
 * crossed by small x's. Being laid: the trench dashed, no wire; emptied: a grey dotted trench.
 */
function trench(g: Graphics, run: Sample[], px: (v: number) => number, look: Look): void {
  const s0 = run[0]!.s;
  const len = run[run.length - 1]!.s - s0;
  if (len <= 0) return;
  const step = px(7);
  const amp = px(4);
  const n = Math.max(1, Math.round(len / step));
  const path: number[][] = [];
  let level = 0;
  for (let k = 0; k <= n; k++) {
    const p = pointAt(run, s0 + (k / n) * len);
    path.push([p.x + p.nx * level, p.y + p.ny * level]);
    if (k === n) break;
    level = k % 2 === 0 ? amp : 0;
    path.push([p.x + p.nx * level, p.y + p.ny * level]);
  }
  if (look.empty) {
    dashed(g, path, px(1.6), px(3), look.ink, px(1.8), 0.45);
    return;
  }
  if (!look.ready) {
    dashed(g, path, px(5), px(4), look.edge, px(4.6), 0.6);
    dashed(g, path, px(5), px(4), look.ink, px(2.2), 0.9);
    return;
  }
  polyline(g, path as [number, number][], look.edge, px(5), 0.75);
  polyline(g, path as [number, number][], look.ink, px(2.2), 1);
  // The wire, paler as the line weakens.
  const off = px(13);
  const alpha = 0.45 + 0.55 * look.strength;
  const strand: [number, number][] = [];
  const m = Math.max(1, Math.round(len / px(2)));
  for (let k = 0; k <= m; k++) {
    const p = pointAt(run, s0 + (k / m) * len);
    strand.push([p.x + p.nx * off, p.y + p.ny * off]);
  }
  polyline(g, strand, look.edge, px(3), 0.5 * alpha);
  polyline(g, strand, look.ink, px(1), alpha);
  const every = px(12);
  const x = px(2.6);
  for (let at = every / 2; at < len; at += every) {
    const p = pointAt(run, s0 + at);
    const [cx, cy] = [p.x + p.nx * off, p.y + p.ny * off];
    const [tx, ty] = [-p.ny, p.nx];
    g.moveTo(cx + (tx + p.nx) * x, cy + (ty + p.ny) * x)
      .lineTo(cx - (tx + p.nx) * x, cy - (ty + p.ny) * x)
      .moveTo(cx + (tx - p.nx) * x, cy + (ty - p.ny) * x)
      .lineTo(cx - (tx - p.nx) * x, cy - (ty - p.ny) * x)
      .stroke({ width: px(1.1), color: look.ink, alpha, cap: 'round' });
  }
}

/**
 * An offensive stretch: a jump-off line in ink on a paper edge, and every so often a broad
 * assault arrow (shaft and head) pointing where it pushes, filled, paler as the line
 * weakens. Digging in: the line dashed, the arrows hollow.
 */
function jumpOff(g: Graphics, run: Sample[], px: (v: number) => number, look: Look): void {
  const s0 = run[0]!.s;
  const len = run[run.length - 1]!.s - s0;
  if (len <= 0) return;
  const xy = run.map((p): [number, number] => [p.x, p.y]);
  if (look.ready && !look.empty) {
    polyline(g, xy, look.edge, px(5.4), 0.75);
    polyline(g, xy, look.ink, px(2.6), 1);
  } else {
    dashed(g, xy, px(8), px(5), look.edge, px(5), 0.6);
    dashed(g, xy, px(8), px(5), look.ink, px(2.4), look.empty ? 0.45 : 0.9);
  }
  if (look.empty) return;
  const every = Math.max(px(40), len / Math.max(1, Math.floor(len / px(40))));
  const alpha = look.ready ? 0.5 + 0.5 * look.strength : 0.9;
  for (let at = Math.min(len / 2, every / 2); at < len; at += every) {
    const p = pointAt(run, s0 + at);
    const [tx, ty] = [-p.ny, p.nx];
    const at2 = (d: number, w: number): [number, number] => [
      p.x + p.nx * d + tx * w,
      p.y + p.ny * d + ty * w,
    ];
    const shape = [
      at2(px(2), px(2.4)),
      at2(px(11), px(2.4)),
      at2(px(11), px(6.5)),
      at2(px(19), 0),
      at2(px(11), -px(6.5)),
      at2(px(11), -px(2.4)),
      at2(px(2), -px(2.4)),
    ].flat();
    if (look.ready)
      g.poly(shape)
        .fill({ color: look.ink, alpha })
        .stroke({ color: look.edge, width: px(1.2), alpha: 0.8, join: 'miter' });
    else g.poly(shape).stroke({ color: look.ink, width: px(1.4), alpha, join: 'miter' });
  }
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}
