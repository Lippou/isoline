// Test helpers: load shipped maps from disk and build games in Node.
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { GameMap, MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type GameConfig } from '../src/core/game/config';
import type { StampedCommand } from '../src/core/net/commands';

const MAPS = path.resolve(import.meta.dirname, '../assets/maps');
const cache = new Map<string, GameMap>();

export function mapFromDisk(id: string): GameMap {
  const hit = cache.get(id);
  if (hit) return hit;
  const meta = JSON.parse(fs.readFileSync(path.join(MAPS, `${id}.json`), 'utf8')) as MapMeta;
  const map = loadMap(
    meta,
    fs.readFileSync(path.join(MAPS, `${id}.png`)),
    fs.readFileSync(path.join(MAPS, `${id}.elev.png`)),
  );
  cache.set(id, map);
  return map;
}

export function makeGame(mapId: string, patch: Partial<GameConfig> = {}): Game {
  const cfg = { ...defaultConfig(12345), mapId, spawnSeconds: 1, ...patch };
  return new Game(mapFromDisk(mapId), cfg);
}

/** Run `ticks` ticks; `script(tick)` may return commands for that tick. */
export function run(
  game: Game,
  ticks: number,
  script?: (tick: number, game: Game) => StampedCommand[],
): void {
  for (let k = 0; k < ticks; k++) game.step(script ? script(game.tick, game) : []);
}

/** Check border/coast/tile-count invariants. Returns a list of problems. */
export function invariants(game: Game): string[] {
  const errs: string[] = [];
  const counts = game.recountTiles();
  for (const p of game.players) {
    if (!p) continue;
    if (counts[p.id] !== p.tiles) errs.push(`player ${p.id} tiles ${p.tiles} != ${counts[p.id]}`);
    for (let k = 0; k < p.border.length; k++) {
      const t = p.border[k]!;
      if (game.owner[t] !== p.id) errs.push(`border tile ${t} not owned by ${p.id}`);
      if (game.borderPos[t] !== k) errs.push(`borderPos mismatch at ${t}`);
    }
  }
  return errs;
}

import { GameMap as GM } from '../src/core/map/gamemap';
import { T } from '../src/core/map/terrain';

const CHARS: Record<string, number> = {
  '~': T.DeepOcean,
  '-': T.Shallow,
  o: T.Lake,
  r: T.River,
  '.': T.Plains,
  h: T.Hills,
  M: T.Mountain,
  d: T.Desert,
  f: T.Forest,
  t: T.Tundra,
  '#': T.Impassable,
};

/**
 * Build a map from rows of characters (scaled ×`scale` in both directions):
 * ~ deep, - shallow, o lake, r river, . plains, h hills, M mountain, d desert,
 * f forest, t tundra, # impassable.
 */
export function asciiMap(rows: string[], scale = 1, id = 'test'): GM {
  const h0 = rows.length;
  const w0 = rows[0]!.length;
  const w = w0 * scale;
  const h = h0 * scale;
  const terrain = new Uint8Array(w * h);
  const elevation = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[Math.floor(y / scale)]![Math.floor(x / scale)]!;
      const t = CHARS[ch] ?? T.Plains;
      terrain[y * w + x] = t;
      elevation[y * w + x] = t === T.Mountain ? 200 : t === T.Hills ? 140 : t <= 2 ? 0 : 60;
    }
  }
  return new GM(
    {
      id,
      name: { fr: id, en: id },
      category: 'custom',
      width: w,
      height: h,
      nations: [],
      spawnPoints: [],
      deposits: [],
    },
    terrain,
    elevation,
  );
}

/** A game on a synthetic map with only the given human slots (no nations/tribes), already in 'playing'. */
export function testGame(map: GM, humans: number, patch: Partial<GameConfig> = {}): Game {
  const cfg: GameConfig = {
    ...defaultConfig(777),
    mapId: map.meta.id,
    nations: 0,
    tribes: 0,
    spawnSeconds: 0,
    players: Array.from({ length: humans }, (_, k) => ({
      slot: k,
      name: `P${k + 1}`,
      kind: 'human' as const,
      team: 0,
      general: 'blitz' as const,
    })),
    ...patch,
  };
  cfg.features = {
    ...cfg.features,
    weather: false,
    events: false,
    council: false,
    loyalty: false,
    ...(patch.features ?? {}),
  };
  return new Game(map, cfg);
}

/** Spawn players at the given tiles and enter the playing phase. Immunity removed. */
export function startWith(game: Game, spawns: [number, number][]): void {
  const cmds = spawns.map(([x, y], k) => ({
    p: k + 1,
    c: { t: 'spawn' as const, tile: game.map.idx(x, y) },
  }));
  game.step(cmds);
  while (game.phase === 'spawn') game.step([]);
  for (const p of game.players) if (p) p.immuneUntil = -1;
}

export const cmd = (p: number, c: import('../src/core/net/commands').Command): StampedCommand => ({ p, c });
