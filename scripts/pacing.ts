// Pacing benchmark: headless games between nations and tribes, reporting the
// leader's share of useful land every 5 minutes and when (if) the game ends.
// Usage: npx tsx scripts/pacing.ts [mapId,mapId…] [difficulty] [maxMinutes] [mode] [seed,seed…]
// With the doomsday or battle royale mode, the mode's happenings are counted too
// (milestones and clock pushes; zone closings and land lost to the zone).
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type Difficulty, type GameMode } from '../src/core/game/config';
import { shares as leaderShares } from '../src/core/rules/victory';
import { DOOM_UNIT } from '../src/core/game/constants';

const ROOT = path.resolve(import.meta.dirname, '..');
const maps = (process.argv[2] ?? 'europe,black-sea,world').split(',');
const difficulty = (process.argv[3] ?? 'normal') as Difficulty;
const maxMin = Number(process.argv[4] ?? 60);
const mode = (process.argv[5] ?? 'ffa') as GameMode;
const seeds = (process.argv[6] ?? '1234').split(',').map(Number);

function load(id: string) {
  const dir = path.join(ROOT, 'assets/maps');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as MapMeta;
  return loadMap(
    meta,
    fs.readFileSync(path.join(dir, `${id}.png`)),
    fs.readFileSync(path.join(dir, `${id}.elev.png`)),
  );
}

const minutes = (g: Game) => ((g.tick - g.startTick) / 600).toFixed(1);

for (const id of maps) {
  const map = load(id);
  for (const seed of seeds) {
    const nations = Math.min(30, map.meta.nations.length);
    const g = new Game(map, {
      ...defaultConfig(seed),
      mapId: id,
      mode,
      nations,
      tribes: 40,
      players: [],
      spawnSeconds: 1,
      difficulty,
    });
    const marks: string[] = [];
    const happenings: string[] = [];
    const pushes = new Map<string, number>();
    let nukes = 0;
    let land0 = 0;
    const t0 = performance.now();
    while (g.phase !== 'ended' && g.tick < maxMin * 600) {
      g.step([]);
      if (land0 === 0 && g.phase === 'playing') land0 = g.usefulLand;
      for (const e of g.events) {
        if (e.k === 'nukeLaunch') nukes++;
        if (e.k !== 'notify' || e.to !== -1) continue;
        if (e.key === 'event.doomStage') happenings.push(`S${e.params?.stage}@${minutes(g)}`);
        if (e.key === 'event.zoneClosing') happenings.push(`Z${e.params?.n}@${minutes(g)}`);
        if (e.key === 'event.zoneFinal') happenings.push(`final@${minutes(g)}`);
      }
      const d = g.victory.doom;
      if (d)
        for (const p of d.pushes)
          if (p.tick === g.tick - 1) pushes.set(p.why, (pushes.get(p.why) ?? 0) + Math.round(p.secs));
      const m = g.tick - g.startTick;
      if (g.phase === 'playing' && m > 0 && m % 3000 === 0) {
        const shares = [...leaderShares(g).values()].sort((a, b) => b - a);
        const alive = [...g.alivePlayers()].filter((p) => p.kind === 'nation').length;
        marks.push(`${m / 600}min:${(shares[0]! * 100).toFixed(0)}%/${alive}n`);
      }
    }
    const end =
      g.phase === 'ended' ? `END ${minutes(g)} min ${g.victory.reason}` : `no end (${minutes(g)} min)`;
    let extra = '';
    if (mode === 'doomsday') {
      const d = g.victory.doom;
      const push = [...pushes].map(([k, v]) => `${k}+${v}s`).join(' ');
      extra = ` | clock ${d ? Math.round(d.units / DOOM_UNIT) : 0}s ${happenings.join(' ')} | pushes ${push} | launches ${nukes}`;
    } else if (mode === 'ffa') {
      extra = ` | launches ${nukes}`;
    } else if (mode === 'battleRoyale') {
      const lost = land0 > 0 ? Math.round((1 - g.usefulLand / land0) * 100) : 0;
      extra = ` | ${happenings.join(' ')} | land lost ${lost}% | launches ${nukes}`;
    }
    console.log(
      `${id.padEnd(14)} ${seed} ${difficulty} ${mode} ${end.padEnd(22)} ${marks.join(' ')}${extra}  (${((performance.now() - t0) / 1000).toFixed(0)} s)`,
    );
  }
}
