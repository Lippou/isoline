// Nuclear blasts, render side only: a layered sequence drawn over the map — white-hot core and
// bloom, shock wave (bright front, dust ring, condensation ring), a fireball that cools from
// white to deep red while it climbs into a rolling mushroom cap, debris and embers, and a
// scorch mark left on the ground for half a minute. Nothing here reads or writes the
// simulation: the blast radius, the damage and the fallout are the worker's alone.
import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import type { ParticleSystem } from './particles';
import { N, NUKE_FALLOUT_RADIUS } from '../core/game/constants';

/** Per-kind look. Sizes are in map tiles (they scale with the world), times in seconds. */
interface Preset {
  /** Visual scale of the fireball / cloud. */
  size: number;
  /** Slow-motion factor of the whole sequence (the H-bomb unfolds slower, a warhead faster). */
  time: number;
  /** How long the cloud lingers. */
  life: number;
  /** Stem height, in `size`. */
  stem: number;
  stemPuffs: number;
  capPuffs: number;
  domePuffs: number;
  skirtPuffs: number;
  sparks: number;
  embers: number;
  debris: number;
  /** Condensation (Wilson) ring, second shock front, horizontal glare streak. */
  wilson: boolean;
  echo: boolean;
  streak: boolean;
  /** Strength of the additive light (a salvo's warheads overlap: each one is dimmer). */
  glow: number;
  /** How far the white bloom spreads, in `size`. */
  bloom: number;
  /** Fireball fully faded at this time (in units of `time`). */
  fireEnd: number;
}

const ATOM: Preset = {
  size: 20,
  time: 1,
  life: 11,
  stem: 2.1,
  stemPuffs: 14,
  capPuffs: 18,
  domePuffs: 6,
  skirtPuffs: 18,
  sparks: 40,
  embers: 28,
  debris: 18,
  wilson: true,
  echo: false,
  streak: true,
  glow: 1,
  bloom: 5.2,
  fireEnd: 4.8,
};
const HYDROGEN: Preset = {
  size: 80,
  time: 1.45,
  life: 16,
  stem: 1.9,
  stemPuffs: 22,
  capPuffs: 30,
  domePuffs: 10,
  skirtPuffs: 30,
  sparks: 120,
  embers: 70,
  debris: 40,
  wilson: true,
  echo: true,
  streak: true,
  glow: 1,
  bloom: 5.2,
  fireEnd: 4.8,
};
const WARHEAD: Preset = {
  size: 12,
  time: 0.75,
  life: 6.5,
  stem: 1.6,
  stemPuffs: 2,
  capPuffs: 5,
  domePuffs: 1,
  skirtPuffs: 0,
  sparks: 6,
  embers: 3,
  debris: 2,
  wilson: false,
  echo: false,
  streak: false,
  glow: 0.45,
  bloom: 1.6,
  fireEnd: 3.4,
};

/** Sprites alive at once beyond which new MIRV warheads keep only their core layers. */
const SPRITE_BUDGET = 3200;
/** Scorch marks kept on the map (the oldest go first). */
const MAX_SCORCH = 420;
/** Scorch: fully dark for this long, then fades out by SCORCH_END (seconds). */
const SCORCH_HOLD = 9;
const SCORCH_END = 27;

/** Fireball colour as it cools (time in units of the preset's `time`). */
const FIRE_RAMP: readonly (readonly [number, number])[] = [
  [0, 0xffffff],
  [0.18, 0xfff7d6],
  [0.5, 0xffde7a],
  [1.0, 0xffad3c],
  [1.8, 0xf46a1e],
  [2.8, 0xc83816],
  [4.2, 0x741a0c],
];
/** Cloud colour: lit dust, then cooling smoke (time in units of `time`). */
const SMOKE_RAMP: readonly (readonly [number, number])[] = [
  [0, 0xfff1dc],
  [0.9, 0xf0c49c],
  [2.2, 0xb39280],
  [4.0, 0x7e736b],
  [7.0, 0x5f5954],
];
const WARM = 0xff9a52;
/** Earth thrown up by the base surge. */
const DUST = 0x8f7a63;

interface Puff {
  s: Sprite;
  /** 0 stem, 1 cap torus, 2 dome, 3 base surge. */
  role: 0 | 1 | 2 | 3;
  /** Stem: height fraction; cap/surge: angle. */
  a: number;
  ph: number;
  size: number;
  jx: number;
  jy: number;
  /** Stretch (puffs are not all round). */
  sx: number;
}

interface Blast {
  x: number;
  y: number;
  /** Visual scale and the fallout radius (tiles). */
  S: number;
  rf: number;
  p: Preset;
  t: number;
  lite: boolean;
  gentle: boolean;
  wind: number;
  bloom: Sprite | null;
  streak: Sprite | null;
  halo: Sprite;
  fire: Sprite;
  core: Sprite;
  shock: Sprite;
  echo: Sprite | null;
  dust: Sprite | null;
  wilson: Sprite | null;
  ground: Sprite;
  capGlow: Sprite | null;
  puffs: Puff[];
  sprites: Sprite[];
  shown: boolean;
}

interface Scorch {
  s: Sprite;
  t: number;
  a0: number;
}

export class NukeFx {
  /** Under the buildings and units: scorch marks, then the glow of the burning ground. */
  readonly ground = new Container();
  /** Over the units: dust, smoke, then the additive light (fire, shock, bloom). */
  readonly air = new Container();
  private readonly scorchLayer = new Container();
  private readonly groundGlow = new Container();
  private readonly dustLayer = new Container();
  private readonly smokeLayer = new Container();
  private readonly lightLayer = new Container();
  private readonly tex: {
    bloom: Texture;
    fire: Texture;
    ring: Texture;
    dust: Texture;
    puff: Texture[];
    scorch: Texture;
    scorchSoft: Texture;
  };
  private pool: Sprite[] = [];
  private blasts: Blast[] = [];
  private scorches: Scorch[] = [];
  private live = 0;

  constructor() {
    this.groundGlow.blendMode = 'add';
    this.lightLayer.blendMode = 'add';
    this.ground.addChild(this.scorchLayer, this.groundGlow);
    this.air.addChild(this.dustLayer, this.smokeLayer, this.lightLayer);
    this.tex = {
      bloom: makeTexture(128, bloomPx),
      fire: makeTexture(256, firePx),
      ring: makeTexture(256, ringPx),
      dust: makeTexture(256, dustPx),
      puff: [0, 1, 2, 3].map((k) => makeTexture(128, (u, v) => puffPx(u, v, 31 + k * 17))),
      scorch: makeTexture(256, (u, v) => scorchPx(u, v, 0.55)),
      scorchSoft: makeTexture(128, (u, v) => scorchPx(u, v, 0.18)),
    };
  }

  /** Blasts still unfolding (QA, perf readouts). */
  get count(): number {
    return this.blasts.length;
  }

  clear(): void {
    for (const b of this.blasts) for (const s of b.sprites) this.release(s);
    for (const sc of this.scorches) this.release(sc.s);
    this.blasts = [];
    this.scorches = [];
    this.live = 0;
  }

  /**
   * A nuclear detonation at (x, y). `visible`: the blast is in view (otherwise only its
   * scorch mark is laid, for when the camera gets there). `density`: the particle setting.
   */
  spawn(
    x: number,
    y: number,
    kind: number,
    visible: boolean,
    density: number,
    gentle: boolean,
    particles: ParticleSystem,
  ): void {
    const p = kind === N.Hydrogen ? HYDROGEN : kind === N.MirvWarhead ? WARHEAD : ATOM;
    // A salvo's warheads are not all alike (a carpet of identical discs reads as a pattern).
    const vary = p === WARHEAD ? 0.8 + Math.random() * 0.45 : 1;
    const rf =
      NUKE_FALLOUT_RADIUS[p === HYDROGEN ? N.Hydrogen : p === WARHEAD ? N.MirvWarhead : N.Atom] * vary;
    const S = p.size * vary;
    this.addScorch(
      x,
      y,
      rf,
      p === WARHEAD ? 0.5 : 0.8,
      p === WARHEAD ? this.tex.scorchSoft : this.tex.scorch,
    );
    if (!visible) return;
    const lite = p === WARHEAD && this.live > SPRITE_BUDGET;
    const sprites: Sprite[] = [];
    const take = (tex: Texture, layer: Container): Sprite => {
      const s = this.take(tex, layer);
      sprites.push(s);
      return s;
    };
    const b: Blast = {
      x,
      y,
      S,
      rf,
      p,
      t: 0,
      lite,
      gentle,
      wind: (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.4),
      ground: take(this.tex.bloom, this.groundGlow),
      dust: lite ? null : take(this.tex.dust, this.dustLayer),
      wilson: p.wilson ? take(this.tex.dust, this.dustLayer) : null,
      puffs: [],
      halo: take(this.tex.bloom, this.lightLayer),
      fire: take(this.tex.fire, this.lightLayer),
      core: take(this.tex.bloom, this.lightLayer),
      capGlow: lite ? null : take(this.tex.bloom, this.lightLayer),
      shock: take(this.tex.ring, this.lightLayer),
      echo: p.echo ? take(this.tex.ring, this.lightLayer) : null,
      bloom: lite ? null : take(this.tex.bloom, this.lightLayer),
      streak: p.streak ? take(this.tex.bloom, this.lightLayer) : null,
      sprites,
      shown: true,
    };
    b.fire.rotation = Math.random() * Math.PI * 2;
    if (b.wilson) b.wilson.rotation = Math.random() * Math.PI * 2;
    if (b.dust) b.dust.rotation = Math.random() * Math.PI * 2;
    if (!lite) {
      // Puffs: the structure of the cloud keeps at least half its puffs at low settings.
      const q = 0.5 + 0.5 * Math.max(0, Math.min(1, density));
      const n = (base: number) => (base > 0 ? Math.max(1, Math.round(base * q)) : 0);
      const puff = (role: Puff['role'], a: number, size: number, jx = 0, jy = 0) => {
        const s = this.take(this.tex.puff[(Math.random() * this.tex.puff.length) | 0]!, this.smokeLayer);
        s.rotation = Math.random() * Math.PI * 2;
        sprites.push(s);
        b.puffs.push({
          s,
          role,
          a,
          ph: Math.random() * Math.PI * 2,
          size,
          jx,
          jy,
          sx: 0.8 + Math.random() * 0.45,
        });
      };
      // Draw order (back to front): base surge, stem, back of the cap, dome, front of the cap.
      const surge = n(p.skirtPuffs);
      for (let k = 0; k < surge; k++)
        puff(
          3,
          ((k + Math.random() * 0.8) / surge) * Math.PI * 2,
          0.7 + Math.random() * 0.6,
          k % 2 ? 0.7 : 1,
        );
      const stem = n(p.stemPuffs);
      for (let k = 0; k < stem; k++) puff(0, (k + 0.5) / stem, 0.85 + Math.random() * 0.3);
      const cap = n(p.capPuffs);
      const ring: number[] = [];
      for (let k = 0; k < cap; k++) ring.push(((k + Math.random() * 0.5) / cap) * Math.PI * 2);
      // Farthest first: the top of the ellipse (sin −1) is the back of the torus.
      ring.sort((a, c) => Math.sin(a) - Math.sin(c));
      const back = ring.filter((a) => Math.sin(a) < 0);
      const front = ring.filter((a) => Math.sin(a) >= 0);
      for (const a of back) puff(1, a, 0.85 + Math.random() * 0.35);
      const dome = n(p.domePuffs);
      for (let k = 0; k < dome; k++)
        puff(2, 0, 0.8 + Math.random() * 0.4, (Math.random() - 0.5) * 1.1, Math.random() * 0.35);
      for (const a of front) puff(1, a, 0.85 + Math.random() * 0.35);
      this.debrisBurst(b, density, particles);
    }
    this.live += sprites.length;
    this.blasts.push(b);
    this.place(b);
  }

  /** Sparks, embers and dark debris thrown out of the fireball and falling back. */
  private debrisBurst(b: Blast, density: number, ps: ParticleSystem): void {
    const { S, x, y, p } = b;
    const d = Math.max(0, Math.min(1, density));
    // Grains keep a modest size on the big blasts (they would read as confetti otherwise).
    const g = Math.min(S, 28);
    const sparks = Math.round(p.sparks * d);
    for (let k = 0; k < sparks; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = S * (1.0 + Math.random() * 2.4);
      const tint = k % 3 === 0 ? 0xfff2c4 : k % 3 === 1 ? 0xffc860 : 0xff9040;
      ps.ballistic(
        x,
        y - S * 0.1,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.55 - S * (0.8 + Math.random() * 1.6),
        S * 3.4,
        1.1,
        tint,
        0.8 + Math.random() * 1.1,
        g * (0.03 + Math.random() * 0.025),
        g * 0.006,
      );
    }
    const embers = Math.round(p.embers * d);
    for (let k = 0; k < embers; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = S * (0.4 + Math.random() * 1.3);
      ps.ballistic(
        x + Math.cos(a) * S * 0.2,
        y - S * 0.2,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.5 - S * (0.6 + Math.random() * 1.4),
        S * 0.9,
        0.9,
        k % 2 ? 0xff6a20 : 0xff3c12,
        2.2 + Math.random() * 2.4,
        g * (0.025 + Math.random() * 0.02),
        g * 0.01,
      );
    }
    const debris = Math.round(p.debris * d);
    for (let k = 0; k < debris; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = S * (0.8 + Math.random() * 2.0);
      ps.ballistic(
        x,
        y,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.55 - S * (1.2 + Math.random() * 1.8),
        S * 3.8,
        0.7,
        k % 2 ? 0x2b2522 : 0x45392f,
        1.2 + Math.random() * 1.0,
        g * (0.03 + Math.random() * 0.025),
        g * 0.02,
        'dot',
      );
    }
  }

  private addScorch(x: number, y: number, rf: number, a0: number, tex: Texture): void {
    if (this.scorches.length >= MAX_SCORCH) this.release(this.scorches.shift()!.s);
    const s = this.take(tex, this.scorchLayer);
    s.position.set(x, y);
    s.rotation = Math.random() * Math.PI * 2;
    s.scale.set(((rf * 1.8) / tex.width) * (0.95 + Math.random() * 0.1));
    s.alpha = 0;
    this.scorches.push({ s, t: 0, a0 });
  }

  /** Advance every blast; `view`: the visible world rectangle [x0, y0, x1, y1]. */
  update(dt: number, view: readonly [number, number, number, number]): void {
    if (this.scorches.length) {
      const keep: Scorch[] = [];
      for (const sc of this.scorches) {
        sc.t += dt;
        if (sc.t >= SCORCH_END) {
          this.release(sc.s);
          continue;
        }
        const fadeIn = Math.min(1, sc.t / 0.5);
        const fadeOut = sc.t < SCORCH_HOLD ? 1 : 1 - (sc.t - SCORCH_HOLD) / (SCORCH_END - SCORCH_HOLD);
        sc.s.alpha = sc.a0 * fadeIn * fadeOut * fadeOut;
        keep.push(sc);
      }
      this.scorches = keep;
    }
    if (!this.blasts.length) return;
    const keep: Blast[] = [];
    for (const b of this.blasts) {
      b.t += dt;
      if (b.t >= b.p.life) {
        for (const s of b.sprites) this.release(s);
        this.live -= b.sprites.length;
        continue;
      }
      keep.push(b);
      // Off-screen culling: the cloud's whole extent (the cap rises above ground zero).
      const m = b.rf * 1.4 + b.S * 0.8;
      const top = b.S * b.p.stem + b.S;
      const inView = b.x + m > view[0] && b.x - m < view[2] && b.y + m > view[1] && b.y - top - m < view[3];
      if (inView !== b.shown) {
        b.shown = inView;
        for (const s of b.sprites) s.visible = inView;
      }
      if (inView) this.place(b);
    }
    this.blasts = keep;
  }

  /** Lays every sprite of a blast out for its current age. */
  private place(b: Blast): void {
    const { x, y, S, rf, p } = b;
    const u = b.t / p.time;
    const lifeU = p.life / p.time;
    const heat = clamp01(1 - u / 4.6);
    // Whole-cloud envelope: fades over the last half of its life.
    const fade = 1 - smooth(lifeU * 0.45, lifeU, u);
    // The column climbs fast then settles; the cap is carried by the wind once formed.
    const climb = easeOut(clamp01((u - 0.05) / 3.4), 2.6);
    const colTop = S * p.stem * climb;
    const wind = b.wind * S * 0.07 * Math.pow(Math.max(0, u - 1.2), 1.15);
    const cx = x + wind;
    const cy = y - colTop;
    // 3. Fireball: grows in a blink, then climbs into the cap while it cools.
    const fr = S * 0.5 * (1 - Math.exp(-u * 9)) * (1 + 0.22 * Math.min(1, u / 3));
    const fx = x + wind * 0.9;
    const fy = y - colTop * 0.92;
    const fireCol = ramp(FIRE_RAMP, u);
    const G = p.glow;
    const fireA =
      (1 - smooth(p.fireEnd * 0.5, p.fireEnd, u)) * Math.min(1, b.t / 0.02 + 0.2) * Math.min(1, G * 1.6);
    set(b.fire, fx, fy, fr, fireCol, fireA, this.tex.fire);
    b.fire.rotation += 0.0025;
    set(b.halo, fx, fy, fr * 3.0, fireCol, 0.55 * heat * fade * G, this.tex.bloom);
    set(
      b.core,
      fx,
      fy,
      fr * (1.15 - 0.4 * clamp01(u / 2)),
      lerpColor(0xffffff, fireCol, clamp01(u / 2.2)),
      Math.exp(-u * 0.75) * G,
      this.tex.bloom,
    );
    // 1. Core flash and bloom: a blinding white burst that blooms out and dies in a second.
    if (b.bloom) {
      const attack = b.gentle ? Math.min(1, b.t / 0.12) : Math.min(1, b.t / 0.025);
      const a = attack * Math.exp(-Math.max(0, u - 0.04) * (b.gentle ? 3.5 : 4.8)) * (b.gentle ? 0.55 : 1);
      set(
        b.bloom,
        x,
        y - colTop * 0.5,
        S * (1.6 + p.bloom * easeOut(clamp01(u / 0.22), 2)),
        0xfffaf0,
        a * G,
        this.tex.bloom,
      );
    }
    if (b.streak) {
      const a = Math.exp(-u * 3) * (b.gentle ? 0.35 : 0.75);
      b.streak.position.set(fx, fy);
      b.streak.tint = 0xffe8c4;
      b.streak.alpha = a;
      const w = this.tex.bloom.width || 1;
      const len = S * (p === HYDROGEN ? 7 : 12);
      b.streak.scale.set((len * (1 + u * 0.8)) / w, (S * 0.18) / w);
    }
    // Ground: the burning earth under the column, glowing then dimming to embers.
    set(
      b.ground,
      x,
      y,
      S * (1.3 + 0.5 * clamp01(u / 2)),
      lerpColor(0xffc070, 0xff3c10, clamp01(u / 2.5)),
      0.85 * Math.exp(-u / 1.7) * G,
      this.tex.bloom,
    );
    if (b.capGlow) {
      const capR = S * 0.62 * (0.25 + 0.75 * easeOut(clamp01((u - 0.2) / 3.2), 2));
      set(b.capGlow, cx, cy + capR * 0.18, capR * 1.7, WARM, 0.5 * heat * heat * fade, this.tex.bloom);
    }
    // 2. Shock wave: a thin bright front racing out past the fallout radius, a second fainter
    // one (H-bomb), the condensation ring and the slow dust ring behind them.
    {
      const k = clamp01(u / 1.2);
      set(
        b.shock,
        x,
        y,
        (rf * 1.3 * easeOut(k, 3)) / 0.93,
        0xfff4e0,
        0.95 * Math.pow(1 - k, 1.3) * Math.min(1, G * 1.4),
        this.tex.ring,
      );
    }
    if (b.echo) {
      const k = clamp01((u - 0.14) / 1.5);
      set(
        b.echo,
        x,
        y,
        (rf * 1.15 * easeOut(k, 3)) / 0.93,
        0xffc890,
        k > 0 ? 0.5 * Math.pow(1 - k, 1.5) : 0,
        this.tex.ring,
      );
    }
    if (b.wilson) {
      const k = clamp01((u - 0.12) / 2.1);
      set(
        b.wilson,
        x,
        y,
        rf * (0.55 + 0.42 * easeOut(k, 2)),
        0xf6f4ef,
        k > 0 && k < 1 ? 0.34 * Math.pow(Math.sin(Math.PI * k), 0.8) : 0,
        this.tex.dust,
      );
    }
    if (b.dust) {
      const k = clamp01((u - 0.05) / 4.2);
      set(
        b.dust,
        x,
        y,
        rf * (0.25 + 0.9 * easeOut(k, 2)),
        0x9c8770,
        0.55 * Math.min(1, k * 6) * Math.pow(1 - k, 1.3),
        this.tex.dust,
      );
    }
    // 4. Mushroom cloud: stem, rolling cap, dome and base surge, lit from below by the fire.
    if (!b.puffs.length) return;
    const smoke = ramp(SMOKE_RAMP, u);
    const grow = 1 + 0.35 * (1 - fade);
    const born = Math.min(1, b.t / 0.25);
    const capR =
      S * 0.62 * (0.25 + 0.75 * easeOut(clamp01((u - 0.2) / 3.2), 2)) * (1 + 0.05 * Math.max(0, u - 3.4));
    const roll = u * 1.5;
    for (const pf of b.puffs) {
      let px: number;
      let py: number;
      let size: number;
      let warm: number;
      let tint = smoke;
      let a = 0.95;
      if (pf.role === 0) {
        // Stem: narrow in the middle, flared at the base, merging into the cap at the top.
        const f = pf.a;
        px = x + wind * f + Math.sin(pf.ph + u * 1.1 + f * 3) * S * 0.04;
        py = y - colTop * f * 0.9;
        size = S * (0.15 + 0.22 * Math.pow(1 - f, 3) + 0.1 * f * f) * pf.size * (0.6 + 0.4 * Math.min(1, u));
        warm = heat * (0.35 + 0.65 * f);
        a *= 0.9;
      } else if (pf.role === 1) {
        // Cap torus: puffs roll over (up at the back, down the front) as the cap spreads.
        const ph = pf.ph + roll;
        const sn = Math.sin(pf.a);
        px = cx + Math.cos(pf.a) * capR * (1 + 0.06 * Math.cos(ph));
        py = cy + sn * capR * 0.36 - Math.sin(ph) * capR * 0.16;
        size = capR * 0.52 * pf.size * (0.88 + 0.16 * Math.cos(ph));
        warm = heat * (0.45 + 0.55 * (sn * 0.5 + 0.5));
      } else if (pf.role === 2) {
        px = cx + pf.jx * capR * 0.55 + Math.sin(pf.ph + roll * 0.5) * capR * 0.05;
        py = cy - capR * (0.3 + pf.jy);
        size = capR * 0.55 * pf.size;
        warm = heat * 0.3;
      } else {
        // Base surge: a low ring of dust rolling out along the ground.
        const k = easeOut(clamp01((u - 0.15) / 3), 2);
        const d = rf * 0.7 * k * pf.jx;
        px = x + Math.cos(pf.a) * d + wind * 0.2;
        py = y + Math.sin(pf.a) * d * 0.8;
        size = S * 0.36 * pf.size * (0.6 + 0.7 * k);
        warm = heat * 0.25 * (1 - k);
        a *= 0.62 * Math.min(1, k * 5);
        tint = DUST;
      }
      pf.s.position.set(px, py);
      pf.s.scale.set((size * grow * pf.sx) / 64, (size * grow) / 64);
      pf.s.rotation += 0.0015;
      pf.s.tint = lerpColor(
        tint === smoke ? smoke : lerpColor(smoke, tint, 0.6),
        WARM,
        Math.min(0.75, warm * 0.8),
      );
      pf.s.alpha = a * fade * born;
    }
  }

  private take(tex: Texture, layer: Container): Sprite {
    let s = this.pool.pop();
    if (!s) {
      s = new Sprite(tex);
      s.anchor.set(0.5);
    }
    s.texture = tex;
    s.visible = true;
    s.alpha = 0;
    s.rotation = 0;
    s.tint = 0xffffff;
    layer.addChild(s);
    return s;
  }

  private release(s: Sprite): void {
    s.removeFromParent();
    this.pool.push(s);
  }
}

// ------------------------------------------------------------------ helpers

/** Places a round sprite: centre, radius in tiles, tint and alpha. */
function set(s: Sprite, x: number, y: number, r: number, tint: number, alpha: number, tex: Texture): void {
  s.position.set(x, y);
  s.scale.set((r * 2) / (tex.width || 1));
  s.tint = tint;
  s.alpha = Math.max(0, alpha);
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function easeOut(t: number, pow: number): number {
  return 1 - Math.pow(1 - t, pow);
}

export function lerpColor(a: number, b: number, f: number): number {
  const t = clamp01(f);
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Colour along a ramp of [time, colour] stops. */
export function ramp(stops: readonly (readonly [number, number])[], u: number): number {
  if (u <= stops[0]![0]) return stops[0]![1];
  for (let k = 1; k < stops.length; k++) {
    const [t1, c1] = stops[k]!;
    if (u <= t1) {
      const [t0, c0] = stops[k - 1]!;
      return lerpColor(c0, c1, (u - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1]![1];
}

// --------------------------------------------------------------- textures
// Generated once as pixel buffers: smooth radial gradients and value-noise billows.

export type Px = (u: number, v: number) => [number, number, number, number];

export function makeTexture(size: number, px: Px): Texture {
  // Raw premultiplied pixels (a 2D canvas upload came out unpremultiplied: hard-edged discs).
  const d = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const [r, g, b, a] = px(((i + 0.5) / size) * 2 - 1, ((j + 0.5) / size) * 2 - 1);
      const k = clamp01(a);
      const o = (j * size + i) * 4;
      d[o] = Math.round(r * k);
      d[o + 1] = Math.round(g * k);
      d[o + 2] = Math.round(b * k);
      d[o + 3] = Math.round(k * 255);
    }
  return new Texture({
    source: new BufferImageSource({
      resource: d,
      width: size,
      height: size,
      alphaMode: 'premultiplied-alpha',
      scaleMode: 'linear',
    }),
  });
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function fbm(x: number, y: number, seed: number, oct = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let k = 0; k < oct; k++) {
    sum += vnoise(x, y, seed + k * 101) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

const W: [number, number, number] = [255, 255, 255];

export function bloomPx(u: number, v: number): [number, number, number, number] {
  const r2 = u * u + v * v;
  if (r2 >= 1) return [...W, 0];
  const e = Math.exp(-4.2);
  const a = (Math.exp(-4.2 * r2) - e) / (1 - e);
  return [...W, a * a * 0.85 + 0.25 * Math.exp(-40 * r2)];
}

function firePx(u: number, v: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  const n = fbm(u * 3 + 10, v * 3 + 10, 3);
  const edge = r + (n - 0.5) * 0.38;
  const a = smooth(1.0, 0.7, edge);
  const lum = Math.max(0.4, Math.min(1, 1.12 - 0.6 * edge * edge + (n - 0.5) * 0.55));
  const c = Math.round(lum * 255);
  return [c, c, c, a];
}

function ringPx(u: number, v: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return [...W, 0];
  const front = Math.exp(-(((r - 0.93) / 0.022) ** 2));
  const wake = r < 0.93 ? 0.28 * Math.exp(-(((r - 0.87) / 0.07) ** 2)) : 0;
  return [...W, Math.min(1, front + wake)];
}

function dustPx(u: number, v: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return [...W, 0];
  const n = fbm(u * 4 + 3, v * 4 + 7, 7);
  const band = Math.exp(-(((r - 0.78) / 0.15) ** 2));
  const inner = 0.12 * smooth(0.9, 0.3, r);
  const a = (band * (0.35 + 0.9 * n) + inner * n) * smooth(1, 0.94, r);
  const c = Math.round((0.8 + 0.2 * n) * 255);
  return [c, c, c, a];
}

export function puffPx(u: number, v: number, seed: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  const n = fbm(u * 2.8 + seed, v * 2.8 - seed, seed);
  const lobes = fbm(Math.cos(Math.atan2(v, u)) * 1.6 + seed, Math.sin(Math.atan2(v, u)) * 1.6, seed + 5, 2);
  const edge = r + (n - 0.5) * 0.7 + (lobes - 0.5) * 0.45;
  const a = smooth(0.98, 0.45, edge);
  if (a <= 0) return [...W, 0];
  // Shaded like a ball lit from above-left (the sun of the atlas), with billowy noise.
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, r * r)));
  const diffuse = Math.max(0, -0.32 * u - 0.5 * v + 0.8 * nz);
  const lum = Math.max(0.3, Math.min(1, 0.5 + 0.48 * diffuse + (n - 0.5) * 0.35));
  const c = Math.round(lum * 255);
  return [c, c, c, a * 0.95];
}

function scorchPx(u: number, v: number, rayAmp: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return [0, 0, 0, 0];
  const th = Math.atan2(v, u);
  const n = fbm(u * 3.5 + 5, v * 3.5 + 9, 11);
  const rays = fbm(Math.cos(th) * 7 + 2, Math.sin(th) * 7 + 2, 13, 3);
  const edge = r - (rays - 0.5) * rayAmp - (n - 0.5) * 0.25;
  const a = smooth(0.95, 0.45, edge) * (0.8 + 0.2 * n);
  // Black at the heart, burnt umber at the ragged edge.
  const k = smooth(0.1, 0.85, r);
  const rr = Math.round(14 + 58 * k + 12 * n);
  const gg = Math.round(11 + 40 * k + 8 * n);
  const bb = Math.round(9 + 26 * k + 5 * n);
  return [rr, gg, bb, a * 0.95];
}
