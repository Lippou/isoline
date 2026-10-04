// Snowball check: a deterministic, attack-only scripted player against the nations,
// reporting how fast it wins and how its troop ceiling and income grow (the « je récupère
// les villes des autres, je grossis… ça devient exponentiel » feedback, GAME_DESIGN.md §5).
// The bot builds a few cities early, then attacks its weakest neighbours non-stop, at a
// high ratio, several fronts at once; it lands by sea when it has no land target left.
// Usage: npx tsx scripts/snowball.ts [mapId,mapId…] [difficulty] [seed,seed…] [maxMinutes] [loyalty 0|1]
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type Difficulty } from '../src/core/game/config';
import { B } from '../src/core/game/constants';
import type { Player } from '../src/core/game/player';
import { applyCommand } from '../src/core/game/commands';
import { validSpawnTile } from '../src/core/game/spawn';
import { completedCityLevels } from '../src/core/game/economy';
import { buildCost, planBuild } from '../src/core/buildings/buildings';
import { shares } from '../src/core/rules/victory';
import { U } from '../src/core/units/unit';

const ROOT = path.resolve(import.meta.dirname, '..');
const maps = (process.argv[2] ?? 'europe,world,black-sea').split(',');
const difficulty = (process.argv[3] ?? 'hard') as Difficulty;
const seeds = (process.argv[4] ?? '1234,42').split(',').map(Number);
const maxMin = Number(process.argv[5] ?? 60);
const loyalty = process.argv[6];

/** Cities the bot builds itself (then it only attacks). */
const OWN_CITIES = 3;
const RATIO = Number(process.env.SB_RATIO ?? 0.5);
/** Attacks start once the army reaches this share of the troop ceiling. */
const READY = Number(process.env.SB_READY ?? 0.45);
/** A country is a target when the attack outnumbers its whole army by this factor. */
const EDGE = Number(process.env.SB_EDGE ?? 1);
const MAX_FRONTS = 3;

function load(id: string) {
  const dir = path.join(ROOT, 'assets/maps');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as MapMeta;
  return loadMap(
    meta,
    fs.readFileSync(path.join(dir, `${id}.png`)),
    fs.readFileSync(path.join(dir, `${id}.elev.png`)),
  );
}

/** First valid spawn point of the largest landmass (deterministic). */
function spawnTile(g: Game): number {
  let best = -1;
  let bestSize = 0;
  for (const [x, y] of g.map.meta.spawnPoints) {
    const t = g.map.idx(x, y);
    if (!validSpawnTile(g, t)) continue;
    const size = g.map.componentSize[g.map.component[t]!] ?? 0;
    if (size > bestSize) {
      bestSize = size;
      best = t;
    }
  }
  return best;
}

/** Land neighbours of p: owner id → one of its tiles touching p (0 = wilderness). */
function neighbours(g: Game, p: Player): Map<number, number> {
  const out = new Map<number, number>();
  const nb = new Int32Array(4);
  for (const t of p.border) {
    const n = g.map.neighbors4(t, nb);
    for (let k = 0; k < n; k++) {
      const j = nb[k]!;
      const o = g.owner[j]!;
      if (o === p.id || out.has(o) || g.isWaterTile(j) || g.isImpassable(j) || g.isDead(j)) continue;
      out.set(o, j);
    }
  }
  return out;
}

function think(g: Game, p: Player, cities: { n: number }): void {
  const cmd = (c: Parameters<typeof applyCommand>[2]) => applyCommand(g, p.id, c);
  // A few cities early, near the capital.
  if (cities.n < OWN_CITIES && p.gold >= buildCost(g, p, B.City)) {
    const tiles = p.border.length ? p.border : [p.capital];
    for (let k = 0; k < 12; k++) {
      // Inland: halfway between the capital and a border tile.
      const bt = tiles[(g.tick * 7 + k * 131) % tiles.length]!;
      const w = g.map.width;
      const c = p.capital >= 0 ? p.capital : bt;
      const x = Math.round(((bt % w) + (c % w)) / 2);
      const y = Math.round((((bt / w) | 0) + ((c / w) | 0)) / 2);
      const plan = planBuild(g, p, B.City, y * w + x);
      if (!plan.building && plan.error === 'ok') {
        cmd({ t: 'build', kind: B.City, tile: plan.tile });
        cities.n++;
        break;
      }
    }
  }
  const active = g.attacks.filter((a) => !a.done && a.attacker === p.id && !a.boat).length;
  if (active >= MAX_FRONTS || p.troops < READY * p.popCap) return;
  const near = neighbours(g, p);
  // Wilderness first while there is some, then the weakest neighbour (troops per tile).
  let target = -1;
  let score = Infinity;
  for (const [o] of near) {
    if (g.attacks.some((a) => !a.done && a.attacker === p.id && a.target === o)) continue;
    if (o > 0 && !g.attackAllowed(p.id, o, true)) continue;
    const q = o > 0 ? g.players[o]! : null;
    if (q && q.kind !== 'tribe' && p.troops * RATIO < EDGE * q.troops) continue;
    const s = q ? q.troops / Math.max(1, q.tiles) + (q.kind === 'tribe' ? 0 : 1) : -1;
    if (s < score) {
      score = s;
      target = o;
    }
  }
  if (target >= 0) {
    cmd({ t: 'attack', tile: near.get(target)!, ratio: RATIO });
    return;
  }
  if (near.size > 0 && [...near.keys()].some((o) => o > 0)) return;
  // Nobody left by land: a landing on the weakest country's coast.
  if (g.tick % 100 !== 0 || g.units.some((u) => u.alive && u.type === U.Transport && u.owner === p.id))
    return;
  let weakest: Player | null = null;
  for (const q of g.alivePlayers())
    if (q.id !== p.id && q.coast.length && g.attackAllowed(p.id, q.id, true))
      if (!weakest || q.troops < weakest.troops) weakest = q;
  if (weakest)
    cmd({ t: 'boat', tile: weakest.coast[((g.tick / 100) % weakest.coast.length) | 0]!, ratio: RATIO });
}

function main(): void {
  for (const id of maps) {
    const map = load(id);
    for (const seed of seeds) {
      const cfg = defaultConfig(seed);
      const g = new Game(map, {
        ...cfg,
        mapId: id,
        nations: Math.min(30, map.meta.nations.length),
        tribes: 40,
        players: [{ slot: 0, name: 'Bot', kind: 'human', team: 0, general: 'blitz' }],
        spawnSeconds: 1,
        difficulty,
        features: loyalty === undefined ? cfg.features : { ...cfg.features, loyalty: loyalty === '1' },
      });
      const p = g.players[1]!;
      g.step([{ p: 1, c: { t: 'spawn', tile: spawnTile(g) } }]);
      const cities = { n: 0 };
      const curve: string[] = [];
      let earned = 0;
      let captured = 0;
      const own = new Set<number>();
      const t0 = performance.now();
      while (g.phase !== 'ended' && g.tick < maxMin * 600 && p.alive) {
        g.step([]);
        for (const e of g.events) {
          if (e.k === 'capture' && e.by === p.id) captured++;
          if (e.k === 'built' && e.owner === p.id && e.kind === B.City) own.add(g.buildingAt[e.tile]!);
        }
        if (g.phase !== 'playing') continue;
        const m = g.tick - g.startTick;
        if (m % 10 === 0) think(g, p, cities);
        if (m > 0 && m % 1200 === 0) {
          const share = (shares(g).get(p.id) ?? 0) * 100;
          const income = (p.stats.goldEarned - earned) / 120;
          earned = p.stats.goldEarned;
          let taken = 0;
          for (const b of g.buildings.values())
            if (b.owner === p.id && b.type === B.City && !own.has(b.id)) taken += b.level;
          curve.push(
            `${m / 600}m ${share.toFixed(0)}% tiles ${p.tiles} cap ${(p.popCap / 1000).toFixed(0)}k troops ${(p.troops / 1000).toFixed(0)}k cityLv(active) ${completedCityLevels(g, p)} captured ${taken} gold/s ${(income / 1000).toFixed(1)}k`,
          );
        }
      }
      const minutes = ((g.tick - g.startTick) / 600).toFixed(1);
      const end = !p.alive
        ? `LOST ${minutes} min`
        : g.phase === 'ended'
          ? `${g.victory.winner === p.id ? 'WON' : 'ENDED'} ${minutes} min`
          : `no end (${minutes} min)`;
      console.log(
        `${id.padEnd(10)} ${seed} ${difficulty} loyalty=${g.config.features.loyalty ? 1 : 0} ${end} captured ${captured} (${((performance.now() - t0) / 1000).toFixed(0)} s)`,
      );
      for (const c of curve) console.log(`    ${c}`);
    }
  }
}

main();
