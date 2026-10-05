// Nuclear missiles in flight and at launch, render side only. The missile itself stays where
// the simulation puts it (its arc, its speed, its interception); everything here is drawn
// around that point:
//  - launch: the silo hatch glows, an ignition flash, a billowing exhaust plume that spreads
//    at the base and lingers, the missile rising (it grows as it climbs) behind a thick column;
//  - in flight: a shaped body per kind (missileArt.ts) along the arc, an engine flame that
//    flickers, a smoke contrail that thins and drifts, and a soft shadow on the ground whose
//    distance to the missile reads as height (the sim's arc is bowed towards the top of the
//    map: "up" on the map is up in the air);
//  - MIRV: at the separation point a flash, the payload fairing breaking in two, the empty bus
//    drifting on, and the warheads fanning out (each a small dark cone with a re-entry glow).
// Sizes scale with the map, with a minimum (and a maximum) on screen. Every sprite comes from
// per-layer pools reused frame after frame: many missiles at once stay cheap.
import { Container, Sprite, Texture } from 'pixi.js';
import { N, NUKE_TARGETABLE_RANGE } from '../core/game/constants';
import { U } from '../core/units/unit';
import { ARC_UP, type Trajectory } from '../core/units/trajectory';
import { svgDoc } from './shipArt';
import { svgTextureMip } from './icons';
import { bloomPx, clamp01, fbm, lerpColor, makeTexture, puffPx, smooth, type Px } from './nukeFx';
import {
  ATOM_ART,
  BUS_ART,
  FAIRING_ART,
  HYDROGEN_ART,
  INTERCEPTOR_ART,
  MIRV_ART,
  WARHEAD_ART,
  type MissileArt,
} from './missileArt';

type Look = 'atom' | 'hydrogen' | 'mirv' | 'warhead' | 'interceptor';

/** Per-kind look. Lengths in tiles; on-screen bounds in CSS pixels. */
interface Spec {
  art: MissileArt;
  len: number;
  minPx: number;
  maxPx: number;
  /** Contrail puff size (tiles at full size), 0: a streak only. */
  trail: number;
  /** Flame: length and width in body lengths, texture. */
  flameLen: number;
  flameW: number;
  flame: 'fire' | 'diamond' | 'ice';
  /** Launch plume and ignition flash scale (0: none). */
  plume: number;
}

const SPECS: Record<Look, Spec> = {
  atom: {
    art: ATOM_ART,
    len: 6,
    minPx: 26,
    maxPx: 120,
    trail: 1.6,
    flameLen: 0.95,
    flameW: 0.3,
    flame: 'fire',
    plume: 1,
  },
  hydrogen: {
    art: HYDROGEN_ART,
    len: 9,
    minPx: 36,
    maxPx: 170,
    trail: 2.4,
    flameLen: 1.05,
    flameW: 0.32,
    flame: 'diamond',
    plume: 1.45,
  },
  mirv: {
    art: MIRV_ART,
    len: 11,
    minPx: 42,
    maxPx: 190,
    trail: 2.8,
    flameLen: 0.7,
    flameW: 0.27,
    flame: 'diamond',
    plume: 1.7,
  },
  warhead: {
    art: WARHEAD_ART,
    len: 2.4,
    minPx: 11,
    maxPx: 42,
    trail: 0,
    flameLen: 0,
    flameW: 0,
    flame: 'fire',
    plume: 0,
  },
  interceptor: {
    art: INTERCEPTOR_ART,
    len: 3,
    minPx: 13,
    maxPx: 56,
    trail: 0.55,
    flameLen: 0.9,
    flameW: 0.32,
    flame: 'ice',
    plume: 0.3,
  },
};

const lookOf = (type: number, kind: number): Look =>
  type === U.Interceptor
    ? 'interceptor'
    : kind === N.Hydrogen
      ? 'hydrogen'
      : kind === N.Mirv
        ? 'mirv'
        : kind === N.MirvWarhead
          ? 'warhead'
          : 'atom';

/** Contrail and plume sprites drawn at most (the farthest puffs go first). */
const PUFF_BUDGET = 2600;
/** Contrail life (seconds of game time) at full particle density. */
const TRAIL_LIFE = 3.6;
/** Wind drift of the smoke (tiles a second at full size). */
const WIND_X = 1.3;
const WIND_Y = -0.55;
/** Sun direction of the shadows (the atlas is lit from the upper left). */
const SUN_X = 0.24;
const SUN_Y = 1;
const SMOKE = 0xefebe3;
const SMOKE_OLD = 0xc4beb4;
const HOT = 0xffc27a;
const AURORA = 0x7fe3ff;

interface Flight {
  id: number;
  look: Look;
  spec: Spec;
  path: Trajectory;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t0: number;
  t1: number;
  arc: number;
  /** Ground under the end of the flight (MIRV carrier: its target). */
  gx: number;
  gy: number;
  seed: number;
  seen: number;
  launched: boolean;
  /** Last fraction flown and heading (the MIRV split happens where the carrier vanished). */
  f: number;
  angle: number;
  /** Seconds since first drawn (a warhead's release, ignition). */
  age: number;
}

/** A free piece of the effects: plume puff, flash, glow, fairing half, the empty bus. */
interface Bit {
  kind: 'puff' | 'flash' | 'hatch' | 'fairing' | 'bus' | 'ring';
  x: number;
  y: number;
  vx: number;
  vy: number;
  drag: number;
  grav: number;
  t: number;
  life: number;
  s0: number;
  s1: number;
  a0: number;
  rot: number;
  vr: number;
  tint: number;
  tex: number;
  /** Fairing: flipped half. Bus: owner ink. */
  flip: boolean;
  ink: number;
}

/** A sprite pool drawn in immediate mode: each frame takes what it needs, the rest hides. */
class Layer {
  readonly c = new Container();
  private sprites: Sprite[] = [];
  private n = 0;
  constructor(blend: 'add' | 'normal' = 'normal') {
    if (blend === 'add') this.c.blendMode = 'add';
  }
  begin(): void {
    this.n = 0;
  }
  take(tex: Texture): Sprite {
    let s = this.sprites[this.n];
    if (!s) {
      s = new Sprite(tex);
      this.sprites.push(s);
      this.c.addChild(s);
    }
    this.n++;
    s.texture = tex;
    s.visible = true;
    return s;
  }
  end(): void {
    for (let k = this.n; k < this.sprites.length; k++) this.sprites[k]!.visible = false;
    // Shrink the pool when a salvo is over (keeps a reserve).
    if (this.sprites.length > this.n + 600) {
      for (const s of this.sprites.splice(this.n + 300)) s.destroy();
    }
  }
  get count(): number {
    return this.n;
  }
}

interface ArtTex {
  base: Texture;
  mark: Texture;
  top: Texture;
}

export interface MissileFrame {
  zoom: number;
  bounds: [number, number, number, number];
  /** Seconds (real time, for the flicker), and the frame's duration. */
  t: number;
  dt: number;
  particles: number;
  reducedMotion: boolean;
  uiScale: number;
}

export class MissileFx {
  /** Under the units: the shadows on the ground. */
  readonly ground = new Container();
  /** High over the map: smoke, light, the missiles. */
  readonly air = new Container();
  private readonly shadows = new Layer();
  private readonly smoke = new Layer();
  private readonly glow = new Layer('add');
  private readonly bodies = new Layer();
  private readonly hot = new Layer('add');
  private art!: Record<Look, ArtTex>;
  private fairing!: Texture;
  private bus!: Texture;
  private tex!: {
    bloom: Texture;
    puff: Texture[];
    flame: Record<Spec['flame'], Texture>;
    streak: Texture;
    ring: Texture;
  };
  private flights = new Map<number, Flight>();
  private bits: Bit[] = [];
  private frame = 0;
  private fr: MissileFrame = {
    zoom: 1,
    bounds: [0, 0, 0, 0],
    t: 0,
    dt: 0,
    particles: 1,
    reducedMotion: false,
    uiScale: 1,
  };
  private puffs = 0;
  /** Recent launch sites (a salvo from one silo shares its plume). */
  private sites: { x: number; y: number; at: number; n: number }[] = [];

  async init(): Promise<void> {
    const raster = async (a: { w: number; h: number }, svg: string) =>
      svgTextureMip(svgDoc(a.w, a.h, svg), a.w * 4, a.h * 4);
    const art = async (a: MissileArt): Promise<ArtTex> => ({
      base: await raster(a, a.base),
      mark: await raster(a, a.mark),
      top: await raster(a, a.top),
    });
    this.art = {
      atom: await art(ATOM_ART),
      hydrogen: await art(HYDROGEN_ART),
      mirv: await art(MIRV_ART),
      warhead: await art(WARHEAD_ART),
      interceptor: await art(INTERCEPTOR_ART),
    };
    this.fairing = await raster(FAIRING_ART, FAIRING_ART.base);
    this.bus = await raster(BUS_ART, BUS_ART.base);
    this.tex = {
      bloom: makeTexture(64, bloomPx),
      puff: [0, 1, 2, 3].map((k) => makeTexture(64, (u, v) => puffPx(u, v, 57 + k * 23))),
      flame: {
        fire: makeTexture(128, flamePx(false, false)),
        diamond: makeTexture(128, flamePx(true, false)),
        ice: makeTexture(128, flamePx(false, true)),
      },
      streak: makeTexture(64, streakPx),
      ring: makeTexture(128, ringPx),
    };
    this.ground.addChild(this.shadows.c);
    this.air.addChild(this.smoke.c, this.glow.c, this.bodies.c, this.hot.c);
  }

  /** Missiles drawn last frame (QA, perf readouts). */
  get count(): number {
    return this.flights.size;
  }
  /** Smoke puffs drawn last frame. */
  get puffCount(): number {
    return this.puffs;
  }

  clear(): void {
    this.flights.clear();
    this.bits = [];
    this.sites = [];
  }

  begin(fr: MissileFrame): void {
    this.fr = fr;
    this.frame++;
    this.puffs = 0;
    for (const l of [this.shadows, this.smoke, this.glow, this.bodies, this.hot]) l.begin();
    this.updateBits();
  }

  /**
   * One missile, every frame: its simulated arc (`path`, from (sx, sy) to (tx, ty) between
   * ticks t0 and t1), the current tick, the owner's ink, and whether a SAM could still reach it.
   * `gx, gy`: a MIRV carrier's target (the ground under its separation point).
   */
  missile(
    id: number,
    type: number,
    kind: number,
    path: Trajectory,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    t0: number,
    t1: number,
    arc: number,
    gx: number,
    gy: number,
    tickF: number,
    ink: number,
  ): void {
    const fr = this.fr;
    let fl = this.flights.get(id);
    if (!fl) {
      const look = lookOf(type, kind);
      fl = {
        id,
        look,
        spec: SPECS[look],
        path,
        sx,
        sy,
        tx,
        ty,
        t0,
        t1,
        arc,
        gx,
        gy,
        seed: hash1(id),
        seen: 0,
        // Already well on its way when first seen (a resync, a replay): no launch.
        launched: tickF - t0 > 4,
        f: 0,
        angle: Math.atan2(ty - sy, tx - sx),
        age: 0,
      };
      this.flights.set(id, fl);
    }
    fl.seen = this.frame;
    fl.path = path;
    const spec = fl.spec;
    const look = fl.look;
    const z = fr.zoom;
    const f = clamp01((tickF - t0) / Math.max(1, t1 - t0));
    // Waiting in its tube (a salvo leaves one tube after the other) or a warhead not yet
    // released: the hatch glows, nothing flies.
    if (tickF < t0) {
      if (look !== 'warhead') this.hatch(sx, sy, spec, 0.55 + 0.25 * Math.sin(fr.t * 9));
      return;
    }
    fl.age += fr.dt;
    if (!fl.launched) {
      fl.launched = true;
      if (look !== 'warhead') this.launch(fl);
    }
    const tau = (tickF - t0) / 10; // game seconds since launch
    const [hx, hy] = path.at(f);
    const e = 0.004;
    const [ax, ay] = path.at(Math.max(0, f - e));
    const [bx, by] = path.at(Math.min(1, f + e));
    const angle = Math.abs(bx - ax) + Math.abs(by - ay) > 1e-6 ? Math.atan2(by - ay, bx - ax) : fl.angle;
    fl.f = f;
    fl.angle = angle;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);

    // Size: the map's scale, within the on-screen bounds.
    const px = Math.max(spec.minPx * fr.uiScale, Math.min(spec.maxPx, spec.len * z));
    const L = px / z; // body length in tiles
    const ls = L / spec.len;
    const hn = this.height(fl, f);
    const rise = smooth(0, 0.5, tau);
    const born = look === 'warhead' ? smooth(0, 0.25, fl.age) : 1;
    const scale = L * (0.5 + 0.5 * rise) * (1 + 0.16 * hn) * (0.45 + 0.55 * born);
    const art = spec.art;
    const k = scale / art.w; // tiles per art unit
    const [x0, y0, x1, y1] = fr.bounds;
    const m = L * 3;
    const inView = hx > x0 - m && hx < x1 + m && hy > y0 - m && hy < y1 + m;
    const thrust = this.thrust(fl, f);
    const reach =
      look === 'interceptor' ||
      (hx - sx) ** 2 + (hy - sy) ** 2 <= NUKE_TARGETABLE_RANGE ** 2 ||
      (hx - tx) ** 2 + (hy - ty) ** 2 <= NUKE_TARGETABLE_RANGE ** 2;
    const flick = fr.reducedMotion ? 1 : flicker(fr.t, fl.seed);
    // Ignition: the flame bursts out, then settles.
    const ign = 1 + 0.9 * (1 - smooth(0, 0.4, tau));

    // ---- contrail and streak (behind everything of this missile)
    this.trail(fl, f, L, ls);
    if (!inView) return;

    // ---- shadow on the ground
    if (look !== 'interceptor') this.shadow(fl, f, hx, hy, hn, scale, angle);

    // ---- engine
    // Art centre → nozzle (art units from the centre to the tail along the axis).
    const tailOff = (art.tail - art.w / 2) * k;
    const nx = hx + ca * tailOff;
    const ny = hy + sa * tailOff;
    if (thrust > 0.01 && spec.flameLen > 0) {
      const ftex = this.tex.flame[spec.flame];
      const fl0 = L * spec.flameLen * thrust * flick * (0.4 + 0.6 * rise);
      const fw = L * spec.flameW * (0.75 + 0.25 * thrust) * (1 + 0.6 * (ign - 1));
      for (const off of art.nozzles) {
        const ox = -sa * off * k;
        const oy = ca * off * k;
        const s = this.glow.take(ftex);
        s.anchor.set(0.94, 0.5);
        s.position.set(nx + ox, ny + oy);
        s.rotation = angle;
        s.scale.set(fl0 / ftex.width / 0.94, fw / ftex.height);
        s.tint = 0xffffff;
        s.alpha = Math.min(1, 0.85 + 0.15 * flick) * (reach ? 1 : 0.8);
      }
      // Light thrown around the nozzle.
      const g = this.glow.take(this.tex.bloom);
      g.anchor.set(0.5);
      g.position.set(nx - ca * L * 0.2, ny - sa * L * 0.2);
      g.rotation = 0;
      const gr = L * (0.45 + 0.2 * thrust) * ign * (reach ? 1 : 0.8);
      g.scale.set((gr * 2) / this.tex.bloom.width);
      g.tint = look === 'interceptor' ? AURORA : 0xffb060;
      g.alpha = (reach ? 0.42 : 0.24) * thrust * flick;
    }

    // ---- body: base, owner's mark, ink
    const t = this.art[look];
    const tint = look === 'interceptor' ? AURORA : ink;
    const layers: [Texture, number][] = [
      [t.base, 0xffffff],
      [t.mark, tint],
      [t.top, 0xffffff],
    ];
    for (const [tex, c] of layers) {
      const s = this.bodies.take(tex);
      s.anchor.set(0.5);
      s.position.set(hx, hy);
      s.rotation = angle;
      s.scale.set(scale / tex.width);
      s.tint = c;
      s.alpha = born;
    }

    // ---- re-entry: the nose glows as the missile comes down
    const heat =
      look === 'warhead'
        ? 0.35 + 0.65 * smooth(0.1, 0.85, f)
        : look === 'atom' || look === 'hydrogen'
          ? smooth(0.62, 0.97, f)
          : 0;
    if (heat > 0.02) {
      const noseOff = (art.nose - art.w / 2) * k;
      const g = this.hot.take(this.tex.bloom);
      g.anchor.set(0.5);
      g.position.set(hx + ca * noseOff * 0.85, hy + sa * noseOff * 0.85);
      g.rotation = 0;
      const r = L * (look === 'warhead' ? 0.75 : 0.32) * (0.8 + 0.2 * flick);
      g.scale.set((r * 2) / this.tex.bloom.width);
      g.tint = lerpColor(0xff7a2a, 0xffe2b0, heat * 0.6);
      g.alpha = heat * (look === 'warhead' ? 0.85 : 0.7) * born;
    }
  }

  /** Missiles not drawn this frame are gone: a MIRV carrier that reached its separation point splits. */
  end(): void {
    for (const [id, fl] of this.flights) {
      if (fl.seen === this.frame) continue;
      this.flights.delete(id);
      if (fl.look === 'mirv' && fl.f > 0.85) this.split(fl);
    }
    this.drawBits();
    for (const l of [this.shadows, this.smoke, this.glow, this.bodies, this.hot]) l.end();
  }

  // ------------------------------------------------------------ flight model

  /** Height for the eye, 0…1 (it never changes the simulated path). */
  private height(fl: Flight, f: number): number {
    switch (fl.look) {
      case 'mirv':
        return 1 - (1 - f) * (1 - f);
      case 'warhead':
        return 1 - f;
      case 'interceptor':
        return 0;
      default:
        return 4 * f * (1 - f);
    }
  }

  /** Engine power along the flight: boost, then a weaker sustainer as it comes down. */
  private thrust(fl: Flight, f: number): number {
    switch (fl.look) {
      case 'warhead':
        return 0;
      case 'mirv':
      case 'interceptor':
        return 1;
      default:
        return 1 - 0.55 * smooth(0.45, 0.8, f);
    }
  }

  /** The point of the ground under the missile at fraction f. */
  private groundAt(fl: Flight, f: number): [number, number] {
    switch (fl.look) {
      case 'mirv':
        return [fl.sx + (fl.gx - fl.sx) * f, fl.sy + (fl.gy - fl.sy) * f];
      case 'warhead': {
        // Released high above the target country: the shadow starts under the release
        // point, level with the target, and runs to it.
        const gy0 = Math.max(fl.sy, fl.ty);
        return [fl.sx + (fl.tx - fl.sx) * f, gy0 + (fl.ty - gy0) * f];
      }
      default: {
        if (fl.arc === ARC_UP)
          // Bowed towards the top of the map: the bow is the height, the chord the ground.
          return [fl.sx + (fl.tx - fl.sx) * f, fl.sy + (fl.ty - fl.sy) * f];
        // Bowed down (or straight): the shadow falls south of the missile.
        const [x, y] = fl.path.at(f);
        const H = Math.max(8, Math.min(60, fl.path.length * 0.14)) * 4 * f * (1 - f);
        return [x + SUN_X * H, y + SUN_Y * H];
      }
    }
  }

  private shadow(
    fl: Flight,
    f: number,
    hx: number,
    hy: number,
    hn: number,
    scale: number,
    angle: number,
  ): void {
    const [gx, gy] = this.groundAt(fl, f);
    const [x0, y0, x1, y1] = this.fr.bounds;
    if (gx < x0 - scale || gx > x1 + scale || gy < y0 - scale || gy > y1 + scale) return;
    // Along the ground track (straight down: keep the missile's heading).
    const e = 0.01;
    const [ax, ay] = this.groundAt(fl, Math.max(0, f - e));
    const [bx, by] = this.groundAt(fl, Math.min(1, f + e));
    const ga = Math.hypot(bx - ax, by - ay) > 1e-4 ? Math.atan2(by - ay, bx - ax) : angle;
    const far = Math.hypot(gx - hx, gy - hy);
    const a = (fl.look === 'warhead' ? 0.2 : 0.3) * (1 - 0.55 * hn);
    const blob = this.shadows.take(this.tex.bloom);
    blob.anchor.set(0.5);
    blob.position.set(gx, gy);
    blob.rotation = ga;
    blob.scale.set(
      (scale * (1.05 + 0.6 * hn)) / this.tex.bloom.width,
      (scale * (0.42 + 0.3 * hn)) / this.tex.bloom.width,
    );
    blob.tint = 0x000000;
    blob.alpha = a * 0.75;
    // The silhouette, sharp near the ground, faint high up (and only once apart from the body).
    if (far > scale * 0.2) {
      const t = this.art[fl.look].base;
      const s = this.shadows.take(t);
      s.anchor.set(0.5);
      s.position.set(gx, gy);
      s.rotation = ga;
      s.scale.set((scale * (0.95 + 0.1 * hn)) / t.width);
      s.tint = 0x05080b;
      s.alpha = a * (1 - 0.6 * hn) * smooth(0.2, 1.2, far / scale);
    }
  }

  /** Contrail: smoke puffs pinned along the arc behind the missile, ageing where they were left. */
  private trail(fl: Flight, f: number, L: number, ls: number): void {
    const fr = this.fr;
    const spec = fl.spec;
    const len = Math.max(1, fl.path.length);
    const [x0, y0, x1, y1] = fr.bounds;
    const rm = fr.reducedMotion;
    const P = fr.particles;
    // The hot exhaust right behind the nozzle (and the whole trace when smoke is off).
    const streakTiles = spec.trail === 0 ? L * 7 : P <= 0 ? L * 8 : L * 0.9;
    const back = Math.min(f, streakTiles / len);
    if (back > 1e-4) {
      const tint = fl.look === 'warhead' ? 0xffb782 : fl.look === 'interceptor' ? AURORA : HOT;
      const pieces = fl.look === 'warhead' ? 2 : 3;
      let [px, py] = fl.path.at(f);
      for (let k = 1; k <= pieces; k++) {
        const [qx, qy] = fl.path.at(f - (back * k) / pieces);
        const d = Math.hypot(px - qx, py - qy);
        if (
          d > 1e-3 &&
          !(Math.max(px, qx) < x0 || Math.min(px, qx) > x1 || Math.max(py, qy) < y0 || Math.min(py, qy) > y1)
        ) {
          const s = this.glow.take(this.tex.streak);
          s.anchor.set(1, 0.5);
          s.position.set(px, py);
          s.rotation = Math.atan2(py - qy, px - qx);
          const w = L * (fl.look === 'warhead' ? 0.3 : 0.18) * (1 - (k - 1) / (pieces + 0.5));
          s.scale.set(d / this.tex.streak.width, w / this.tex.streak.height);
          s.tint = tint;
          s.alpha =
            (fl.look === 'warhead' ? 0.85 : 0.4) *
            (1 - (k - 1) / pieces) *
            (P <= 0 && spec.trail > 0 ? 0.7 : 1);
        }
        px = qx;
        py = qy;
      }
    }
    if (spec.trail === 0 || P <= 0 || this.puffs >= PUFF_BUDGET) return;
    const T = Math.max(0.1, (fl.t1 - fl.t0) / 10); // flight time, game seconds
    const life = TRAIL_LIFE * (0.55 + 0.45 * P);
    // Puffs sit on a fixed grid along the path (nested when the zoom changes: no sliding).
    const q = Math.pow(2, Math.ceil(Math.log2(Math.max(1, ls))));
    const reachF = Math.min(1, life / T);
    let ds = Math.max(spec.trail * 0.42 * q, len / 260, (reachF * len) / 220);
    ds /= 0.6 + 0.4 * P;
    const df = ds / len;
    const kHead = Math.floor(f / df);
    const kTail = Math.max(0, Math.ceil((f - life / T) / df));
    const W = spec.trail * ls;
    for (let k = kHead; k >= kTail && this.puffs < PUFF_BUDGET; k--) {
      const fk = k * df;
      const age = (f - fk) * T;
      if (age <= 0 || age >= life) continue;
      const u = age / life;
      const h = hash2(k, fl.seed);
      const h2 = hash2(k + 7919, fl.seed);
      const [bx, by] = fl.path.at(fk);
      const drift = rm ? 0 : age * ls;
      const spread = W * 0.9 * Math.sqrt(u);
      const x = bx + WIND_X * drift + (h - 0.5) * spread;
      const y = by + WIND_Y * drift + (h2 - 0.5) * spread;
      const thr = this.thrust(fl, fk);
      // Thick at the base (the missile still slow), thinning as it climbs and speeds up.
      const base = 1 + 1.3 * (1 - smooth(0, 0.06, fk));
      const size =
        Math.max(W * (0.5 + 1.9 * Math.sqrt(u)), ds * (1.5 + 1.2 * Math.sqrt(u))) *
        (0.55 + 0.45 * thr) *
        base *
        (0.85 + 0.3 * h);
      if (x + size < x0 || x - size > x1 || y + size < y0 || y - size > y1) continue;
      const tex = this.tex.puff[(h * 4) | 0]!;
      const s = this.smoke.take(tex);
      s.anchor.set(0.5);
      s.position.set(x, y);
      s.rotation = h2 * 6.283 + (rm ? 0 : age * 0.3);
      s.scale.set(size / tex.width);
      s.tint = age < 0.35 ? lerpColor(0xffe0b0, SMOKE, age / 0.35) : lerpColor(SMOKE, SMOKE_OLD, u);
      s.alpha = 0.66 * Math.pow(1 - u, 1.35) * (0.35 + 0.65 * thr) * Math.min(1, age / 0.09);
      this.puffs++;
    }
  }

  // ------------------------------------------------------------ launch & split

  private hatch(x: number, y: number, spec: Spec, a: number): void {
    const fr = this.fr;
    const px = Math.max(spec.minPx * fr.uiScale, Math.min(spec.maxPx, spec.len * fr.zoom));
    const L = px / fr.zoom;
    const g = this.glow.take(this.tex.bloom);
    g.anchor.set(0.5);
    g.position.set(x, y);
    g.rotation = 0;
    g.scale.set((L * 0.7) / this.tex.bloom.width);
    g.tint = 0xff8c3a;
    g.alpha = a;
  }

  private launch(fl: Flight): void {
    const fr = this.fr;
    const spec = fl.spec;
    if (spec.plume <= 0) return;
    const px = Math.max(spec.minPx * fr.uiScale, Math.min(spec.maxPx, spec.len * fr.zoom));
    const ls = px / fr.zoom / spec.len;
    // Ground smoke grows with the missile's minimum size, but less (no cloud over a region).
    const S = spec.plume * damp(ls);
    const { sx: x, sy: y } = fl;
    const now = fr.t;
    this.sites = this.sites.filter((s) => now - s.at < 1.5);
    const site = this.sites.find((s) => Math.abs(s.x - x) < 1 && Math.abs(s.y - y) < 1);
    // A salvo from the same silo: one plume that grows, not ten stacked flashes.
    const extra = site ? Math.min(1, 3 / (site.n + 2)) : 1;
    if (site) site.n++;
    else this.sites.push({ x, y, at: now, n: 1 });
    const rm = fr.reducedMotion;
    const add = (b: Partial<Bit> & Pick<Bit, 'kind' | 'life' | 's0' | 's1' | 'a0'>) =>
      this.bits.push({
        x,
        y,
        vx: 0,
        vy: 0,
        drag: 0,
        grav: 0,
        t: 0,
        rot: 0,
        vr: 0,
        tint: 0xffffff,
        tex: 0,
        flip: false,
        ink: 0,
        ...b,
      });
    if (!site) {
      // Hatch glow (fades over two seconds) and the ignition flash.
      add({ kind: 'hatch', life: 2.4, s0: 2.6 * S, s1: 3.2 * S, a0: 0.95, tint: 0xff8a3a });
      add({
        kind: 'flash',
        life: rm ? 0.8 : 0.42,
        s0: 4 * S,
        s1: 13 * S,
        a0: rm ? 0.35 : 0.9,
        tint: 0xfff1d6,
      });
    }
    const P = fr.particles;
    if (P <= 0) return;
    // The exhaust plume: billows rolling out along the ground, lit by the flame at first.
    const n = Math.max(3, Math.round(16 * P * extra * Math.min(1.6, spec.plume)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.6;
      const v = (2.2 + Math.random() * 4.2) * S * (rm ? 0.4 : 1);
      add({
        kind: 'puff',
        x: x + Math.cos(a) * 0.6 * S,
        y: y + Math.sin(a) * 0.45 * S,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.62,
        drag: 0.9,
        life: 6 + Math.random() * 3.5,
        s0: (1.6 + Math.random()) * S,
        s1: (4.6 + Math.random() * 2) * S,
        a0: 0.52 + Math.random() * 0.14,
        rot: Math.random() * 6.283,
        vr: rm ? 0 : (Math.random() - 0.5) * 0.25,
        tint: SMOKE,
        tex: (Math.random() * 4) | 0,
      });
    }
    // A short column over the hatch, where the missile cleared it.
    const col = Math.max(1, Math.round(4 * P * extra));
    const [ex, ey] = fl.path.at(Math.min(1, 6 / Math.max(1, fl.path.length)));
    for (let k = 0; k < col; k++) {
      const f = (k + 0.5) / col;
      add({
        kind: 'puff',
        x: x + (ex - x) * f,
        y: y + (ey - y) * f,
        vx: (Math.random() - 0.5) * S,
        vy: (Math.random() - 0.5) * S,
        drag: 0.6,
        life: 4.5 + Math.random() * 2,
        s0: (2 + Math.random()) * S,
        s1: (4.5 + Math.random() * 1.5) * S,
        a0: 0.55,
        rot: Math.random() * 6.283,
        vr: rm ? 0 : (Math.random() - 0.5) * 0.3,
        tint: SMOKE,
        tex: (Math.random() * 4) | 0,
      });
    }
  }

  /** The MIRV separates: flash, fairing halves tumbling away, the empty bus, a smoke ring. */
  private split(fl: Flight): void {
    const fr = this.fr;
    const spec = fl.spec;
    const px = Math.max(spec.minPx * fr.uiScale, Math.min(spec.maxPx, spec.len * fr.zoom));
    const L = px / fr.zoom;
    const ls = L / spec.len;
    const S = damp(ls);
    const [x, y] = [fl.tx, fl.ty];
    const ca = Math.cos(fl.angle);
    const sa = Math.sin(fl.angle);
    const rm = fr.reducedMotion;
    const base: Bit = {
      kind: 'puff',
      x,
      y,
      vx: 0,
      vy: 0,
      drag: 0,
      grav: 0,
      t: 0,
      life: 1,
      s0: 1,
      s1: 1,
      a0: 1,
      rot: 0,
      vr: 0,
      tint: 0xffffff,
      tex: 0,
      flip: false,
      ink: 0,
    };
    this.bits.push({
      ...base,
      kind: 'flash',
      life: rm ? 1.1 : 0.8,
      s0: 6 * S,
      s1: 18 * S,
      a0: rm ? 0.35 : 0.85,
      tint: 0xfff4dc,
    });
    this.bits.push({
      ...base,
      kind: 'ring',
      life: 1.3,
      s0: 2 * S,
      s1: 16 * S,
      a0: rm ? 0.3 : 0.75,
      tint: 0xffe6c0,
    });
    // The bus's engine light, lingering where the warheads leave it.
    this.bits.push({ ...base, kind: 'hatch', life: 1.8, s0: 3 * S, s1: 3.6 * S, a0: 0.7, tint: 0xffc070 });
    // The fairing's two halves, thrown sideways, tumbling, falling behind.
    for (const side of [-1, 1]) {
      const v = (rm ? 1.5 : 5) * S;
      this.bits.push({
        ...base,
        kind: 'fairing',
        x: x - sa * side * L * 0.15,
        y: y + ca * side * L * 0.15,
        vx: -sa * side * v + ca * v * 0.5,
        vy: ca * side * v + sa * v * 0.5,
        drag: 0.5,
        grav: rm ? 0 : 3.2 * S,
        life: 2.8,
        s0: L * 0.42,
        s1: L * 0.4,
        a0: 1,
        rot: fl.angle,
        vr: rm ? 0 : side * 2.6,
        flip: side > 0,
      });
    }
    // The bus drifts on a moment, empty.
    this.bits.push({
      ...base,
      kind: 'bus',
      vx: ca * 3 * S,
      vy: sa * 3 * S,
      drag: 0.3,
      life: 2.2,
      s0: L * 0.42,
      s1: L * 0.42,
      a0: 1,
      rot: fl.angle,
    });
    const P = fr.particles;
    if (P <= 0) return;
    const n = Math.max(4, Math.round(12 * P));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.4;
      const v = (2.5 + Math.random() * 2.5) * S * (rm ? 0.4 : 1);
      this.bits.push({
        ...base,
        x: x + Math.cos(a) * S,
        y: y + Math.sin(a) * S,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        drag: 1,
        life: 4 + Math.random() * 2,
        s0: 1.6 * S,
        s1: (4.4 + Math.random() * 1.6) * S,
        a0: 0.5,
        rot: Math.random() * 6.283,
        vr: rm ? 0 : (Math.random() - 0.5) * 0.3,
        tint: SMOKE,
        tex: (Math.random() * 4) | 0,
      });
    }
  }

  private updateBits(): void {
    const dt = this.fr.dt;
    const keep: Bit[] = [];
    for (const b of this.bits) {
      b.t += dt;
      if (b.t >= b.life) continue;
      const d = Math.exp(-b.drag * dt);
      b.vx *= d;
      b.vy = b.vy * d + b.grav * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      keep.push(b);
    }
    this.bits = keep;
  }

  private drawBits(): void {
    const [x0, y0, x1, y1] = this.fr.bounds;
    for (const b of this.bits) {
      const u = b.t / b.life;
      const size = b.s0 + (b.s1 - b.s0) * (b.kind === 'puff' ? Math.sqrt(u) : u);
      if (b.x + size < x0 || b.x - size > x1 || b.y + size < y0 || b.y - size > y1) continue;
      let s: Sprite;
      let tex: Texture;
      switch (b.kind) {
        case 'puff': {
          if (this.puffs >= PUFF_BUDGET) continue;
          this.puffs++;
          tex = this.tex.puff[b.tex]!;
          s = this.smoke.take(tex);
          // Lit by the flame at first, then grey; full for a while, then gone.
          s.tint = b.t < 0.6 ? lerpColor(0xffd2a0, b.tint, b.t / 0.6) : lerpColor(b.tint, SMOKE_OLD, u);
          s.alpha = b.a0 * Math.min(1, b.t / 0.12) * (1 - smooth(0.35, 1, u));
          s.scale.set(size / tex.width, (size * 0.86) / tex.width);
          break;
        }
        case 'flash':
        case 'hatch':
        case 'ring': {
          tex = b.kind === 'ring' ? this.tex.ring : this.tex.bloom;
          s = this.glow.take(tex);
          s.tint = b.kind === 'flash' ? lerpColor(b.tint, 0xffb070, u) : b.tint;
          s.alpha =
            b.kind === 'flash'
              ? b.a0 * Math.pow(1 - u, 2)
              : b.kind === 'ring'
                ? b.a0 * Math.pow(1 - u, 1.5) * Math.min(1, b.t / 0.05)
                : b.a0 * (1 - smooth(0.25, 1, u)) * (0.85 + 0.15 * Math.sin(b.t * 14));
          s.scale.set((size / tex.width) * 2);
          break;
        }
        case 'fairing':
        case 'bus': {
          tex = b.kind === 'bus' ? this.bus : this.fairing;
          s = this.bodies.take(tex);
          s.alpha = b.a0 * (1 - smooth(0.55, 1, u));
          s.tint = 0xffffff;
          s.scale.set(size / tex.width, ((b.flip ? -1 : 1) * size) / tex.width);
          if (b.kind === 'bus' && u < 0.75) {
            // Its thrusters still puff while it backs away.
            const g = this.glow.take(this.tex.bloom);
            g.anchor.set(0.5);
            g.position.set(b.x - Math.cos(b.rot) * size * 0.45, b.y - Math.sin(b.rot) * size * 0.45);
            g.rotation = 0;
            g.scale.set((size * 0.8) / this.tex.bloom.width);
            g.tint = 0xffb060;
            g.alpha = 0.5 * (1 - u / 0.75) * (this.fr.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(b.t * 31));
          }
          break;
        }
      }
      s.anchor.set(0.5);
      s.position.set(b.x, b.y);
      s.rotation = b.rot;
    }
  }
}

// ------------------------------------------------------------------ helpers

function hash1(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash2(k: number, seed: number): number {
  return hash1(k * 7349 + Math.floor(seed * 1e6));
}

/** Engine flicker: a few incommensurate sines (no strobing). */
function flicker(t: number, seed: number): number {
  const p = seed * 50;
  return (
    1 + 0.1 * Math.sin(t * 31 + p) + 0.07 * Math.sin(t * 53.7 + p * 2.1) + 0.05 * Math.sin(t * 89.3 + p * 0.7)
  );
}

/**
 * Engine flame, pointing left from the nozzle (u ≈ 0.88): a white core, yellow, then orange
 * edges (`ice`: the interceptors' bluish flame); `diamonds`: shock diamonds along the core.
 */
function flamePx(diamonds: boolean, ice: boolean): Px {
  return (u, v) => {
    const t = (0.88 - u) / 1.86; // 0 at the nozzle, 1 at the tip
    if (t < -0.02 || t > 1) return [0, 0, 0, 0];
    const tt = Math.max(0, t);
    const r = 0.55 * Math.pow(tt + 0.04, 0.35) * Math.pow(1 - tt, 0.9);
    const av = Math.abs(v);
    if (av >= r) return [0, 0, 0, 0];
    const n = fbm(u * 5 + 3, v * 5, 17, 3);
    const q = av / r;
    const edge = smooth(1, 0.55 + (n - 0.5) * 0.3, q);
    let core = Math.exp(-q * q * 5) * Math.pow(1 - tt, 1.4);
    if (diamonds) core *= 0.75 + 0.5 * Math.pow(Math.max(0, Math.cos(tt * Math.PI * 9)), 6) * (1 - tt);
    const a = edge * Math.pow(1 - tt, 0.8) * (0.55 + 0.45 * n) + core * 0.6;
    const hot = Math.min(1, core * 1.4);
    const [r0, g0, b0] = ice ? [120, 200, 255] : [255, 120, 40];
    const [r1, g1, b1] = ice ? [215, 245, 255] : [255, 214, 120];
    const m = clamp01(1 - q * 0.9 - tt * 0.5);
    const rr = r0 + (r1 - r0) * m;
    const gg = g0 + (g1 - g0) * m;
    const bb = b0 + (b1 - b0) * m;
    return [rr + (255 - rr) * hot, gg + (255 - gg) * hot, bb + (250 - bb) * hot, clamp01(a)];
  };
}

/** Damped growth of the ground smoke with the missile's on-screen minimum. */
function damp(ls: number): number {
  return ls <= 1 ? ls : 1 + (ls - 1) * 0.4;
}

/** A thin bright ring (the separation's shock), soft inside. */
function ringPx(u: number, v: number): [number, number, number, number] {
  const r = Math.hypot(u, v);
  if (r >= 1) return [255, 255, 255, 0];
  return [255, 255, 255, Math.exp(-(((r - 0.9) / 0.05) ** 2)) + 0.12 * smooth(0.9, 0.4, r)];
}

/** A streak of light: transparent at the left, bright at the right, soft across. */
function streakPx(u: number, v: number): [number, number, number, number] {
  const along = clamp01((u + 1) / 2);
  const across = Math.exp(-v * v * 9);
  return [255, 255, 255, Math.pow(along, 1.6) * across];
}
