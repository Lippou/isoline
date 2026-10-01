// Lightweight pooled particle system (sprites, additive or normal blending).
import { Container, Sprite } from 'pixi.js';
import type { IconSet } from './icons';

type Kind = 'spark' | 'smoke' | 'dot' | 'ring' | 'glow';

interface P {
  s: Sprite;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size0: number;
  size1: number;
  alpha0: number;
  gravity: number;
  drag: number;
  active: boolean;
  worldSize: boolean;
}

export class ParticleSystem {
  readonly container = new Container();
  private readonly additive = new Container();
  private readonly normal = new Container();
  private pool: P[] = [];
  private live: P[] = [];
  private zoom = 1;

  constructor(
    private readonly icons: IconSet,
    private readonly max: number,
  ) {
    this.additive.blendMode = 'add';
    this.container.addChild(this.normal, this.additive);
  }

  private take(kind: Kind): P | null {
    if (this.live.length >= this.max) return null;
    let p = this.pool.pop();
    const tex =
      kind === 'smoke'
        ? this.icons.smoke
        : kind === 'ring'
          ? this.icons.ring
          : kind === 'glow'
            ? this.icons.glow
            : kind === 'dot'
              ? this.icons.dot
              : this.icons.spark;
    const layer = kind === 'smoke' || kind === 'dot' ? this.normal : this.additive;
    if (!p) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      p = {
        s,
        vx: 0,
        vy: 0,
        life: 0,
        max: 1,
        size0: 1,
        size1: 1,
        alpha0: 1,
        gravity: 0,
        drag: 0,
        active: true,
        worldSize: true,
      };
    }
    p.s.texture = tex;
    if (p.s.parent !== layer) layer.addChild(p.s);
    p.s.visible = true;
    p.active = true;
    this.live.push(p);
    return p;
  }

  /** Generic particle: position/velocity in tiles (per second), size in tiles (or screen px if !worldSize). */
  emit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    tint: number,
    life: number,
    size: number,
    kind: Kind = 'spark',
    endSize = size * 0.3,
    worldSize = true,
  ): void {
    const p = this.take(kind);
    if (!p) return;
    p.s.position.set(x, y);
    p.vx = vx;
    p.vy = vy;
    p.life = 0;
    p.max = life;
    p.size0 = size;
    p.size1 = endSize;
    p.alpha0 = kind === 'smoke' ? 0.55 : 1;
    p.gravity = 0;
    p.drag = 1.2;
    p.worldSize = worldSize;
    p.s.tint = tint;
    p.s.alpha = p.alpha0;
  }

  burst(x: number, y: number, n: number, tint: number, speed: number, kind: Kind): void {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random()) * 6;
      const size = kind === 'smoke' ? 1.2 + Math.random() * 1.5 : 0.35 + Math.random() * 0.4;
      this.emit(
        x,
        y,
        Math.cos(a) * v,
        Math.sin(a) * v,
        tint,
        kind === 'smoke' ? 2 + Math.random() : 0.5 + Math.random() * 0.7,
        size * Math.max(1, speed * 0.25),
        kind,
        kind === 'smoke' ? size * 3 : size * 0.2,
      );
    }
  }

  ring(x: number, y: number, radius: number, tint: number, life: number): void {
    const p = this.take('ring');
    if (!p) return;
    p.s.position.set(x, y);
    p.vx = 0;
    p.vy = 0;
    p.life = 0;
    p.max = life;
    p.size0 = radius * 0.1;
    p.size1 = radius * 2;
    p.alpha0 = 0.9;
    p.gravity = 0;
    p.drag = 0;
    p.worldSize = true;
    p.s.tint = tint;
  }

  /** Stylised mushroom cloud: rising column + cap, glowing core, lingering dust. */
  mushroom(x: number, y: number, radius: number, big: boolean, density: number): void {
    const glow = this.take('glow');
    if (glow) {
      glow.s.position.set(x, y);
      glow.vx = glow.vy = 0;
      glow.life = 0;
      glow.max = big ? 2.6 : 1.6;
      glow.size0 = radius * 1.6;
      glow.size1 = radius * 2.6;
      glow.alpha0 = 1;
      glow.gravity = 0;
      glow.drag = 0;
      glow.worldSize = true;
      glow.s.tint = 0xffc070;
    }
    const n = Math.round((big ? 70 : 34) * density);
    for (let k = 0; k < n; k++) {
      const col = k < n * 0.45;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * (col ? 0.18 : 0.6);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.5;
      const rise = (col ? 0.5 + Math.random() : 0.9 + Math.random() * 0.4) * radius * 0.55;
      const spread = col ? 0 : (Math.random() - 0.5) * radius * 0.5;
      this.emit(
        px,
        py,
        spread,
        -rise,
        col ? 0x9a8f88 : 0xc9b8a8,
        2.8 + Math.random() * 1.5,
        radius * (col ? 0.12 : 0.2),
        'smoke',
        radius * (col ? 0.3 : 0.55),
      );
    }
    for (let k = 0; k < Math.round(40 * density); k++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.8 + Math.random() * 0.8);
      this.emit(
        x + Math.cos(a) * r,
        y + Math.sin(a) * r,
        0,
        -0.3,
        0xb8e04a,
        3 + Math.random() * 2,
        radius * 0.06,
        'spark',
        radius * 0.02,
      );
    }
  }

  update(dt: number, zoom: number): void {
    this.zoom = zoom;
    const keep: P[] = [];
    for (const p of this.live) {
      p.life += dt;
      if (p.life >= p.max) {
        p.active = false;
        p.s.visible = false;
        this.pool.push(p);
        continue;
      }
      const f = p.life / p.max;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      const size = p.size0 + (p.size1 - p.size0) * f;
      const texW = p.s.texture.width || 1;
      p.s.scale.set(p.worldSize ? (size / texW) * 2 : size / texW / this.zoom);
      p.s.alpha = p.alpha0 * (1 - f) * (f < 0.1 ? f * 10 : 1);
      keep.push(p);
    }
    this.live = keep;
  }
}
