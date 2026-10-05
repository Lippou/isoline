// Mirror of the simulation state on the main thread (for rendering and UI).
import type {
  InitDone,
  TickUpdate,
  PlayerView,
  LocalView,
  WorldView,
  BuildingView,
  RailView,
  LineView,
  TradeRoutesView,
} from './protocol';
import { UNIT_STRIDE } from './protocol';
import { samRange } from '../core/game/constants';
import type { MapMeta } from '../core/map/gamemap';
import type { GameEvent } from '../core/game/events';

export class ClientState {
  meta!: MapMeta;
  width = 0;
  height = 0;
  terrain!: Uint8Array;
  elevation!: Uint8Array;
  coastDist!: Uint8Array;
  resource!: Uint8Array;
  owner!: Uint16Array;
  fallout!: Uint8Array;
  flags!: Uint8Array;
  tick = 0;
  phase: 'spawn' | 'playing' | 'ended' = 'spawn';
  viewer = 0;

  players = new Map<number, PlayerView>();
  /** Every name ever seen (eliminated players stay nameable in logs). */
  names = new Map<number, { fr: string; en: string }>();
  playerList: PlayerView[] = [];
  local: LocalView | null = null;
  world: WorldView | null = null;
  buildings: BuildingView[] = [];
  buildingById = new Map<number, BuildingView>();
  rails: RailView[] = [];
  lines: LineView[] = [];
  linesVersion = 0;
  railsVersion = 0;
  buildingsVersion = 0;
  fog: { w: number; h: number; data: Uint8Array } | null = null;
  fogVersion = 0;
  loyalty: { w: number; h: number; data: Uint8Array } | null = null;
  loyaltyVersion = 0;
  /** Trade lanes and rail traffic (the map's trade-route view). */
  routes: TradeRoutesView | null = null;
  routesVersion = 0;

  /** Units: current and previous packed buffers + time of arrival for interpolation. */
  units: Float32Array = new Float32Array(0);
  unitCount = 0;
  prevPos = new Map<number, [number, number]>();
  tickArrival = 0;
  tickInterval = 100;

  /** Tiles whose ownership changed since the renderer last consumed them, with arrival time. */
  pendingTiles: number[] = [];
  pendingState: number[] = [];
  /** Per-tile time (ms, performance.now) of the last ownership change, for ink-diffusion fades. */
  changeTime!: Float32Array;
  tickMs = 0;
  lastHash = 0;

  init(d: InitDone): void {
    this.meta = d.meta;
    this.width = d.width;
    this.height = d.height;
    this.terrain = d.terrain;
    this.elevation = d.elevation;
    this.coastDist = d.coastDist;
    this.resource = d.resource;
    this.owner = d.owner;
    this.fallout = d.fallout;
    this.flags = d.flags;
    this.tick = d.tick;
    this.phase = d.phase;
    this.viewer = d.viewer;
    this.changeTime = new Float32Array(d.width * d.height);
    this.pendingTiles = [];
    this.pendingState = [];
  }

  apply(u: TickUpdate): GameEvent[] {
    const now = performance.now();
    if (this.tickArrival > 0)
      this.tickInterval = this.tickInterval * 0.8 + Math.min(400, now - this.tickArrival) * 0.2;
    this.tickArrival = now;
    this.tick = u.tick;
    this.phase = u.phase;
    this.tickMs = u.tickMs;
    for (let k = 0; k < u.changed.length; k++) {
      const t = u.changed[k]!;
      this.owner[t] = u.owners[k]!;
      this.changeTime[t] = now;
      this.pendingTiles.push(t);
    }
    for (let k = 0; k < u.stateTiles.length; k++) {
      const t = u.stateTiles[k]!;
      this.fallout[t] = u.stateFallout[k]!;
      this.flags[t] = u.stateFlags[k]!;
      this.pendingState.push(t);
    }
    // Keep previous positions for interpolation.
    this.prevPos.clear();
    for (let k = 0; k < this.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      this.prevPos.set(this.units[o]!, [this.units[o + 3]!, this.units[o + 4]!]);
    }
    this.units = u.units;
    this.unitCount = u.unitCount;
    if (u.players) {
      this.players.clear();
      for (const p of u.players) {
        this.players.set(p.id, p);
        this.names.set(p.id, p.name);
      }
      this.playerList = u.players;
    }
    if (u.local) this.local = u.local;
    if (u.world) this.world = u.world;
    if (u.buildings) {
      this.buildings = u.buildings;
      this.buildingById = new Map(u.buildings.map((b) => [b.id, b]));
      this.buildingsVersion++;
    }
    if (u.lines) {
      this.lines = u.lines;
      this.linesVersion++;
    }
    if (u.rails) {
      this.rails = u.rails;
      this.railsVersion++;
    }
    if (u.fog) {
      this.fog = u.fog;
      this.fogVersion++;
    }
    if (u.loyalty) {
      this.loyalty = u.loyalty;
      this.loyaltyVersion++;
    }
    if (u.routes) {
      this.routes = u.routes;
      this.routesVersion++;
    }
    if (u.hash !== undefined) this.lastHash = u.hash;
    return u.events;
  }

  /** Interpolation factor between the previous and current tick (0..1). */
  alpha(): number {
    return Math.max(0, Math.min(1, (performance.now() - this.tickArrival) / Math.max(16, this.tickInterval)));
  }

  ownerAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.owner[y * this.width + x]!;
  }

  /** A SAM's true reach, research bonus included (the same as the simulation's samRangeOf). */
  samReach(owner: number, level: number): number {
    return samRange(level) + (this.players.get(owner)?.samBonus ?? 0);
  }

  name(id: number, lang: 'fr' | 'en'): string {
    const n = this.players.get(id)?.name ?? this.names.get(id);
    if (!n) return id === 0 ? (lang === 'fr' ? 'Terres libres' : 'Wilderness') : `#${id}`;
    return n[lang] || n.en;
  }
}
