// Headless benchmarks (Node): map load, tick time with many nations, long-game
// stability and determinism. Writes docs/bench.json. Usage: npm run bench [-- quick]
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig } from '../src/core/game/config';
import { hashGame } from '../src/core/net/hash';

const ROOT = path.resolve(import.meta.dirname, '..');
const quick = process.argv.includes('quick');

function load(id: string) {
  const dir = path.join(ROOT, 'assets/maps');
  const t0 = performance.now();
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as MapMeta;
  const map = loadMap(
    meta,
    fs.readFileSync(path.join(dir, `${id}.png`)),
    fs.readFileSync(path.join(dir, `${id}.elev.png`)),
  );
  return { map, ms: performance.now() - t0 };
}

function runGame(id: string, nations: number, tribes: number, ticks: number, seed = 2026) {
  const { map } = load(id);
  const cfg = {
    ...defaultConfig(seed),
    mapId: id,
    nations,
    tribes,
    players: [],
    spawnSeconds: 1,
    difficulty: 'hard' as const,
  };
  const g = new Game(map, cfg);
  const times: number[] = [];
  let peakUnits = 0;
  for (let k = 0; k < ticks; k++) {
    const a = performance.now();
    g.step([]);
    times.push(performance.now() - a);
    if (g.units.length > peakUnits) peakUnits = g.units.length;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    game: g,
    stats: {
      map: id,
      tiles: map.size,
      nations,
      tribes,
      ticks,
      avgMs: +avg.toFixed(3),
      p95Ms: +sorted[Math.floor(sorted.length * 0.95)]!.toFixed(3),
      p99Ms: +sorted[Math.floor(sorted.length * 0.99)]!.toFixed(3),
      maxMs: +sorted[sorted.length - 1]!.toFixed(2),
      alive: [...g.alivePlayers()].length,
      buildings: g.buildings.size,
      peakUnits,
      phase: g.phase,
      heapMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
    },
  };
}

const results: Record<string, unknown> = {
  date: new Date().toISOString(),
  node: process.version,
  cpu: (await import('node:os')).cpus()[0]?.model,
};

for (const id of ['world', 'world-giant']) {
  const r = load(id);
  results[`load_${id}`] = { tiles: r.map.size, ms: Math.round(r.ms) };
  console.log(`load ${id}: ${r.map.size} tiles in ${r.ms.toFixed(0)} ms`);
}

const t100 = runGame('world', 100, 100, quick ? 1200 : 6000);
results.world100 = t100.stats;
console.log('world, 100 nations + 100 tribes:', t100.stats);

const t50 = runGame('world', 50, 60, quick ? 3000 : 18000, 7);
results.world50_30min = t50.stats;
console.log('world, 50 nations, 30 min:', t50.stats);

const giant = runGame('world-giant', 100, 100, quick ? 600 : 3000, 11);
results.giant100 = giant.stats;
console.log('giant world, 100 nations:', giant.stats);

// Determinism: two identical runs give identical hashes.
const a = runGame('europe', 40, 40, quick ? 600 : 3000, 99).game;
const b = runGame('europe', 40, 40, quick ? 600 : 3000, 99).game;
results.determinism = { equal: hashGame(a) === hashGame(b), hash: hashGame(a).toString(16) };
console.log('determinism:', results.determinism);

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/bench.json'), JSON.stringify(results, null, 2));
console.log('written docs/bench.json');
