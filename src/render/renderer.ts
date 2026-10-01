import 'pixi.js/unsafe-eval';
// PixiJS v8 renderer: map shader + vector/sprite layers + particles + labels.
import { Application, BitmapText, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { MapLayer } from './mapLayer';
import { Camera } from './camera';
import { buildIcons, type IconSet } from './icons';
import { inkNum, inkRgb, type ColorVision, UI } from './colors';
import type { ClientState } from '../engine/clientState';
import { UNIT_STRIDE } from '../engine/protocol';
import { U } from '../core/units/unit';
import {
  B,
  DEFENSE_POST_RANGE,
  N,
  NUKE_FALLOUT_RADIUS,
  NUKE_RADIUS,
  RADAR_RANGE,
  samRange,
} from '../core/game/constants';
import type { GameEvent } from '../core/game/events';
import { dayPhase } from '../core/rules/features';
import { ParticleSystem } from './particles';

export interface RenderSettings {
  quality: 'performance' | 'balanced' | 'high';
  particles: number; // 0..1
  vision: ColorVision;
  highContrast: boolean;
  reducedMotion: boolean;
  showFps: boolean;
  maxFps: number;
  lang: 'fr' | 'en';
  uiScale: number;
}

export interface Overlay {
  hoverTile: number;
  ghost: { kind: number; tile: number; ok: boolean } | null;
  ranges: { x: number; y: number; r: number; color: number }[];
  boatPath: number[] | null;
  nukeTarget: { tile: number; kind: number } | null;
  selection: Set<number>;
  dragRect: [number, number, number, number] | null;
  highlightPlayer: number;
  terrainView: boolean;
  resourcesView: boolean;
  fogView: boolean;
  loyaltyView: boolean;
}

interface UnitSprite {
  s: Sprite;
  seen: number;
  wakeT: number;
}

export class GameRenderer {
  readonly app = new Application();
  readonly camera = new Camera();
  private map!: MapLayer;
  private world = new Container();
  private screen = new Container();
  private rails = new Graphics();
  private deposits = new Container();
  private buildings = new Container();
  private lights = new Container();
  private units = new Container();
  private trails = new Graphics();
  private overlayG = new Graphics();
  private labels = new Container();
  private flash = new Graphics();
  private icons!: IconSet;
  private particles!: ParticleSystem;
  private unitSprites = new Map<number, UnitSprite>();
  private buildingSprites = new Map<number, Container>();
  private labelPool = new Map<number, { name: BitmapText; troops: BitmapText }>();
  private railsVersion = -1;
  private buildingsVersion = -1;
  private fogVersion = -1;
  private loyaltyVersion = -1;
  private paletteKey = '';
  private frame = 0;
  private flashAlpha = 0;
  private shake = 0;
  private startTime = performance.now();
  private pings: { x: number; y: number; t: number; color: number; kind: number }[] = [];
  private emojis: { x: number; y: number; t: number; text: BitmapText }[] = [];
  private popups: { x: number; y: number; t: number; text: BitmapText }[] = [];
  private frontSparks: number[] = [];
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  overlay: Overlay = {
    hoverTile: -1,
    ghost: null,
    ranges: [],
    boatPath: null,
    nukeTarget: null,
    selection: new Set(),
    dragRect: null,
    highlightPlayer: -1,
    terrainView: false,
    resourcesView: false,
    fogView: true,
    loyaltyView: false,
  };
  onFrame: (dt: number) => void = () => {};

  constructor(
    private readonly state: ClientState,
    public settings: RenderSettings,
  ) {}

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      background: UI.abyss,
      antialias: true,
      preference: 'webgl',
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      powerPreference: 'high-performance',
    });
    parent.appendChild(this.app.canvas);
    this.app.canvas.style.display = 'block';
    this.icons = buildIcons(this.app.renderer);
    this.map = new MapLayer(this.state, this.app.renderer);
    this.particles = new ParticleSystem(this.icons, 2600);
    this.lights.blendMode = 'add';
    this.trails.blendMode = 'add';
    this.world.addChild(
      this.map.mesh,
      this.rails,
      this.deposits,
      this.lights,
      this.buildings,
      this.units,
      this.trails,
      this.particles.container,
      this.overlayG,
      this.labels,
    );
    this.screen.addChild(this.flash);
    this.app.stage.addChild(this.world, this.screen);
    this.camera.setMap(this.state.width, this.state.height);
    this.camera.resize(this.app.screen.width, this.app.screen.height);
    this.camera.fit();
    this.buildDeposits();
    this.applySettings();
    this.app.ticker.add((t) => this.render(t.deltaMS / 1000));
  }

  /** Recreate the map surface after the client state was re-initialised (replay rewind, resync). */
  rebuildMap(): void {
    const old = this.map;
    this.map = new MapLayer(this.state, this.app.renderer);
    this.world.addChildAt(this.map.mesh, 0);
    this.world.removeChild(old.mesh);
    old.destroy();
    this.paletteKey = '';
    this.fogVersion = -1;
    this.loyaltyVersion = -1;
    this.railsVersion = -1;
    this.buildingsVersion = -1;
  }

  applySettings(): void {
    this.app.ticker.maxFPS = this.settings.maxFps > 0 ? this.settings.maxFps : 0;
    this.camera.reducedMotion = this.settings.reducedMotion;
    this.paletteKey = '';
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }

  // --------------------------------------------------------------- palette
  private updatePalette(): void {
    const key = `${this.settings.vision}|${this.state.playerList.map((p) => `${p.id}:${p.color}`).join(',')}`;
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const m = new Map<number, [number, number, number]>();
    for (const p of this.state.playerList) m.set(p.id, inkRgb(p.color, this.settings.vision));
    this.map.setPalette(m);
  }

  inkOf(id: number): number {
    const p = this.state.players.get(id);
    return p ? inkNum(p.color, this.settings.vision) : UI.parchment;
  }

  // ------------------------------------------------------------ deposits
  private buildDeposits(): void {
    for (const d of this.state.meta.deposits) {
      const s = new Sprite(this.icons.deposit[d.type] ?? this.icons.dot);
      s.anchor.set(0.5);
      s.position.set(d.x + 0.5, d.y + 0.5);
      this.deposits.addChild(s);
    }
  }

  // -------------------------------------------------------------- frame
  private render(dt: number): void {
    this.frame++;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    const s = this.state;
    const cam = this.camera;
    cam.resize(this.app.screen.width, this.app.screen.height);
    cam.update(dt);
    this.onFrame(dt);
    let ox = 0;
    let oy = 0;
    if (this.shake > 0 && !this.settings.reducedMotion) {
      ox = (Math.random() - 0.5) * this.shake;
      oy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 6);
      if (this.shake < 0.3) this.shake = 0;
    }
    this.world.scale.set(cam.zoom);
    this.world.position.set(cam.viewW / 2 - cam.cx * cam.zoom + ox, cam.viewH / 2 - cam.cy * cam.zoom + oy);

    this.updatePalette();
    this.collectFrontSparks();
    this.map.consumeChanges();
    this.map.upload();
    if (s.fogVersion !== this.fogVersion) {
      this.fogVersion = s.fogVersion;
      this.map.setFog(s.fog);
    }
    if (s.loyaltyVersion !== this.loyaltyVersion) {
      this.loyaltyVersion = s.loyaltyVersion;
      this.map.setLoyalty(s.loyalty);
    }
    const t = (performance.now() - this.startTime) / 1000;
    const alpha = s.alpha();
    const tickF = s.tick - 1 + alpha;
    const phase = dayPhase(Math.max(0, s.tick));
    const weatherOn = !!s.world;
    const night = weatherOn ? Math.max(0, Math.sin((phase - 0.5) * Math.PI * 2)) : 0;
    const weather = new Float32Array(32).fill(-1);
    (s.world?.weather ?? []).slice(0, 8).forEach((c, k) => {
      weather[k * 4] = c.x;
      weather[k * 4 + 1] = c.y;
      weather[k * 4 + 2] = c.r;
      weather[k * 4 + 3] = c.kind;
    });
    const ring = s.world?.ring;
    const q = this.settings.quality;
    this.map.setUniforms({
      time: this.settings.reducedMotion ? 0 : t,
      tick: tickF,
      zoom: cam.zoom * this.app.renderer.resolution,
      night,
      highlight: this.overlay.highlightPlayer,
      viewer: s.viewer,
      fogOn: !!s.fog && this.overlay.fogView,
      terrainView: this.overlay.terrainView,
      quality: q === 'performance' ? 0 : 1,
      pattern: this.settings.vision !== 'none',
      contrast: this.settings.highContrast,
      loyaltyView: this.overlay.loyaltyView,
      weather,
      ring: ring ? [ring.cx, ring.cy, ring.r, 1] : [0, 0, 0, 0],
    });

    // LOD visibility.
    const z = cam.zoom;
    this.deposits.visible = this.overlay.resourcesView || z > 2.5;
    for (const d of this.deposits.children)
      d.scale.set(Math.min(0.9, (18 / 24 / z) * (this.overlay.resourcesView ? 1.2 : 1)));
    this.rails.visible = z > 0.9;
    if (s.railsVersion !== this.railsVersion) this.drawRails();
    if (s.buildingsVersion !== this.buildingsVersion) this.syncBuildings();
    this.updateBuildings(night, t);
    this.updateUnits(alpha, tickF, dt, t);
    this.particles.update(dt, z);
    this.drawOverlay(t);
    this.updateLabels(z);
    this.updateFloaters(dt, z);
    // Screen flash (nukes).
    this.flash.clear();
    if (this.flashAlpha > 0.01) {
      this.flash.rect(0, 0, cam.viewW, cam.viewH).fill({ color: 0xfff6e0, alpha: this.flashAlpha });
      this.flashAlpha *= Math.exp(-dt * 3.2);
    }
  }

  // ---------------------------------------------------------------- rails
  private drawRails(): void {
    this.railsVersion = this.state.railsVersion;
    const g = this.rails;
    g.clear();
    const w = this.state.width;
    for (const r of this.state.rails) {
      if (r.tiles.length < 2) continue;
      // Smooth: Chaikin-like decimation (every 3rd tile) + quadratic curves.
      const pts: [number, number][] = [];
      for (let k = 0; k < r.tiles.length; k += 3)
        pts.push([(r.tiles[k]! % w) + 0.5, ((r.tiles[k]! / w) | 0) + 0.5]);
      const last = r.tiles[r.tiles.length - 1]!;
      pts.push([(last % w) + 0.5, ((last / w) | 0) + 0.5]);
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (let k = 1; k < pts.length - 1; k++) {
        const mx = (pts[k]![0] + pts[k + 1]![0]) / 2;
        const my = (pts[k]![1] + pts[k + 1]![1]) / 2;
        g.quadraticCurveTo(pts[k]![0], pts[k]![1], mx, my);
      }
      g.lineTo(pts[pts.length - 1]![0], pts[pts.length - 1]![1]);
      g.stroke({ width: 0.55, color: 0x1a1612, alpha: 0.85 });
      g.moveTo(pts[0]![0], pts[0]![1]);
      for (let k = 1; k < pts.length - 1; k++) {
        const mx = (pts[k]![0] + pts[k + 1]![0]) / 2;
        const my = (pts[k]![1] + pts[k + 1]![1]) / 2;
        g.quadraticCurveTo(pts[k]![0], pts[k]![1], mx, my);
      }
      g.lineTo(pts[pts.length - 1]![0], pts[pts.length - 1]![1]);
      g.stroke({ width: 0.22, color: this.inkOf(r.owner), alpha: 0.95 });
    }
  }

  // ------------------------------------------------------------ buildings
  private syncBuildings(): void {
    this.buildingsVersion = this.state.buildingsVersion;
    const seen = new Set<number>();
    for (const b of this.state.buildings) {
      seen.add(b.id);
      let c = this.buildingSprites.get(b.id);
      if (!c) {
        c = new Container();
        const back = new Sprite(this.icons.backdrop);
        back.anchor.set(0.5);
        const ico = new Sprite(this.icons.buildings[b.type]!);
        ico.anchor.set(0.5);
        const prog = new Graphics();
        c.addChild(back, ico, prog);
        const light = new Sprite(this.icons.glow);
        light.anchor.set(0.5);
        light.visible = false;
        (c as Container & { light?: Sprite }).light = light;
        this.lights.addChild(light);
        this.buildings.addChild(c);
        this.buildingSprites.set(b.id, c);
        if (b.progress < 1) this.particles.burst(b.x + 0.5, b.y + 0.5, 6, 0xeae6da, 0.6, 'spark');
      }
      c.position.set(b.x + 0.5, b.y + 0.5);
      const ink = this.inkOf(b.owner);
      (c.children[0] as Sprite).tint = ink;
      (c.children[1] as Sprite).tint = b.ready ? 0xffffff : 0x9aa3ad;
      (c as Container & { info?: typeof b }).info = b;
    }
    for (const [id, c] of this.buildingSprites) {
      if (seen.has(id)) continue;
      const light = (c as Container & { light?: Sprite }).light;
      light?.destroy();
      c.destroy({ children: true });
      this.buildingSprites.delete(id);
    }
  }

  private updateBuildings(night: number, t: number): void {
    const z = this.camera.zoom;
    const size = Math.max(10, Math.min(30, 9 + z * 2.2)) * (this.settings.uiScale || 1);
    const scale = size / 32 / z;
    const [x0, y0, x1, y1] = this.camera.bounds();
    for (const c of this.buildingSprites.values()) {
      const b = (c as Container & { info?: import('../engine/protocol').BuildingView }).info!;
      const inView = b.x >= x0 - 2 && b.x <= x1 + 2 && b.y >= y0 - 2 && b.y <= y1 + 2;
      const lod = z < 0.7 ? b.type === B.City && b.level >= 2 : z < 1.4 ? b.type !== B.DefensePost : true;
      c.visible = inView && lod;
      if (!c.visible) {
        const light = (c as Container & { light?: Sprite }).light;
        if (light) light.visible = false;
        continue;
      }
      c.scale.set(scale);
      const prog = c.children[2] as Graphics;
      prog.clear();
      if (!b.ready) {
        prog
          .arc(0, 0, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.progress)
          .stroke({ width: 3, color: UI.aurora });
      } else if (b.level > 1) {
        for (let k = 0; k < Math.min(5, b.level - 1); k++)
          prog.circle(-10 + k * 5, 19, 1.8).fill({ color: UI.brass });
      }
      // City lights at night (additive glow).
      const light = (c as Container & { light?: Sprite }).light;
      if (light) {
        const lit =
          (b.type === B.City || b.type === B.Port || b.type === B.Factory) &&
          night > 0.05 &&
          this.settings.quality !== 'performance';
        light.visible = lit;
        if (lit) {
          light.position.set(b.x + 0.5, b.y + 0.5);
          const flicker = 0.9 + 0.1 * Math.sin(t * 3 + b.id);
          light.scale.set((0.08 + 0.025 * b.level) * (b.type === B.City ? 1 : 0.6));
          light.tint = 0xffd38a;
          light.alpha = night * 0.55 * flicker;
        }
      }
    }
  }

  // ---------------------------------------------------------------- units
  private updateUnits(alpha: number, tickF: number, dt: number, t: number): void {
    const s = this.state;
    const z = this.camera.zoom;
    const buf = s.units;
    this.trails.clear();
    const [vx0, vy0, vx1, vy1] = this.camera.bounds();
    for (let k = 0; k < s.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      const id = buf[o]!;
      const type = buf[o + 1]! as U;
      const owner = buf[o + 2]!;
      let x = buf[o + 3]!;
      let y = buf[o + 4]!;
      const prev = s.prevPos.get(id);
      if (prev && Math.hypot(prev[0] - x, prev[1] - y) < 40) {
        x = prev[0] + (x - prev[0]) * alpha;
        y = prev[1] + (y - prev[1]) * alpha;
      }
      if (type === U.Nuke || type === U.Interceptor) {
        this.drawMissile(buf, o, tickF, t);
        continue;
      }
      if (type === U.Shell) {
        this.trails.circle(x, y, Math.max(0.25, 1.5 / z)).fill({ color: 0xffe9a8, alpha: 0.9 });
        continue;
      }
      const inView = x >= vx0 - 5 && x <= vx1 + 5 && y >= vy0 - 5 && y <= vy1 + 5;
      let us = this.unitSprites.get(id);
      if (!us) {
        const tex = this.unitTexture(type);
        const sp = new Sprite(tex);
        sp.anchor.set(0.5);
        this.units.addChild(sp);
        us = { s: sp, seen: 0, wakeT: 0 };
        this.unitSprites.set(id, us);
        sp.position.set(x, y);
      }
      us.seen = this.frame;
      const sp = us.s;
      const dx = x - sp.x;
      const dy = y - sp.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0005) sp.rotation = Math.atan2(dy, dx);
      sp.position.set(x, y);
      // LOD: ships visible from medium zoom, trains at close zoom.
      const minZoom = type === U.Train ? 2.2 : type === U.Merchant ? 1.2 : 0.4;
      sp.visible = inView && z >= minZoom && !(type === U.Transport && this.hiddenInFogBank(owner, x, y));
      if (!sp.visible) continue;
      const base =
        type === U.Warship
          ? 20
          : type === U.Train
            ? 11
            : type >= U.Fighter
              ? 14
              : type === U.Merchant
                ? 10
                : 15;
      const px = Math.max(base * 0.6, Math.min(base * 1.4, base * (0.6 + z * 0.08)));
      sp.scale.set((px / sp.texture.width / z) * 3);
      sp.tint = type === U.Merchant ? 0xffffff : this.inkOf(owner);
      sp.alpha = type === U.Merchant ? 0.7 : 1;
      // Wakes behind ships; contrails behind planes.
      us.wakeT += dt;
      const moving = Math.abs(dx) + Math.abs(dy) > 0.001;
      if (
        moving &&
        us.wakeT > 0.08 &&
        this.settings.particles > 0 &&
        (type === U.Transport || type === U.Warship || type === U.Merchant || type >= U.Fighter)
      ) {
        us.wakeT = 0;
        this.particles.emit(
          x - Math.cos(sp.rotation) * 0.8,
          y - Math.sin(sp.rotation) * 0.8,
          0,
          0,
          type >= U.Fighter ? 0xdfe8f0 : 0xbfe6ff,
          0.9,
          0.35,
          'dot',
          0.18,
        );
      }
      if (type === U.Transport && z > 1.6) {
        const troops = buf[o + 14]!;
        this.trails.circle(x, y - 1.6, 0.0001).fill({ color: 0 });
        void troops;
      }
      if (type === U.Warship && buf[o + 5]! < 0.999) {
        const hp = buf[o + 5]!;
        const wbar = 2.4;
        this.trails.rect(x - wbar / 2, y - 1.8, wbar, 0.3).fill({ color: 0x000000, alpha: 0.6 });
        this.trails
          .rect(x - wbar / 2, y - 1.8, wbar * hp, 0.3)
          .fill({ color: hp > 0.5 ? UI.verdant : UI.signal });
      }
      if (this.overlay.selection.has(id))
        this.trails
          .circle(x, y, Math.max(1.2, 12 / z))
          .stroke({ width: Math.max(0.12, 1.5 / z), color: UI.aurora });
    }
    for (const [id, us] of this.unitSprites) {
      if (us.seen !== this.frame) {
        us.s.destroy();
        this.unitSprites.delete(id);
      }
    }
  }

  /** Enemy transports are hidden inside weather fog banks (original weather feature). */
  private hiddenInFogBank(owner: number, x: number, y: number): boolean {
    const s = this.state;
    const me = s.viewer;
    if (me <= 0 || owner === me) return false;
    const mine = s.players.get(me);
    if (mine && mine.allies.includes(owner)) return false;
    for (const c of s.world?.weather ?? []) {
      if (c.kind === 1 && (c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return true;
    }
    return false;
  }

  private unitTexture(type: U): Texture {
    switch (type) {
      case U.Warship:
        return this.icons.warship;
      case U.Merchant:
        return this.icons.merchant;
      case U.Train:
        return this.icons.train;
      case U.Fighter:
      case U.Bomber:
      case U.Recon:
        return this.icons.plane;
      default:
        return this.icons.ship;
    }
  }

  /** Ballistic arcs with luminous trails; projected impact rings. */
  private drawMissile(buf: Float32Array, o: number, tickF: number, t: number): void {
    const type = buf[o + 1]!;
    const owner = buf[o + 2]!;
    const kind = buf[o + 6]!;
    const sx = buf[o + 8]!;
    const sy = buf[o + 9]!;
    const tx = buf[o + 10]!;
    const ty = buf[o + 11]!;
    const t0 = buf[o + 12]!;
    const t1 = buf[o + 13]!;
    const f = Math.max(0, Math.min(1, (tickF - t0) / Math.max(1, t1 - t0)));
    const dist = Math.hypot(tx - sx, ty - sy);
    const hMax = type === U.Interceptor ? dist * 0.12 : dist * 0.22;
    const pos = (u: number): [number, number] => [
      sx + (tx - sx) * u,
      sy + (ty - sy) * u - Math.sin(Math.PI * u) * hMax,
    ];
    const color =
      type === U.Interceptor ? UI.aurora : kind === N.Hydrogen || kind === N.Mirv ? UI.signal : 0xffb070;
    const g = this.trails;
    const z = this.camera.zoom;
    const steps = 24;
    const [p0x, p0y] = pos(Math.max(0, f - 0.35));
    g.moveTo(p0x, p0y);
    for (let k = 1; k <= steps; k++) {
      const u = Math.max(0, f - 0.35) + ((f - Math.max(0, f - 0.35)) * k) / steps;
      const [px, py] = pos(u);
      g.lineTo(px, py);
    }
    g.stroke({ width: Math.max(0.3, 2.2 / z), color, alpha: 0.75 });
    const [hx, hy] = pos(f);
    g.circle(hx, hy, Math.max(0.5, 3.5 / z)).fill({ color: 0xffffff });
    g.circle(hx, hy, Math.max(1.2, 9 / z)).fill({ color, alpha: 0.25 });
    if (type !== U.Interceptor) {
      // Projected impact: destruction + fallout radii, pulsing.
      const r = kind === N.Mirv ? 70 : NUKE_RADIUS[kind as N] || 12;
      const rf = kind === N.Mirv ? 70 : NUKE_FALLOUT_RADIUS[kind as N] || 18;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      g.circle(tx, ty, r).stroke({
        width: Math.max(0.3, 1.6 / z),
        color: UI.signal,
        alpha: 0.5 + 0.4 * pulse,
      });
      g.circle(tx, ty, rf).stroke({ width: Math.max(0.2, 1 / z), color: UI.signal, alpha: 0.25 });
      void owner;
    }
  }

  // -------------------------------------------------------------- overlay
  private drawOverlay(t: number): void {
    const g = this.overlayG;
    g.clear();
    const z = this.camera.zoom;
    const lw = (px: number) => Math.max(0.08, px / z);
    const w = this.state.width;
    const ov = this.overlay;
    if (ov.hoverTile >= 0 && z > 3) {
      const x = ov.hoverTile % w;
      const y = (ov.hoverTile / w) | 0;
      g.rect(x, y, 1, 1).stroke({ width: lw(1.5), color: 0xffffff, alpha: 0.7 });
    }
    for (const r of ov.ranges)
      g.circle(r.x, r.y, r.r)
        .fill({ color: r.color, alpha: 0.06 })
        .stroke({ width: lw(1.5), color: r.color, alpha: 0.6 });
    if (ov.ghost) {
      const x = (ov.ghost.tile % w) + 0.5;
      const y = ((ov.ghost.tile / w) | 0) + 0.5;
      const color = ov.ghost.ok ? UI.aurora : UI.signal;
      const rad = Math.max(1.2, 14 / z);
      g.circle(x, y, rad)
        .fill({ color, alpha: 0.25 })
        .stroke({ width: lw(2), color });
      const range =
        ov.ghost.kind === B.DefensePost
          ? DEFENSE_POST_RANGE
          : ov.ghost.kind === B.Sam
            ? samRange(1)
            : ov.ghost.kind === B.Radar
              ? RADAR_RANGE
              : 0;
      if (range) g.circle(x, y, range).stroke({ width: lw(1.5), color, alpha: 0.5 });
    }
    if (ov.boatPath && ov.boatPath.length > 1) {
      const p = ov.boatPath;
      g.moveTo((p[0]! % w) + 0.5, ((p[0]! / w) | 0) + 0.5);
      for (let k = 1; k < p.length; k++) g.lineTo((p[k]! % w) + 0.5, ((p[k]! / w) | 0) + 0.5);
      g.stroke({ width: lw(2), color: UI.aurora, alpha: 0.7 });
    }
    if (ov.nukeTarget) {
      const x = (ov.nukeTarget.tile % w) + 0.5;
      const y = ((ov.nukeTarget.tile / w) | 0) + 0.5;
      const k = ov.nukeTarget.kind as N;
      const r = k === N.Mirv ? 70 : NUKE_RADIUS[k];
      const rf = k === N.Mirv ? 80 : NUKE_FALLOUT_RADIUS[k];
      g.circle(x, y, r)
        .fill({ color: UI.signal, alpha: 0.12 })
        .stroke({ width: lw(2), color: UI.signal });
      g.circle(x, y, rf).stroke({ width: lw(1), color: UI.signal, alpha: 0.5 });
      g.moveTo(x - r * 0.3, y)
        .lineTo(x + r * 0.3, y)
        .moveTo(x, y - r * 0.3)
        .lineTo(x, y + r * 0.3)
        .stroke({ width: lw(1), color: UI.signal });
    }
    if (ov.dragRect) {
      const [x0, y0, x1, y1] = ov.dragRect;
      g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
        .fill({ color: UI.aurora, alpha: 0.08 })
        .stroke({ width: lw(1.5), color: UI.aurora });
    }
    // Pings.
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 3000);
    for (const p of this.pings) {
      const a = (now - p.t) / 3000;
      for (let k = 0; k < 2; k++) {
        const r = ((a * 2 + k * 0.5) % 1) * Math.max(6, 60 / z);
        g.circle(p.x, p.y, r).stroke({ width: lw(2), color: p.color, alpha: 1 - ((a * 2 + k * 0.5) % 1) });
      }
    }
    void t;
  }

  // --------------------------------------------------------------- labels
  private updateLabels(z: number): void {
    const s = this.state;
    const seen = new Set<number>();
    const lang = this.settings.lang;
    for (const p of s.playerList) {
      if (!p.alive || p.tiles === 0) continue;
      const [lx, ly, size] = p.label;
      const px = size * z;
      if (px < 18) continue;
      seen.add(p.id);
      let l = this.labelPool.get(p.id);
      if (!l) {
        const name = new BitmapText({
          text: '',
          style: { fontFamily: 'Fraunces, Georgia, serif', fontSize: 64, fill: 0xffffff, fontWeight: '600' },
        });
        const troops = new BitmapText({
          text: '',
          style: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 40, fill: 0xffffff },
        });
        name.anchor.set(0.5);
        troops.anchor.set(0.5);
        this.labels.addChild(name, troops);
        l = { name, troops };
        this.labelPool.set(p.id, l);
      }
      const fontPx = Math.max(10, Math.min(46, px * 0.32));
      const nm = (p.name[lang] || p.name.en) + (p.traitor ? ' ⚠' : '') + (p.inactive ? ' Zzz' : '');
      if (l.name.text !== nm) l.name.text = nm;
      const tr = formatShort(p.troops);
      if (l.troops.text !== tr) l.troops.text = tr;
      l.name.scale.set(fontPx / 64 / z);
      l.troops.scale.set((fontPx * 0.62) / 40 / z);
      l.name.position.set(lx, ly - (fontPx * 0.25) / z);
      l.troops.position.set(lx, ly + (fontPx * 0.55) / z);
      const alpha = Math.min(1, (px - 18) / 30);
      l.name.alpha = 0.92 * alpha;
      l.troops.alpha = 0.75 * alpha;
      l.name.tint = p.id === s.viewer ? 0xffffff : 0xf3efe4;
      l.troops.tint = p.immune ? UI.aurora : 0xe8e3d6;
    }
    for (const [id, l] of this.labelPool) {
      if (seen.has(id)) continue;
      l.name.destroy();
      l.troops.destroy();
      this.labelPool.delete(id);
    }
  }

  private updateFloaters(dt: number, z: number): void {
    const now = performance.now();
    for (const e of this.emojis) {
      const a = (now - e.t) / 2500;
      e.text.position.set(e.x, e.y - (a * 30) / z);
      e.text.scale.set(28 / 64 / z);
      e.text.alpha = 1 - a;
    }
    this.emojis = this.emojis.filter((e) => {
      if (now - e.t > 2500) {
        e.text.destroy();
        return false;
      }
      return true;
    });
    for (const p of this.popups) {
      const a = (now - p.t) / 1600;
      p.text.position.set(p.x, p.y - (a * 26) / z);
      p.text.scale.set(15 / 40 / z);
      p.text.alpha = 1 - a * a;
    }
    this.popups = this.popups.filter((p) => {
      if (now - p.t > 1600) {
        p.text.destroy();
        return false;
      }
      return true;
    });
    void dt;
  }

  // --------------------------------------------------------- game events
  private collectFrontSparks(): void {
    // Sparks at a sample of freshly conquered tiles (active fronts).
    const s = this.state;
    if (this.settings.particles <= 0 || s.pendingTiles.length === 0) return;
    const n = Math.min(s.pendingTiles.length, Math.round(10 * this.settings.particles));
    const w = s.width;
    for (let k = 0; k < n; k++) {
      const t = s.pendingTiles[Math.floor(Math.random() * s.pendingTiles.length)]!;
      const o = s.owner[t]!;
      if (o === 0) continue;
      this.particles.emit(
        (t % w) + Math.random(),
        ((t / w) | 0) + Math.random(),
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3,
        this.inkOf(o),
        1.3,
        0.45,
        'spark',
        0.12,
      );
    }
    void this.frontSparks;
  }

  onEvents(events: GameEvent[]): void {
    const P = this.settings.particles;
    for (const e of events) {
      switch (e.k) {
        case 'explosion':
          this.explosion(e.x, e.y, e.kind, e.radius);
          break;
        case 'intercept':
          this.particles.burst(e.x, e.y, Math.round(30 * P), UI.aurora, 3, 'spark');
          this.particles.ring(e.x, e.y, 10, UI.aurora, 0.6);
          break;
        case 'shipSunk':
          this.particles.burst(e.x, e.y, Math.round(18 * P), 0xffb070, 1.4, 'spark');
          this.particles.burst(e.x, e.y, Math.round(8 * P), 0x8090a0, 0.8, 'smoke');
          break;
        case 'built': {
          const x = (e.tile % this.state.width) + 0.5;
          const y = ((e.tile / this.state.width) | 0) + 0.5;
          this.particles.ring(x, y, 4, UI.aurora, 0.5);
          break;
        }
        case 'ping':
          this.pings.push({
            x: (e.tile % this.state.width) + 0.5,
            y: ((e.tile / this.state.width) | 0) + 0.5,
            t: performance.now(),
            color: this.inkOf(e.from),
            kind: e.kind,
          });
          break;
        case 'emoji': {
          const text = new BitmapText({
            text: EMOJIS[e.emoji] ?? '•',
            style: { fontFamily: 'sans-serif', fontSize: 64, fill: 0xffffff },
          });
          text.anchor.set(0.5);
          this.labels.addChild(text);
          this.emojis.push({
            x: (e.tile % this.state.width) + 0.5,
            y: ((e.tile / this.state.width) | 0) + 0.5,
            t: performance.now(),
            text,
          });
          break;
        }
        case 'trainPay':
        case 'tradePay':
          if (e.owner === this.state.viewer && this.camera.zoom > 1.5) {
            const text = new BitmapText({
              text: `+${formatShort(e.amount)}`,
              style: { fontFamily: '"IBM Plex Mono", monospace', fontSize: 40, fill: 0xffffff },
            });
            text.tint = UI.brass;
            text.anchor.set(0.5);
            this.labels.addChild(text);
            this.popups.push({ x: e.x + 0.5, y: e.y - 0.5, t: performance.now(), text });
          }
          break;
        case 'capture':
          this.particles.ring(e.x + 0.5, e.y + 0.5, 6, this.inkOf(e.by), 0.6);
          break;
      }
    }
  }

  private explosion(x: number, y: number, kind: number, radius: number): void {
    const P = this.settings.particles;
    if (kind === 10 || kind === 11) {
      this.particles.burst(x, y, Math.round(26 * P), 0xffb070, 2, 'spark');
      this.particles.burst(x, y, Math.round(10 * P), 0x6d6a70, 1.2, 'smoke');
      return;
    }
    // Nuclear: flash, shock wave, fireball, mushroom column, fallout dust.
    const big = kind === N.Hydrogen;
    const [sx, sy] = this.camera.worldToScreen(x, y);
    const onScreen = sx > -200 && sy > -200 && sx < this.camera.viewW + 200 && sy < this.camera.viewH + 200;
    if (onScreen && !this.settings.reducedMotion) {
      this.flashAlpha = Math.max(this.flashAlpha, big ? 0.55 : 0.28);
      this.shake = Math.max(this.shake, big ? 18 : 8);
    }
    this.particles.ring(x, y, radius * 2.2, 0xfff1d0, big ? 1.6 : 1.0);
    this.particles.ring(x, y, radius * 1.3, 0xffb070, big ? 1.2 : 0.8);
    this.particles.burst(x, y, Math.round((big ? 120 : 50) * P), 0xffd38a, radius * 0.35, 'spark');
    this.particles.mushroom(x, y, radius, big, P);
  }

  // ------------------------------------------------------------ helpers
  tileAtScreen(sx: number, sy: number): number {
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= this.state.width || y >= this.state.height) return -1;
    return y * this.state.width + x;
  }

  unitsInRect(x0: number, y0: number, x1: number, y1: number, owner: number, type: U): number[] {
    const out: number[] = [];
    const s = this.state;
    for (let k = 0; k < s.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      if (s.units[o + 1] !== type || s.units[o + 2] !== owner) continue;
      const x = s.units[o + 3]!;
      const y = s.units[o + 4]!;
      if (x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1))
        out.push(s.units[o]!);
    }
    return out;
  }

  async screenshot(): Promise<string> {
    const canvas = this.app.renderer.extract.canvas(this.app.stage) as HTMLCanvasElement;
    return canvas.toDataURL('image/png');
  }
}

export const EMOJIS = [
  '👍',
  '👎',
  '😂',
  '😡',
  '🤝',
  '💀',
  '🔥',
  '❤️',
  '⚔️',
  '🏳️',
  '🎯',
  '😱',
  '🙏',
  '👀',
  '💰',
  '☢️',
];

export function formatShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return Math.round(v).toString();
}
