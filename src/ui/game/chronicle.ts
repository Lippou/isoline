// The game's chronicle: what the final edition of the Courier is written from.
// Recorded on the client from the mirror state and the simulation's events (never in
// the deterministic simulation): every 30 s of play the share of usable land of each
// nation, a small ownership map of the world, and who took land from whom; plus the
// facts of the game (falls, betrayals, alliances, missiles, world events). Memory stays
// small: at most MAX_MAPS maps of MAP_SIDE px (palette indices), about 2 MB for an hour.
import type { GameEvent, EliminationCause } from '../../core/game/events';
import type { LocalizedName } from '../../core/map/gamemap';
import type { PlayerKind, PlayerStats } from '../../core/game/player';
import type { FinalStats, PlayerView, WorldView } from '../../engine/protocol';
import type { GameMode } from '../../core/game/config';
import type { PlayerFlag } from '../../core/data/flagSpec';

/** One sample every 30 s of game time. */
export const SAMPLE_TICKS = 300;
/** Longest side of the ownership maps (px). */
export const MAP_SIDE = 240;
/** Maps kept at most (the oldest half is thinned out beyond: one in two). */
export const MAX_MAPS = 40;
/** Map palette: 0 is nobody's land, 1..254 a nation of the roster (index + 1), 255 the tribes. */
export const TRIBES = 255;

/** What the chronicle needs from the client mirror (ClientState fits). */
export interface ChronicleSource {
  width: number;
  height: number;
  tick: number;
  phase: 'spawn' | 'playing' | 'ended';
  terrain: Uint8Array;
  owner: Uint16Array;
  playerList: PlayerView[];
  players: Map<number, PlayerView>;
  world: WorldView | null;
  meta: { id: string; name: LocalizedName };
}

export interface EdPlayer {
  id: number;
  name: LocalizedName;
  kind: PlayerKind;
  team: number;
  color: number;
  flagSeed: number;
  iso: string;
  flag?: PlayerFlag;
  /** Tick of its fall (-1: standing at the end). */
  fellAt: number;
}

type At = [number, number];

export type Fact =
  | { k: 'fall'; tick: number; player: number; by: number; cause: EliminationCause; at?: At }
  | { k: 'betrayal'; tick: number; traitor: number; victim: number; at?: At }
  | { k: 'alliance'; tick: number; a: number; b: number; at?: At }
  | { k: 'nuke'; tick: number; owner: number; kind: number; victim: number; at: At }
  | { k: 'worldEvent'; tick: number; id: string }
  | { k: 'city'; tick: number; owner: number; at: At };

/** Land that changed hands between two samples (the interval ending at `tick`). */
export interface Transfer {
  tick: number;
  from: number;
  to: number;
  /** Map cells (of `landCells`). */
  cells: number;
}

export interface EdMap {
  tick: number;
  data: Uint8Array;
}

export interface Edition {
  mapId: string;
  mapName: LocalizedName;
  /** Size of the ownership maps and their land mask (1 = land). */
  w: number;
  h: number;
  land: Uint8Array;
  landCells: number;
  /** Ticks: start of play (after the spawn phase) and end of the game. */
  startTick: number;
  endTick: number;
  /** Real time the game ended (ms since the epoch). */
  date: number;
  mode: GameMode;
  /** Victory threshold at the end (percent of usable land). */
  threshold: number;
  reason: string;
  winner: number;
  winnerTeam: number;
  /** Who read the paper (-1: a spectator). */
  viewer: number;
  roster: EdPlayer[];
  /** Sample ticks, and each nation's share of the usable land at that tick (by roster index). */
  ticks: number[];
  shares: Float32Array[];
  /** Label position (x, y) of each nation at each sample (by roster index, -1 if unknown). */
  pos: Int16Array[];
  maps: EdMap[];
  facts: Fact[];
  transfers: Transfer[];
  counts: { nukes: number; betrayals: number; alliances: number };
  /** The reader's statistics (absent for spectators). */
  stats?: PlayerStats;
}

export class Chronicle {
  readonly w: number;
  readonly h: number;
  readonly land: Uint8Array;
  readonly landCells: number;
  private readonly roster: EdPlayer[] = [];
  private readonly index = new Map<number, number>();
  private lut = new Uint8Array(1);
  private ticks: number[] = [];
  private shares: Float32Array[] = [];
  private pos: Int16Array[] = [];
  private maps: EdMap[] = [];
  private mapStride = 1;
  private samples = 0;
  private prev: Uint8Array | null = null;
  private facts: Fact[] = [];
  private transfers: Transfer[] = [];
  private counts = { nukes: 0, betrayals: 0, alliances: 0 };
  private pairs = new Set<string>();
  private nukeKinds = new Set<string>();
  private launches: { owner: number; impact: number; threatened: number[] }[] = [];
  private lastPos = new Map<number, At>();
  private startTick = -1;
  private nextSample = -1;
  private firstCity = false;
  private lastTick = -1;
  /** Sub-sample offsets inside a map cell (2 × 2). */
  private readonly sub: number[][] = [];

  constructor(
    src: Pick<ChronicleSource, 'width' | 'height' | 'terrain'>,
    readonly viewer: number,
  ) {
    const scale = Math.min(1, MAP_SIDE / Math.max(src.width, src.height));
    this.w = Math.max(1, Math.round(src.width * scale));
    this.h = Math.max(1, Math.round(src.height * scale));
    const sx = src.width / this.w;
    const sy = src.height / this.h;
    // Each cell reads 4 points of the map; it is land when at least 2 of them are.
    for (let cy = 0; cy < this.h; cy++)
      for (let cx = 0; cx < this.w; cx++) {
        const pts: number[] = [];
        for (const [fx, fy] of [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ] as const) {
          const x = Math.min(src.width - 1, Math.floor((cx + fx) * sx));
          const y = Math.min(src.height - 1, Math.floor((cy + fy) * sy));
          pts.push(y * src.width + x);
        }
        this.sub.push(pts);
      }
    this.land = new Uint8Array(this.w * this.h);
    let n = 0;
    for (let i = 0; i < this.sub.length; i++) {
      let landPts = 0;
      for (const t of this.sub[i]!) if (src.terrain[t]! > 2) landPts++;
      if (landPts >= 2) {
        this.land[i] = 1;
        n++;
      }
    }
    this.landCells = Math.max(1, n);
  }

  /** Forget everything recorded (a replay was rewound: the story starts over). */
  private restart(): void {
    this.roster.length = 0;
    this.index.clear();
    this.ticks = [];
    this.shares = [];
    this.pos = [];
    this.maps = [];
    this.mapStride = 1;
    this.samples = 0;
    this.prev = null;
    this.facts = [];
    this.transfers = [];
    this.counts = { nukes: 0, betrayals: 0, alliances: 0 };
    this.pairs.clear();
    this.nukeKinds.clear();
    this.launches = [];
    this.lastPos.clear();
    this.startTick = -1;
    this.nextSample = -1;
    this.firstCity = false;
  }

  /** Feed one simulation update (after the mirror state applied it). */
  tick(st: ChronicleSource, events: readonly GameEvent[]): void {
    if (st.tick < this.lastTick) this.restart();
    this.lastTick = st.tick;
    for (const e of events) this.event(st, e);
    if (st.phase === 'spawn') return;
    if (this.startTick < 0) {
      this.startTick = st.world?.startTick ?? st.tick;
      this.nextSample = this.startTick;
    }
    if (st.tick >= this.nextSample) {
      this.sample(st);
      const k = Math.floor((st.tick - this.startTick) / SAMPLE_TICKS) + 1;
      this.nextSample = this.startTick + k * SAMPLE_TICKS;
    }
  }

  // ------------------------------------------------------------ sampling
  private member(p: PlayerView): number {
    let k = this.index.get(p.id);
    if (k === undefined) {
      k = this.roster.length;
      this.index.set(p.id, k);
      this.roster.push({
        id: p.id,
        name: p.name,
        kind: p.kind,
        team: p.team,
        color: p.color,
        flagSeed: p.flagSeed,
        iso: p.iso,
        ...(p.flag ? { flag: p.flag } : {}),
        fellAt: -1,
      });
    } else {
      const r = this.roster[k]!;
      r.name = p.name;
      r.team = p.team;
      r.color = p.color;
    }
    return k;
  }

  private sample(st: ChronicleSource): void {
    const useful = Math.max(1, st.world?.usefulLand ?? 1);
    let maxId = 0;
    for (const p of st.playerList) {
      if (p.id > maxId) maxId = p.id;
      if (p.kind !== 'tribe' && p.spawned) this.member(p);
    }
    const share = new Float32Array(this.roster.length);
    const pos = new Int16Array(this.roster.length * 2).fill(-1);
    for (const p of st.playerList) {
      const k = this.index.get(p.id);
      if (p.label[2] > 0) this.lastPos.set(p.id, [p.label[0], p.label[1]]);
      if (k === undefined) continue;
      share[k] = p.alive ? p.usefulTiles / useful : 0;
      const at = this.lastPos.get(p.id);
      if (at) {
        pos[k * 2] = Math.round(at[0]);
        pos[k * 2 + 1] = Math.round(at[1]);
      }
    }
    this.ticks.push(st.tick);
    this.shares.push(share);
    this.pos.push(pos);
    // Palette: roster index + 1, the tribes (and any overflow) share the last entry.
    if (this.lut.length <= maxId) this.lut = new Uint8Array(maxId + 1);
    for (const p of st.playerList) {
      const k = this.index.get(p.id);
      this.lut[p.id] = k !== undefined && k < TRIBES - 1 ? k + 1 : TRIBES;
    }
    const snap = this.snapshot(st.owner);
    if (this.prev) this.compare(this.prev, snap, st.tick);
    this.prev = snap;
    if (this.samples % this.mapStride === 0) {
      this.maps.push({ tick: st.tick, data: snap });
      if (this.maps.length > MAX_MAPS) {
        this.maps = this.maps.filter((_, k) => k % 2 === 0);
        this.mapStride *= 2;
      }
    }
    this.samples++;
  }

  /**
   * The ownership map, palette indices: the most common owner among each cell's four
   * points (an owned point wins over free land and sea, so coasts keep their colour).
   */
  snapshot(owner: Uint16Array): Uint8Array {
    const out = new Uint8Array(this.w * this.h);
    const lut = this.lut;
    for (let i = 0; i < out.length; i++) {
      if (!this.land[i]) continue;
      const pts = this.sub[i]!;
      const oa = owner[pts[0]!]!;
      const ob = owner[pts[1]!]!;
      const oc = owner[pts[2]!]!;
      const od = owner[pts[3]!]!;
      let o = 0;
      let best = 0;
      for (const x of [oa, ob, oc, od]) {
        if (x === 0) continue;
        const n = (x === oa ? 1 : 0) + (x === ob ? 1 : 0) + (x === oc ? 1 : 0) + (x === od ? 1 : 0);
        if (n > best) {
          best = n;
          o = x;
        }
      }
      out[i] = o === 0 ? 0 : lut[o] || TRIBES;
    }
    return out;
  }

  /** Who took land from whom since the last sample: the three largest flows are kept. */
  private compare(a: Uint8Array, b: Uint8Array, tick: number): void {
    const flows = new Map<number, number>();
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!;
      const y = b[i]!;
      if (x === y || x === 0 || y === 0 || x === TRIBES || y === TRIBES) continue;
      const key = (x << 8) | y;
      flows.set(key, (flows.get(key) ?? 0) + 1);
    }
    const min = Math.max(3, this.landCells * 0.002);
    [...flows.entries()]
      .filter(([, n]) => n >= min)
      .sort((p, q) => q[1] - p[1])
      .slice(0, 3)
      .forEach(([key, cells]) =>
        this.transfers.push({
          tick,
          from: this.roster[(key >> 8) - 1]!.id,
          to: this.roster[(key & 255) - 1]!.id,
          cells,
        }),
      );
  }

  // --------------------------------------------------------------- facts
  private where(st: ChronicleSource, id: number): At | undefined {
    const p = st.players.get(id);
    if (p && p.label[2] > 0) return [p.label[0], p.label[1]];
    return this.lastPos.get(id);
  }

  /** Author of the blast that just razed `player`'s last lands (0 if unknown). */
  private nuker(player: number, now: number): number {
    const near = this.launches.filter((l) => l.impact <= now + 30 && l.impact >= now - 60);
    const hit = near.filter((l) => l.threatened.includes(player));
    return (hit.at(-1) ?? near.at(-1))?.owner ?? 0;
  }

  private event(st: ChronicleSource, e: GameEvent): void {
    const tick = st.tick;
    switch (e.k) {
      case 'eliminated': {
        const p = st.players.get(e.player);
        if (!p || p.kind === 'tribe') return;
        const k = this.member(p);
        this.roster[k]!.fellAt = tick;
        const by = e.cause === 'nuked' ? this.nuker(e.player, tick) : e.by;
        const at = this.lastPos.get(e.player) ?? this.where(st, e.player);
        this.facts.push({ k: 'fall', tick, player: e.player, by, cause: e.cause, ...(at ? { at } : {}) });
        break;
      }
      case 'nukeLaunch': {
        this.launches = [
          ...this.launches.filter((l) => l.impact > tick - 100),
          { owner: e.owner, impact: e.impact, threatened: e.threatened },
        ];
        if (e.kind > 2) return; // MIRV warheads: the MIRV itself was counted
        this.counts.nukes++;
        // The first missile of each kind, and the reader's first.
        const keys = [`k${e.kind}`, ...(e.owner === this.viewer ? ['mine'] : [])];
        const fresh = keys.filter((x) => !this.nukeKinds.has(x));
        if (!fresh.length) return;
        for (const x of fresh) this.nukeKinds.add(x);
        const tx = Math.round(e.tx);
        const ty = Math.round(e.ty);
        const victim = st.owner[ty * st.width + tx] ?? 0;
        this.facts.push({ k: 'nuke', tick, owner: e.owner, kind: e.kind, victim, at: [tx, ty] });
        break;
      }
      case 'betrayal': {
        this.counts.betrayals++;
        const at = this.where(st, e.victim);
        this.facts.push({ k: 'betrayal', tick, traitor: e.traitor, victim: e.victim, ...(at ? { at } : {}) });
        break;
      }
      case 'alliance': {
        if (!e.on) return;
        const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
        if (this.pairs.has(key)) return; // renewals
        this.pairs.add(key);
        this.counts.alliances++;
        const pa = this.where(st, e.a);
        const pb = this.where(st, e.b);
        const at: At | undefined = pa && pb ? [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] : (pa ?? pb);
        this.facts.push({ k: 'alliance', tick, a: e.a, b: e.b, ...(at ? { at } : {}) });
        break;
      }
      case 'worldEvent':
        this.facts.push({ k: 'worldEvent', tick, id: e.id });
        break;
      case 'built':
        if (e.owner !== this.viewer || e.kind !== 0 || this.firstCity) return; // 0: B.City
        this.firstCity = true;
        this.facts.push({
          k: 'city',
          tick,
          owner: e.owner,
          at: [e.tile % st.width, Math.floor(e.tile / st.width)],
        });
        break;
    }
  }

  // ---------------------------------------------------------------- close
  /**
   * The edition: a last sample at the final tick, then everything the paper needs.
   * Null when the game ended before there was anything to tell (still in the spawn phase).
   */
  close(st: ChronicleSource, stats: FinalStats, mode: GameMode, date: number): Edition | null {
    if (this.startTick < 0) return null;
    if (this.ticks.at(-1) !== st.tick) this.sample(st);
    // The last map is always the world as it ends.
    if (this.prev && this.maps.at(-1)?.tick !== st.tick) this.maps.push({ tick: st.tick, data: this.prev });
    for (const p of stats.players) {
      const k = this.index.get(p.id);
      if (k !== undefined && !p.alive && this.roster[k]!.fellAt < 0)
        this.roster[k]!.fellAt = p.eliminatedTick;
    }
    const mine = stats.players.find((p) => p.id === this.viewer);
    return {
      mapId: st.meta.id,
      mapName: st.meta.name,
      w: this.w,
      h: this.h,
      land: this.land,
      landCells: this.landCells,
      startTick: this.startTick,
      endTick: st.tick,
      date,
      mode,
      threshold: st.world?.threshold ?? 0,
      reason: stats.reason,
      winner: stats.winner,
      winnerTeam: stats.winnerTeam,
      viewer: this.viewer,
      roster: this.roster.map((r) => ({ ...r })),
      ticks: this.ticks.slice(),
      shares: this.shares.slice(),
      pos: this.pos.slice(),
      maps: this.maps.slice(),
      facts: this.facts.slice(),
      transfers: this.transfers.slice(),
      counts: { ...this.counts },
      ...(mine ? { stats: mine.stats } : {}),
    };
  }
}

/**
 * The last edition printed, kept with the replay it tells: watching a moment of that
 * replay ("Revoir") and coming back finds the same front page.
 */
let kept: { key: string; edition: Edition } | null = null;

export function keepEdition(key: string, edition: Edition): void {
  kept = { key, edition };
}

export function keptEdition(key: string | undefined): Edition | null {
  return key && kept?.key === key ? kept.edition : null;
}
