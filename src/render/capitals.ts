// Capital markers. The cartographer's sign for a capital, a star: filled with the
// owner's ink, rimmed in paper and edged in navy so that it reads on any land and at
// every zoom. Its silhouette sets it apart from the round building badges and from the
// leader's crown (a round badge above the country's name). Also the short rings when a
// capital falls or is re-established, and the preview while the player chooses a seat.
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { svgTexture } from './icons';
import { badgePx, capitalPx } from './badgeSize';
import { UI } from './colors';
import type { ClientState } from '../engine/clientState';
import { CAPITAL_FRONT_GAP } from '../core/game/constants';

export interface CapitalHooks {
  revealed: (owner: number, x: number, y: number) => boolean;
  inkOf: (id: number) => number;
  uiScale: () => number;
  reducedMotion: () => boolean;
}

interface Marker {
  c: Container;
  /** The star's ink (white texture tinted with the owner's colour). */
  fill: Sprite;
  tile: number;
  /** Distance (tiles) to the nearest building badge, refreshed with the buildings. */
  near: number;
  version: number;
}

interface Fx {
  x: number;
  y: number;
  t: number;
  color: number;
  lost: boolean;
}

/** Hazard magenta (BRAND.md §4): the ring left where a capital fell. */
const LOST = 0xe0456f;
const PAPER = '#f4efe2';
const NAVY = '#0c1a26';
/** Design space of the marker textures (96 × 96, drawn at 128 px). */
const D = 96;

/** A five-pointed star as a flat [x, y, …] polygon (point up). */
export function starPoints(cx: number, cy: number, outer: number, inner = outer * 0.42): number[] {
  const pts: number[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? outer : inner;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

const fmt = (v: number) => Math.round(v * 100) / 100;

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 ${D} ${D}">${body}</svg>`;
/** The star's outline (its optical centre sits a little low in the box). */
const STAR = starPoints(48, 51, 41, 41 * 0.46)
  .map(fmt)
  .join(' ');
/** Navy edge and paper rim; the ink fill goes on top. */
const BASE_SVG = svg(
  `<polygon points="${STAR}" fill="${NAVY}" stroke="${NAVY}" stroke-opacity="0.9" stroke-width="10" stroke-linejoin="round"/>` +
    `<polygon points="${STAR}" fill="${PAPER}" stroke="${PAPER}" stroke-width="3.5" stroke-linejoin="round"/>`,
);
const FILL_SVG = svg(
  `<polygon points="${starPoints(48, 51, 33, 33 * 0.46)
    .map(fmt)
    .join(' ')}" fill="#fff"/>`,
);

export class CapitalLayer {
  readonly container = new Container();
  private readonly fxG = new Graphics();
  private markers = new Map<number, Marker>();
  /** Capital of each player at the last frame (-1: none), to ring the changes. */
  private prev = new Map<number, number>();
  private fx: Fx[] = [];
  private base!: Texture;
  private fillTex!: Texture;

  constructor(
    private readonly state: ClientState,
    private readonly hooks: CapitalHooks,
  ) {}

  async init(): Promise<void> {
    this.base = await svgTexture(BASE_SVG, 128, 128);
    this.fillTex = await svgTexture(FILL_SVG, 128, 128);
    this.container.addChild(this.fxG);
  }

  /** On-screen size of a marker (px): larger than a building badge, never tiny. */
  static px(z: number, ui = 1): number {
    return capitalPx(z, ui);
  }

  update(z: number): void {
    const s = this.state;
    const w = s.width;
    const now = performance.now();
    const ui = this.hooks.uiScale() || 1;
    const px = CapitalLayer.px(z, ui);
    // Building badge size, as drawn by the renderer (updateBuildings).
    const badge = badgePx(z, ui);
    const live = new Set<number>();
    for (const p of s.playerList) {
      const tile = p.alive ? p.capital : -1;
      const before = this.prev.get(p.id);
      this.prev.set(p.id, tile);
      if (before !== undefined && before !== tile && !this.hooks.reducedMotion()) {
        if (before >= 0) this.ring(p.id, before, LOST, true, now);
        if (tile >= 0) this.ring(p.id, tile, this.hooks.inkOf(p.id), false, now);
      }
      if (tile < 0) continue;
      const x = (tile % w) + 0.5;
      const y = ((tile / w) | 0) + 0.5;
      if (!this.hooks.revealed(p.id, x, y)) continue;
      live.add(p.id);
      let m = this.markers.get(p.id);
      if (!m) {
        const c = new Container();
        const back = new Sprite(this.base);
        back.anchor.set(0.5);
        back.setSize(D, D);
        const fill = new Sprite(this.fillTex);
        fill.anchor.set(0.5);
        fill.setSize(D, D);
        c.addChild(back, fill);
        this.container.addChild(c);
        m = { c, fill, tile: -1, near: Infinity, version: -1 };
        this.markers.set(p.id, m);
      }
      if (m.tile !== tile || m.version !== s.buildingsVersion) {
        m.tile = tile;
        m.version = s.buildingsVersion;
        m.near = Infinity;
        for (const b of s.buildings) m.near = Math.min(m.near, Math.hypot(b.x + 0.5 - x, b.y + 0.5 - y));
      }
      m.fill.tint = this.hooks.inkOf(p.id);
      // On a building, the star rides just above its badge instead of hiding it.
      const lift = m.near * z < badge * 0.8 ? (badge / 2 + px * 0.4) / z : 0;
      m.c.position.set(x, y - lift);
      m.c.scale.set(px / D / z);
      m.c.visible = true;
    }
    for (const [id, m] of this.markers) {
      if (live.has(id)) continue;
      m.c.destroy({ children: true });
      this.markers.delete(id);
    }
    this.drawFx(z, now);
  }

  private ring(owner: number, tile: number, color: number, lost: boolean, now: number): void {
    const w = this.state.width;
    const x = (tile % w) + 0.5;
    const y = ((tile / w) | 0) + 0.5;
    if (this.hooks.revealed(owner, x, y)) this.fx.push({ x, y, t: now, color, lost });
  }

  /** A fallen capital leaves two magenta rings spreading out; a new one is ringed in its ink. */
  private drawFx(z: number, now: number): void {
    const g = this.fxG;
    g.clear();
    this.fx = this.fx.filter((f) => now - f.t < 1600);
    const lw = (v: number) => Math.max(0.08, v / z);
    for (const f of this.fx) {
      const a = (now - f.t) / 1600;
      if (f.lost) {
        for (const d of [0, 0.25]) {
          const k = Math.max(0, Math.min(1, (a - d) / 0.75));
          if (k <= 0) continue;
          g.circle(f.x, f.y, lw(10 + 46 * k)).stroke({
            width: lw(2.5),
            color: f.color,
            alpha: 0.9 * (1 - k),
          });
        }
      } else {
        const k = Math.min(1, a / 0.6);
        g.circle(f.x, f.y, lw(40 - 26 * k)).stroke({ width: lw(2), color: f.color, alpha: 0.85 * (1 - a) });
      }
    }
  }

  /** Choosing a new seat: the clearance square (no foreign land inside) and the star, ok or not. */
  drawGhost(g: Graphics, ghost: { tile: number; ok: boolean }, z: number): void {
    const w = this.state.width;
    const x = (ghost.tile % w) + 0.5;
    const y = ((ghost.tile / w) | 0) + 0.5;
    const color = ghost.ok ? UI.aurora : UI.signal;
    const lw = (v: number) => Math.max(0.08, v / z);
    const r = CAPITAL_FRONT_GAP + 0.5;
    g.rect(x - r, y - r, 2 * r, 2 * r)
      .fill({ color, alpha: 0.08 })
      .stroke({ width: lw(1.5), color, alpha: 0.75 });
    const s = Math.max(1.4, 14 / z);
    g.poly(starPoints(x, y, s, s * 0.46))
      .fill({ color: 0xf4efe2, alpha: 0.95 })
      .stroke({ width: lw(3), color, join: 'round' });
    // Refused: the star is crossed out (not only red: colour-blind players read the ×).
    if (!ghost.ok) {
      const d = s * 1.05;
      for (const [w, c] of [
        [lw(5), 0x0b0e12],
        [lw(2.6), color],
      ] as const)
        g.moveTo(x - d, y - d)
          .lineTo(x + d, y + d)
          .moveTo(x + d, y - d)
          .lineTo(x - d, y + d)
          .stroke({ width: w, color: c, cap: 'round' });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
