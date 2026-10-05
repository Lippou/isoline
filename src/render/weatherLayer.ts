// Weather on the map: packs the drifting storm cells and fog banks for the map shader
// (rain bands, rain, lightning, veils) and marks each one with a faint dashed outline
// and a small glyph at its centre, so the zone reads as weather and not as clouds.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { ClientState } from '../engine/clientState';
import type { IconSet } from './icons';

/** Ticks a cell takes to fade in after it forms, and out before it clears. */
const FADE_TICKS = 50;
/** On-screen size of the centre glyph (px). */
const MARK_PX = 22;
/**
 * Dashed outline colours: storm (cold slate), fog bank (paper white); a world event's zone
 * (earthquake, volcanic ash) in brass, with longer and bolder dashes and its own glyph.
 */
const RING_COLOR = [0xc9d6e8, 0xf2f5f7, 0xe9b44c, 0xe9b44c] as const;
/** Mark kinds of the world events' zones (icons.weather[kind]). */
const EVENT_KIND: Record<string, 2 | 3> = { earthquake: 2, volcano: 3 };

interface Mark {
  c: Container;
  ring: Graphics;
  icon: Sprite;
  /** Zoom and radius the outline was drawn for (dashes are in screen pixels). */
  zoom: number;
  r: number;
  seen: number;
}

export class WeatherLayer {
  readonly container = new Container();
  private marks = new Map<number, Mark>();
  private packed = new Float32Array(32).fill(-1);
  private frame = 0;

  constructor(
    private readonly state: ClientState,
    private readonly icons: IconSet,
  ) {}

  /**
   * Cells as they stand at `tickF` (the drift is extrapolated between world updates):
   * updates the markers and returns the shader's packed cells (x, y, radius, code).
   */
  update(tickF: number, zoom: number): Float32Array {
    this.frame++;
    const w = this.state.world;
    const cells = w?.weather ?? [];
    const since = w ? Math.max(0, Math.min(10, tickF - w.tick)) : 0;
    this.packed.fill(-1);
    for (let k = 0; k < cells.length && k < 8; k++) {
      const c = cells[k]!;
      const x = c.x + c.vx * since;
      const y = c.y + c.vy * since;
      const born = c.born ?? c.until - 2400;
      const fade = Math.max(0, Math.min(1, (tickF - born) / FADE_TICKS, (c.until - tickF) / FADE_TICKS));
      this.packed[k * 4] = x;
      this.packed[k * 4 + 1] = y;
      this.packed[k * 4 + 2] = c.r;
      this.packed[k * 4 + 3] = (c.kind === 1 ? 2 : 0) + fade;
      this.mark(born * 2 + c.kind, c.kind, x, y, c.r, fade, zoom);
    }
    // The zone of a world event under way (GAME_DESIGN.md §12): the earthquake's circle,
    // the ash cloud where no aircraft flies.
    const ev = w?.event;
    const ek = ev ? EVENT_KIND[ev.id] : undefined;
    if (ev && ek !== undefined && (ev.r ?? 0) > 0 && ev.until > tickF) {
      const fade = Math.max(0, Math.min(1, (ev.until - tickF) / FADE_TICKS));
      this.mark(-1 - ev.until, ek, ev.x ?? 0, ev.y ?? 0, ev.r ?? 0, fade, zoom);
    }
    for (const [id, m] of this.marks) {
      if (m.seen === this.frame) continue;
      m.c.destroy({ children: true });
      this.marks.delete(id);
    }
    return this.packed;
  }

  private mark(
    id: number,
    kind: 0 | 1 | 2 | 3,
    x: number,
    y: number,
    r: number,
    fade: number,
    z: number,
  ): void {
    let m = this.marks.get(id);
    if (!m) {
      const c = new Container();
      const ring = new Graphics();
      const icon = new Sprite(this.icons.weather[kind]!);
      icon.anchor.set(0.5);
      c.addChild(ring, icon);
      this.container.addChild(c);
      m = { c, ring, icon, zoom: 0, r: 0, seen: 0 };
      this.marks.set(id, m);
    }
    m.seen = this.frame;
    if (Math.abs(Math.log(z / (m.zoom || 1))) > 0.12 || Math.abs(m.r - r) > 0.5) {
      m.zoom = z;
      m.r = r;
      m.ring.clear();
      if (kind >= 2) {
        // A world event's zone reads as an area: a faint wash inside the bold dashes.
        m.ring.circle(0, 0, r).fill({ color: RING_COLOR[kind], alpha: 0.09 });
        dashedRing(m.ring, r, z, RING_COLOR[kind], 16, 6, 2.4, 0.85);
      } else dashedRing(m.ring, r, z, RING_COLOR[kind]);
    }
    m.c.position.set(x, y);
    m.c.alpha = fade;
    // The glyph keeps a readable size; it shrinks away when the cell itself is tiny on screen.
    const px = Math.min(MARK_PX, r * z * 0.7);
    m.icon.visible = px >= 10;
    m.icon.width = m.icon.height = px / z;
    // A world event's glyph sits on its circle's top edge: the building at the epicentre stays visible.
    m.icon.position.set(0, kind >= 2 ? -r : 0);
  }
}

/** A faint dashed circle of radius r (tiles) centred on the origin; dashes in screen pixels. */
function dashedRing(
  g: Graphics,
  r: number,
  z: number,
  color: number,
  dash = 9,
  gap = 7,
  width = 1.4,
  alpha = 0.5,
): void {
  const circ = Math.PI * 2 * r * z;
  const n = Math.max(8, Math.min(240, Math.round(circ / (dash + gap))));
  const on = (dash / (dash + gap)) * ((Math.PI * 2) / n);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2;
    const a1 = a0 + on;
    // A short arc as a few straight pieces.
    const steps = Math.max(1, Math.ceil(((a1 - a0) * r * z) / 4));
    g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
    for (let s = 1; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  g.stroke({ width: Math.max(0.06, width / z), color, alpha, cap: 'round' });
}
