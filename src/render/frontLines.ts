// Front lines on the map (core/rules/lines.ts, 1.17), drawn as on a staff map, in ink:
//   - a defensive line: a solid line with teeth on the side it faces (a fortified line);
//   - an offensive line: a solid line with chevrons pointing where it pushes; while it
//     digs in (30 s) it is dashed, its chevrons faint, with the time left on its label;
//   - a stretch lost to the enemy (a breach): dotted, no teeth;
//   - its reach (settings: front-line zones), shaded in front of the stretches held, the far
//     edge dashed; the back stays bare.
// The kinds differ by shape, not by colour (the player is colour-blind). Drawn in the
// Courier's ink on a paper edge, readable on any country's colour (a line in its owner's
// colour vanished on its own land); its reach is shaded in ink too. Its troops
// ride a small label just behind its middle. The line being drawn (input.ts LineDraft)
// is previewed in brass: solid over our land, dotted elsewhere; then, picking the side,
// with its teeth or chevrons and its reach.
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
      // The line: held stretches solid (dashed while digging in), breaches dotted.
      runs(samples, isHeld, (run, on) => {
        const xy = run.map((p): [number, number] => [p.x, p.y]);
        if (!on) {
          dashed(this.ink, xy, px(1.5), px(4), INK, px(1.6), 0.7);
          return;
        }
        if (ready) {
          polyline(this.ink, xy, PAPER, px(5), 0.75);
          polyline(this.ink, xy, INK, px(2.4), 1);
        } else {
          dashed(this.ink, xy, px(7), px(5), PAPER, px(5), 0.7);
          dashed(this.ink, xy, px(7), px(5), INK, px(2.4), 1);
        }
      });
      // Its mark every so many pixels: teeth (defensive) or chevrons (offensive), on held stretches.
      const every = Math.max(0.6, 15 / z);
      const alpha = ready ? 0.45 + 0.55 * l.strength : 0.35;
      let next = every / 2;
      for (const p of samples) {
        if (p.s < next) continue;
        next = p.s + every;
        if (!isHeld(p)) continue;
        if (l.kind === 0) tooth(this.ink, p, px(7), px(6), INK, alpha, PAPER, px(1.2));
        else chevron(this.ink, p, px(5.5), px(6), INK, px(2), alpha, PAPER);
      }
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
    // Over our land solid, elsewhere dotted: a line stands only on our own tiles.
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
    for (let i = 0; i < d.pts.length; i += 2)
      g.circle(d.pts[i]!, d.pts[i + 1]!, px(3.5))
        .fill({ color: BRASS })
        .stroke({ color: INK_DARK, width: px(1.2) });
    if (d.stage !== 'side') return;
    // The side picked: the reach shaded, and the line's marks pointing there.
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
      ]).fill({
        color: BRASS,
        alpha: 0.1,
      });
    }
    const every = Math.max(0.6, 15 / z);
    let next = every / 2;
    for (const p of samples) {
      if (p.s < next) continue;
      next = p.s + every;
      if (d.kind === 0) tooth(g, p, px(7), px(6), BRASS, 1, INK_DARK, px(1));
      else chevron(g, p, px(5.5), px(6), BRASS, px(2), 1, INK_DARK);
    }
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

/** A tooth: a small triangle standing on the line, pointing to the side faced, edged. */
function tooth(
  g: Graphics,
  p: Sample,
  base: number,
  height: number,
  color: number,
  alpha: number,
  edge: number,
  edgeW: number,
): void {
  const [tx, ty] = [-p.ny, p.nx];
  g.poly([
    p.x + tx * base * 0.5,
    p.y + ty * base * 0.5,
    p.x - tx * base * 0.5,
    p.y - ty * base * 0.5,
    p.x + p.nx * height,
    p.y + p.ny * height,
  ])
    .fill({ color, alpha })
    .stroke({ color: edge, width: edgeW, alpha: alpha * 0.8, join: 'miter' });
}

/** A chevron ahead of the line, pointing to the side it pushes towards (on a paper edge). */
function chevron(
  g: Graphics,
  p: Sample,
  half: number,
  depth: number,
  color: number,
  width: number,
  alpha: number,
  edge: number,
): void {
  const [tx, ty] = [-p.ny, p.nx];
  const [cx, cy] = [p.x + p.nx * depth * 0.4, p.y + p.ny * depth * 0.4];
  for (const [c, w, a] of [
    [edge, width * 2.2, alpha * 0.7],
    [color, width, alpha],
  ] as const)
    g.moveTo(cx + tx * half, cy + ty * half)
      .lineTo(cx + p.nx * depth, cy + p.ny * depth)
      .lineTo(cx - tx * half, cy - ty * half)
      .stroke({ width: w, color: c, alpha: a, cap: 'round', join: 'miter' });
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}
