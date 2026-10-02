// Pacing benchmark: headless FFA games between nations and tribes, reporting the
// leader's share of useful land every 5 minutes and when (if) the game ends.
// Usage: npx tsx scripts/pacing.ts [mapId,mapId…] [difficulty] [maxMinutes]
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type Difficulty } from '../src/core/game/config';
import { shares as leaderShares } from '../src/core/rules/victory';

const ROOT = path.resolve(import.meta.dirname, '..');
const maps = (process.argv[2] ?? 'europe,black-sea,world').split(',');
const difficulty = (process.argv[3] ?? 'normal') as Difficulty;
const maxMin = Number(process.argv[4] ?? 60);

function load(id: string) {
  const dir = path.join(ROOT, 'assets/maps');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as MapMeta;
  return loadMap(
    meta,
    fs.readFileSync(path.join(dir, `${id}.png`)),
    fs.readFileSync(path.join(dir, `${id}.elev.png`)),
  );
}

for (const id of maps) {
  const map = load(id);
  const nations = Math.min(30, map.meta.nations.length);
  const g = new Game(map, {
    ...defaultConfig(1234),
    mapId: id,
    nations,
    tribes: 40,
    players: [],
    spawnSeconds: 1,
    difficulty,
  });
  const marks: string[] = [];
  const t0 = performance.now();
  while (g.phase !== 'ended' && g.tick < maxMin * 600) {
    g.step([]);
    const m = g.tick - g.startTick;
    if (g.phase === 'playing' && m > 0 && m % 3000 === 0) {
      const shares = [...leaderShares(g).values()].sort((a, b) => b - a);
      const alive = [...g.alivePlayers()].filter((p) => p.kind === 'nation').length;
      marks.push(`${m / 600}min:${(shares[0]! * 100).toFixed(0)}%/${alive}n`);
    }
  }
  const end =
    g.phase === 'ended'
      ? `END ${((g.tick - g.startTick) / 600).toFixed(1)} min ${g.victory.reason}`
      : 'no end';
  console.log(
    `${id.padEnd(14)} ${difficulty} ${end.padEnd(14)} ${marks.join(' ')}  (${((performance.now() - t0) / 1000).toFixed(0)} s)`,
  );
}
