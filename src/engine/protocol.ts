// Messages between the main thread and the simulation worker.
import type { GameConfig } from '../core/game/config';
import type { MapMeta, LocalizedName } from '../core/map/gamemap';
import type { GameEvent } from '../core/game/events';
import type { Turn } from '../core/net/commands';
import type { Snapshot } from '../core/net/snapshot';
import type { Personality, PlayerKind, PlayerStats, HistorySample } from '../core/game/player';
import type { GenParams } from '../core/map/generator';
import type { WeatherCell } from '../core/rules/features';

/** Floats per unit in the packed unit buffer. */
export const UNIT_STRIDE = 15;
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
  T1 = 13,
  Troops = 14,
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
  | { type: 'query'; id: number; q: Query };

export type Query =
  | { q: 'tile'; tile: number }
  | { q: 'placement'; kind: number; tile: number }
  | { q: 'boat'; tile: number }
  | { q: 'hash' }
  | { q: 'stats' };

export interface PlayerView {
  id: number;
  name: LocalizedName;
  kind: PlayerKind;
  team: number;
  color: number;
  flagSeed: number;
  alive: boolean;
  spawned: boolean;
  tiles: number;
  usefulTiles: number;
  troops: number;
  workers: number;
  gold: number;
  traitor: boolean;
  inactive: boolean;
  immune: boolean;
  allies: number[];
  personality: Personality;
  general: string;
  label: [number, number, number]; // x, y, size (tiles)
  bigMalus: number;
}

export interface LocalView {
  id: number;
  alive: boolean;
  gold: number;
  troops: number;
  workers: number;
  popCap: number;
  growth: number;
  income: number;
  incomeBreakdown: { base: number; workers: number; trade: number; trains: number; resources: number };
  troopRatio: number;
  attacks: { id: number; target: number; troops: number }[];
  boats: number;
  tech: number[];
  researching: number;
  researchPoints: number;
  researchCost: number;
  researchRate: number;
  generalReadyIn: number;
  general: string;
  immuneFor: number;
  traitorFor: number;
  debuffFor: number;
  allyRequests: number[];
  allies: { id: number; expiresIn: number }[];
  embargo: number[];
  buildCosts: number[];
  warshipCost: number;
  nukeCosts: number[];
  maxLaunch: number[];
  resources: [number, number, number, number];
  buildingCount: number[];
  stats: PlayerStats;
  blitzFor: number;
  rampartFor: number;
  propagandaFor: number;
}

export interface WorldView {
  tick: number;
  startTick: number;
  spawnEndTick: number;
  threshold: number;
  doomsday: number;
  ring: { cx: number; cy: number; r: number; nextR: number } | null;
  weather: WeatherCell[];
  event: { id: string; until: number } | null;
  council: { closes: number; votes: number; myVote: number } | null;
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
  ready: boolean;
  tubesReady: number;
  cooldown: number;
}

export interface RailView {
  id: number;
  owner: number;
  tiles: number[];
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
  fog?: { w: number; h: number; data: Uint8Array };
  /** Low-resolution loyalty of the viewer's tiles (0 = not owned, 1..255). */
  loyalty?: { w: number; h: number; data: Uint8Array };
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
