// Player state. Plain data + small helpers; systems live in their own modules.
import type { GeneralType } from './config';
import type { LocalizedName } from '../map/gamemap';
import { BUILDING_COUNT } from './constants';

export type PlayerKind = 'human' | 'nation' | 'tribe';
export type Personality = 'expansionist' | 'builder' | 'merchant' | 'diplomat' | 'isolationist' | 'warmonger';
export const PERSONALITIES: readonly Personality[] = [
  'expansionist',
  'builder',
  'merchant',
  'diplomat',
  'isolationist',
  'warmonger',
];

export interface PlayerStats {
  tilesConquered: number;
  tilesLost: number;
  buildingsBuilt: number;
  shipsSunk: number;
  shipsLost: number;
  nukesLaunched: number;
  nukesIntercepted: number;
  goldEarned: number;
  tradeGold: number;
  trainGold: number;
  troopsLost: number;
  enemiesKilled: number;
  maxTiles: number;
  betrayals: number;
}

export interface HistorySample {
  tick: number;
  tiles: number;
  gold: number;
  troops: number;
}

export class Player {
  readonly id: number;
  name: LocalizedName;
  kind: PlayerKind;
  team = 0;
  color = 0;
  flagSeed = 0;
  /** ISO code of the real country this nation represents ('' otherwise). */
  iso = '';
  slot = -1;
  personality: Personality = 'expansionist';
  general: GeneralType = 'blitz';

  alive = true;
  spawned = false;
  spawnTile = -1;
  eliminatedTick = -1;
  inactive = false;
  surrendered = false;

  troops = 0;
  /** Always 0: troops are the whole population (field kept for older code paths and saves). */
  workers = 0;
  gold = 0;
  tiles = 0;
  /** Tiles that do not carry fallout (victory / troop ceiling). */
  usefulTiles = 0;
  /** Troop ceiling (maxTroops), refreshed every tick by the economy. */
  popCap = 0;
  /** Troops gained (or lost above the ceiling) during the last tick. */
  lastGrowth = 0;
  income = 0; // passive gold per tick (last computed)
  /** Per second for base/resources; trade and trains are decaying averages of the payouts. */
  incomeBreakdown = { base: 0, trade: 0, trains: 0, resources: 0 };

  /** Dense list of owned tiles that touch a different-owner land tile. */
  border: number[] = [];
  /** Dense list of owned tiles that touch water. */
  coast: number[] = [];
  /** Running sums for the centroid (labels, AI). */
  sumX = 0;
  sumY = 0;

  buildingCount = new Int32Array(BUILDING_COUNT);
  /** Levels of owned cities (under construction included). */
  cityLevels = 0;
  /** Levels ever built per building type (placements + upgrades): caps the price ladders. */
  levelsBuilt = new Int32Array(BUILDING_COUNT);
  warshipsBuilt = 0;
  mirvLaunched = 0;

  allies = new Map<number, number>(); // ally id → expiry tick
  allyRequests = new Map<number, number>(); // requester id → expiry tick (incoming)
  embargo = new Set<number>();
  embargoUntil = new Map<number, number>(); // automatic (traitor) embargo expiry
  traitorUntil = -1;
  debuffUntil = -1;
  immuneUntil = -1;
  betrayedBy = new Map<number, number>(); // who betrayed me (id → tick)
  /** OpenFront's relations: my feeling towards each player, −100 … 100 (absent = 0), easing back to 0. */
  relations = new Map<number, number>();

  // Tech tree (rules/tech.ts): level reached in each of the 6 branches (beyond 6: levels of
  // the branch's repeatable technology), banked research points, the technology aimed at
  // (-1: none; its prerequisites are studied first) and the goals queued after it.
  tech = new Uint8Array(6);
  researchPoints = 0;
  researching = -1;
  researchQueue: number[] = [];
  /** Levels of completed research centres (refreshed every tick when the tree is on). */
  labLevels = 0;

  // Generals.
  generalReadyTick = 0;
  blitzUntil = -1;
  rampartUntil = -1;
  propagandaUntil = -1;

  // Capital (rules/capital.ts): the seat of government, set on the spawn tile at the start.
  /** Capital tile, -1 when there is none (lost and not re-established yet, or a tribe). */
  capital = -1;
  /** The loss of the capital disorganises the country until this tick. */
  disorgUntil = -1;
  /** When the capital fell (-1: one is held, or there never was one), and who took it (0: razed). */
  capitalLostTick = -1;
  capitalLostBy = 0;
  /** When the capital was last established or moved (voluntary moves wait CAPITAL_MOVE_COOLDOWN). */
  capitalSetTick = -1;

  // Doomsday warnings.
  doomsdayWarned = false;

  stats: PlayerStats = {
    tilesConquered: 0,
    tilesLost: 0,
    buildingsBuilt: 0,
    shipsSunk: 0,
    shipsLost: 0,
    nukesLaunched: 0,
    nukesIntercepted: 0,
    goldEarned: 0,
    tradeGold: 0,
    trainGold: 0,
    troopsLost: 0,
    enemiesKilled: 0,
    maxTiles: 0,
    betrayals: 0,
  };
  history: HistorySample[] = [];

  constructor(id: number, name: LocalizedName, kind: PlayerKind) {
    this.id = id;
    this.name = name;
    this.kind = kind;
  }

  get population(): number {
    return this.troops + this.workers;
  }

  isAlliedWith(other: number): boolean {
    return this.allies.has(other);
  }

  isTraitor(tick: number): boolean {
    return this.traitorUntil > tick;
  }

  relation(other: number): number {
    return this.relations.get(other) ?? 0;
  }

  updateRelation(other: number, delta: number): void {
    if (other === this.id) return;
    this.relations.set(other, Math.max(-100, Math.min(100, this.relation(other) + delta)));
  }

  hasEmbargoWith(other: Player, tick: number): boolean {
    if (this.embargo.has(other.id) || other.embargo.has(this.id)) return true;
    const a = this.embargoUntil.get(other.id);
    const b = other.embargoUntil.get(this.id);
    return (a !== undefined && a > tick) || (b !== undefined && b > tick);
  }

  centroid(width: number): [number, number] {
    if (this.tiles === 0) return [this.spawnTile % width, (this.spawnTile / width) | 0];
    return [this.sumX / this.tiles, this.sumY / this.tiles];
  }

  displayName(lang: 'fr' | 'en'): string {
    return this.name[lang] || this.name.en;
  }
}
