// Ships on the map: troop transports, warships and merchants drawn from one family of
// top-down sprites (see shipArt.ts), plus the warships' shells. Rendering only: the
// simulation's positions are read from the unit buffer, everything else (heading, speed,
// turret aim, muzzle flashes, impacts) is inferred frame to frame without allocating.
import { BitmapText, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { IconSet, ShipTextures } from './icons';
import type { ParticleSystem } from './particles';
import { U } from '../core/units/unit';
import { SHIP_H, SHIP_RASTER, SHIP_W, TURRET_PIVOT_X, WAKE_H, WAKE_W } from './shipArt';

/**
 * Hull length of each ship type: [map tiles, least on-screen px]. 1.11.0: ships keep their
 * size on the map, like the territory (they used to keep 20–34 px on screen, so they grew
 * against the coasts when zooming out); the small minimum keeps a far ship a visible dot.
 */
const SHIP_SIZE: Record<number, readonly [number, number]> = {
  [U.Transport]: [4.5, 8],
  [U.Warship]: [5.5, 9],
  [U.Merchant]: [3.5, 6],
};

/** Hull length (px) of a ship at zoom `z`: its length on the map, never under a few pixels. */
export function shipPx(type: number, z: number, ui = 1): number {
  const [tiles, least] = SHIP_SIZE[type] ?? SHIP_SIZE[U.Transport]!;
  return Math.max(least * ui, tiles * z);
}

/** Warship `kind` values (the sim's WS enum, mirrored for the view). */
const WS_DOCKED = 2;
/** Warships smoke and limp home under half health (OpenFront's repair retreat). */
const SMOKE_HP = 0.5;
/** Turret training speed (rad/s) and how long a turret holds its aim after a shot (s). */
const TURRET_SPEED = 4.5;
const AIM_HOLD = 3.5;
const FLASH_TIME = 0.14;
/** A shell first seen this close to a warship of its owner (tiles) was fired by it. */
const SHOOTER_RANGE = 6;
const TAU = Math.PI * 2;
const wrap = (a: number) => a - TAU * Math.round(a / TAU);

/**
 * A ship sunk (shells, a fighter, a nuke, its country gone): a small explosion (flash,
 * sparks, smoke, debris), then the hull lists onto its side, settles and darkens into the
 * water among bubbles and a spreading oil slick (SINK_TIME s). Ships that leave the map in
 * any other way (landing, arrival, a recalled transport) just go.
 */
const SINK_TIME = 3.6;
/** With reduced motion: no list nor drift, a short fade. */
const SINK_TIME_STILL = 1.2;
/** Ships going under at once at most: the others only explode (a whole fleet nuked). */
const MAX_WRECKS = 40;
/** How long a sinking reported by the simulation waits for its ship to leave the buffer (s). */
const DOOM_TIME = 2;
/** Sea water: what a hull darkens to as it goes under. */
const SEA = 0x2c4756;

/** A ship going under: its own sprites, kept after it left the unit buffer. */
interface Wreck {
  root: Container;
  type: number;
  x: number;
  y: number;
  heading: number;
  /** The side it lists to (±1). */
  roll: number;
  t: number;
  dur: number;
  bubbleT: number;
  smokeT: number;
  oil: boolean;
}

/** A sinking reported by the simulation: where, within how many tiles. */
export interface Doom {
  x: number;
  y: number;
  r: number;
}

/**
 * Did a ship last drawn at (x, y) leave the unit buffer sunk? Yes under a reported sinking
 * (a ship hit, a nuclear blast's fallout; a tile and a half of slack for the frame's
 * interpolation), or when its country is gone (an abandoned fleet sinks); no otherwise (it
 * landed its troops, reached its port, was recalled).
 */
export function sunkAt(dooms: readonly Doom[], x: number, y: number, ownerAlive: boolean): boolean {
  if (!ownerAlive) return true;
  for (const d of dooms) {
    const r = d.r + 2.5;
    if ((x - d.x) ** 2 + (y - d.y) ** 2 <= r * r) return true;
  }
  return false;
}

/** `k` in 0..1 eased in and out. */
const smooth = (k: number) => k * k * (3 - 2 * k);
/** Colour `a` blended towards `b` by `k`. */
function mixColor(a: number, b: number, k: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** A ship's sprites, made the first time it is on screen. */
interface ShipGfx {
  /** Rotated to the heading: wake, owner mark, hull, turrets. */
  root: Container;
  wake: Sprite;
  mark: Sprite;
  turrets: Sprite[];
  flashes: Sprite[];
}

interface ShipView {
  type: number;
  owner: number;
  gfx: ShipGfx | null;
  /** Unrotated badges and label over the hull (created when first needed). */
  extras: Container | null;
  badges: Container | null;
  label: BitmapText | null;
  labelText: string;
  badgeKey: number;
  x: number;
  y: number;
  heading: number;
  headingSet: boolean;
  speed: number;
  aim: number;
  aimHold: number;
  flashT: number;
  flashIdx: number;
  smokeT: number;
  foamT: number;
  seen: number;
}

interface ShellView {
  x: number;
  y: number;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
  shooter: number;
  seen: number;
  /** Drawn last frame (in view and not hidden by the fog of war). */
  shown: boolean;
}

export interface ShipDeps {
  inkOf(id: number): number;
  particles(): number;
  uiScale(): number;
  formatTroops(v: number): string;
  reducedMotion(): boolean;
  /** Is this country still in the game (an abandoned fleet sinks)? */
  alive(id: number): boolean;
}

export class ShipLayer {
  /** Hulls (normal blending), drawn with the other units: a render group of its own, so the
   * hundreds of hulls are not walked again whenever something else on the map changes. */
  readonly container = new Container({ isRenderGroup: true });
  /** Health bars and selection rings over the hulls. */
  readonly fx = new Graphics();
  private views = new Map<number, ShipView>();
  private shells = new Map<number, ShellView>();
  private shellPool: ShellView[] = [];
  private frame = 0;
  private z = 1;
  private dt = 0;
  /** Seconds since the layer was made (the dooms' clock). */
  private clock = 0;
  private wrecks: Wreck[] = [];
  /** QA: ships sunk on screen while the simulation still has them (qaSink): not drawn again. */
  private qaGone = new Set<number>();
  /** Sinkings reported by the simulation (shipSunk, a nuclear blast), until their ship goes. */
  private dooms: { x: number; y: number; r: number; t: number }[] = [];

  constructor(
    private readonly icons: IconSet,
    private readonly particles: ParticleSystem,
    private readonly deps: ShipDeps,
  ) {}

  private textures(type: number): ShipTextures {
    return type === U.Warship
      ? this.icons.ships.warship
      : type === U.Merchant
        ? this.icons.ships.merchant
        : this.icons.ships.transport;
  }

  begin(frame: number, z: number, dt: number): void {
    this.frame = frame;
    this.z = z;
    this.dt = Math.min(0.1, dt);
    this.clock += this.dt;
    this.fx.clear();
  }

  /** Ships going under now. */
  get wreckCount(): number {
    return this.wrecks.length;
  }

  /**
   * The simulation sank something at (x, y) within `r` tiles (a ship hit, a nuclear blast):
   * a ship of ours that leaves the buffer there goes under instead of just vanishing.
   */
  doom(x: number, y: number, r: number): void {
    this.dooms.push({ x, y, r, t: this.clock });
  }

  /** QA: sinks these ships now, render only (none given: every ship in view). */
  qaSink(ids?: number[]): number {
    let n = 0;
    for (const [id, v] of this.views) {
      if (ids ? !ids.includes(id) : !v.gfx?.root.visible) continue;
      if (!v.gfx?.root.visible) continue;
      this.views.delete(id);
      this.qaGone.add(id);
      this.sink(v);
      n++;
    }
    return n;
  }

  /**
   * The sprites are made when the ship first comes into view: ships sailing (and spawning,
   * and sinking) off screen never touch the scene graph.
   */
  private build(v: ShipView): ShipGfx {
    const tex = this.textures(v.type);
    const root = new Container();
    const k = 1 / SHIP_RASTER;
    const sprite = (t: Texture, ax = 0.5, ay = 0.5) => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay);
      s.scale.set(k);
      return s;
    };
    // Origin = canvas centre; the wake's apex sits at the stern. The owner's colour goes
    // under the hull layer, which is open over the deck.
    const wake = sprite(this.icons.wake, 1, 0.5);
    wake.position.set(tex.stern - SHIP_W / 2 + 3, 0);
    wake.visible = false;
    const mark = sprite(tex.mark);
    const hull = sprite(tex.hull);
    root.addChild(wake, mark, hull);
    const turrets: Sprite[] = [];
    const flashes: Sprite[] = [];
    tex.turrets.forEach((tx, i) => {
      const tur = sprite(this.icons.turret, TURRET_PIVOT_X / 32, 0.5);
      tur.position.set(tx - SHIP_W / 2, 0);
      tur.rotation = i === 0 ? 0 : Math.PI;
      // The flash sits at the muzzles, in the turret's texture pixels.
      const fl = new Sprite(this.icons.flash);
      fl.anchor.set(2 / 32, 0.5);
      fl.position.set((26 - TURRET_PIVOT_X) * SHIP_RASTER, 0);
      fl.tint = 0xffd27a;
      fl.blendMode = 'add';
      fl.visible = false;
      tur.addChild(fl);
      root.addChild(tur);
      turrets.push(tur);
      flashes.push(fl);
    });
    this.container.addChild(root);
    v.gfx = { root, wake, mark, turrets, flashes };
    return v.gfx;
  }

  private create(id: number, type: number, owner: number, x: number, y: number): ShipView {
    const v: ShipView = {
      type,
      owner,
      gfx: null,
      extras: null,
      badges: null,
      label: null,
      labelText: '',
      badgeKey: -1,
      x,
      y,
      heading: 0,
      headingSet: false,
      speed: 0,
      aim: 0,
      aimHold: 0,
      flashT: 0,
      flashIdx: 0,
      smokeT: Math.random() * 0.2,
      foamT: Math.random() * 0.1,
      seen: this.frame,
    };
    this.views.set(id, v);
    return v;
  }

  /**
   * One ship this frame. (x, y): interpolated position; (cx, cy): this tick's position and
   * (px, py) the previous tick's (NaN when unknown), which give the heading and the speed.
   */
  ship(
    id: number,
    type: number,
    owner: number,
    x: number,
    y: number,
    cx: number,
    cy: number,
    px: number,
    py: number,
    hp: number,
    kind: number,
    level: number,
    troops: number,
    visible: boolean,
    selected: boolean,
  ): void {
    if (this.qaGone.size && this.qaGone.has(id)) return;
    const v = this.views.get(id) ?? this.create(id, type, owner, x, y);
    v.seen = this.frame;
    v.owner = owner;
    v.x = x;
    v.y = y;
    const dt = this.dt;
    // Heading and speed from the tick-to-tick motion (stable within a tick: no jitter).
    let moved = 0;
    if (px === px) {
      const mx = cx - px;
      const my = cy - py;
      moved = Math.hypot(mx, my);
      if (moved > 0.02) {
        const target = Math.atan2(my, mx);
        if (!v.headingSet) {
          v.heading = target;
          v.headingSet = true;
        } else v.heading = wrap(v.heading + wrap(target - v.heading) * (1 - Math.exp(-dt * 6)));
      }
    }
    v.speed += (Math.min(1.5, moved) - v.speed) * (1 - Math.exp(-dt * 4));
    if (v.flashT > 0) v.flashT -= dt;
    if (v.aimHold > 0) v.aimHold -= dt;
    if (v.extras) v.extras.visible = visible;
    if (!visible) {
      if (v.gfx) v.gfx.root.visible = false;
      return;
    }
    const g = v.gfx ?? this.build(v);
    const root = g.root;
    root.visible = true;
    const z = this.z;
    const tex = this.textures(type);
    const len = tex.bow - tex.stern;
    const px2 = shipPx(type, z, this.deps.uiScale());
    const unit = px2 / z / len; // world tiles per art unit
    root.position.set(x, y);
    root.scale.set(unit);
    root.rotation = v.heading;
    if (v.extras) {
      v.extras.position.set(x, y);
      v.extras.scale.set(unit);
    }
    g.mark.tint = this.deps.inkOf(owner);
    root.alpha = type === U.Merchant ? 0.92 : 1;
    // V-shaped wake, proportional to the speed (slower, shorter up a river).
    const docked = type === U.Warship && kind === WS_DOCKED;
    const s = docked ? 0 : Math.min(1.2, v.speed);
    // (Merchants, the most numerous, leave it out while they are only a few pixels long.)
    g.wake.visible = s > 0.06 && (type !== U.Merchant || z >= 2.5);
    if (g.wake.visible) {
      const wl = len * (0.2 + 0.6 * s);
      const ww = SHIP_H * (0.55 + 0.35 * s);
      g.wake.scale.set(wl / (WAKE_W * SHIP_RASTER), ww / (WAKE_H * SHIP_RASTER));
      g.wake.alpha = 0.25 + 0.35 * Math.min(1, s);
    }
    const tiles = px2 / z; // hull length in tiles
    const cos = Math.cos(v.heading);
    const sin = Math.sin(v.heading);
    const fx = this.deps.particles() > 0;
    // A little foam left behind (warships and transports, close enough to see it).
    if (fx && s > 0.3 && type !== U.Merchant && z >= 2) {
      v.foamT -= dt;
      if (v.foamT <= 0) {
        v.foamT = 0.09;
        const back = (tex.stern - SHIP_W / 2) * unit;
        this.particles.emit(
          x + cos * back,
          y + sin * back,
          0,
          0,
          0xeaf7ff,
          1.2,
          tiles * 0.035,
          'smoke',
          tiles * 0.11,
        );
      }
    }
    if (type === U.Warship) this.warship(v, g, hp, kind, level, tiles, unit, cos, sin, fx);
    else if (type === U.Transport) this.transportLabel(v, troops, unit, tiles);
    if (selected) {
      this.fx
        .circle(x, y, tiles * 0.62)
        .stroke({ width: Math.max(0.12, 1.6 / z), color: 0x4fe3c1, alpha: 0.95 });
    }
  }

  private warship(
    v: ShipView,
    g: ShipGfx,
    hp: number,
    kind: number,
    level: number,
    tiles: number,
    unit: number,
    cos: number,
    sin: number,
    fx: boolean,
  ): void {
    const dt = this.dt;
    const docked = kind === WS_DOCKED;
    // Turrets train on the target while engaged, then swing back fore and aft.
    for (let i = 0; i < g.turrets.length; i++) {
      const tur = g.turrets[i]!;
      const rest = i === 0 ? 0 : Math.PI;
      const want = v.aimHold > 0 && !docked ? wrap(v.aim - v.heading) : rest;
      const d = wrap(want - tur.rotation);
      const step = TURRET_SPEED * dt;
      tur.rotation = Math.abs(d) <= step ? want : wrap(tur.rotation + Math.sign(d) * step);
      const fl = g.flashes[i]!;
      fl.visible = v.flashT > 0 && v.flashIdx === i;
      if (fl.visible) fl.alpha = Math.min(1, v.flashT / (FLASH_TIME * 0.5));
    }
    // Damaged (under half health, retreating to port): smoke from the funnel.
    if (fx && hp < SMOKE_HP) {
      v.smokeT -= dt;
      if (v.smokeT <= 0) {
        v.smokeT = hp < 0.25 ? 0.09 : 0.16;
        const off = (53 - SHIP_W / 2) * unit;
        this.particles.emit(
          v.x + cos * off,
          v.y + sin * off,
          tiles * 0.12,
          -tiles * 0.22,
          hp < 0.25 ? 0x2b2f33 : 0x50565c,
          1.7,
          tiles * 0.07,
          'smoke',
          tiles * 0.26,
        );
      }
    }
    // Badges over the hull (not rotated): veterancy chevrons, repair cross when docked.
    const key = level * 2 + (docked ? 1 : 0);
    if (key !== v.badgeKey) {
      v.badgeKey = key;
      if (!v.badges && key > 0) {
        v.badges = new Container();
        this.extrasOf(v, unit).addChild(v.badges);
      }
      if (v.badges) {
        for (const c of v.badges.removeChildren()) c.destroy();
        const icons: Texture[] = [];
        for (let k = 0; k < Math.min(3, level); k++) icons.push(this.icons.chevron);
        if (docked) icons.push(this.icons.repair);
        const size = 30; // art units: ~6–9 px on screen
        icons.forEach((t, k) => {
          const sp = new Sprite(t);
          sp.anchor.set(0.5, 1);
          const chevron = t === this.icons.chevron;
          sp.scale.set((chevron ? size : size * 1.35) / t.width);
          // Chevrons stack upwards; the repair cross sits beside them.
          sp.position.set(chevron ? 0 : level > 0 ? size * 1.2 : 0, chevron ? -k * size * 0.4 : 0);
          v.badges!.addChild(sp);
        });
        v.badges.visible = icons.length > 0;
      }
    }
    // Health bar once hit: above the hull, a screen-constant size.
    const extent = this.extent(v, tiles);
    if (v.badges?.visible) v.badges.position.set(0, -(extent / unit) - 2);
    if (hp < 0.999) {
      const z = this.z;
      const w = tiles * 0.7;
      const h = Math.max(0.15, 3 / z);
      const lift =
        extent + (v.badges?.visible ? (Math.max(0, Math.min(3, level) - 1) * 12 + 36) * unit : 3 / z);
      const bx = v.x - w / 2;
      const by = v.y - lift - h;
      this.fx
        .rect(bx - 0.6 / z, by - 0.6 / z, w + 1.2 / z, h + 1.2 / z)
        .fill({ color: 0x0c1a26, alpha: 0.85 });
      this.fx.rect(bx, by, w * Math.max(0, hp), h).fill({ color: hp > SMOKE_HP ? 0x5bc98a : 0xe0456f });
    }
  }

  private extrasOf(v: ShipView, unit: number): Container {
    if (!v.extras) {
      v.extras = new Container();
      v.extras.position.set(v.x, v.y);
      v.extras.scale.set(unit);
      this.container.addChild(v.extras);
    }
    return v.extras;
  }

  /** Half the hull's vertical extent on screen at its heading (tiles). */
  private extent(v: ShipView, tiles: number): number {
    const tex = this.textures(v.type);
    const len = tex.bow - tex.stern;
    const beam = tiles * (24 / len);
    return Math.abs(Math.sin(v.heading)) * (tiles / 2) + Math.abs(Math.cos(v.heading)) * (beam / 2);
  }

  /** Troops aboard a transport, written under it when zoomed in. */
  private transportLabel(v: ShipView, troops: number, unit: number, tiles: number): void {
    const show = this.z >= 3.5 && troops > 0;
    if (!show) {
      if (v.label) v.label.visible = false;
      return;
    }
    if (!v.label) {
      v.label = new BitmapText({
        text: '',
        style: {
          fontFamily: '"IBM Plex Sans", sans-serif',
          fontSize: 40,
          fill: 0xffffff,
          fontWeight: '700',
          stroke: { color: 0x0c1a26, width: 9, join: 'round' },
        },
      });
      v.label.anchor.set(0.5, 0);
      this.extrasOf(v, unit).addChild(v.label);
    }
    const text = this.deps.formatTroops(troops);
    if (text !== v.labelText) {
      v.labelText = text;
      v.label.text = text;
    }
    v.label.visible = true;
    // 12 px type, a few px under the hull whatever its heading.
    v.label.scale.set(12 / 40 / (unit * this.z));
    v.label.position.set(0, (this.extent(v, tiles) + 2 / this.z) / unit);
  }

  /**
   * A shell this frame: a short tracer with a fading trail. A new shell is traced back to
   * the warship that fired it (muzzle flash, turrets trained on the target).
   */
  shell(id: number, owner: number, x: number, y: number, g: Graphics, inView: boolean): void {
    let s = this.shells.get(id);
    if (!s) {
      s = this.shellPool.pop() ?? {
        x: 0,
        y: 0,
        ox: 0,
        oy: 0,
        dx: 0,
        dy: 0,
        shooter: -1,
        seen: 0,
        shown: false,
      };
      s.x = s.ox = x;
      s.y = s.oy = y;
      s.dx = s.dy = 0;
      s.shooter = this.shooterOf(owner, x, y);
      this.shells.set(id, s);
    }
    s.seen = this.frame;
    s.shown = inView;
    const mx = x - s.x;
    const my = y - s.y;
    const d = Math.hypot(mx, my);
    if (d > 1e-4) {
      s.dx = mx / d;
      s.dy = my / d;
    }
    s.x = x;
    s.y = y;
    const shooter = s.shooter >= 0 ? this.views.get(s.shooter) : undefined;
    if (shooter) {
      if (s.dx === 0 && s.dy === 0) {
        s.dx = x - shooter.x;
        s.dy = y - shooter.y;
        const n = Math.hypot(s.dx, s.dy) || 1;
        s.dx /= n;
        s.dy /= n;
      }
      shooter.aim = Math.atan2(y - shooter.y, x - shooter.x);
      shooter.aimHold = AIM_HOLD;
    }
    if (!inView) return;
    const z = this.z;
    const flown = Math.hypot(x - s.ox, y - s.oy);
    const tail = Math.min(flown, Math.max(1.4, 16 / z));
    const w = Math.max(0.12, 1.5 / z);
    // Three fading segments behind a hot head.
    for (let k = 0; k < 3; k++) {
      const a = (tail * k) / 3;
      const b = (tail * (k + 1)) / 3;
      g.moveTo(x - s.dx * a, y - s.dy * a)
        .lineTo(x - s.dx * b, y - s.dy * b)
        .stroke({ width: w * (1 - k * 0.25), color: 0xffc46b, alpha: 0.75 - k * 0.25 });
    }
    g.circle(x, y, Math.max(0.35, 3.2 / z)).fill({ color: 0xffb050, alpha: 0.22 });
    g.circle(x, y, Math.max(0.14, 1.3 / z)).fill({ color: 0xfff4d6, alpha: 1 });
  }

  /** Did this ship leave the buffer sunk (a doom over it, or its country gone)? */
  private doomed(v: ShipView): boolean {
    return sunkAt(this.dooms, v.x, v.y, this.deps.alive(v.owner));
  }

  /** The explosion, then the hull kept to go under (updateWrecks). */
  private sink(v: ShipView): void {
    const g = v.gfx;
    v.extras?.destroy({ children: true });
    v.extras = null;
    if (!g) return;
    const z = this.z;
    const tiles = shipPx(v.type, z, this.deps.uiScale()) / z;
    this.explode(v.x, v.y, tiles);
    if (this.wrecks.length >= MAX_WRECKS) {
      g.root.destroy({ children: true });
      return;
    }
    g.wake.visible = false;
    for (const f of g.flashes) f.visible = false;
    const still = this.deps.reducedMotion();
    this.wrecks.push({
      root: g.root,
      type: v.type,
      x: v.x,
      y: v.y,
      heading: v.heading,
      roll: Math.random() < 0.5 ? -1 : 1,
      t: 0,
      dur: still ? SINK_TIME_STILL : SINK_TIME,
      bubbleT: 0.15,
      smokeT: 0,
      oil: false,
    });
  }

  /**
   * A small explosion over a hull `tiles` long: a hot flash and ring, sparks thrown out,
   * a puff of dark smoke, bits of wreckage. Sized on the hull (read at any zoom); with
   * reduced motion no flash, fewer sparks.
   */
  private explode(x: number, y: number, tiles: number): void {
    const P = this.deps.particles();
    if (P <= 0) return;
    const still = this.deps.reducedMotion();
    const pt = this.particles;
    if (!still) {
      pt.emit(x, y, 0, 0, 0xffe4b0, 0.34, tiles * 0.42, 'glow', tiles * 0.9);
      pt.ring(x, y, tiles * 0.3, 0xffd9a0, 0.45);
      // A fireball: a few hot puffs rolling off the hull.
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * TAU;
        pt.emit(
          x + Math.cos(a) * tiles * 0.12,
          y + Math.sin(a) * tiles * 0.12,
          Math.cos(a) * tiles * 0.25,
          Math.sin(a) * tiles * 0.25 - tiles * 0.15,
          k ? 0xff7a2e : 0xffb347,
          0.55 + Math.random() * 0.25,
          tiles * 0.2,
          'glow',
          tiles * 0.08,
        );
      }
    }
    const sparks = Math.round((still ? 4 : 10) * P);
    for (let k = 0; k < sparks; k++) {
      const a = Math.random() * TAU;
      const sp = tiles * (0.8 + Math.random() * 1.6);
      pt.ballistic(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp - tiles * 0.5,
        tiles * 1.4,
        1.8,
        k % 3 === 0 ? 0xfff0c8 : 0xffa14a,
        0.45 + Math.random() * 0.4,
        tiles * (0.05 + Math.random() * 0.04),
        tiles * 0.015,
      );
    }
    for (let k = 0; k < Math.round(4 * P); k++) {
      const a = Math.random() * TAU;
      pt.emit(
        x + Math.cos(a) * tiles * 0.15,
        y + Math.sin(a) * tiles * 0.15,
        Math.cos(a) * tiles * 0.12,
        Math.sin(a) * tiles * 0.12 - tiles * 0.1,
        k === 0 ? 0x5a5650 : 0x34383c,
        1.8 + Math.random() * 0.8,
        tiles * 0.2,
        'smoke',
        tiles * 0.62,
      );
    }
    // Wreckage: dark bits thrown out that drift and fade on the water.
    for (let k = 0; k < Math.round(6 * P); k++) {
      const a = Math.random() * TAU;
      const sp = tiles * (0.25 + Math.random() * 0.5);
      pt.ballistic(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        0,
        1.6,
        k % 2 ? 0x4a3b2c : 0x2f3236,
        2.4 + Math.random() * 1.2,
        tiles * (0.035 + Math.random() * 0.03),
        tiles * 0.03,
        'dot',
      );
    }
  }

  /** Wrecks going under: list, settle, darken and fade; bubbles, oil, the fire's smoke. */
  private updateWrecks(): void {
    if (this.wrecks.length === 0) return;
    const dt = this.dt;
    const z = this.z;
    const P = this.deps.particles();
    const still = this.deps.reducedMotion();
    const keep: Wreck[] = [];
    for (const w of this.wrecks) {
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      if (k >= 1) {
        w.root.destroy({ children: true });
        continue;
      }
      keep.push(w);
      const tex = this.textures(w.type);
      const len = tex.bow - tex.stern;
      const tiles = shipPx(w.type, z, this.deps.uiScale()) / z;
      const unit = tiles / len;
      const e = smooth(k);
      const cos = Math.cos(w.heading);
      const sin = Math.sin(w.heading);
      // Rolling onto its side (the beam narrows), the bow dipping (the hull shortens), a
      // last slew and a little way still on; darkening under the water, then gone.
      const roll = still ? 0 : e;
      w.root.scale.set(unit * (1 - 0.22 * roll), unit * (1 - 0.6 * roll));
      w.root.rotation = w.heading + w.roll * 0.3 * roll;
      const drift = still ? 0 : tiles * 0.18 * (1 - (1 - k) * (1 - k));
      w.root.position.set(w.x + cos * drift, w.y + sin * drift);
      w.root.tint = mixColor(0xffffff, SEA, Math.min(1, k * 1.3));
      w.root.alpha = k < 0.3 ? 1 : 1 - smooth((k - 0.3) / 0.7);
      if (P <= 0 || still) continue;
      const cx = w.root.x;
      const cy = w.root.y;
      // The slick spreads from where it went down (two dark sheens).
      if (!w.oil && k > 0.08) {
        w.oil = true;
        for (let j = 0; j < 2; j++)
          this.particles.emit(
            cx + (j - 0.5) * cos * tiles * 0.3,
            cy + (j - 0.5) * sin * tiles * 0.3,
            0,
            0,
            j ? 0x1b2026 : 0x26303a,
            w.dur * 1.25,
            tiles * 0.22,
            'smoke',
            tiles * (0.7 + j * 0.2),
          );
      }
      // Bubbles: pale rings popping along the hull.
      w.bubbleT -= dt;
      if (w.bubbleT <= 0 && k > 0.12) {
        w.bubbleT = 0.1 + Math.random() * 0.1;
        const along = (Math.random() - 0.5) * tiles * 0.7;
        const side = (Math.random() - 0.5) * tiles * 0.25;
        this.particles.ring(
          cx + cos * along - sin * side,
          cy + sin * along + cos * side,
          tiles * 0.05,
          0xdff2fa,
          0.55,
        );
      }
      // The fire's smoke, while the deck is still above the water.
      w.smokeT -= dt;
      if (w.smokeT <= 0 && k < 0.45) {
        w.smokeT = 0.18;
        this.particles.emit(
          cx,
          cy,
          tiles * 0.05,
          -tiles * 0.18,
          0x2b2f33,
          1.6,
          tiles * 0.13,
          'smoke',
          tiles * 0.42,
        );
      }
    }
    this.wrecks = keep;
  }

  /** The warship of `owner` nearest to a new shell, which must have just fired it. */
  private shooterOf(owner: number, x: number, y: number): number {
    let best = -1;
    let bd = SHOOTER_RANGE * SHOOTER_RANGE;
    for (const [id, v] of this.views) {
      if (v.type !== U.Warship || v.owner !== owner) continue;
      const d = (v.x - x) ** 2 + (v.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    if (best >= 0) {
      const v = this.views.get(best)!;
      const bearing = Math.atan2(y - v.y, x - v.x);
      // The turret that bears best fires: forward arc → A turret, else the aft one.
      v.flashIdx = Math.abs(wrap(bearing - v.heading)) > Math.PI / 2 ? 1 : 0;
      v.flashT = FLASH_TIME;
      v.aim = bearing;
      v.aimHold = AIM_HOLD;
      // The firing turret is already on target.
      const tur = v.gfx?.turrets[v.flashIdx];
      if (tur) tur.rotation = wrap(bearing - v.heading);
      if (v.gfx?.root.visible && this.deps.particles() > 0) {
        const tiles = shipPx(U.Warship, this.z, this.deps.uiScale()) / this.z;
        this.particles.emit(v.x, v.y, 0, -tiles * 0.1, 0xc9cdd1, 0.9, tiles * 0.06, 'smoke', tiles * 0.16);
      }
    }
    return best;
  }

  /**
   * The ship drawn nearest to the world point (x, y), within `reach` tiles of its centre or
   * within its own half length (the hover card: a far ship is a dot of a few pixels, so the
   * caller passes a generous reach). Only ships drawn last frame (not fogged out). −1: none.
   */
  nearest(x: number, y: number, reach: number): { id: number; d: number } | null {
    let best: { id: number; d: number } | null = null;
    const ui = this.deps.uiScale();
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame || !v.gfx?.root.visible) continue;
      const d = Math.hypot(v.x - x, v.y - y);
      const r = Math.max(reach, shipPx(v.type, this.z, ui) / this.z / 2);
      if (d <= r && (!best || d < best.d)) best = { id, d };
    }
    return best;
  }

  /**
   * Drop what was not seen this frame (a ship sunk goes under: sink); a shell that vanished
   * has struck: spark and splash.
   */
  end(): void {
    this.dooms = this.dooms.filter((d) => this.clock - d.t < DOOM_TIME);
    for (const [id, v] of this.views) {
      if (v.seen !== this.frame) {
        this.views.delete(id);
        if (v.gfx?.root.visible && this.doomed(v)) this.sink(v);
        else {
          v.gfx?.root.destroy({ children: true });
          v.extras?.destroy({ children: true });
        }
      }
    }
    this.updateWrecks();
    for (const [id, s] of this.shells) {
      if (s.seen === this.frame) continue;
      this.shells.delete(id);
      this.shellPool.push(s);
      if (this.deps.particles() <= 0 || !s.shown) continue;
      const z = this.z;
      const r = Math.max(0.5, 7 / z);
      // Hit: a small hot ring (the ring sprite grows to ~13 × its radius), sparks, smoke.
      this.particles.ring(s.x, s.y, r * 0.16, 0xffd9a0, 0.3);
      for (let k = 0; k < 5; k++) {
        const a = Math.random() * TAU;
        const sp = r * (2 + Math.random() * 3);
        this.particles.emit(
          s.x,
          s.y,
          Math.cos(a) * sp,
          Math.sin(a) * sp,
          0xffb050,
          0.35,
          r * 0.18,
          'spark',
          r * 0.05,
        );
      }
      this.particles.emit(s.x, s.y, 0, -r * 0.4, 0x6d7276, 1.2, r * 0.3, 'smoke', r * 0.8);
    }
  }
}
