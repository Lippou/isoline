// Cost of the nations' AI per tick (Node, headless): a World game with many nations, the AI
// timed on its own (run right after the rest of each tick instead of inside it).
// Usage: npx tsx scripts/ai-bench.ts [nations] [tribes] [minutes] [map] [difficulty] [seed]
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type Difficulty } from '../src/core/game/config';
import { updateAI } from '../src/core/npc/ai';

const ROOT = path.resolve(import.meta.dirname, '..');
const nations = Number(process.argv[2] ?? 100);
const tribes = Number(process.argv[3] ?? 100);
const minutes = Number(process.argv[4] ?? 10);
const mapId = process.argv[5] ?? 'world';
const difficulty = (process.argv[6] ?? 'hard') as Difficulty;
const seed = Number(process.argv[7] ?? 2026);

const dir = path.join(ROOT, 'assets/maps');
const meta = JSON.parse(fs.readFileSync(path.join(dir, `${mapId}.json`), 'utf8')) as MapMeta;
const map = loadMap(
  meta,
  fs.readFileSync(path.join(dir, `${mapId}.png`)),
  fs.readFileSync(path.join(dir, `${mapId}.elev.png`)),
);
const g = new Game(map, {
  ...defaultConfig(seed),
  mapId,
  nations,
  tribes,
  players: [],
  spawnSeconds: 1,
  difficulty,
});
const budget = g.aiBudget;
const ai: number[] = [];
const all: number[] = [];
const ticks = minutes * 600;
for (let k = 0; k < ticks && g.phase !== 'ended'; k++) {
  const t0 = performance.now();
  g.aiBudget = 0;
  g.step([]);
  g.aiBudget = budget;
  const t1 = performance.now();
  updateAI(g);
  const t2 = performance.now();
  ai.push(t2 - t1);
  if (t2 - t1 > Number(process.env.SPIKE ?? Infinity))
    console.log(`  spike ${(t2 - t1).toFixed(1)} ms at tick ${g.tick}`);
  all.push(t2 - t0);
}
const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const avg = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return `avg ${avg.toFixed(3)} p95 ${s[Math.floor(s.length * 0.95)]!.toFixed(2)} p99 ${s[Math.floor(s.length * 0.99)]!.toFixed(2)} max ${s[s.length - 1]!.toFixed(1)} ms`;
};
console.log(`${mapId} ${nations} nations ${tribes} tribes ${difficulty} ${ai.length} ticks`);
console.log(`  AI   ${stat(ai)}`);
console.log(`  tick ${stat(all)}`);
