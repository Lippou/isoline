// The deterministic simulation. One Game instance = one match.
// Inputs: GameConfig + GameMap + per-tick command lists. No DOM, no wall-clock.
import { GameMap } from '../map/gamemap';
import { IS_LAND, IS_WATER, T as Terr } from '../map/terrain';
import { Rng } from '../rng';
import type { GameConfig } from './config';
import { DIFFICULTY } from './config';
import {
  B,
  BUILDING_COUNT,
  CAPTURE_TRANSFER,
  DEFENSE_POST_MAG,
  DEFENSE_POST_RANGE,
  DEFENSE_POST_SPEED,
  HISTORY_EVERY,
  LARGE_DEFENDER_DEPTH,
  LOYALTY_CONQUERED,
  LOYALTY_MAX,
  LOYALTY_SETTLED,
  RECON_LOSS_MULT,
} from './constants';
import type { EliminationCause, GameEvent } from './events';
import { Player, type PlayerKind } from './player';
import type { LocalizedName } from '../map/gamemap';
import { Attack, largeTerritoryBonus, processAttacks } from '../rules/combat';
import { BuildingGrid, type Building } from '../buildings/building';
import type { Unit } from '../units/unit';
import type { StampedCommand } from '../net/commands';
import { applyCommand } from './commands';
import { addGold, updateEconomy } from './economy';
import { setupPlayers, updateSpawnPhase } from './spawn';
import { updateBuildings, removeBuilding, paidLevels } from '../buildings/buildings';
import { updateShips } from '../units/ships';
import { updateRails, cutRailsAt, type Rail } from '../units/trains';
import { updateNukes } from '../units/nukes';
import { updateAir } from '../units/air';
import { updateDiplomacy } from '../rules/diplomacy';
import { updateVictory, type VictoryState } from '../rules/victory';
import { updateFeatures, type FeatureState, createFeatureState } from '../rules/features';
import { updateAI, type AIState, createAIState } from '../npc/ai';
import { techMagMultiplier, techSpeedMultiplier } from '../rules/tech';
import { capitalTileTaken, updateCapitals } from '../rules/capital';

export type Phase = 'spawn' | 'playing' | 'ended';

export class Game {
  readonly map: GameMap;
  readonly config: GameConfig;
  readonly rng: Rng;
  tick = 0;
  phase: Phase = 'spawn';
  spawnEndTick: number;
  startTick = 0;
  private idCounter = 1;

  // ---- per-tile state
  readonly owner: Uint16Array;
  /** Fallout intensity 0..255. */
  readonly fallout: Uint8Array;
  readonly loyalty: Uint8Array;
  /** bit0: dead zone (battle royale) — uninhabitable. */
  readonly flags: Uint8Array;
  /** Position of a tile in its owner's border/coast list (-1 = absent). */
  readonly borderPos: Int32Array;
  readonly coastPos: Int32Array;
  /** Scratch marks used by attacks (attack id that queued the tile). */
  readonly queuedBy: Int32Array;
  /** Arrival time of the attack in queuedBy (frontier tiles) or conquest time (taken tiles). */
  readonly frontTime: Float32Array;
  /** Building id occupying a tile (-1 none). */
  readonly buildingAt: Int32Array;

  // ---- entities
  players: (Player | null)[] = [null];
  attacks: Attack[] = [];
  buildings = new Map<number, Building>();
  readonly grid: BuildingGrid;
  units: Unit[] = [];
  rails: Rail[] = [];
  railTiles: Uint8Array;

  victory: VictoryState;
  features: FeatureState;
  ai: AIState;

  /** Useful (non-fallout, non-dead) passable land tiles. */
  usefulLand = 0;

  // ---- outputs for the presentation layer (cleared every tick)
  events: GameEvent[] = [];
  changedTiles: number[] = [];
  changedFallout: number[] = [];
  buildingsDirty = false;
  railsDirty = false;
  /** Incremented on every building add/remove/ownership/completion change. */
  buildingsVersion = 0;
  /** Capitals taken this tick ([tile, loser, new owner] triples), handled by updateCapitals. */
  capitalFalls: number[] = [];

  /** Optional per-tick work budget for AI (deterministic work units). */
  aiBudget = 6000;

  constructor(map: GameMap, config: GameConfig, opts: { skipSetup?: boolean } = {}) {
    this.map = map;
    this.config = config;
    this.rng = new Rng(config.seed);
    const n = map.size;
    this.owner = new Uint16Array(n);
    this.fallout = new Uint8Array(n);
    this.loyalty = new Uint8Array(n).fill(LOYALTY_MAX);
    this.flags = new Uint8Array(n);
    this.borderPos = new Int32Array(n).fill(-1);
    this.coastPos = new Int32Array(n).fill(-1);
    this.queuedBy = new Int32Array(n).fill(-1);
    this.frontTime = new Float32Array(n);
    this.buildingAt = new Int32Array(n).fill(-1);
    this.railTiles = new Uint8Array(n);
    this.grid = new BuildingGrid(map.width, map.height);
    this.usefulLand = map.landCount;
    this.spawnEndTick = Math.round(config.spawnSeconds * 10);
    this.victory = { winner: -1, winnerTeam: -1, threshold: config.victoryThreshold, reason: '' };
    this.features = createFeatureState(this);
    this.ai = createAIState();
    if (!opts.skipSetup) setupPlayers(this);
  }

  nextId(): number {
    return this.idCounter++;
  }
  peekIdCounter(): number {
    return this.idCounter;
  }
  setIdCounter(v: number): void {
    this.idCounter = v;
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  notify(
    to: number,
    key: string,
    level: 'info' | 'good' | 'warn' | 'danger',
    params?: Record<string, string | number>,
    tile?: number,
  ): void {
    const e: GameEvent = { k: 'notify', to, key, level };
    if (params) e.params = params;
    if (tile !== undefined) e.tile = tile;
    this.events.push(e);
  }

  addPlayer(name: LocalizedName, kind: PlayerKind): Player {
    const p = new Player(this.players.length, name, kind);
    this.players.push(p);
    return p;
  }

  player(id: number): Player | null {
    return id > 0 && id < this.players.length ? this.players[id]! : null;
  }

  *alivePlayers(): Generator<Player> {
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (p.alive) yield p;
    }
  }

  isDead(tile: number): boolean {
    return (this.flags[tile]! & 1) === 1;
  }

  isUsefulLand(tile: number): boolean {
    return IS_LAND[this.map.terrain[tile]!] === 1 && this.fallout[tile] === 0 && !this.isDead(tile);
  }

  sameTeam(a: number, b: number): boolean {
    if (a === b) return true;
    const pa = this.player(a);
    const pb = this.player(b);
    return !!pa && !!pb && pa.team > 0 && pa.team === pb.team;
  }

  friendly(a: number, b: number): boolean {
    if (a === b) return true;
    if (this.sameTeam(a, b)) return true;
    const pa = this.player(a);
    return !!pa && pa.allies.has(b);
  }

  // ------------------------------------------------------------------ tiles
  /** Change the owner of a tile, keeping counts, border/coast lists and buildings in sync. */
  setOwner(tile: number, newOwner: number): void {
    const old = this.owner[tile]!;
    if (old === newOwner) return;
    const map = this.map;
    const w = map.width;
    const x = tile % w;
    const y = (tile / w) | 0;
    const useful = this.fallout[tile] === 0 && !this.isDead(tile);
    if (old > 0) {
      const p = this.players[old]!;
      p.tiles--;
      if (useful) p.usefulTiles--;
      p.sumX -= x;
      p.sumY -= y;
      p.stats.tilesLost++;
      this.removeBorder(tile, p);
      this.removeCoast(tile, p);
      if (p.capital === tile) capitalTileTaken(this, tile, old, newOwner);
    }
    this.owner[tile] = newOwner;
    if (newOwner > 0) {
      const p = this.players[newOwner]!;
      p.tiles++;
      if (useful) p.usefulTiles++;
      p.sumX += x;
      p.sumY += y;
      p.stats.tilesConquered++;
      if (p.tiles > p.stats.maxTiles) p.stats.maxTiles = p.tiles;
      // A conquest is restless; land taken back from rebels who seceded from us comes home
      // calm (it would otherwise secede again at once: the rebellion would never end).
      if (old > 0 || this.phase === 'playing')
        this.loyalty[tile] =
          old > 0 && this.players[old]!.rebelOf !== newOwner ? LOYALTY_CONQUERED : LOYALTY_SETTLED;
    } else {
      this.loyalty[tile] = LOYALTY_MAX;
    }
    this.changedTiles.push(tile);
    // Re-evaluate border status of the tile and its neighbours.
    this.refreshBorder(tile);
    if (x > 0) this.refreshBorder(tile - 1);
    if (x < w - 1) this.refreshBorder(tile + 1);
    if (y > 0) this.refreshBorder(tile - w);
    if (y < map.height - 1) this.refreshBorder(tile + w);
    if (newOwner > 0 && map.isCoastalLand(tile)) this.addCoast(tile, this.players[newOwner]!);
    // Buildings on the tile.
    const bid = this.buildingAt[tile]!;
    if (bid >= 0) this.onBuildingTileCaptured(bid, newOwner);
    if (this.railTiles[tile]) cutRailsAt(this, tile, newOwner);
    if (old > 0) {
      const p = this.players[old]!;
      if (p.tiles === 0 && p.alive && this.phase === 'playing') this.eliminate(p, newOwner, tile);
    }
  }

  private onBuildingTileCaptured(bid: number, newOwner: number): void {
    const b = this.buildings.get(bid);
    if (!b) return;
    const prev = b.owner;
    if (newOwner === 0 || !CAPTURE_TRANSFER[b.type]) {
      removeBuilding(this, b, false);
      return;
    }
    const po = this.players[prev];
    const pn = this.players[newOwner]!;
    if (po) {
      po.buildingCount[b.type]--;
      if (b.type === B.City) po.cityLevels -= paidLevels(b);
    }
    pn.buildingCount[b.type]++;
    if (b.type === B.City) pn.cityLevels += paidLevels(b);
    b.owner = newOwner;
    this.buildingsDirty = true;
    this.buildingsVersion++;
    this.emit({ k: 'capture', x: b.x, y: b.y, owner: prev, by: newOwner });
    // Journal: a research centre changes hands with its research output.
    if (b.type === B.Lab) {
      if (po?.kind === 'human') this.notify(prev, 'notify.labLost', 'warn', { by: newOwner }, b.tile);
      if (pn.kind === 'human') this.notify(newOwner, 'notify.labTaken', 'good', { player: prev }, b.tile);
    }
  }

  private refreshBorder(tile: number): void {
    const o = this.owner[tile]!;
    if (o === 0) return;
    const p = this.players[o]!;
    const map = this.map;
    const w = map.width;
    const x = tile % w;
    const own = this.owner;
    const t = map.terrain;
    let border = false;
    if (x > 0 && own[tile - 1] !== o && IS_LAND[t[tile - 1]!]) border = true;
    else if (x < w - 1 && own[tile + 1] !== o && IS_LAND[t[tile + 1]!]) border = true;
    else if (tile >= w && own[tile - w] !== o && IS_LAND[t[tile - w]!]) border = true;
    else if (tile < map.size - w && own[tile + w] !== o && IS_LAND[t[tile + w]!]) border = true;
    if (border) this.addBorder(tile, p);
    else this.removeBorder(tile, p);
  }

  private addBorder(tile: number, p: Player): void {
    if (this.borderPos[tile]! >= 0) return;
    this.borderPos[tile] = p.border.length;
    p.border.push(tile);
  }

  private removeBorder(tile: number, p: Player): void {
    const pos = this.borderPos[tile]!;
    if (pos < 0) return;
    const last = p.border.pop()!;
    if (last !== tile) {
      p.border[pos] = last;
      this.borderPos[last] = pos;
    }
    this.borderPos[tile] = -1;
  }

  private addCoast(tile: number, p: Player): void {
    if (this.coastPos[tile]! >= 0) return;
    this.coastPos[tile] = p.coast.length;
    p.coast.push(tile);
  }

  private removeCoast(tile: number, p: Player): void {
    const pos = this.coastPos[tile]!;
    if (pos < 0) return;
    const last = p.coast.pop()!;
    if (last !== tile) {
      p.coast[pos] = last;
      this.coastPos[last] = pos;
    }
    this.coastPos[tile] = -1;
  }

  /** Mark a tile with fallout (keeps useful-tile counts consistent). */
  setFallout(tile: number, value: number): void {
    // Stored in a Uint8Array: clamp, or 256 would wrap to 0 and break the useful-land counts.
    value = Math.max(0, Math.min(255, Math.round(value)));
    const prev = this.fallout[tile]!;
    if (prev === value) return;
    const wasUseful = prev === 0 && !this.isDead(tile) && IS_LAND[this.map.terrain[tile]!];
    this.fallout[tile] = value;
    const isUseful = value === 0 && !this.isDead(tile) && IS_LAND[this.map.terrain[tile]!];
    if (wasUseful !== isUseful) {
      const d = isUseful ? 1 : -1;
      this.usefulLand += d;
      const o = this.owner[tile]!;
      if (o > 0) this.players[o]!.usefulTiles += d;
    }
    this.changedFallout.push(tile);
  }

  /** Battle royale: make a tile uninhabitable. */
  killTile(tile: number): void {
    if (this.isDead(tile)) return;
    if (this.owner[tile] !== 0) this.setOwner(tile, 0);
    const wasUseful = this.isUsefulLand(tile);
    this.flags[tile]! |= 1;
    if (wasUseful) this.usefulLand--;
    this.changedFallout.push(tile);
  }

  /** `tile`: the last tile taken (where the conqueror's loot is shown). */
  eliminate(p: Player, by: number, tile = -1): void {
    if (!p.alive) return;
    p.alive = false;
    p.eliminatedTick = this.tick;
    p.troops = 0;
    p.workers = 0;
    // Conquest: the conqueror seizes the treasury (only half of a human's survives).
    const conqueror = by > 0 && by !== p.id ? this.players[by] : null;
    if (conqueror && conqueror.alive) {
      const loot = p.kind === 'human' ? Math.floor(p.gold / 2) : Math.floor(p.gold);
      p.gold = 0;
      if (loot > 0) {
        addGold(conqueror, loot);
        const w = this.map.width;
        const [cx, cy] = conqueror.centroid(w);
        const x = tile >= 0 ? tile % w : Math.round(cx);
        const y = tile >= 0 ? (tile / w) | 0 : Math.round(cy);
        this.emit({ k: 'loot', x, y, owner: conqueror.id, amount: loot });
      }
    }
    for (const a of this.attacks) if (a.attacker === p.id) a.done = true;
    // Ships at sea sink progressively (handled in ships update: owner dead → hp decay).
    for (const [id, b] of this.buildings)
      if (b.owner === p.id) removeBuilding(this, this.buildings.get(id)!, false);
    for (const q of this.alivePlayers()) {
      q.allies.delete(p.id);
      q.allyRequests.delete(p.id);
    }
    // Its own pacts and pending offers die with it (a spectating loser kept stale ones).
    p.allies.clear();
    p.allyRequests.clear();
    const cause = this.eliminationCause(p, by, tile);
    this.emit({ k: 'eliminated', player: p.id, by, cause });
    if (p.kind !== 'tribe') this.notify(-1, 'event.eliminated', 'info', { player: p.id, by, cause });
  }

  /**
   * Why `p` fell (the news reports it). A last tile lost to nobody during play is
   * either the battle royale zone (outside the shrinking ring) or a nuclear blast:
   * the only other ways a tile goes back to the wilderness.
   */
  private eliminationCause(p: Player, by: number, tile: number): EliminationCause {
    if (p.surrendered) return 'surrender';
    if (by > 0 && by !== p.id) return 'conquered';
    const ring = this.victory.ring;
    if (ring && tile >= 0) {
      const w = this.map.width;
      const dx = (tile % w) + 0.5 - ring.cx;
      const dy = ((tile / w) | 0) + 0.5 - ring.cy;
      if (dx * dx + dy * dy > ring.nextR * ring.nextR) return 'zone';
    }
    return 'nuked';
  }

  // ------------------------------------------------------ combat modifiers
  /** Defence post / rampart multiplier on attacker losses for a tile owned by `target`. */
  defenseMagMult(tile: number, target: number): number {
    return this.nearDefensePost(tile, target) ? DEFENSE_POST_MAG * this.rampartMult(target) : 1;
  }

  defenseSpeedMult(tile: number, target: number): number {
    return this.nearDefensePost(tile, target) ? DEFENSE_POST_SPEED : 1;
  }

  private rampartMult(target: number): number {
    const p = this.players[target]!;
    return p.rampartUntil > this.tick ? 2 : 1;
  }

  private nearDefensePost(tile: number, target: number): boolean {
    const p = this.players[target]!;
    if (p.buildingCount[B.DefensePost] === 0) return false;
    const w = this.map.width;
    const x = tile % w;
    const y = (tile / w) | 0;
    const r2 = DEFENSE_POST_RANGE * DEFENSE_POST_RANGE;
    let found = false;
    this.grid.query(x, y, DEFENSE_POST_RANGE, (id) => {
      if (found) return;
      const b = this.buildings.get(id)!;
      if (b.type !== B.DefensePost || b.owner !== target || b.buildLeft > 0) return;
      if ((b.x - x) ** 2 + (b.y - y) ** 2 <= r2) found = true;
    });
    return found;
  }

  /**
   * Reconnaissance (GAME_DESIGN.md §11): inside a zone spotted by the attacker (or a friend
   * of it), its land attacks lose RECON_LOSS_MULT of their usual losses.
   */
  reconLossMult(attacker: number, tile: number): number {
    const zones = this.features.reveals;
    if (zones.length === 0) return 1;
    const w = this.map.width;
    const x = (tile % w) + 0.5;
    const y = ((tile / w) | 0) + 0.5;
    for (const z of zones)
      if ((z.x - x) ** 2 + (z.y - y) ** 2 <= z.r * z.r && this.friendly(z.owner, attacker))
        return RECON_LOSS_MULT;
    return 1;
  }

  /** How much cheaper attacking p gets because p is huge (OpenFront's large-defender bonus, hover card). */
  bigEmpireMalus(p: Player): number {
    const m = 1 - largeTerritoryBonus(p.tiles, LARGE_DEFENDER_DEPTH);
    return m >= 0.005 ? m : 0;
  }

  techMagMult(attacker: number, terrain: number): number {
    return this.config.features.tech ? techMagMultiplier(this.players[attacker]!, terrain) : 1;
  }

  techSpeedMult(attacker: number): number {
    return this.config.features.tech ? techSpeedMultiplier(this.players[attacker]!) : 1;
  }

  eventDefenseMult(_target: number): number {
    return 1;
  }

  /** Whether `attacker` may (still) attack `target`. `fresh` = a new order (betrayal checks happen in commands). */
  attackAllowed(attacker: number, target: number, fresh: boolean): boolean {
    if (this.phase !== 'playing') return false;
    if (target === 0) return true;
    if (attacker === target || this.sameTeam(attacker, target)) return false;
    const T = this.players[target]!;
    const A = this.players[attacker]!;
    if (!T.alive) return false;
    if (T.immuneUntil > this.tick) return false;
    if (T.kind !== 'tribe' && A.kind !== 'tribe' && this.features.ceasefireUntil > this.tick) return false;
    if (!fresh && A.allies.has(target)) return false;
    return true;
  }

  difficulty() {
    return DIFFICULTY[this.config.difficulty];
  }

  // ------------------------------------------------------------------ tick
  /** Advance the simulation by one tick, applying the given commands first. */
  step(cmds: readonly StampedCommand[]): void {
    this.events.length = 0;
    this.changedTiles.length = 0;
    this.changedFallout.length = 0;
    for (const sc of cmds) applyCommand(this, sc.p, sc.c);

    if (this.phase === 'spawn') {
      updateSpawnPhase(this);
    } else if (this.phase === 'playing') {
      updateEconomy(this);
      processAttacks(this);
      updateBuildings(this);
      updateShips(this);
      updateRails(this);
      updateNukes(this);
      if (this.config.features.air) updateAir(this);
      updateDiplomacy(this);
      updateFeatures(this);
      updateAI(this);
      updateCapitals(this);
      updateVictory(this);
      if (this.tick % HISTORY_EVERY === 0) this.sampleHistory();
    }
    this.tick++;
  }

  private sampleHistory(): void {
    for (const p of this.alivePlayers()) {
      p.history.push({
        tick: this.tick,
        tiles: p.tiles,
        gold: Math.round(p.gold),
        troops: Math.round(p.troops),
      });
    }
  }

  /** Utility for tests/tools: count tiles per owner from scratch. */
  recountTiles(): number[] {
    const counts = new Array<number>(this.players.length).fill(0);
    for (let i = 0; i < this.owner.length; i++) counts[this.owner[i]!]!++;
    return counts;
  }

  isWaterTile(tile: number): boolean {
    return IS_WATER[this.map.terrain[tile]!] === 1;
  }

  isImpassable(tile: number): boolean {
    return this.map.terrain[tile] === Terr.Impassable;
  }

  buildingCounts(owner: number): Int32Array {
    return this.players[owner]?.buildingCount ?? new Int32Array(BUILDING_COUNT);
  }
}
