import 'pixi.js/unsafe-eval';
// PixiJS v8 renderer: map shader + vector/sprite layers + particles + labels.
import { Application, BitmapText, Container, Graphics, Sprite, TextStyle, type Texture } from 'pixi.js';
import { MapLayer } from './mapLayer';
import { Camera } from './camera';
import { buildIcons, type IconSet, type StatusIcon } from './icons';
import { SIGNALS } from '../ui/icons/icons';
import { t } from '../ui/i18n/i18n.svelte';
import { inkNum, inkRgb, type ColorVision, UI } from './colors';
import type { ClientState } from '../engine/clientState';
import { UNIT_STRIDE, type BuildingView } from '../engine/protocol';
import { U } from '../core/units/unit';
import {
  B,
  N,
  NUKE_FALLOUT_RADIUS,
  NUKE_RADIUS,
  NUKE_TARGETABLE_RANGE,
  RECON_RADIUS,
} from '../core/game/constants';
import { ARC_UP, Trajectory, flightTicks, mirvSplitPoint } from '../core/units/trajectory';
import type { GameEvent } from '../core/game/events';
import { dayPhase } from '../core/rules/features';
import { liveRing } from '../core/rules/victory';
import { ParticleSystem } from './particles';
import { NukeFx, lerpColor } from './nukeFx';
import { MissileFx } from './missileFx';
import { ShipLayer } from './ships';
import { WeatherLayer } from './weatherLayer';
import { TradeRouteLayer } from './tradeRoutes';
import { RailLayer } from './railLayer';
import { CapitalLayer } from './capitals';
import { FrontLineLayer } from './frontLines';
import type { AimDraft, BorderDraft, LineDraft } from '../ui/game/input';
import { FlagTextures } from './flagTextures';
import { MINOR_BADGE_ZOOM, badgePriority, badgePx, badgeSpacing, majorBuilding } from './badgeSize';
import { flagAspect } from './flags';
import { REL_COLOR, SAM_LINE } from './relations';

/** QA: a visual-only missile (ticks on the QA clock). */
interface QaFlight {
  id: number;
  type: number;
  owner: number;
  kind: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t0: number;
  t1: number;
  arc: number;
  dest: number;
  /** MIRV carrier: warheads released at the end, spread (tiles) around the target. */
  warheads: number;
  spread: number;
  /** Blast drawn at impact (nukeFx, render only). */
  blast: boolean;
}

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
  /**
   * Building being placed: where the order would put it (`tile`, the click snapped to the
   * nearest free spot, or the building it would upgrade), whether it can, and the cursor's
   * tile (`from`) when the spot is elsewhere.
   */
  ghost: { kind: number; tile: number; ok: boolean; from?: number } | null;
  /**
   * Radii of action; `strong`: the one of a building being placed (bolder); `invalid`: it
   * cannot go there (dashed, not only red).
   */
  ranges: { x: number; y: number; r: number; color: number; strong?: boolean; invalid?: boolean }[];
  boatPath: number[] | null;
  /** Missile launch preview: path from the silo that would fire, predicted interception, blast. */
  nukePreview: NukePreview | null;
  /** Aircraft aiming preview: route from the airfield, reach, the building hit, the danger on the way. */
  airPreview: AirPreview | null;
  /** Show every known SAM's coverage (own green, allies yellow, others red). */
  samCoverage: boolean;
  /** The reach of every front line in sight, shaded (settings.game.defenceZones). */
  defenceZones: boolean;
  /** A front line being drawn (input.ts). */
  lineDraft: LineDraft | null;
  /** My front line under the pointer (lit: a click opens it), -1 none. */
  lineHover: number;
  /** An offensive line being laid on a border, and one's arrow being aimed (input.ts). */
  border: BorderDraft | null;
  aim: AimDraft | null;
  /** The words on an offensive line's arrow for its charge (set by the interface, i18n). */
  arrowText: (charge: number) => string;
  /** Build-bar filter: these building types light up, the others fade (null: no filter). */
  buildingFilter: number[] | null;
  /**
   * Aiming a missile or a bomber (or hovering the missile buttons): hostile buildings are the
   * targets, drawn at full strength whatever the filter, marked with corner brackets, and
   * shown at every zoom.
   */
  aimTargets: boolean;
  selection: Set<number>;
  dragRect: [number, number, number, number] | null;
  highlightPlayer: number;
  terrainView: boolean;
  resourcesView: boolean;
  fogView: boolean;
  loyaltyView: boolean;
  /** Campaign guide: a pulsing marker on what the current step is about. */
  guideMarker: [number, number] | null;
  /** Trade-route view: sea lanes and busy railways (on by default). */
  tradeRoutes: boolean;
  /** Choosing a new capital: the hovered tile and whether it may host it. */
  capitalGhost: { tile: number; ok: boolean } | null;
  /** Photo mode: what the picture keeps (null: not in photo mode, everything shows). */
  photo: { labels: boolean; borders: boolean; weather: boolean } | null;
  /** Time of day forced by the photo mode (0 day … 1 deep night); -1: the game's clock. */
  night: number;
}

/** How long a front stays marked after a wave (ms). */
const FRONT_MARK_MS = 2600;
/** A country looked for (focusPlayer): the reticle closing in on it, then pulsing (ms). */
const LOCATE_MS = 3600;
/** A revolution's outbreak: the shockwave over its region (ms); then a slow pulse while it lasts. */
const REVOLT_BURST_MS = 7000;
const REVOLT_PULSE_MS = 2600;
/** The rebels' oxblood (palette.ts REBEL_INK), a shade brighter to read over their own land. */
const REVOLT_INK = 0x9a3530;
const PAPER = 0xf6f1e4;
const INK_DARK = 0x0b1824;

/** No storm nor fog bank (the shader's weather cells, all empty). */
const NO_WEATHER = new Float32Array(32).fill(-1);

export interface NukePreview {
  kind: number;
  /** Silo → impact (MIRV: silo → separation point); null without any silo. */
  path: Trajectory | null;
  tx: number;
  ty: number;
  /** Fraction of the path where a hostile SAM is predicted to strike (-1: clear sky). */
  interceptF: number;
  /** The blast would break an alliance. */
  betray: boolean;
  /** A loaded silo would fire (false: drawn from the nearest silo, still reloading). */
  ready: boolean;
}

/** Aiming an aircraft (ui/game/airPreview.ts). */
export interface AirPreview {
  /** A.Fighter, A.Bomber or A.Recon. */
  kind: number;
  /** The airfield it would take off from (NaN: none). */
  fx: number;
  fy: number;
  /** Aim point (a bomber's: the centre of the building it would hit). */
  tx: number;
  ty: number;
  /** How far the plane flies from its airfield. */
  reach: number;
  /** The order would be carried out. */
  ok: boolean;
  /** Fighter patrol / reconnaissance zone radius (0: none). */
  zone: number;
  /** Bomber: a building or a ship is in its sights (`destroy`: nothing would be left of it). */
  target: { destroy: boolean } | null;
  /** Bomber at sea: the radius its bombs hit ships within (0: a strike on land). */
  blast: number;
  /** Fraction of the route where a loaded hostile SAM would down the bomber (-1: none). */
  samF: number;
  /** SAMs or interceptors wait for it. */
  danger: boolean;
}

interface UnitSprite {
  /** Container rotated/scaled as a whole: [hull, owner mark] (trains: articulated pieces). */
  s: Container;
  seen: number;
  wakeT: number;
  /** Trains: recent head positions (x, y, newest first) that the wagons follow. */
  trail?: number[];
}

/** A country's map label: flag, name, troops and status badges. */
interface MapLabel {
  name: BitmapText;
  troops: BitmapText;
  icons: Sprite[];
  flag: Sprite;
  /** Flag texture key ('' for tribes, which carry none). */
  flagKey: string;
  flagTex: Texture | null;
  /** Flag width / height. */
  aspect: number;
  /** Name width at scale 1 (64 px font), measured when the text changes. */
  nameW: number;
}

/** A troop-count pill pinned on a stretch of front. */
interface FrontBadge {
  c: Container;
  bg: Graphics;
  txt: BitmapText;
  /** Where it is pinned, and where it glides to when the front has moved on. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  text: string;
  seen: number;
}

/** A front badge stays put until its stretch of front has moved this far (tiles). */
// Outlined bitmap text gets one glyph atlas per TextStyle *instance* (Pixi keys stroked
// fonts by style uid): inline styles built a new atlas for every label and building
// badge (dozens of fonts, Pixi warning). Shared instances keep one atlas per look.
const LEVEL_STYLE = new TextStyle({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 40,
  fill: 0xffffff,
  fontWeight: '600',
  stroke: { color: 0x0b0e12, width: 8, join: 'round' },
});
const NAME_STYLE = new TextStyle({
  fontFamily: '"IBM Plex Serif", Georgia, serif',
  fontSize: 64,
  fill: 0xffffff,
  fontWeight: '600',
  stroke: { color: 0x0b0e12, width: 9, join: 'round' },
});
const TROOPS_STYLE = new TextStyle({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 40,
  fill: 0xffffff,
  stroke: { color: 0x0b0e12, width: 7, join: 'round' },
});

const FRONT_BADGE_SLACK = 28;

/**
 * Length of each aircraft: [map tiles, least on-screen px]. 1.11.0: like the ships
 * (ships.ts), planes keep their size on the map when zooming out (they used to keep 24–30 px
 * on screen and grew against the land); the small minimum keeps a far plane visible.
 */
const PLANE_SIZE: Partial<Record<U, readonly [number, number]>> = {
  [U.Fighter]: [3.2, 9],
  [U.Bomber]: [4.2, 11],
  [U.Recon]: [2.8, 8],
};
/** Train: wagons behind the locomotive, and the smallest on-screen wagon length (px). */
const TRAIN_WAGONS = 3;
const TRAIN_CAR_MIN_PX = 5;

export class GameRenderer {
  readonly app = new Application();
  readonly camera = new Camera();
  private map!: MapLayer;
  private world = new Container();
  private screen = new Container();
  /** Railways: track by zoom, built and torn up before our eyes (railLayer.ts). */
  private railLayer!: RailLayer;
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
  private nukeFx!: NukeFx;
  /** Missiles in flight and at launch (render only: missileFx.ts). */
  private missileFx = new MissileFx();
  /** QA: visual-only missiles (no simulation), on their own clock. */
  private qaFlights: QaFlight[] = [];
  private qaNextId = -1;
  private ships!: ShipLayer;
  private weather!: WeatherLayer;
  private routes!: TradeRouteLayer;
  private capitals!: CapitalLayer;
  private frontLines = new FrontLineLayer();
  private unitSprites = new Map<number, UnitSprite>();
  private buildingSprites = new Map<number, Container>();
  private labelPool = new Map<number, MapLabel>();
  /** Flags shown before the country names (one texture per distinct flag). */
  private flagTex = new FlagTextures();
  private missilePaths = new Map<number, Trajectory>();
  /** Troop counts on each stretch of front of the attacks that involve the viewer. */
  private frontBadges = new Map<number, FrontBadge[]>();
  /** Per frame: who has missiles in flight, and at whom (for the radiation badges). */
  private nukesInFlight = new Map<number, boolean>();
  /** Building badges placed by the last declutter pass, and the view it was computed for. */
  private badgeShown = new Set<number>();
  private badgeKey = '';
  private buildingsVersion = -1;
  private fogVersion = -1;
  private loyaltyVersion = -1;
  private paletteKey = '';
  private frame = 0;
  private flashAlpha = 0;
  /** Peak of the current screen flash (its colour cools from white to amber as it fades). */
  private flashPeak = 0;
  /** Last MIRV warhead flash (the salvo's flashes are throttled, and never strobe in reduced motion). */
  private lastWarheadFlash = 0;
  private shake = 0;
  private startTime = performance.now();
  private pings: { x: number; y: number; t: number; color: number; kind: number }[] = [];
  /** Fronts marked for a moment: a wave sent at us (red: an invasion in view, brass: a riposte). */
  private frontMarks: { x: number; y: number; t: number; color: number; hostile: boolean }[] = [];
  private pacts: { ax: number; ay: number; bx: number; by: number; t: number }[] = [];
  /** The country just looked for (focusPlayer) and the box of its land. */
  private located: { id: number; box: [number, number, number, number]; t: number } | null = null;
  /** Revolutions breaking out (their shockwave), and where each one rose (until its label is known). */
  private revoltBursts: { tribe: number; x: number; y: number; t: number; mine: boolean }[] = [];
  private revoltSeeds = new Map<number, [number, number]>();
  private emojis: { x: number; y: number; t: number; text: Container }[] = [];
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
    nukePreview: null,
    airPreview: null,
    samCoverage: false,
    defenceZones: true,
    lineDraft: null,
    lineHover: -1,
    border: null,
    aim: null,
    arrowText: (c: number) => `${Math.round(c * 100)} %`,
    buildingFilter: null,
    aimTargets: false,
    selection: new Set(),
    dragRect: null,
    highlightPlayer: -1,
    terrainView: false,
    resourcesView: false,
    fogView: true,
    loyaltyView: false,
    guideMarker: null,
    tradeRoutes: true,
    capitalGhost: null,
    photo: null,
    night: -1,
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
    this.icons = await buildIcons(this.app.renderer);
    this.map = new MapLayer(this.state, this.app.renderer);
    this.particles = new ParticleSystem(this.icons, 2600);
    this.nukeFx = new NukeFx();
    await this.missileFx.init();
    this.ships = new ShipLayer(this.icons, this.particles, {
      inkOf: (id) => this.inkOf(id),
      particles: () => this.settings.particles,
      uiScale: () => this.settings.uiScale,
      formatTroops: formatShort,
      reducedMotion: () => this.settings.reducedMotion,
      alive: (id) => this.state.players.get(id)?.alive ?? false,
    });
    this.units.addChild(this.ships.container);
    this.weather = new WeatherLayer(this.state, this.icons);
    this.routes = new TradeRouteLayer(this.state, {
      ink: (id) => this.inkOf(id),
      seen: (owner, x, y) => this.revealed(owner, x, y),
    });
    this.railLayer = new RailLayer(this.state, {
      ink: (id) => this.inkOf(id),
      seen: (owner, x, y) => this.revealed(owner, x, y),
      particles: () => this.settings.particles,
      reducedMotion: () => this.settings.reducedMotion,
      inkKey: () => this.settings.vision,
    });
    this.lights.blendMode = 'add';
    this.trails.blendMode = 'add';
    this.world.addChild(
      this.map.mesh,
      this.routes.railGlow,
      this.railLayer.container,
      this.routes.lanes,
      this.routes.cuts,
      this.nukeFx.ground,
      this.frontLines.container,
      this.deposits,
      this.lights,
      this.buildings,
      this.missileFx.ground,
      this.units,
      this.trails,
      this.particles.container,
      this.nukeFx.air,
      this.missileFx.air,
      this.weather.container,
      this.overlayG,
      this.labels,
    );
    // Capital markers sit just above the building badges.
    this.capitals = new CapitalLayer(this.state, {
      revealed: (owner, x, y) => this.revealed(owner, x, y),
      inkOf: (id) => this.inkOf(id),
      uiScale: () => this.settings.uiScale,
      reducedMotion: () => this.settings.reducedMotion,
    });
    await this.capitals.init();
    this.world.addChildAt(this.capitals.container, this.world.getChildIndex(this.buildings) + 1);
    // Ship health bars and selection rings, over the hulls.
    this.world.addChildAt(this.ships.fx, this.world.getChildIndex(this.units) + 1);
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
    this.railLayer.reset();
    this.buildingsVersion = -1;
    this.routes.invalidate();
  }

  applySettings(): void {
    this.app.ticker.maxFPS = this.settings.maxFps > 0 ? this.settings.maxFps : 0;
    this.camera.reducedMotion = this.settings.reducedMotion;
    this.paletteKey = '';
  }

  destroy(): void {
    this.flagTex.destroy();
    this.app.destroy(true, { children: true, texture: true });
  }

  // --------------------------------------------------------------- palette
  private updatePalette(): void {
    const s = this.state;
    const local = s.local;
    const me = s.players.get(s.viewer);
    const rel = new Map<number, number>();
    for (const p of s.playerList) {
      if (p.id === s.viewer) continue;
      if (me && (me.allies.includes(p.id) || (me.team > 0 && p.team === me.team))) rel.set(p.id, 1);
      else if (local?.wars.includes(p.id)) rel.set(p.id, 2);
      // A neighbour massing an army on our border: its shared border glows amber.
      else if (local?.threats?.some((x) => x.id === p.id)) rel.set(p.id, 4);
      else if (local?.noTrade.includes(p.id)) rel.set(p.id, 3);
    }
    // Revolutions are hatched in ink (a pattern, not only a colour: GAME_DESIGN.md §6.5).
    const hatched = new Set(s.playerList.filter((p) => p.revoltFor !== undefined).map((p) => p.id));
    const key =
      `${this.settings.vision}|${s.playerList.map((p) => `${p.id}:${p.color}`).join(',')}|` +
      [...rel].map(([id, r]) => `${id}:${r}`).join(',') +
      `|${[...hatched].join(',')}`;
    if (key === this.paletteKey) return;
    this.paletteKey = key;
    const m = new Map<number, [number, number, number]>();
    for (const p of s.playerList) m.set(p.id, inkRgb(p.color, this.settings.vision));
    this.map.setPalette(m, rel, hatched);
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
    const photo = this.overlay.photo;
    const night =
      this.overlay.night >= 0
        ? Math.min(1, this.overlay.night)
        : weatherOn
          ? Math.max(0, Math.sin((phase - 0.5) * Math.PI * 2))
          : 0;
    // Storms and fog banks: packed for the shader, marked with an outline and a glyph.
    const skies = !photo || photo.weather;
    const weather = skies ? this.weather.update(tickF, cam.zoom) : NO_WEATHER;
    this.weather.container.visible = skies;
    this.labels.visible = !photo || photo.labels;
    const ring = s.world?.ring;
    const live = ring ? liveRing(ring, tickF) : null;
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
      borders: !photo || photo.borders,
      motion: this.settings.reducedMotion ? 0 : 1,
      // Battle royale: the zone in force, sliding while it closes, and the next one announced.
      ring: live ? [live[0], live[1], live[2], 1] : [0, 0, 0, 0],
      ringNext:
        ring && ring.endAt < 0 ? [ring.nx, ring.ny, ring.nr, tickF >= ring.closeAt ? 2 : 1] : [0, 0, 0, 0],
      // Clouds fade in as the camera pulls back past the medium zoom.
      clouds:
        q === 'performance' || this.settings.reducedMotion || !skies
          ? 0
          : Math.max(0, Math.min(1, (1.1 - cam.zoom) / 0.6)),
    });

    // LOD visibility.
    const z = cam.zoom;
    this.deposits.visible = this.overlay.resourcesView || z > 2.5;
    for (const d of this.deposits.children)
      d.scale.set(Math.min(0.34, (18 / 64 / z) * (this.overlay.resourcesView ? 1.2 : 1)));
    this.railLayer.update(z, this.camera.bounds(), dt);
    this.routes.update(z, tickF, this.overlay.tradeRoutes, this.camera.bounds());
    if (s.buildingsVersion !== this.buildingsVersion) this.syncBuildings();
    this.updateBuildings(night, t);
    this.capitals.update(z);
    this.updateUnits(alpha, tickF, dt, t);
    this.particles.update(dt, z);
    this.nukeFx.update(dt, cam.bounds());
    this.updateFrontLines(z);
    this.drawOverlay(t);
    this.updateLabels(z);
    this.updateFronts(z);
    this.updateFloaters(dt, z);
    // Screen flash (nukes).
    this.flash.clear();
    if (this.flashAlpha > 0.01) {
      // White-out at the peak, cooling to a warm amber veil as it fades.
      const cool = 1 - this.flashAlpha / Math.max(0.01, this.flashPeak);
      const color = lerpColor(0xfffdf8, 0xffb878, cool * 1.4);
      this.flash.rect(0, 0, cam.viewW, cam.viewH).fill({ color, alpha: this.flashAlpha });
      this.flashAlpha *= Math.exp(-dt * (this.settings.reducedMotion ? 1.8 : 3.4));
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
        // Badge: dark disc, ring in the owner's colour, white glyph (sizes in 32-unit design space).
        const back = new Sprite(this.icons.backdrop);
        back.anchor.set(0.5);
        back.setSize(32, 32);
        const ring = new Sprite(this.icons.badgeRing);
        ring.anchor.set(0.5);
        ring.setSize(32, 32);
        const ico = new Sprite(this.icons.buildings[b.type]!);
        ico.anchor.set(0.5);
        ico.setSize(20, 20);
        const prog = new Graphics();
        // Level number (as in OpenFront: structure levels are uncapped).
        const lvl = new BitmapText({
          text: '',
          style: LEVEL_STYLE,
        });
        lvl.anchor.set(0.5);
        lvl.position.set(12.5, 12.5);
        lvl.scale.set(0.45);
        lvl.tint = UI.brass;
        c.addChild(back, ring, ico, prog, lvl);
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
      (c.children[1] as Sprite).tint = ink;
      (c.children[2] as Sprite).tint = b.ready ? 0xffffff : 0x8d949b;
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

  /** Build-bar filter: only the viewer's own buildings of the filtered types light up (a way to find them). */
  private pickedByFilter(b: BuildingView): boolean {
    const filter = this.overlay.buildingFilter;
    const viewer = this.state.viewer;
    return !!filter && filter.includes(b.type) && (viewer <= 0 || b.owner === viewer);
  }

  /** While aiming (overlay.aimTargets): a building we could strike, a hostile one. */
  private aimedAt(b: BuildingView): boolean {
    const viewer = this.state.viewer;
    return this.overlay.aimTargets && viewer > 0 && b.owner !== viewer && this.relation(b.owner) === 'foe';
  }

  /**
   * Map badges never pile up: each frame (when the view changed) the candidates in view are
   * ranked — the viewer's own first, then cities, silos, ports… — and a badge is drawn only
   * where it does not overlap one already placed. Zoomed far out, minor types wait.
   */
  private declutterBadges(z: number, size: number): void {
    const cam = this.camera;
    const filter = this.overlay.buildingFilter;
    const key = `${z.toFixed(4)}|${cam.cx.toFixed(1)}|${cam.cy.toFixed(1)}|${this.buildingsVersion}|${filter?.join(',') ?? ''}|${size}|${this.fogVersion}|${this.overlay.aimTargets ? 1 : 0}`;
    if (key === this.badgeKey && this.frame % 30 !== 0) return;
    this.badgeKey = key;
    const viewer = this.state.viewer;
    const [x0, y0, x1, y1] = cam.bounds();
    const m = size / z;
    const cands: { id: number; pri: number; sx: number; sy: number }[] = [];
    for (const c of this.buildingSprites.values()) {
      const b = (c as Container & { info?: BuildingView }).info!;
      if (b.x < x0 - m || b.x > x1 + m || b.y < y0 - m || b.y > y1 + m) continue;
      if (!this.revealed(b.owner, b.x, b.y)) continue;
      const picked = this.pickedByFilter(b);
      // Aiming: the targets come right after the filtered buildings, at every zoom.
      const target = this.aimedAt(b);
      const shown = picked || target;
      if (!shown && z < MINOR_BADGE_ZOOM && !majorBuilding(b.type)) continue;
      cands.push({
        id: b.id,
        pri:
          badgePriority(b.type, b.level, viewer > 0 && b.owner === viewer) +
          (picked ? 5000 : target ? 4000 : 0),
        sx: (b.x + 0.5) * z,
        sy: (b.y + 0.5) * z,
      });
    }
    cands.sort((a, b) => b.pri - a.pri || a.id - b.id);
    // Spatial hash in screen pixels: zoomed in two badges keep 85 % of a diameter apart;
    // zoomed out they leave room for the map (no carpet of icons over the world).
    const gap = badgeSpacing(z);
    const cell = size * gap;
    const minD2 = cell * cell;
    const grid = new Map<number, number[]>();
    this.badgeShown.clear();
    for (const k of cands) {
      const gx = Math.floor(k.sx / cell);
      const gy = Math.floor(k.sy / cell);
      let free = true;
      for (let dy = -1; dy <= 1 && free; dy++)
        for (let dx = -1; dx <= 1 && free; dx++) {
          const pts = grid.get((gx + dx) * 65536 + gy + dy);
          if (!pts) continue;
          for (let q = 0; q < pts.length; q += 2)
            if ((pts[q]! - k.sx) ** 2 + (pts[q + 1]! - k.sy) ** 2 < minD2) {
              free = false;
              break;
            }
        }
      if (!free) continue;
      const g = gx * 65536 + gy;
      const pts = grid.get(g);
      if (pts) pts.push(k.sx, k.sy);
      else grid.set(g, [k.sx, k.sy]);
      this.badgeShown.add(k.id);
    }
  }

  /**
   * A target's corner brackets around its badge (badge units, radius 16): a shape, not a
   * tint, so that it reads for colour-blind eyes; ink under paper, legible on any ground.
   */
  private drawTargetBrackets(g: Graphics): void {
    const r = 21;
    const arm = 7;
    for (const [w, color, alpha] of [
      [4.5, 0x0b0e12, 0.75],
      [2, UI.parchment, 1],
    ] as const) {
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const)
        g.moveTo(sx * r, sy * (r - arm))
          .lineTo(sx * r, sy * r)
          .lineTo(sx * (r - arm), sy * r);
      g.stroke({ width: w, color, alpha, cap: 'square', join: 'miter' });
    }
  }

  /** The building whose badge is under the screen point (px), as drawn — or null. */
  buildingAtScreen(sx: number, sy: number): BuildingView | null {
    const z = this.camera.zoom;
    const r = badgePx(z, this.settings.uiScale || 1) / 2;
    const filter = this.overlay.buildingFilter;
    let best: BuildingView | null = null;
    let bd = Infinity;
    for (const id of this.badgeShown) {
      const c = this.buildingSprites.get(id);
      if (!c || !c.visible) continue;
      const b = (c as Container & { info?: BuildingView }).info!;
      const [bx, by] = this.camera.worldToScreen(b.x + 0.5, b.y + 0.5);
      const d = Math.hypot(bx - sx, by - sy);
      const rr = filter && filter.includes(b.type) ? r * 1.3 : r;
      if (d <= rr && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private updateBuildings(night: number, t: number): void {
    const z = this.camera.zoom;
    const size = badgePx(z, this.settings.uiScale || 1);
    const scale = size / 32 / z;
    this.declutterBadges(z, size);
    const [x0, y0, x1, y1] = this.camera.bounds();
    for (const c of this.buildingSprites.values()) {
      const b = (c as Container & { info?: BuildingView }).info!;
      const inView = b.x >= x0 - 2 && b.x <= x1 + 2 && b.y >= y0 - 2 && b.y <= y1 + 2;
      const filter = this.overlay.buildingFilter;
      const picked = this.pickedByFilter(b);
      // Aiming a missile or a bomber, the enemy's buildings are what we aim at: never faded.
      const target = this.aimedAt(b);
      c.visible = inView && this.badgeShown.has(b.id);
      // Filter: matching buildings stand out (bigger, pulsing halo), the others fade.
      const faded = !!filter && !picked && !target;
      c.alpha = faded ? 0.18 : 1;
      // City lights at night (additive glow) — kept even where the badge gave way to another.
      const light = (c as Container & { light?: Sprite }).light;
      if (light) {
        const lit =
          inView &&
          (b.type === B.City || b.type === B.Port || b.type === B.Factory) &&
          night > 0.05 &&
          this.settings.quality !== 'performance' &&
          this.revealed(b.owner, b.x, b.y);
        light.visible = lit;
        if (lit) {
          light.position.set(b.x + 0.5, b.y + 0.5);
          const flicker = 0.9 + 0.1 * Math.sin(t * 3 + b.id);
          light.scale.set((0.13 + 0.035 * Math.min(6, b.level)) * (b.type === B.City ? 1 : 0.6));
          light.tint = 0xffd38a;
          light.alpha = night * 0.8 * flicker * (faded ? 0.18 : 1);
        }
      }
      if (!c.visible) continue;
      c.scale.set(picked ? scale * 1.3 : scale);
      const prog = c.children[3] as Graphics;
      prog.clear();
      if (picked) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 5);
        prog.circle(0, 0, 20).stroke({ width: 3, color: 0xffffff, alpha: 0.5 + 0.4 * pulse });
        prog.circle(0, 0, 25).stroke({ width: 2, color: 0xffffff, alpha: 0.25 * pulse });
      } else if (target) this.drawTargetBrackets(prog);
      if (b.demolish > 0) {
        // Being demolished (1.16): a ring of short ink-and-paper ticks (a shape, not a tint)
        // empties as the countdown runs, and the badge is struck through like a cancelled
        // line — out of service meanwhile (icon greyed).
        const left = b.demolish / Math.max(1, b.demolishTotal);
        const ticks = 20;
        const step = (Math.PI * 2) / ticks;
        const end = -Math.PI / 2 + Math.PI * 2 * left;
        prog.circle(0, 0, 17.5).stroke({ width: 5, color: 0x0b0e12, alpha: 0.45 });
        for (let k = 0; k < ticks; k++) {
          const a0 = -Math.PI / 2 + k * step;
          const a1 = a0 + step * 0.4;
          prog.moveTo(Math.cos(a0) * 17.5, Math.sin(a0) * 17.5).arc(0, 0, 17.5, a0, a1);
          prog.stroke({ width: 3.5, color: UI.parchment, alpha: a0 < end ? 1 : 0.2 });
        }
        prog.moveTo(-12, 12).lineTo(12, -12).stroke({ width: 5, color: 0x0b0e12, alpha: 0.8, cap: 'round' });
        prog.moveTo(-12, 12).lineTo(12, -12).stroke({ width: 2.5, color: UI.parchment, cap: 'round' });
      } else if (b.occupied > 0 && b.progress >= 1) {
        // Occupied after a capture (GAME_DESIGN.md §6.4): a red ring empties as the
        // occupation ends; the icon stays greyed until then (out of service). The ring is
        // broken into links (a chain), so it never reads as the solid upgrade ring by colour alone.
        const left = b.occupied / Math.max(1, b.occupiedTotal);
        prog.circle(0, 0, 17.5).stroke({ width: 5, color: UI.slate, alpha: 0.55 });
        const links = 12;
        const step = (Math.PI * 2) / links;
        const end = -Math.PI / 2 + Math.PI * 2 * left;
        for (let k = 0; k < links; k++) {
          const a0 = -Math.PI / 2 + k * step;
          const a1 = a0 + step * 0.62;
          // moveTo: an arc must not start with a stroke from the centre.
          prog.moveTo(Math.cos(a0) * 17.5, Math.sin(a0) * 17.5).arc(0, 0, 17.5, a0, a1);
          if (a0 < end) {
            prog.stroke({ width: 3, color: UI.signal, alpha: a1 <= end ? 1 : 0.6 });
          } else prog.stroke({ width: 3, color: UI.signal, alpha: 0.25 });
        }
      } else if (!b.ready && b.progress < 1) {
        prog
          .arc(0, 0, 17.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.progress)
          .stroke({ width: 3, color: 0xf2f0e8 });
      } else if (b.upgrade >= 0) {
        // Next level under construction: a brass ring fills while the building keeps working.
        prog.circle(0, 0, 17.5).stroke({ width: 3, color: UI.brass, alpha: 0.25 });
        prog
          .moveTo(0, -17.5)
          .arc(0, 0, 17.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.upgrade)
          .stroke({ width: 3, color: UI.brass });
      }
      const lvl = c.children[4] as BitmapText;
      lvl.visible = b.level > 1;
      if (lvl.visible && lvl.text !== String(b.level)) lvl.text = String(b.level);
    }
  }

  // ---------------------------------------------------------------- units
  private updateUnits(alpha: number, tickF: number, dt: number, t: number): void {
    const s = this.state;
    const z = this.camera.zoom;
    const buf = s.units;
    this.trails.clear();
    this.nukesInFlight.clear();
    const missilesSeen = new Set<number>();
    const [vx0, vy0, vx1, vy1] = this.camera.bounds();
    this.ships.begin(this.frame, z, dt);
    this.missileFx.begin({
      zoom: z,
      bounds: [vx0, vy0, vx1, vy1],
      t,
      dt,
      particles: this.settings.particles,
      reducedMotion: this.settings.reducedMotion,
    });
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
        missilesSeen.add(id);
        this.drawMissile(buf, o, tickF, t);
        continue;
      }
      const inView = x >= vx0 - 5 && x <= vx1 + 5 && y >= vy0 - 5 && y <= vy1 + 5;
      if (type === U.Shell) {
        this.ships.shell(id, owner, x, y, this.trails, inView && this.revealed(owner, x, y));
        continue;
      }
      if (type === U.Transport || type === U.Warship || type === U.Merchant) {
        // LOD: merchants from medium zoom; enemy transports hide in fog banks.
        const visible =
          inView &&
          z >= (type === U.Merchant ? 1.2 : 0.4) &&
          this.revealed(owner, x, y) &&
          !(type === U.Transport && this.hiddenInFogBank(owner, x, y));
        this.ships.ship(
          id,
          type,
          owner,
          x,
          y,
          buf[o + 3]!,
          buf[o + 4]!,
          prev ? prev[0] : NaN,
          prev ? prev[1] : NaN,
          buf[o + 5]!,
          buf[o + 6]!,
          buf[o + 7]!,
          buf[o + 14]!,
          visible,
          this.overlay.selection.has(id),
        );
        continue;
      }
      if (type === U.Train) {
        // On the drawn track (its rail and progress ride in the slots 15 and 13).
        const on = this.railLayer.trainAt(id, buf[o + 16]!, buf[o + 13]!, s.tick, alpha);
        if (on) [x, y] = on;
        this.updateTrain(id, owner, x, y, z, inView);
        continue;
      }
      let us = this.unitSprites.get(id);
      if (!us) {
        const art = this.unitArt(type);
        const sp = new Container();
        const hull = new Sprite(art.base);
        hull.anchor.set(0.5);
        const mark = new Sprite(art.mark);
        mark.anchor.set(0.5);
        sp.addChild(hull, mark);
        // Normalise: the sprite is `length` tiles long at scale 1.
        const k = art.length / art.base.width;
        hull.scale.set(k);
        mark.scale.set(k);
        this.units.addChild(sp);
        us = { s: sp, seen: 0, wakeT: 0 };
        this.unitSprites.set(id, us);
        sp.position.set(x, y);
      }
      us.seen = this.frame;
      const sp = us.s;
      const dx = x - sp.x;
      const dy = y - sp.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.0005) {
        const turn = Math.atan2(dy, dx) - sp.rotation;
        const d = turn - Math.PI * 2 * Math.round(turn / (Math.PI * 2));
        sp.rotation += Math.abs(d) > 2.5 ? d : d * Math.min(1, dt * 12);
      }
      sp.position.set(x, y);
      // Aircraft (ships: ShipLayer).
      sp.visible = inView && z >= 0.4 && this.revealed(owner, x, y);
      if (!sp.visible) continue;
      // Its size on the map whatever the zoom, never under a few pixels.
      const lenTiles = this.unitArt(type).length;
      const [tiles, least] = PLANE_SIZE[type] ?? [lenTiles, 9];
      sp.scale.set(Math.max(tiles, least / z) / lenTiles);
      (sp.children[1] as Sprite).tint = this.inkOf(owner);
      // Contrails behind planes.
      us.wakeT += dt;
      const moving = Math.abs(dx) + Math.abs(dy) > 0.001;
      if (moving && us.wakeT > 0.08 && this.settings.particles > 0 && type >= U.Fighter) {
        us.wakeT = 0;
        this.particles.emit(
          x - Math.cos(sp.rotation) * 0.8,
          y - Math.sin(sp.rotation) * 0.8,
          0,
          0,
          0xdfe8f0,
          0.9,
          0.35,
          'dot',
          0.18,
        );
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
    this.updateQaFlights(missilesSeen, t);
    for (const id of this.missilePaths.keys()) if (!missilesSeen.has(id)) this.missilePaths.delete(id);
    this.missileFx.end();
    this.ships.end();
  }

  /**
   * Articulated train: the locomotive leads, each wagon follows the path the
   * locomotive actually took (a breadcrumb trail), so the train bends with the track.
   */
  private updateTrain(id: number, owner: number, x: number, y: number, z: number, inView: boolean): void {
    let us = this.unitSprites.get(id);
    if (!us) {
      const sp = new Container();
      const loco = new Sprite(this.icons.train.base);
      const mark = new Sprite(this.icons.train.mark);
      sp.addChild(loco, mark);
      for (let k = 0; k < TRAIN_WAGONS; k++) sp.addChild(new Sprite(this.icons.trainCar.base));
      for (const c of sp.children) (c as Sprite).anchor.set(0.5);
      this.units.addChild(sp);
      us = { s: sp, seen: 0, wakeT: 0, trail: [x, y] };
      this.unitSprites.set(id, us);
    }
    us.seen = this.frame;
    const tr = us.trail!;
    const moved = Math.hypot(tr[0]! - x, tr[1]! - y);
    if (moved > 6) tr.length = 0; // jumped (new route): start a fresh trail
    if (tr.length === 0 || moved > 0.04) {
      tr.unshift(x, y);
      if (tr.length > 400) tr.length = 400;
    }
    const sp = us.s;
    sp.visible = inView && z >= 2.2 && this.revealed(owner, x, y);
    if (!sp.visible) return;
    // Its size on the map (like the ships), never under a few pixels a wagon.
    const scale = Math.max(1, TRAIN_CAR_MIN_PX / (this.icons.trainCar.length * z));
    const pieces: [Sprite[], number][] = [
      [[sp.children[0] as Sprite, sp.children[1] as Sprite], this.icons.train.length],
    ];
    for (let k = 0; k < TRAIN_WAGONS; k++)
      pieces.push([[sp.children[2 + k] as Sprite], this.icons.trainCar.length]);
    let along = 0;
    for (const [sprites, len] of pieces) {
      const l = len * scale;
      const [px, py, angle] = trailPoint(tr, along + l / 2);
      for (const s of sprites) {
        s.position.set(px, py);
        s.rotation = angle;
        s.scale.set(l / s.texture.width);
      }
      along += l * 1.06;
    }
    (sp.children[1] as Sprite).tint = this.inkOf(owner);
  }

  /** Relation of a player to the viewer: own, friend (ally or teammate) or foe (spectators: foe). */
  relation(id: number): keyof typeof REL_COLOR {
    const s = this.state;
    if (s.viewer > 0 && id === s.viewer) return 'own';
    const me = s.players.get(s.viewer);
    if (me && (me.allies.includes(id) || (me.team > 0 && s.players.get(id)?.team === me.team)))
      return 'friend';
    return 'foe';
  }

  /** Fog of war: other players' things are drawn only in currently visible cells. */
  revealed(owner: number, x: number, y: number): boolean {
    const s = this.state;
    const fog = s.fog;
    if (!fog || s.viewer <= 0 || owner === s.viewer) return true;
    const me = s.players.get(s.viewer);
    if (me && (me.allies.includes(owner) || (me.team > 0 && s.players.get(owner)?.team === me.team)))
      return true;
    const fx = Math.min(fog.w - 1, Math.max(0, Math.floor(x / 4)));
    const fy = Math.min(fog.h - 1, Math.max(0, Math.floor(y / 4)));
    return fog.data[fy * fog.w + fx] === 255;
  }

  /** Enemy transports are hidden inside weather fog banks (original weather feature). */
  private hiddenInFogBank(owner: number, x: number, y: number): boolean {
    const s = this.state;
    const me = s.viewer;
    if (me <= 0 || owner === me) return false;
    // Allies and teammates keep no secrets from us (relation 'friend').
    if (this.relation(owner) === 'friend') return false;
    for (const c of s.world?.weather ?? []) {
      if (c.kind === 1 && (c.x - x) ** 2 + (c.y - y) ** 2 < c.r * c.r) return true;
    }
    return false;
  }

  /** Artwork of an aircraft (ships: ShipLayer, trains: updateTrain). */
  private unitArt(type: U): import('./icons').UnitSprite {
    switch (type) {
      case U.Bomber:
        return this.icons.bomber;
      case U.Recon:
        return this.icons.recon;
      default:
        return this.icons.fighter;
    }
  }

  /** Missiles along their real (simulated) arc (missileFx.ts), and impact telegraphs. */
  private drawMissile(buf: Float32Array, o: number, tickF: number, t: number): void {
    this.flight(
      buf[o]!,
      buf[o + 1]!,
      buf[o + 2]!,
      buf[o + 6]!,
      buf[o + 8]!,
      buf[o + 9]!,
      buf[o + 10]!,
      buf[o + 11]!,
      buf[o + 12]!,
      buf[o + 13]!,
      buf[o + 14]!,
      buf[o + 15]!,
      tickF,
      t,
    );
  }

  private flight(
    id: number,
    type: number,
    owner: number,
    kind: number,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    t0: number,
    t1: number,
    arc: number,
    dest: number,
    tickF: number,
    t: number,
  ): void {
    let path = this.missilePaths.get(id);
    if (!path) {
      path = new Trajectory(sx, sy, tx, ty, arc, this.state.height);
      this.missilePaths.set(id, path);
    }
    if (type === U.Nuke && dest >= 0 && id >= 0) {
      const atMe = this.state.viewer > 0 && this.state.owner[dest] === this.state.viewer;
      this.nukesInFlight.set(owner, (this.nukesInFlight.get(owner) ?? false) || atMe);
    }
    const w = this.state.width;
    const gx = dest >= 0 ? (dest % w) + 0.5 : tx;
    const gy = dest >= 0 ? ((dest / w) | 0) + 0.5 : ty;
    this.missileFx.missile(
      id,
      type,
      kind,
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
      tickF,
      this.inkOf(owner),
    );
    const g = this.trails;
    const z = this.camera.zoom;
    if (type === U.Interceptor || kind === N.Mirv) return;
    // Telegraph: destruction disc and dashed fallout ring, coloured by who launched it; a
    // hostile one is also barbed outwards like a hostile SAM ring (not colour alone).
    const relation = this.relation(owner);
    const rel = REL_COLOR[relation];
    const r = NUKE_RADIUS[kind as N] || 12;
    const rf = NUKE_FALLOUT_RADIUS[kind as N] || 18;
    const pulse = 0.85 + 0.1 * Math.sin(t * 3);
    g.circle(tx, ty, r)
      .fill({ color: rel, alpha: 0.12 })
      .stroke({ width: Math.max(0.3, 1.6 / z), color: rel, alpha: pulse });
    if (relation === 'foe') {
      const [dash, gap, tick] = SAM_LINE.foe;
      this.dashedCircle(g, tx, ty, rf, rel, pulse * 0.8, 1.6, dash, gap, t * 20, null, tick);
    } else if (kind === N.MirvWarhead)
      g.circle(tx, ty, rf).stroke({ width: Math.max(0.2, 1 / z), color: rel, alpha: 0.4 });
    else this.dashedCircle(g, tx, ty, rf, rel, pulse * 0.8, 1.6, 12, 6, t * 20, null);
  }

  /**
   * A dashed circle (dash, gap and phase in screen pixels). Arcs lying inside one of the
   * `skip` circles are left out, so overlapping circles read as one outline.
   */
  private dashedCircle(
    g: Graphics,
    cx: number,
    cy: number,
    r: number,
    color: number,
    alpha: number,
    widthPx: number,
    dash: number,
    gap: number,
    phase: number,
    skip: readonly { x: number; y: number; r: number }[] | null,
    /** Outward barbs (screen px) at the start of each dash: the hostile mark, readable without colour. */
    tickPx = 0,
  ): void {
    const z = this.camera.zoom;
    const circ = Math.PI * 2 * r * z;
    const n = Math.max(24, Math.min(720, Math.ceil(circ / 3)));
    const period = dash + gap;
    let open = false;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      const s = ((k + 0.5) / n) * circ + phase;
      let on = gap <= 0 || ((s % period) + period) % period < dash;
      if (on && skip) {
        const am = (a0 + a1) / 2;
        const mx = cx + Math.cos(am) * r;
        const my = cy + Math.sin(am) * r;
        for (const c of skip) {
          if ((c.x !== cx || c.y !== cy || c.r !== r) && (mx - c.x) ** 2 + (my - c.y) ** 2 < c.r * c.r) {
            on = false;
            break;
          }
        }
      }
      if (on) {
        if (!open && tickPx > 0) {
          const tr = r + tickPx / z;
          g.moveTo(cx + Math.cos(a0) * tr, cy + Math.sin(a0) * tr);
          g.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        } else if (!open) g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
        open = true;
      } else open = false;
    }
    g.stroke({ width: Math.max(0.08, widthPx / z), color, alpha });
  }

  /** Front lines (frontLines.ts): every one in sight, and the one being drawn. */
  private updateFrontLines(z: number): void {
    const s = this.state;
    const ov = this.overlay;
    this.frontLines.container.visible = !ov.photo;
    if (ov.photo) return;
    this.frontLines.width = s.width;
    this.frontLines.update(
      s.lines,
      s.linesVersion * 1000 + (this.fogVersion & 1023),
      {
        zoom: z,
        tick: s.tick,
        viewer: s.viewer,
        zones: ov.defenceZones,
        reducedMotion: this.settings.reducedMotion,
        color: (id) => this.inkOf(id),
        flag: (id) => {
          const p = s.players.get(id);
          return p && p.kind !== 'tribe' ? this.flagTex.get(this.flagTex.key(p), p) : null;
        },
        visible: (l, x, y) => this.revealed(l.owner, x, y),
        mine: (x, y) => s.owner[Math.floor(y) * s.width + Math.floor(x)] === s.viewer,
        bounds: this.camera.bounds(),
        hover: ov.lineHover,
        owner: (x, y) => s.owner[Math.floor(y) * s.width + Math.floor(x)] ?? 0,
        border: ov.border,
        aim: ov.aim,
        arrowText: ov.arrowText,
      },
      ov.lineDraft,
    );
  }

  /** An × (refused, intercepted…): a dark under-stroke then the colour, so it reads on any ground. */
  drawCross(g: Graphics, x: number, y: number, d: number, under: number, width: number, color: number): void {
    for (const [w, c] of [
      [under, 0x0b0e12],
      [width, color],
    ] as const)
      g.moveTo(x - d, y - d)
        .lineTo(x + d, y + d)
        .moveTo(x + d, y - d)
        .lineTo(x - d, y + d)
        .stroke({ width: w, color: c, cap: 'round' });
  }

  /**
   * Every known SAM's reach: own green, allies yellow, the others red (merged outlines). The
   * relation is also in the line itself, for colour-blind eyes (NukePanel's legend draws the
   * same): own a solid rule, allies long dashes, hostile short dashes barbed outwards.
   */
  private drawSamCoverage(g: Graphics, t: number): void {
    const groups: Record<string, { x: number; y: number; r: number }[]> = { own: [], friend: [], foe: [] };
    for (const b of this.state.buildings) {
      if (b.type !== B.Sam || !b.ready || !this.revealed(b.owner, b.x, b.y)) continue;
      groups[this.relation(b.owner)]!.push({
        x: b.x + 0.5,
        y: b.y + 0.5,
        r: this.state.samReach(b.owner, b.level),
      });
    }
    for (const rel of ['foe', 'friend', 'own'] as const) {
      const list = groups[rel]!;
      const color = REL_COLOR[rel];
      for (const c of list) g.circle(c.x, c.y, c.r).fill({ color, alpha: rel === 'foe' ? 0.07 : 0.05 });
      const [dash, gap, tick] = SAM_LINE[rel];
      for (const c of list)
        this.dashedCircle(g, c.x, c.y, c.r, color, 0.85, 2.2, dash, gap, t * 14, list, tick);
    }
  }

  /** Launch preview: dashed arc from the silo, dotted where SAMs cannot reach, red past the interception. */
  private drawNukePreview(g: Graphics, p: NukePreview): void {
    const z = this.camera.zoom;
    const lw = (px: number) => Math.max(0.08, px / z);
    const a = p.ready ? 1 : 0.45;
    if (p.kind !== N.Mirv) {
      const col = p.betray ? 0xff4d4d : 0xffffff;
      const r = NUKE_RADIUS[p.kind as N];
      const rf = NUKE_FALLOUT_RADIUS[p.kind as N];
      g.circle(p.tx, p.ty, rf)
        .fill({ color: col, alpha: 0.12 })
        .stroke({ width: lw(1.5), color: col, alpha: 0.5 });
      g.circle(p.tx, p.ty, r)
        .fill({ color: col, alpha: 0.18 })
        .stroke({ width: lw(2), color: col, alpha: 0.9 });
    } else {
      const c = lw(14);
      g.moveTo(p.tx - c, p.ty)
        .lineTo(p.tx + c, p.ty)
        .moveTo(p.tx, p.ty - c)
        .lineTo(p.tx, p.ty + c)
        .stroke({ width: lw(2), color: UI.signal });
    }
    const path = p.path;
    if (!path) return;
    const [sx, sy] = path.at(0);
    const [ex, ey] = path.at(1);
    const r2 = NUKE_TARGETABLE_RANGE * NUKE_TARGETABLE_RANGE;
    const n = Math.max(32, Math.min(1200, Math.ceil((path.length * z) / 2)));
    const safe: number[] = [];
    const hit: number[] = [];
    const marks: [number, number][] = [];
    let run = 0;
    let [px, py] = [sx, sy];
    let prevReach = true;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const [x, y] = path.at(f);
      const mx = (px + x) / 2;
      const my = (py + y) / 2;
      const reach =
        p.kind === N.Mirv || (mx - sx) ** 2 + (my - sy) ** 2 <= r2 || (mx - ex) ** 2 + (my - ey) ** 2 <= r2;
      if (reach !== prevReach) marks.push([px, py]);
      prevReach = reach;
      const segPx = Math.hypot(x - px, y - py) * z;
      const [dash, gap] = reach ? [8, 4] : [2, 6];
      if (run % (dash + gap) < dash) (p.interceptF >= 0 && f > p.interceptF ? hit : safe).push(px, py, x, y);
      run += segPx;
      px = x;
      py = y;
    }
    const strokeSegs = (segs: number[], width: number, color: number, alpha: number) => {
      for (let k = 0; k < segs.length; k += 4)
        g.moveTo(segs[k]!, segs[k + 1]!).lineTo(segs[k + 2]!, segs[k + 3]!);
      if (segs.length) g.stroke({ width: lw(width), color, alpha, cap: 'round' });
    };
    strokeSegs(safe, 4, 0x8c8c8c, 0.9 * a);
    strokeSegs(safe, 2.5, 0xffffff, a);
    strokeSegs(hit, 4, 0x965a5a, 0.9 * a);
    strokeSegs(hit, 2.5, 0xff5050, a);
    for (const [mx, my] of marks)
      g.circle(mx, my, lw(5))
        .fill({ color: 0xffffff, alpha: a })
        .stroke({ width: lw(1.5), color: 0x8c8c8c });
    if (p.interceptF >= 0) {
      const [ix, iy] = path.at(p.interceptF);
      const d = lw(9);
      for (const [w, c] of [
        [6, 0x000000],
        [3.5, 0xff4040],
      ] as const)
        g.moveTo(ix - d, iy - d)
          .lineTo(ix + d, iy + d)
          .moveTo(ix + d, iy - d)
          .lineTo(ix - d, iy + d)
          .stroke({ width: lw(w), color: c, cap: 'round' });
    }
    // MIRV: from the separation point the warheads spread over the target country.
    if (p.kind === N.Mirv)
      g.moveTo(ex, ey)
        .lineTo(p.tx, p.ty)
        .stroke({ width: lw(1.5), color: 0xffffff, alpha: 0.5 * a });
  }

  /**
   * What planes are doing (GAME_DESIGN.md §11), kept faint: our bombers and those bound for
   * our buildings draw a thin line to their target (red when it is ours), our reconnaissance
   * zones a dashed circle in our ink, a hostile one over our land a dashed red circle.
   */
  private drawAirActivity(g: Graphics, t: number): void {
    const s = this.state;
    const me = s.viewer;
    if (me <= 0 || s.unitCount === 0) return;
    const z = this.camera.zoom;
    const lw = (px: number) => Math.max(0.08, px / z);
    const w = s.width;
    const myInk = this.inkOf(me);
    const buf = s.units;
    for (let k = 0; k < s.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      const type = buf[o + 1]!;
      if (type !== U.Bomber && type !== U.Recon) continue;
      const owner = buf[o + 2]!;
      const [x, y, tx, ty] = [buf[o + 3]!, buf[o + 4]!, buf[o + 10]!, buf[o + 11]!];
      const tile = Math.floor(ty) * w + Math.floor(tx);
      const mine = owner === me;
      const aimed = s.owner[tile] === me;
      if ((!mine && !aimed) || !this.revealed(owner, x, y)) continue;
      const col = mine ? myInk : REL_COLOR.foe;
      if (type === U.Bomber) {
        if (buf[o + 6] !== 0) continue; // bombs dropped: flying home
        g.moveTo(x, y)
          .lineTo(tx, ty)
          .stroke({ width: lw(1.2), color: col, alpha: mine ? 0.45 : 0.6 });
        const pulse = 0.5 + 0.5 * Math.sin(t * 5 + k);
        const r = lw(8);
        g.circle(tx, ty, r * (1.3 + pulse * 0.5)).stroke({
          width: lw(1.2),
          color: col,
          alpha: 0.5 * (1 - pulse) + 0.15,
        });
        g.circle(tx, ty, r).stroke({ width: lw(2), color: col, alpha: 0.85 });
        // A bomber coming for our building: a crosshair, not only a red ring.
        if (!mine)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const)
            g.moveTo(tx + dx * r * 0.45, ty + dy * r * 0.45)
              .lineTo(tx + dx * r * 1.6, ty + dy * r * 1.6)
              .stroke({ width: lw(2), color: col, alpha: 0.85 });
      } else if (buf[o + 6] === 1) {
        // Orbiting reconnaissance: its zone (a hostile one barbed, as hostile SAM rings).
        const [dash, gap, tick] = mine ? [10, 7, 0] : SAM_LINE.foe;
        this.dashedCircle(
          g,
          tx,
          ty,
          RECON_RADIUS,
          col,
          mine ? 0.55 : 0.7,
          1.4,
          dash,
          gap,
          t * 10,
          null,
          tick,
        );
      }
    }
  }

  /** Aiming an aircraft: reach of the airfield, route, the building in its sights and the danger on the way. */
  private drawAirPreview(g: Graphics, p: AirPreview, t: number): void {
    const z = this.camera.zoom;
    const lw = (px: number) => Math.max(0.08, px / z);
    const col = p.ok ? 0xffffff : UI.signal;
    const hasField = Number.isFinite(p.fx);
    if (hasField) {
      g.circle(p.fx, p.fy, p.reach).stroke({ width: lw(1.2), color: 0xd1a64a, alpha: 0.55 });
      // Dashed route, red past the point where a loaded SAM would fire.
      const len = Math.hypot(p.tx - p.fx, p.ty - p.fy);
      const n = Math.max(2, Math.ceil((len * z) / 12));
      const safe: number[] = [];
      const hit: number[] = [];
      for (let k = 0; k < n; k += 2) {
        const f0 = k / n;
        const f1 = Math.min(1, (k + 1) / n);
        const seg = [
          p.fx + (p.tx - p.fx) * f0,
          p.fy + (p.ty - p.fy) * f0,
          p.fx + (p.tx - p.fx) * f1,
          p.fy + (p.ty - p.fy) * f1,
        ];
        (p.samF >= 0 && f0 >= p.samF ? hit : safe).push(...seg);
      }
      const stroke = (segs: number[], width: number, color: number, alpha: number) => {
        for (let k = 0; k < segs.length; k += 4)
          g.moveTo(segs[k]!, segs[k + 1]!).lineTo(segs[k + 2]!, segs[k + 3]!);
        if (segs.length) g.stroke({ width: lw(width), color, alpha, cap: 'round' });
      };
      stroke(safe, 3.5, 0x6d6a70, 0.8);
      stroke(safe, 2, p.ok ? 0xffffff : UI.signal, 0.95);
      stroke(hit, 3.5, 0x965a5a, 0.8);
      stroke(hit, 2, 0xff5050, 0.95);
      if (p.samF >= 0) {
        const ix = p.fx + (p.tx - p.fx) * p.samF;
        const iy = p.fy + (p.ty - p.fy) * p.samF;
        const d = lw(8);
        for (const [wd, c] of [
          [5.5, 0x000000],
          [3, 0xff4040],
        ] as const)
          g.moveTo(ix - d, iy - d)
            .lineTo(ix + d, iy + d)
            .moveTo(ix + d, iy - d)
            .lineTo(ix - d, iy + d)
            .stroke({ width: lw(wd), color: c, cap: 'round' });
      }
    }
    // At sea: the bombs' reach around the ship followed (a dashed ring, other ships inside it are hit).
    if (p.blast > 0) this.dashedCircle(g, p.tx, p.ty, p.blast, col, 0.9, 1.6, 6, 5, t * 10, null);
    if (p.zone > 0) {
      g.circle(p.tx, p.ty, p.zone).fill({ color: col, alpha: 0.06 });
      this.dashedCircle(g, p.tx, p.ty, p.zone, col, 0.85, 1.8, 10, 6, t * 12, null);
    }
    // The target: a reticle (on the building a bomber would hit, doubled when it would be razed).
    const r = Math.max(2.2, lw(13));
    const ret = p.kind === 1 && !p.target ? UI.signal : p.danger && p.ok ? 0xf2b84b : col;
    g.circle(p.tx, p.ty, r).stroke({ width: lw(4), color: 0x0b0e12, alpha: 0.55 });
    g.circle(p.tx, p.ty, r).stroke({ width: lw(2), color: ret });
    if (p.target?.destroy) g.circle(p.tx, p.ty, r * 1.35).stroke({ width: lw(1.5), color: ret, alpha: 0.8 });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      g.moveTo(p.tx + dx * r * 0.5, p.ty + dy * r * 0.5)
        .lineTo(p.tx + dx * r * 1.5, p.ty + dy * r * 1.5)
        .stroke({ width: lw(2), color: ret });
    // Order refused, or a bomber with nothing in its sights: the reticle is crossed out.
    if (!p.ok || (p.kind === 1 && !p.target)) this.drawCross(g, p.tx, p.ty, r * 0.6, lw(4.5), lw(2.2), ret);
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
    for (const r of ov.ranges) {
      // Refused spot: a broken (dashed) ring with a faint fill, never just a red one.
      if (r.invalid) {
        g.circle(r.x, r.y, r.r).fill({ color: r.color, alpha: 0.05 });
        this.dashedCircle(g, r.x, r.y, r.r, r.color, 0.95, 2.5, 7, 7, 0, null);
        continue;
      }
      g.circle(r.x, r.y, r.r)
        .fill({ color: r.color, alpha: r.strong ? 0.12 : 0.06 })
        .stroke({ width: lw(r.strong ? 2.5 : 1.5), color: r.color, alpha: r.strong ? 0.95 : 0.6 });
    }
    if (ov.capitalGhost) this.capitals.drawGhost(g, ov.capitalGhost, z);
    if (ov.ghost) {
      const x = (ov.ghost.tile % w) + 0.5;
      const y = ((ov.ghost.tile / w) | 0) + 0.5;
      const color = ov.ghost.ok ? UI.aurora : UI.signal;
      const rad = Math.max(1.2, 14 / z);
      const from = ov.ghost.from ?? -1;
      if (from >= 0 && from !== ov.ghost.tile) {
        // The click lands elsewhere (snapped): a thin lead from the cursor to the spot.
        const fx = (from % w) + 0.5;
        const fy = ((from / w) | 0) + 0.5;
        const d = Math.hypot(x - fx, y - fy);
        if (d > rad) {
          const ux = (x - fx) / d;
          const uy = (y - fy) / d;
          g.moveTo(fx, fy)
            .lineTo(x - ux * rad, y - uy * rad)
            .stroke({ width: lw(1.5), color, alpha: 0.8 });
        }
        g.circle(fx, fy, lw(3)).stroke({ width: lw(1.5), color, alpha: 0.8 });
      }
      if (ov.ghost.ok)
        g.circle(x, y, rad)
          .fill({ color, alpha: 0.25 })
          .stroke({ width: lw(2), color });
      else {
        // Refused: a dashed ring crossed out (shape, not only the red), ruled in dark for contrast.
        g.circle(x, y, rad).fill({ color, alpha: 0.18 });
        this.dashedCircle(g, x, y, rad, color, 1, 2, 4, 3, 0, null);
        this.drawCross(g, x, y, rad * 0.62, lw(4.5), lw(2.5), color);
      }
    }
    if (ov.boatPath && ov.boatPath.length > 1) {
      const p = ov.boatPath;
      g.moveTo((p[0]! % w) + 0.5, ((p[0]! / w) | 0) + 0.5);
      for (let k = 1; k < p.length; k++) g.lineTo((p[k]! % w) + 0.5, ((p[k]! / w) | 0) + 0.5);
      g.stroke({ width: lw(2), color: UI.aurora, alpha: 0.7 });
    }
    // Our transports at sea: a pulsing target on each landing point, joined by a faint wake line.
    const myInk = this.state.viewer > 0 ? this.inkOf(this.state.viewer) : UI.aurora;
    for (const tr of this.state.local?.transports ?? []) {
      if (tr.retreating) continue; // recalled: no landing to mark
      g.moveTo(tr.x, tr.y)
        .lineTo(tr.tx, tr.ty)
        .stroke({ width: lw(1.2), color: myInk, alpha: 0.35 });
      const r = lw(9);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4 + tr.id);
      g.circle(tr.tx, tr.ty, r * (1.6 + pulse * 0.6)).stroke({
        width: lw(1.2),
        color: myInk,
        alpha: 0.35 * (1 - pulse) + 0.1,
      });
      g.circle(tr.tx, tr.ty, r).stroke({ width: lw(4), color: 0x0b1824, alpha: 0.6 });
      g.circle(tr.tx, tr.ty, r).stroke({ width: lw(2), color: myInk });
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        g.moveTo(tr.tx + dx * r * 0.55, tr.ty + dy * r * 0.55)
          .lineTo(tr.tx + dx * r * 1.45, tr.ty + dy * r * 1.45)
          .stroke({ width: lw(2), color: myInk });
    }
    if (ov.samCoverage) this.drawSamCoverage(g, t);
    if (ov.nukePreview) this.drawNukePreview(g, ov.nukePreview);
    this.drawAirActivity(g, t);
    if (ov.airPreview) this.drawAirPreview(g, ov.airPreview, t);
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
    // A wave's front: a ring held a moment, and two slow ripples (screen-sized at any zoom).
    this.frontMarks = this.frontMarks.filter((f) => now - f.t < FRONT_MARK_MS);
    for (const f of this.frontMarks) {
      const a = (now - f.t) / FRONT_MARK_MS;
      const fade = a < 0.75 ? 1 : 1 - (a - 0.75) / 0.25;
      const r0 = 11 / z;
      g.circle(f.x, f.y, r0).stroke({ width: lw(4.5), color: 0x0b1824, alpha: 0.35 * fade });
      g.circle(f.x, f.y, r0).stroke({ width: lw(2.5), color: f.color, alpha: 0.95 * fade });
      g.circle(f.x, f.y, lw(2.6)).fill({ color: f.color, alpha: 0.95 * fade });
      if (f.hostile)
        for (let q = 0; q < 4; q++) {
          // Four chevrons pointing in at the front, just outside the ring.
          const a = Math.PI / 4 + (q * Math.PI) / 2;
          const [ux, uy] = [Math.cos(a), Math.sin(a)];
          const tip = r0 * 1.3;
          const base = r0 * 2.25;
          const half = r0 * 0.55;
          const pts = [
            f.x + ux * tip,
            f.y + uy * tip,
            f.x + ux * base - uy * half,
            f.y + uy * base + ux * half,
            f.x + ux * base + uy * half,
            f.y + uy * base - ux * half,
          ];
          g.poly(pts)
            .fill({ color: f.color, alpha: 0.95 * fade })
            .stroke({ width: lw(1.2), color: 0x0b1824, alpha: 0.5 * fade });
        }
      for (let k = 0; k < 2; k++) {
        const u = (a * 2 + k * 0.5) % 1;
        g.circle(f.x, f.y, r0 * (1 + u * 2.6)).stroke({
          width: lw(2),
          color: f.color,
          alpha: (1 - u) * 0.7 * fade,
        });
      }
    }
    this.drawRevolts(g, now, z);
    this.drawLocator(g, now, z);
    // Alliance pacts: a green arc drawn from one capital to the other, then fading.
    this.pacts = this.pacts.filter((p) => now - p.t < 4500);
    for (const p of this.pacts) {
      const age = (now - p.t) / 4500;
      const grow = Math.min(1, age * 3);
      const fade = age < 0.8 ? 1 : 1 - (age - 0.8) / 0.2;
      const mx = (p.ax + p.bx) / 2;
      const my = (p.ay + p.by) / 2 - Math.hypot(p.bx - p.ax, p.by - p.ay) * 0.25;
      const steps = 40;
      const pt = (u: number): [number, number] => [
        (1 - u) * (1 - u) * p.ax + 2 * (1 - u) * u * mx + u * u * p.bx,
        (1 - u) * (1 - u) * p.ay + 2 * (1 - u) * u * my + u * u * p.by,
      ];
      g.moveTo(p.ax, p.ay);
      for (let k = 1; k <= steps * grow; k++) g.lineTo(...pt(k / steps));
      g.stroke({ width: lw(3), color: REL_COLOR.own, alpha: 0.85 * fade, cap: 'round' });
      for (const [x, y] of [
        [p.ax, p.ay],
        [p.bx, p.by],
      ] as const)
        g.circle(x, y, lw(10 + 18 * age)).stroke({ width: lw(2), color: REL_COLOR.own, alpha: 0.7 * fade });
    }
    // Campaign guide marker: double pulsing ring and a downward chevron.
    if (ov.guideMarker) {
      const [mx, my] = ov.guideMarker;
      const pulse = (now % 1600) / 1600;
      const base = Math.max(3, 26 / z);
      g.circle(mx, my, base).stroke({ width: lw(2.5), color: UI.brass, alpha: 0.95 });
      g.circle(mx, my, base * (1 + pulse * 1.2)).stroke({ width: lw(2), color: UI.brass, alpha: 1 - pulse });
      const ay = my - base * 1.6 - Math.sin(now / 250) * (4 / z);
      const aw = Math.max(1.5, 10 / z);
      g.poly([mx - aw, ay - aw * 1.4, mx + aw, ay - aw * 1.4, mx, ay]).fill({ color: UI.brass });
    }
  }

  // --------------------------------------------------------------- labels
  /**
   * Country names, outlined for contrast and coloured by relation to the viewer
   * (ally green, at war red, traitor yellow), under a row of status badges.
   */
  private updateLabels(z: number): void {
    const s = this.state;
    const seen = new Set<number>();
    const lang = this.settings.lang;
    const local = s.local;
    let leader = -1;
    let most = 0;
    for (const p of s.playerList)
      if (p.alive && p.tiles > most) {
        most = p.tiles;
        leader = p.id;
      }
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const loc = this.located;
    for (const p of s.playerList) {
      if (!p.alive || p.tiles === 0) continue;
      let [lx, ly] = p.label;
      const size = p.label[2];
      let px = size * z;
      // The country just looked for: named however small, just over its reticle.
      const found = loc?.id === p.id && px < 40;
      if (found) {
        const [x0, y0, x1, y1] = loc.box;
        const r = Math.max(Math.hypot(x1 - x0, y1 - y0) / 2 + 5 / z, 16 / z);
        px = 44;
        lx = (x0 + x1) / 2;
        ly = (y0 + y1) / 2 - r - 22 / z;
      }
      const status: StatusIcon[] = [];
      const ally = local?.allies.find((a) => a.id === p.id);
      // Teammates read like allies (green name, a team badge) without the alliance timer.
      const friend = p.id !== s.viewer && this.relation(p.id) === 'friend';
      const atWar = !!local?.wars.includes(p.id);
      // A revolution: the raised fist leads its badges (hatched land, GAME_DESIGN.md §6.5).
      if (p.revoltFor !== undefined) status.push('revolt');
      if (p.id === leader) status.push('crown');
      if (p.traitor && (p.traitorFor > 150 || blink)) status.push('traitor');
      if (p.inactive) status.push('inactive');
      if (ally && (ally.expiresIn > 300 || blink)) status.push('ally');
      // Teammates: their own badge (the green name alone would be colour only).
      else if (friend && !ally) status.push('team');
      if (local?.allyRequests.includes(p.id)) status.push('request');
      if (atWar) status.push('war');
      if (local?.noTrade.includes(p.id)) status.push('noTrade');
      const nuke = this.nukesInFlight.get(p.id);
      if (nuke !== undefined) status.push(nuke ? 'nukeMe' : 'nuke');
      // Countries we deal with stay labelled a little further out.
      const minPx = found ? 0 : atWar || friend || nuke ? 11 : 18;
      if (px < minPx || !this.revealed(p.id, lx, ly)) continue;
      seen.add(p.id);
      let l = this.labelPool.get(p.id);
      if (!l) {
        const name = new BitmapText({
          text: '',
          style: NAME_STYLE,
        });
        const troops = new BitmapText({
          text: '',
          style: TROOPS_STYLE,
        });
        name.anchor.set(0.5);
        troops.anchor.set(0.5);
        const flag = new Sprite();
        flag.anchor.set(0.5);
        flag.visible = false;
        this.labels.addChild(flag, name, troops);
        // Tribes carry no flag: many, small, and their names already read as minor.
        const flagKey = p.kind === 'tribe' ? '' : this.flagTex.key(p);
        l = { name, troops, icons: [], flag, flagKey, flagTex: null, aspect: flagAspect(p), nameW: 0 };
        this.labelPool.set(p.id, l);
      }
      const fontPx = Math.max(10, Math.min(46, px * 0.32));
      const nm = p.name[lang] || p.name.en;
      if (l.name.text !== nm) {
        l.name.text = nm;
        l.name.scale.set(1);
        l.nameW = l.name.width;
      }
      const tr = formatShort(p.troops);
      if (l.troops.text !== tr) l.troops.text = tr;
      l.name.scale.set(fontPx / 64 / z);
      l.troops.scale.set((fontPx * 0.62) / 40 / z);
      const alpha = Math.min(1, (px - minPx + 4) / 30);
      // Flag before the name (hidden on small labels); flag + name are centred together.
      if (l.flagKey && !l.flagTex) l.flagTex = this.flagTex.get(l.flagKey, p);
      const showFlag = l.flagTex !== null && fontPx >= 13;
      let nameX = lx;
      if (showFlag) {
        const fh = fontPx * 0.74;
        const fw = fh * l.aspect;
        const gap = fontPx * 0.28;
        const half = (fw + gap + (l.nameW * fontPx) / 64) / 2;
        nameX = lx + (fw + gap) / 2 / z;
        if (l.flag.texture !== l.flagTex) l.flag.texture = l.flagTex!;
        l.flag.setSize(fw / z, fh / z);
        l.flag.position.set(lx + (fw / 2 - half) / z, ly - (fontPx * 0.2) / z);
        l.flag.alpha = alpha;
      }
      l.flag.visible = showFlag;
      l.name.position.set(nameX, ly - (fontPx * 0.25) / z);
      l.troops.position.set(lx, ly + (fontPx * 0.55) / z);
      l.name.alpha = alpha;
      l.troops.alpha = 0.85 * alpha;
      l.name.tint =
        p.id === s.viewer ? 0xffffff : friend ? 0x6ee7a0 : atWar ? 0xff7a7a : p.traitor ? 0xffd84d : 0xf3efe4;
      l.troops.tint = p.immune ? UI.aurora : 0xe8e3d6;
      // Status badges, centred in one row above the name.
      const iconPx = Math.max(13, Math.min(34, fontPx * 0.9));
      while (l.icons.length < status.length) {
        const sp = new Sprite(this.icons.status.crown);
        sp.anchor.set(0.5);
        this.labels.addChild(sp);
        l.icons.push(sp);
      }
      const rowY = ly - (fontPx * 0.25 + fontPx * 0.62 + iconPx * 0.55) / z;
      for (let k = 0; k < l.icons.length; k++) {
        const sp = l.icons[k]!;
        sp.visible = k < status.length;
        if (!sp.visible) continue;
        sp.texture = this.icons.status[status[k]!];
        sp.setSize(iconPx / z, iconPx / z);
        sp.position.set(lx + ((k - (status.length - 1) / 2) * iconPx * 1.12) / z, rowY);
        sp.alpha = alpha;
      }
    }
    for (const [id, l] of this.labelPool) {
      if (seen.has(id)) continue;
      l.name.destroy();
      l.troops.destroy();
      l.flag.destroy();
      for (const sp of l.icons) sp.destroy();
      this.labelPool.delete(id);
    }
  }

  /**
   * Pills on the fronts showing how many troops push them: ours edged in our ink, those
   * coming at us in hazard magenta. One per stretch of front; each stays pinned where it
   * appeared (readable) and only glides on once the front has moved well away.
   */
  private updateFronts(z: number): void {
    const s = this.state;
    const live = new Set<number>();
    for (const f of s.local?.fronts ?? []) {
      const mine = f.attacker === s.viewer;
      if (!mine && !this.revealed(f.attacker, f.points[0]?.[0] ?? 0, f.points[0]?.[1] ?? 0)) continue;
      live.add(f.id);
      const list = this.frontBadges.get(f.id) ?? [];
      this.frontBadges.set(f.id, list);
      const free = new Set(list);
      for (const [px, py] of f.points) {
        // The nearest badge of this attack keeps its place; a far one is moved; else a new one.
        let best: FrontBadge | null = null;
        let bd = Infinity;
        for (const b of free) {
          const d = Math.hypot(b.tx - px, b.ty - py);
          if (d < bd) {
            bd = d;
            best = b;
          }
        }
        if (!best || (bd > FRONT_BADGE_SLACK * 3 && list.length < f.points.length)) {
          best = this.makeFrontBadge(px, py);
          list.push(best);
        } else free.delete(best);
        if (Math.hypot(best.tx - px, best.ty - py) > FRONT_BADGE_SLACK) {
          best.tx = px;
          best.ty = py;
        }
        best.seen = this.frame;
        const text = formatShort(f.troops);
        if (text !== best.text) {
          best.text = text;
          best.txt.text = text;
          const edge = mine ? this.inkOf(s.viewer) : REL_COLOR.foe;
          const wpx = best.txt.width + 34;
          best.bg.clear();
          // Ours: a round pill and disc. Coming at us: a square-cut tag and a diamond (the
          // map's "aimed at us" shape, as the missile badge), so it reads without the red.
          if (mine) {
            best.bg
              .roundRect(-15, -13, wpx, 26, 13)
              .fill({ color: 0x0b1824, alpha: 0.94 })
              .stroke({ width: 2.5, color: edge });
            best.bg.circle(0, 0, 9).fill({ color: edge, alpha: 0.9 });
          } else {
            best.bg
              .rect(-15, -13, wpx, 26)
              .fill({ color: 0x0b1824, alpha: 0.94 })
              .stroke({ width: 2.5, color: edge });
            best.bg.poly([0, -11, 11, 0, 0, 11, -11, 0]).fill({ color: edge });
          }
        }
      }
    }
    for (const [id, list] of this.frontBadges) {
      const keep: FrontBadge[] = [];
      for (const b of list) {
        if (!live.has(id) || b.seen !== this.frame) {
          b.c.destroy({ children: true });
          continue;
        }
        // Glide (slowly) to a new spot only when the front has moved on.
        b.x += (b.tx - b.x) * 0.08;
        b.y += (b.ty - b.y) * 0.08;
        b.c.position.set(b.x, b.y);
        b.c.scale.set(1 / z);
        keep.push(b);
      }
      if (keep.length) this.frontBadges.set(id, keep);
      else this.frontBadges.delete(id);
    }
  }

  private makeFrontBadge(x: number, y: number): FrontBadge {
    const c = new Container();
    const bg = new Graphics();
    const ico = new Sprite(this.icons.sword);
    ico.anchor.set(0.5);
    ico.setSize(13, 13);
    ico.tint = 0x0b1824;
    const txt = new BitmapText({
      text: '',
      style: { fontFamily: '"IBM Plex Sans", sans-serif', fontSize: 40, fill: 0xffffff, fontWeight: '700' },
    });
    txt.anchor.set(0, 0.5);
    txt.scale.set(15 / 40);
    txt.position.set(13, 0);
    c.addChild(bg, ico, txt);
    this.labels.addChild(c);
    c.position.set(x, y);
    return { c, bg, txt, x, y, tx: x, ty: y, text: '', seen: this.frame };
  }

  private updateFloaters(dt: number, z: number): void {
    const now = performance.now();
    for (const e of this.emojis) {
      const a = (now - e.t) / 4000;
      e.text.position.set(e.x, e.y - (a * 10) / z);
      e.text.scale.set(34 / 64 / z);
      e.text.alpha = a < 0.8 ? 1 : 1 - (a - 0.8) / 0.2;
    }
    this.emojis = this.emojis.filter((e) => {
      if (now - e.t > 4000) {
        e.text.destroy({ children: true });
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
    // A few faint sparks only: fronts should read as ink spreading, not as confetti.
    const n = Math.min(s.pendingTiles.length, Math.round(3 * this.settings.particles));
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
        0.9,
        0.28,
        'spark',
        0.06,
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
          // A nuclear blast sinks every ship within its fallout (nukes.ts detonate): they go
          // down (ships.ts) as they vanish.
          if (e.kind <= 3)
            this.ships.doom(e.x, e.y, Math.max(e.radius, NUKE_FALLOUT_RADIUS[e.kind as N] || 0));
          break;
        case 'intercept':
          this.particles.burst(e.x, e.y, Math.round(30 * P), UI.aurora, 3, 'spark');
          this.particles.ring(e.x, e.y, 10, UI.aurora, 0.6);
          break;
        case 'planeDown':
          // Debris and a puff of smoke where the plane fell.
          if (!this.revealed(e.owner, e.x, e.y)) break;
          this.particles.burst(e.x, e.y, Math.round(16 * P), 0xffb070, 1.2, 'spark');
          this.particles.burst(e.x, e.y, Math.round(8 * P), 0x6d6a70, 0.7, 'smoke');
          break;
        case 'airStrike':
          // The building hit: a ring in the raider's ink, a column of smoke when it is razed.
          if (e.type < 0) break;
          this.particles.ring(e.x, e.y, 7, this.inkOf(e.owner), 0.7);
          if (e.destroyed) this.particles.burst(e.x, e.y, Math.round(14 * P), 0x5d5a60, 0.9, 'smoke');
          break;
        case 'scramble':
          if (this.revealed(e.owner, e.x, e.y)) this.particles.ring(e.x, e.y, 4, this.inkOf(e.owner), 0.5);
          break;
        case 'shipSunk':
          // The ship explodes and goes under as it leaves the unit buffer (ships.ts).
          this.ships.doom(e.x, e.y, 0);
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
          // Tactical signal: badge + caption, visible to its recipient (or everyone).
          const sig = SIGNALS[e.emoji];
          if (!sig) break;
          const box = new Container();
          const badge = new Sprite(this.icons.signals[e.emoji]!);
          badge.anchor.set(0.5);
          badge.setSize(64, 64);
          const cap = new BitmapText({
            text: t(`signal.${sig.key}`),
            style: {
              fontFamily: '"IBM Plex Sans", sans-serif',
              fontSize: 30,
              fill: 0xffffff,
              fontWeight: '600',
            },
          });
          cap.anchor.set(0.5, 0);
          cap.position.set(0, 38);
          box.addChild(badge, cap);
          this.labels.addChild(box);
          this.emojis.push({
            x: (e.tile % this.state.width) + 0.5,
            y: ((e.tile / this.state.width) | 0) + 0.5,
            t: performance.now(),
            text: box,
          });
          break;
        }
        case 'trainPay':
        case 'tradePay':
        case 'loot':
          if (e.owner === this.state.viewer && this.camera.zoom > (e.k === 'loot' ? 0.6 : 1.5)) {
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
        case 'revolution':
          // The outbreak's shockwave (drawRevolts), where the region rose.
          if (e.phase === 'start' && e.tile >= 0) {
            const x = (e.tile % this.state.width) + 0.5;
            const y = ((e.tile / this.state.width) | 0) + 0.5;
            this.revoltSeeds.set(e.tribe, [x, y]);
            this.revoltBursts.push({
              tribe: e.tribe,
              x,
              y,
              t: performance.now(),
              mine: e.from === this.state.viewer,
            });
          }
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
    // Nuclear: core flash and bloom, shock wave, fireball, mushroom cloud, debris, scorch
    // (nukeFx.ts). Render only: the blast itself is the simulation's.
    const cam = this.camera;
    const rm = this.settings.reducedMotion;
    const [x0, y0, x1, y1] = cam.bounds();
    const m = radius * 3 + 60 / cam.zoom;
    const visible = x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m * 2.5;
    this.nukeFx.spawn(x, y, kind, visible, P, rm, this.particles);
    if (!visible) return;
    let peak = kind === N.Hydrogen ? 0.72 : 0.38;
    if (kind === N.MirvWarhead) {
      // A salvo: each warhead adds a little light (a flicker over the target), throttled;
      // with reduced motion a single gentle flash, never a strobe.
      const now = performance.now();
      if (rm) {
        if (now - this.lastWarheadFlash < 1500) return;
        this.lastWarheadFlash = now;
        peak = 0.12;
      } else {
        if (now - this.lastWarheadFlash < 70) return;
        this.lastWarheadFlash = now;
        peak = Math.min(0.42, this.flashAlpha + 0.07);
      }
      this.shake = Math.max(this.shake, Math.min(12, this.shake + 2.5), 5);
    } else {
      if (rm) peak *= 0.35;
      this.shake = Math.max(this.shake, kind === N.Hydrogen ? 22 : 10);
    }
    if (peak >= this.flashAlpha) {
      this.flashAlpha = peak;
      this.flashPeak = peak;
    }
  }

  /** QA: a nuclear blast drawn at (x, y) without the simulation (no damage, no sound). */
  qaNuke(kind: number, x: number, y: number): void {
    this.explosion(x, y, kind, NUKE_RADIUS[kind === N.Hydrogen ? 1 : kind === N.MirvWarhead ? 3 : 0]);
  }

  /**
   * QA: a missile drawn without the simulation (no damage, no sound), from (sx, sy) to (tx, ty):
   * kind 0 A, 1 H, 2 MIRV (`warheads` released over `spread` tiles), 4 an interceptor.
   * `rate`: QA ticks a second (10: the game's pace; lower for slow motion). Returns the flight time (s).
   */
  qaMissile(
    kind: number,
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    opts: {
      up?: boolean;
      owner?: number;
      delay?: number;
      warheads?: number;
      spread?: number;
      blast?: boolean;
      rate?: number;
    } = {},
  ): number {
    if (opts.rate !== undefined) this.qaRate = opts.rate;
    const now = this.qaTick();
    const w = this.state.width;
    const owner = opts.owner ?? this.state.viewer;
    const interceptor = kind === 4;
    const mirv = kind === N.Mirv;
    const [ex, ey] = mirv ? mirvSplitPoint(sx, tx, ty) : [tx, ty];
    const arc = mirv || interceptor || opts.up !== false ? ARC_UP : 1;
    const path = new Trajectory(sx, sy, ex, ey, interceptor ? 0 : arc, this.state.height);
    const ticks = interceptor
      ? Math.max(3, Math.ceil(path.length / 12))
      : mirv
        ? Math.max(10, Math.round(14 + Math.max(0, path.length / 15 - 14) * 0.15))
        : flightTicks(path, 10, 10);
    const t0 = now + (opts.delay ?? 0);
    this.qaFlights.push({
      id: this.qaNextId--,
      type: interceptor ? U.Interceptor : U.Nuke,
      owner,
      kind: interceptor ? 0 : kind,
      sx,
      sy,
      tx: ex,
      ty: ey,
      t0,
      t1: t0 + ticks,
      arc: interceptor ? 0 : arc,
      dest: Math.floor(ty) * w + Math.floor(tx),
      warheads: mirv ? (opts.warheads ?? 60) : 0,
      spread: opts.spread ?? 150,
      blast: !!opts.blast,
    });
    return ticks / this.qaRate;
  }

  /** QA: visual-only missiles wiped. */
  qaClearMissiles(): void {
    this.qaFlights = [];
    this.missileFx.clear();
  }

  /** QA: missiles drawn and smoke puffs in use. */
  get missileFxCount(): { missiles: number; puffs: number } {
    return { missiles: this.missileFx.count, puffs: this.missileFx.puffCount };
  }

  private qaStart = -1;
  private qaRate = 10;
  private qaTick(): number {
    const now = performance.now();
    if (this.qaStart < 0) this.qaStart = now;
    return ((now - this.qaStart) / 1000) * this.qaRate;
  }

  private updateQaFlights(seen: Set<number>, t: number): void {
    if (this.qaFlights.length === 0) return;
    const tick = this.qaTick();
    const w = this.state.width;
    const keep: QaFlight[] = [];
    const born: QaFlight[] = [];
    for (const q of this.qaFlights) {
      if (tick >= q.t1) {
        if (q.warheads > 0) {
          // The carrier separates: warheads over the target, like the simulation's splitMirv.
          const gx = (q.dest % w) + 0.5;
          const gy = ((q.dest / w) | 0) + 0.5;
          for (let k = 0; k < q.warheads; k++) {
            const a = Math.random() * Math.PI * 2;
            const d = k === 0 ? 0 : Math.sqrt(Math.random()) * q.spread;
            const hx = Math.max(1, Math.min(w - 2, gx + Math.cos(a) * d));
            const hy = Math.max(1, Math.min(this.state.height - 2, gy + Math.sin(a) * d));
            const path = new Trajectory(q.tx, q.ty, hx, hy, ARC_UP, this.state.height);
            const t0 = q.t1 + Math.floor(Math.random() * 16);
            born.push({
              ...q,
              id: this.qaNextId--,
              kind: N.MirvWarhead,
              sx: q.tx,
              sy: q.ty,
              tx: hx,
              ty: hy,
              t0,
              t1: t0 + flightTicks(path, 22, 4),
              arc: ARC_UP,
              dest: Math.floor(hy) * w + Math.floor(hx),
              warheads: 0,
            });
          }
        } else if (q.blast && q.type === U.Nuke)
          this.explosion(q.tx, q.ty, q.kind, NUKE_RADIUS[q.kind as N] || 12);
        continue;
      }
      keep.push(q);
      seen.add(q.id);
      this.flight(q.id, q.type, q.owner, q.kind, q.sx, q.sy, q.tx, q.ty, q.t0, q.t1, q.arc, q.dest, tick, t);
    }
    this.qaFlights = [...keep, ...born];
  }

  /** QA: every nuclear blast and scorch mark wiped (and the screen flash). */
  qaClearNukes(): void {
    this.nukeFx.clear();
    this.flashAlpha = 0;
    this.shake = 0;
  }

  /** QA: lay rail `id` again or tear up a copy of it, render only (railLayer.ts). */
  qaRail(id: number, kind: 'build' | 'tear' = 'build'): boolean {
    return this.railLayer.qaReplay(id, kind);
  }

  /** QA: rails being laid and torn up on the map. */
  get railFx(): { building: number; tearing: number } {
    return this.railLayer.animating;
  }

  /** QA: ships in view sunk now, render only (ships.ts); returns how many. */
  qaSink(ids?: number[]): number {
    return this.ships.qaSink(ids);
  }

  /** QA: ships going under. */
  get wreckCount(): number {
    return this.ships.wreckCount;
  }

  /** QA: blasts still unfolding. */
  get nukeFxCount(): number {
    return this.nukeFx.count;
  }

  /** Marks a front on the map for a moment (tile coordinates): a wave of troops sent at us. */
  /** `hostile`: a wave coming at us (chevrons closing on the ring, not only its colour). */
  markFront(x: number, y: number, color: number, hostile = false): void {
    this.frontMarks = [
      ...this.frontMarks.filter((f) => Math.hypot(f.x - x, f.y - y) > 3),
      { x, y, t: performance.now(), color, hostile },
    ];
  }

  /**
   * A country looked for (a click on its name): a reticle closes in on the box of its land
   * and pulses a few times, at a size read on screen whatever the zoom (a country of one
   * tile included); its name is shown over it meanwhile (updateLabels).
   */
  locate(id: number, box: [number, number, number, number]): void {
    this.located = { id, box, t: performance.now() };
  }

  private drawLocator(g: Graphics, now: number, z: number): void {
    const L = this.located;
    if (!L) return;
    const age = (now - L.t) / LOCATE_MS;
    if (age >= 1 || this.overlay.photo) {
      this.located = null;
      return;
    }
    const lw = (px: number) => Math.max(0.05, px / z);
    const [x0, y0, x1, y1] = L.box;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const r = Math.max(Math.hypot(x1 - x0, y1 - y0) / 2 + 5 / z, 16 / z);
    const rm = this.settings.reducedMotion;
    // Closing in over the first 0.8 s (at once with reduced motion), fading at the end.
    const close = rm ? 1 : Math.min(1, age / 0.22);
    const rr = r * (1 + (1 - close) ** 3 * 5);
    const fade = age < 0.82 ? 1 : 1 - (age - 0.82) / 0.18;
    g.circle(cx, cy, rr).stroke({ width: lw(5), color: INK_DARK, alpha: 0.5 * fade });
    g.circle(cx, cy, rr).stroke({ width: lw(2.4), color: PAPER, alpha: 0.95 * fade });
    // A reticle: four ticks pointing in at the land (a shape, not a colour).
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2;
      const [ux, uy] = [Math.cos(a), Math.sin(a)];
      const a0 = rr + 3 / z;
      const a1 = rr + 13 / z;
      g.moveTo(cx + ux * a0, cy + uy * a0)
        .lineTo(cx + ux * a1, cy + uy * a1)
        .stroke({ width: lw(5), color: INK_DARK, alpha: 0.5 * fade, cap: 'round' });
      g.moveTo(cx + ux * a0, cy + uy * a0)
        .lineTo(cx + ux * a1, cy + uy * a1)
        .stroke({ width: lw(2.4), color: PAPER, alpha: 0.95 * fade, cap: 'round' });
    }
    // Then two brass ripples a second (none with reduced motion).
    if (!rm && close >= 1)
      for (let k = 0; k < 2; k++) {
        const u = ((age - 0.22) * 3 + k * 0.5) % 1;
        g.circle(cx, cy, rr * (1 + u * 1.3)).stroke({
          width: lw(2),
          color: UI.brass,
          alpha: (1 - u) * 0.75 * fade,
        });
      }
  }

  /**
   * Revolutions on the map, for every player (GAME_DESIGN.md §6.5): at the outbreak a
   * shockwave of rings bursting out of the region, screen-sized so that it shows at any
   * zoom; then, while the revolution lasts, a toothed ring round the region (a cog of
   * spikes: a shape, not only the oxblood) that sends out a slow ripple. Reduced motion:
   * the rings stand still.
   */
  private drawRevolts(g: Graphics, now: number, z: number): void {
    if (this.overlay.photo) return;
    const lw = (px: number) => Math.max(0.05, px / z);
    const rm = this.settings.reducedMotion;
    this.revoltBursts = this.revoltBursts.filter((b) => now - b.t < REVOLT_BURST_MS);
    const live = new Set<number>();
    for (const p of this.state.playerList) {
      if (p.revoltFor === undefined || !p.alive || p.tiles === 0) continue;
      live.add(p.id);
      const seed = this.revoltSeeds.get(p.id);
      const [x, y] = p.label[2] > 0 ? [p.label[0], p.label[1]] : (seed ?? [-1, -1]);
      if (x < 0) continue;
      const R = Math.max(Math.sqrt(p.tiles / Math.PI), 13 / z);
      const burst = this.revoltBursts.find((b) => b.tribe === p.id);
      const strong = burst ? 1 - (now - burst.t) / REVOLT_BURST_MS : 0;
      // The toothed ring: twelve spikes pointing out (the raised fist's badge rides the label).
      const teeth = 12;
      const spin = rm ? 0 : now / 9000;
      const t0 = R + 2 / z;
      const t1 = R + (7 + 5 * strong) / z;
      g.circle(x, y, R).stroke({ width: lw(4.5), color: INK_DARK, alpha: 0.45 });
      g.circle(x, y, R).stroke({ width: lw(2.2 + strong * 1.2), color: REVOLT_INK, alpha: 0.95 });
      for (let k = 0; k < teeth; k++) {
        const a = spin + (k / teeth) * Math.PI * 2;
        const [ux, uy] = [Math.cos(a), Math.sin(a)];
        g.moveTo(x + ux * t0, y + uy * t0)
          .lineTo(x + ux * t1, y + uy * t1)
          .stroke({ width: lw(3.6), color: INK_DARK, alpha: 0.4, cap: 'round' });
        g.moveTo(x + ux * t0, y + uy * t0)
          .lineTo(x + ux * t1, y + uy * t1)
          .stroke({ width: lw(1.8), color: PAPER, alpha: 0.95, cap: 'round' });
      }
      if (rm) {
        if (strong > 0)
          g.circle(x, y, R + 16 / z).stroke({ width: lw(2.5), color: REVOLT_INK, alpha: strong });
        continue;
      }
      // The slow ripple while it lasts.
      const u = (now / REVOLT_PULSE_MS + p.id * 0.37) % 1;
      g.circle(x, y, t1 + u * Math.max(R * 0.6, 34 / z)).stroke({
        width: lw(2),
        color: REVOLT_INK,
        alpha: (1 - u) * 0.7,
      });
      // The outbreak: the region flares, and three shock rings race out far beyond it.
      if (burst) {
        const age = (now - burst.t) / 1000;
        if (age < 1.2) g.circle(x, y, R).fill({ color: REVOLT_INK, alpha: 0.45 * (1 - age / 1.2) });
        const reach = R + (burst.mine ? 240 : 170) / z;
        for (let k = 0; k < 3; k++) {
          const v = (age * 0.7 + k / 3) % 1;
          // (Each ring starts only once the one before has left.)
          if (age * 0.7 < k / 3) continue;
          const r = R + v * (reach - R);
          const a = (1 - v) * strong;
          g.circle(burst.x, burst.y, r).stroke({
            width: lw(6 * (1 - v) + 3),
            color: INK_DARK,
            alpha: 0.3 * a,
          });
          g.circle(burst.x, burst.y, r).stroke({
            width: lw(4 * (1 - v) + 1.6),
            color: k === 1 ? PAPER : REVOLT_INK,
            alpha: 0.95 * a,
          });
        }
      }
    }
    for (const id of this.revoltSeeds.keys())
      if (!live.has(id) && !this.revoltBursts.some((b) => b.tribe === id)) this.revoltSeeds.delete(id);
  }

  /** An alliance was signed between the capitals at (ax, ay) and (bx, by). */
  pactLink(ax: number, ay: number, bx: number, by: number): void {
    this.pacts.push({ ax, ay, bx, by, t: performance.now() });
  }

  // ------------------------------------------------------------ helpers
  tileAtScreen(sx: number, sy: number): number {
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= this.state.width || y >= this.state.height) return -1;
    return y * this.state.width + x;
  }

  /**
   * The ship, plane or train drawn under the screen point (sx, sy), as drawn last frame (so
   * never one hidden by the fog or a fog bank): the nearest within `px` screen pixels — a
   * generous reach, ships are a few pixels long when zoomed out — or its own half length.
   * −1: none.
   */
  unitAtScreen(sx: number, sy: number, px = 16): number {
    const [wx, wy] = this.camera.screenToWorld(sx, sy);
    const z = Math.max(0.05, this.camera.zoom);
    const reach = (px * (this.settings.uiScale || 1)) / z;
    const ship = this.ships.nearest(wx, wy, reach);
    let best = ship ? ship.id : -1;
    let bestD = ship ? ship.d : Infinity;
    // (The sprites of units gone are dropped every frame: those left were drawn last frame.)
    for (const [id, us] of this.unitSprites) {
      if (!us.s.visible) continue;
      // Trains: the locomotive leads the trail; planes: the sprite itself.
      const x = us.trail ? us.trail[0]! : us.s.x;
      const y = us.trail ? us.trail[1]! : us.s.y;
      const d = Math.hypot(x - wx, y - wy);
      if (d <= reach && d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  /** My offensive line whose grip is under the pointer (screen px), -1 none (1.24). */
  lineGripAt(sx: number, sy: number): number {
    const [x, y] = this.camera.screenToWorld(sx, sy);
    return this.frontLines.gripAt(x, y, 16 / this.camera.zoom);
  }

  /** My offensive line whose arrow is under the pointer (screen px), -1 none (1.24). */
  lineArrowAt(sx: number, sy: number): number {
    const [x, y] = this.camera.screenToWorld(sx, sy);
    return this.frontLines.arrowAt(x, y);
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

/** Point `dist` tiles back along a breadcrumb trail (x, y pairs, newest first) and the heading there. */
function trailPoint(tr: number[], dist: number): [number, number, number] {
  let left = dist;
  for (let k = 0; k + 3 < tr.length; k += 2) {
    const ax = tr[k]!;
    const ay = tr[k + 1]!;
    const bx = tr[k + 2]!;
    const by = tr[k + 3]!;
    const seg = Math.hypot(ax - bx, ay - by);
    const angle = Math.atan2(ay - by, ax - bx);
    if (seg >= left) {
      const f = seg > 0 ? left / seg : 0;
      return [ax + (bx - ax) * f, ay + (by - ay) * f, angle];
    }
    left -= seg;
  }
  // Trail too short (just spawned): line up behind the oldest point.
  const n = tr.length;
  const angle = n >= 4 ? Math.atan2(tr[n - 3]! - tr[n - 1]!, tr[n - 4]! - tr[n - 2]!) : 0;
  return [tr[n - 2]! - Math.cos(angle) * left, tr[n - 1]! - Math.sin(angle) * left, angle];
}

export function formatShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return Math.round(v).toString();
}
