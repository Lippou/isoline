// Full-state snapshots (saves, desync resync, reconnection, spectators joining).
// Restoring a snapshot must reproduce the exact same future as the original game.
import { Game } from '../game/state';
import type { GameConfig } from '../game/config';
import type { GameMap } from '../map/gamemap';
import { Player } from '../game/player';
import { Attack } from '../rules/combat';
import { rebuildRailIndex } from '../units/trains';
import type { Building } from '../buildings/building';
import { toBase64, fromBase64 } from '../map/format';

export const SNAPSHOT_VERSION = 1;

// ---------------------------------------------------------- run-length codec
export function rleEncode(a: Uint8Array | Uint16Array | Int32Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i]!;
    let j = i + 1;
    while (j < a.length && a[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

export function rleDecodeInto(runs: number[], a: Uint8Array | Uint16Array | Int32Array): void {
  let o = 0;
  for (let k = 0; k < runs.length; k += 2) {
    const v = runs[k]!;
    const n = runs[k + 1]!;
    a.fill(v, o, o + n);
    o += n;
  }
}

// ------------------------------------------------- generic plain conversion
type Plain = unknown;

export function toPlain(v: unknown): Plain {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Map) return { __m: [...v.entries()].map(([k, x]) => [toPlain(k), toPlain(x)]) };
  if (v instanceof Set) return { __s: [...v].map(toPlain) };
  if (v instanceof Uint8Array) return { __u8: toBase64(v) };
  if (v instanceof Int32Array) return { __i32: Array.from(v) };
  if (v instanceof Uint16Array) return { __u16: Array.from(v) };
  if (v instanceof Float32Array) return { __f32: Array.from(v) };
  if (Array.isArray(v)) return v.map(toPlain);
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'function') continue;
    o[k] = toPlain(x);
  }
  return o;
}

export function fromPlain(v: Plain): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(fromPlain);
  const o = v as Record<string, unknown>;
  if ('__m' in o)
    return new Map((o.__m as [unknown, unknown][]).map(([k, x]) => [fromPlain(k), fromPlain(x)]));
  if ('__s' in o) return new Set((o.__s as unknown[]).map(fromPlain));
  if ('__u8' in o) return new Uint8Array(fromBase64(o.__u8 as string));
  if ('__i32' in o) return new Int32Array(o.__i32 as number[]);
  if ('__u16' in o) return new Uint16Array(o.__u16 as number[]);
  if ('__f32' in o) return new Float32Array(o.__f32 as number[]);
  const r: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) r[k] = fromPlain(x);
  return r;
}

export interface Snapshot {
  version: number;
  mapId: string;
  config: GameConfig;
  core: Record<string, unknown>;
  owner: number[];
  fallout: number[];
  loyalty: number[];
  flags: number[];
  queuedBy: number[];
  players: unknown[];
  attacks: unknown[];
  buildings: unknown[];
  units: unknown;
  rails: unknown;
  victory: unknown;
  features: unknown;
  ai: unknown;
}

export function takeSnapshot(game: Game): Snapshot {
  const { shipSpeedAt: _ignored, ...features } = game.features;
  return {
    version: SNAPSHOT_VERSION,
    mapId: game.map.meta.id,
    config: game.config,
    core: {
      tick: game.tick,
      phase: game.phase,
      spawnEndTick: game.spawnEndTick,
      startTick: game.startTick,
      idCounter: game.peekIdCounter(),
      rng: game.rng.getState(),
      usefulLand: game.usefulLand,
      buildingsVersion: game.buildingsVersion,
    },
    owner: rleEncode(game.owner),
    fallout: rleEncode(game.fallout),
    loyalty: rleEncode(game.loyalty),
    flags: rleEncode(game.flags),
    queuedBy: rleEncode(game.queuedBy),
    players: game.players.map((p) => (p ? toPlain(p) : null)) as unknown[],
    attacks: game.attacks.map((a) => toPlain(a)) as unknown[],
    buildings: [...game.buildings.values()].map((b) => toPlain(b)) as unknown[],
    units: toPlain(game.units),
    rails: toPlain(game.rails),
    victory: toPlain(game.victory),
    features: toPlain(features),
    ai: toPlain(game.ai),
  };
}

export function restoreSnapshot(map: GameMap, snap: Snapshot): Game {
  if (snap.version !== SNAPSHOT_VERSION) throw new Error(`unsupported snapshot version ${snap.version}`);
  const game = new Game(map, snap.config, { skipSetup: true });
  const core = snap.core as {
    tick: number;
    phase: Game['phase'];
    spawnEndTick: number;
    startTick: number;
    idCounter: number;
    rng: number[];
    usefulLand: number;
    buildingsVersion: number;
  };
  game.tick = core.tick;
  game.phase = core.phase;
  game.spawnEndTick = core.spawnEndTick;
  game.startTick = core.startTick;
  game.setIdCounter(core.idCounter);
  game.rng.setState(core.rng);
  game.usefulLand = core.usefulLand;
  game.buildingsVersion = core.buildingsVersion;
  rleDecodeInto(snap.owner, game.owner);
  rleDecodeInto(snap.fallout, game.fallout);
  rleDecodeInto(snap.loyalty, game.loyalty);
  rleDecodeInto(snap.flags, game.flags);
  rleDecodeInto(snap.queuedBy, game.queuedBy);

  game.players = snap.players.map((raw) => {
    if (!raw) return null;
    const o = fromPlain(raw) as Record<string, unknown>;
    const p = new Player(o.id as number, o.name as Player['name'], o.kind as Player['kind']);
    Object.assign(p, o);
    return p;
  });
  for (const p of game.players) {
    if (!p) continue;
    p.border.forEach((t, k) => (game.borderPos[t] = k));
    p.coast.forEach((t, k) => (game.coastPos[t] = k));
  }
  game.attacks = snap.attacks.map((raw) => {
    const o = fromPlain(raw) as Record<string, unknown>;
    const a = new Attack(
      o.id as number,
      o.attacker as number,
      o.target as number,
      o.troops as number,
      o.createdTick as number,
    );
    Object.assign(a, o);
    return a;
  });
  for (const raw of snap.buildings) {
    const b = fromPlain(raw) as Building;
    game.buildings.set(b.id, b);
    game.grid.add(b);
    game.buildingAt[b.tile] = b.id;
  }
  game.units = fromPlain(snap.units) as Game['units'];
  game.rails = fromPlain(snap.rails) as Game['rails'];
  rebuildRailIndex(game);
  game.victory = fromPlain(snap.victory) as Game['victory'];
  Object.assign(game.features, fromPlain(snap.features) as object);
  game.ai = fromPlain(snap.ai) as Game['ai'];
  game.buildingsDirty = true;
  game.railsDirty = true;
  return game;
}

/** JSON text of a snapshot (save files). */
export function snapshotToJson(s: Snapshot): string {
  return JSON.stringify(s);
}

export function snapshotFromJson(text: string): Snapshot {
  return JSON.parse(text) as Snapshot;
}
