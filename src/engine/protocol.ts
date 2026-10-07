// Messages between the main thread and the simulation worker.
import type { GameConfig } from '../core/game/config';
import type { MapMeta, LocalizedName } from '../core/map/gamemap';
import type { GameEvent } from '../core/game/events';
import type { Turn } from '../core/net/commands';
import type { Snapshot } from '../core/net/snapshot';
import type { Personality, PlayerKind, PlayerStats, HistorySample } from '../core/game/player';
import type { GenParams } from '../core/map/generator';
import type { WeatherCell } from '../core/rules/features';
import type { Threat } from './threats';
import type { PlayerFlag } from '../core/data/flagSpec';
import type { Opinion } from '../core/rules/opinion';
import type { DoomPush } from '../core/rules/victory';

/** Commerce panel: trade income is summed over this sliding window (5 minutes). */
export const TRADE_WINDOW_TICKS = 3000;

/** Floats per unit in the packed unit buffer. */
export const UNIT_STRIDE = 17;
export const enum UF {
  Id = 0,
  Type = 1,
  Owner = 2,
  X = 3,
  Y = 4,
  Hp = 5, // hp / maxHp
  Kind = 6,
  Level = 7,
  Sx = 8,
  Sy = 9,
  Tx = 10,
  Ty = 11,
  T0 = 12,
  T1 = 13, // trains: progress along the rail (tiles)
  Troops = 14, // transports: troops · trains: direction · missiles: arc (-1 up, 1 down, 0 straight)
  Dest = 15, // destination tile: missile target, transport landing, merchant port, train station (-1 none)
  Rail = 16, // trains: rail id (-1 otherwise)
}

export type MapSource =
  | { kind: 'builtin'; meta: MapMeta; terrainPng: ArrayBuffer; elevPng: ArrayBuffer }
  | { kind: 'procedural'; params: GenParams };

export type ToWorker =
  | { type: 'init'; config: GameConfig; map: MapSource; viewer: number; snapshot?: Snapshot }
  | { type: 'turn'; turn: Turn; fast?: boolean }
  | { type: 'turns'; turns: Turn[] }
  | { type: 'setViewer'; viewer: number; fogEnabled: boolean }
  | { type: 'layers'; loyalty: boolean }
  | { type: 'snapshot'; id: number }
  | { type: 'query'; id: number; q: Query }
  /** QA (?automation, solo only): a revolution breaks out in `player`'s land at once. */
  | { type: 'qa'; action: 'revolution'; player: number }
  /** QA (?automation, solo only): `player` keeps only its `keep` tiles nearest its centre. */
  | { type: 'qa'; action: 'shrink'; player: number; keep: number }
  /**
   * QA (?automation, solo only): world event `id` strikes at once, for real (its zone, its
   * effects); `zone` moves an earthquake's or an ash cloud's circle there.
   */
  | { type: 'qa'; action: 'worldEvent'; id: string; zone?: { x: number; y: number; r: number } }
  /** QA (?automation, solo only): a peace summit opens at once for `secs` seconds (its forced truce). */
  | { type: 'qa'; action: 'summit'; secs: number };

export type Query =
  | { q: 'tile'; tile: number }
  /** What a build order there would do (answers a PlacementView). */
  | { q: 'placement'; kind: number; tile: number }
  | { q: 'boat'; tile: number }
  | { q: 'hash' }
  | { q: 'stats' };

/**
 * The cursor's preview of a build order (core/buildings planBuild): a new building on
 * `at` (the click snapped to the nearest free spot; -1: none nearby), or an upgrade of
 * the building standing on `at` to `level`. `error`: 'ok' or why the order would fail;
 * `tech`: the missing technology's i18n key ('locked').
 */
export interface PlacementView {
  upgrade: boolean;
  at: number;
  level: number;
  error: string;
  cost: number;
  tech: string;
}

export interface PlayerView {
  id: number;
  name: LocalizedName;
  kind: PlayerKind;
  team: number;
  color: number;
  flagSeed: number;
  iso: string;
  /** Flag chosen by a human player (from its config slot); absent otherwise. */
  flag?: PlayerFlag;
  alive: boolean;
  spawned: boolean;
  tiles: number;
  usefulTiles: number;
  troops: number;
  gold: number;
  traitor: boolean;
  /** Ticks left on the traitor mark (0 when not a traitor). */
  traitorFor: number;
  inactive: boolean;
  immune: boolean;
  allies: number[];
  personality: Personality;
  label: [number, number, number]; // x, y, size (tiles)
  bigMalus: number;
  /** Extra reach of this player's SAMs from research (tiles), added to samRange(level). */
  samBonus: number;
  /** Capital tile (-1: none — lost and not re-established, or a tribe). */
  capital: number;
  /** Ticks left of the disorganisation after losing its capital (0: none). */
  disorgFor: number;
  /** Rebels risen against this country (0: none; a revolution or a secession, rules/revolution.ts). */
  rebelOf: number;
  /** A revolution: ticks before its land rejoins `rebelOf` (absent otherwise). */
  revoltFor?: number;
  /** A revolution: ticks left behind its barricades (0: down; rules/revolution.ts guerrilla). */
  revoltBarricades?: number;
  /** A revolution: ticks before it may spread (-1: no more spreads), and whether it holds enough land to. */
  revoltSpreadIn?: number;
  revoltHolds?: boolean;
  /** A revolution: all the land it has raised (outbreak and spreads). */
  revoltLand?: number;
}

export interface LocalView {
  id: number;
  alive: boolean;
  gold: number;
  troops: number;
  /** Troop ceiling (maxTroops), lowered by the troops on front lines. */
  popCap: number;
  /** My front lines holding troops: [defensive, offensive], and the troops on all my lines. */
  lineCount: [number, number];
  lineTroops: number;
  /** Troops gained per tick (negative above the ceiling). */
  growth: number;
  /** Passive gold per tick. */
  income: number;
  /** Per second: base and resources; trade and trains are decaying averages of the payouts. */
  incomeBreakdown: { base: number; trade: number; trains: number; resources: number };
  /** My land attacks; `retreating`: cancelled, troops on their way back. */
  attacks: { id: number; target: number; troops: number; retreating: boolean }[];
  boats: number;
  tech: number[];
  researching: number;
  researchPoints: number;
  researchCost: number;
  /** Research points per second, and where they come from (base trickle, centres, bonus). */
  researchRate: number;
  research: { base: number; labs: number; labLevels: number; mult: number };
  /** Goals queued after the current one. */
  researchQueue: number[];
  immuneFor: number;
  traitorFor: number;
  debuffFor: number;
  /** Incoming alliance requests (oldest first) and the ticks each one has left before it lapses. */
  allyRequests: number[];
  allyRequestsIn: number[];
  allies: { id: number; expiresIn: number }[];
  embargo: number[];
  /** Land attacks involving me (mine and those against me): troops and a point on their front line. */
  fronts: {
    id: number;
    attacker: number;
    target: number;
    troops: number;
    /** One point per separate stretch of front (largest first), on the front line. */
    points: [number, number][];
  }[];
  /** My transport ships at sea: position, troops and where they will land. */
  transports: {
    id: number;
    troops: number;
    x: number;
    y: number;
    tx: number;
    ty: number;
    retreating: boolean;
  }[];
  /** My missiles in the air (or waiting in a silo for their salvo): where, where to, ticks to impact. */
  missiles: { id: number; kind: number; x: number; y: number; tx: number; ty: number; left: number }[];
  /** Countries at war with me: fighting on our border, landing troops or launching missiles (lingers 10 s). */
  wars: number[];
  /** Countries sharing a land border with me (those a land attack can reach), refreshed every second. */
  neighbors: number[];
  /** Countries I cannot trade with (embargo in either direction, manual or temporary). */
  noTrade: number[];
  /**
   * Commerce with each partner: gold earned over the last TRADE_WINDOW_TICKS, by sea and by
   * rail, and the merchant ships / trains running between us right now.
   */
  trade: { id: number; sea: number; rail: number; ships: number; trains: number }[];
  /**
   * Embargoes with each country, both ways: manual ones (`mine`: I block them, `theirs`: they
   * block me) and the temporary ones after an attack or a betrayal (ticks left, 0 = none).
   */
  embargoes: { id: number; mine: boolean; theirs: boolean; mineFor: number; theirsFor: number }[];
  buildCosts: number[];
  warshipCost: number;
  nukeCosts: number[];
  maxLaunch: number[];
  resources: [number, number, number, number];
  buildingCount: number[];
  /**
   * Levels of my buildings per type (one under construction counts 1, an upgrade under way
   * as done): building on one of your own buildings stacks it, so a level-2 city is two cities.
   */
  buildingLevels: number[];
  stats: PlayerStats;
  /** My capital tile (-1: none — lost, a new one is to be chosen). */
  capital: number;
  /** Who took my last capital (0: razed, or none lost). */
  capitalLostBy: number;
  /** Ticks left of my disorganisation after losing the capital (0: none). */
  disorgFor: number;
  /** Ticks before I may move the capital I hold again (0: now). */
  capitalCooldown: number;
  /** While without a capital: the safest spot for a new one (-1: none fits, or one is held). */
  capitalHint: number;
  /** Threatened borders: land neighbours massing a much bigger army with hostile intent. */
  threats: Threat[];
  /** What each living nation thinks of me, why, and its odds of accepting an alliance (every second). */
  opinions: Opinion[];
}

/**
 * The battle royale zone. The circle in force at a tick is `liveRing(view, tick)` (it slides
 * from (cx, cy, r) to the next zone (nx, ny, nr) during a closing).
 */
export interface ZoneView {
  cx: number;
  cy: number;
  r: number;
  nx: number;
  ny: number;
  nr: number;
  /** Tick the next closing starts (it lasts ROYALE_CLOSE + ROYALE_SWEEP). */
  closeAt: number;
  /** Closings done, out of `steps`. */
  step: number;
  steps: number;
  /** After the last zone: the tick the game ends (-1 before). */
  endAt: number;
  /** Share (0..1) of the viewer's land outside the next zone (-1: no viewer). */
  mineOut: number;
}

export interface DoomView {
  /** Clock units gone (DOOM_UNIT per clock second; midnight at DOOM_MIDNIGHT × DOOM_UNIT). */
  units: number;
  /** Milestones passed. */
  stage: number;
  /** The last pushes, oldest first. */
  pushes: DoomPush[];
}

export interface WorldView {
  tick: number;
  startTick: number;
  spawnEndTick: number;
  threshold: number;
  /** Doomsday: the share (%) under which troops melt, -1 while not in force. */
  doomsday: number;
  /** Doomsday clock (GAME_DESIGN.md §14.2), null in other modes. */
  doom: DoomView | null;
  /** Battle royale zone (GAME_DESIGN.md §14.1), null in other modes. */
  ring: ZoneView | null;
  weather: WeatherCell[];
  /** The world event under way; x, y, r: the zone it strikes (earthquake, volcanic ash). */
  event: { id: string; until: number; x?: number; y?: number; r?: number } | null;
  council: { closes: number; votes: number; myVote: number } | null;
  /** Next World Council session (absolute tick; -1 when the council is off). */
  councilNext: number;
  /** The Council's sanctions in force: the leader's income is halved. */
  sanction: { target: number; until: number } | null;
  ceasefireUntil: number;
  nukeBanUntil: number;
  radarsOffUntil: number;
  usefulLand: number;
  winner: number;
  winnerTeam: number;
  reason: string;
}

export interface BuildingView {
  id: number;
  type: number;
  owner: number;
  x: number;
  y: number;
  level: number;
  progress: number; // 0..1 construction
  /** In service: built and not under occupation (buildings.ts inService). */
  ready: boolean;
  /** Upgrade to level + 1 under way: 0..1 done, −1 when none. */
  upgrade: number;
  /** Occupied after a capture (GAME_DESIGN.md §6.4): ticks left (0 = none), out of `occupiedTotal`. */
  occupied: number;
  occupiedTotal: number;
  /** Being demolished (1.16): ticks left before it comes down (0 = none), out of `demolishTotal`. */
  demolish: number;
  demolishTotal: number;
  tubesReady: number;
  cooldown: number;
}

/** A front line (core/rules/lines.ts) as the map draws it. */
export interface LineView {
  id: number;
  owner: number;
  /** 0 defensive, 1 offensive. */
  kind: number;
  pts: number[];
  side: 1 | -1;
  troops: number;
  /** Tiles of it still held (the rest: breaches). */
  tiles: number[];
  /** Tick it takes effect (an offensive line digs in for 30 s). */
  readyTick: number;
  /** How fully it acts, 0–1 (its troops per tile against its country's). */
  strength: number;
  /** Offensive (1.22): the country whose border it stands on; 0 for a defensive line. */
  target: number;
  /** Offensive: the tile its arrow points at (-1 none) — its owner's eyes only. */
  aim: number;
  /** Offensive, launched: its attack's id (the line is that attack's front), -1 before. */
  attack: number;
  /** Tick it was laid (1.24): an offensive line's charge. */
  laidTick: number;
  /** Defensive: the tick its organisation is done (1.24.1), -1 not ordered. */
  organizeTick: number;
}

export interface RailView {
  id: number;
  owner: number;
  tiles: number[];
}

/** A sea trade lane drawn on the map: the route merchants sail between two ports. */
export interface TradeRouteView {
  /** Stable id of the lane (the renderer's caches). */
  id: number;
  /** Owners of its two ports. */
  a: number;
  b: number;
  /** Waypoints (tile indices) of the route merchants actually sail, from a's port to b's. */
  path: number[];
  /** Gold paid on it over the last TRADE_WINDOW_TICKS (both ends together). */
  gold: number;
  /** Merchant ships sailing it now. */
  ships: number;
  /** Tick of the last ship seen on it or of the last delivery. */
  last: number;
  /** Tick an embargo cut it (-1: never). */
  cut: number;
}

/** Traffic on a railway: trips run over the last TRADE_WINDOW_TICKS, and an embargo cut. */
export interface RailTrafficView {
  id: number;
  trips: number;
  cut: number;
}

export interface TradeRoutesView {
  tick: number;
  sea: TradeRouteView[];
  rail: RailTrafficView[];
}

export interface TickUpdate {
  type: 'tick';
  tick: number;
  phase: 'spawn' | 'playing' | 'ended';
  changed: Uint32Array;
  owners: Uint16Array;
  stateTiles: Uint32Array;
  stateFallout: Uint8Array;
  stateFlags: Uint8Array;
  units: Float32Array;
  unitCount: number;
  events: GameEvent[];
  players?: PlayerView[];
  local?: LocalView;
  world?: WorldView;
  buildings?: BuildingView[];
  rails?: RailView[];
  lines?: LineView[];
  fog?: { w: number; h: number; data: Uint8Array };
  /** Low-resolution loyalty of the viewer's tiles (0 = not owned, 1..255). */
  loyalty?: { w: number; h: number; data: Uint8Array };
  /** Trade lanes and rail traffic for the map's trade-route view (every 2 s). */
  routes?: TradeRoutesView;
  hash?: number;
  tickMs: number;
}

export interface InitDone {
  type: 'ready';
  meta: MapMeta;
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation: Uint8Array;
  coastDist: Uint8Array;
  resource: Uint8Array;
  owner: Uint16Array;
  fallout: Uint8Array;
  flags: Uint8Array;
  tick: number;
  phase: 'spawn' | 'playing' | 'ended';
  viewer: number;
}

export interface FinalStats {
  players: {
    id: number;
    name: LocalizedName;
    kind: PlayerKind;
    color: number;
    flagSeed: number;
    iso: string;
    flag?: PlayerFlag;
    team: number;
    alive: boolean;
    tiles: number;
    stats: PlayerStats;
    history: HistorySample[];
    eliminatedTick: number;
  }[];
  tick: number;
  startTick: number;
  winner: number;
  winnerTeam: number;
  reason: string;
}

export type FromWorker =
  | InitDone
  | TickUpdate
  | { type: 'snapshot'; id: number; snapshot: Snapshot }
  | { type: 'answer'; id: number; a: unknown }
  | { type: 'error'; message: string };
