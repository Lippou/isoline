// A scripted human (scripts/bots.ts) against the nations' AI, headless: how fast it wins
// (or how long it survives), and how the nations reacted to it.
// Usage: npx tsx scripts/versus.ts [maps] [difficulties] [bot] [seeds] [maxMinutes] [mode]
//   e.g. npx tsx scripts/versus.ts europe,world,black-sea hard,impossible aggressive 1234,42,7 40
// One line per game: outcome (WIN at m min / LOST at m min / share at the time limit), the
// bot's share of the land every 5 minutes, its peak simultaneous attacks, then the
// nations' reactions: waves at the bot (and how many answered one of its attacks), the most
// nations attacking it at once, alliances signed between nations, defence posts built by
// its neighbours, warships launched by nations and the bot's ships they sank, bombing raids
// and nuclear launches at the bot, council sanctions against it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type Difficulty, type GameMode } from '../src/core/game/config';
import { shares } from '../src/core/rules/victory';
import { B } from '../src/core/game/constants';
import { U } from '../src/core/units/unit';
import { createBot, type BotKind } from './bots';

const ROOT = path.resolve(import.meta.dirname, '..');
const maps = (process.argv[2] ?? 'europe,world,black-sea').split(',');
const diffs = (process.argv[3] ?? 'hard').split(',') as Difficulty[];
const botKinds = (process.argv[4] ?? 'aggressive').split(',') as BotKind[];
const seeds = (process.argv[5] ?? '1234,42,7').split(',').map(Number);
const maxMin = Number(process.argv[6] ?? 40);
const mode = (process.argv[7] ?? 'ffa') as GameMode;
const boost = Number(process.env.BOT_BOOST ?? 1);
// TAC="hard.strikeEvery=100,normal.coalition=0" (tuning experiments): overrides the nations'
// tactics (src/core/npc/tactics.ts; absent in trees before 1.12).
if (process.env.TAC) {
  const mod = (await import('../src/core/npc/tactics').catch(() => null)) as {
    TACTICS: Record<string, Record<string, number | boolean>>;
  } | null;
  for (const kv of process.env.TAC.split(',')) {
    const [key, v] = kv.split('=');
    const [d, f] = key!.split('.');
    if (mod && mod.TACTICS[d!])
      mod.TACTICS[d!]![f!] = v === 'true' ? true : v === 'false' ? false : Number(v);
  }
}

function load(id: string) {
  const dir = path.join(ROOT, 'assets/maps');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as MapMeta;
  return loadMap(
    meta,
    fs.readFileSync(path.join(dir, `${id}.png`)),
    fs.readFileSync(path.join(dir, `${id}.elev.png`)),
  );
}

interface Tally {
  waves: number;
  ripostes: number;
  attackers: Set<number>;
  peakGang: number;
  alliances: number;
  posts: number;
  postsNear: number;
  warships: Set<number>;
  sunkBot: number;
  sunkByBot: number;
  raids: number;
  nukes: number;
  sanctions: number;
  maxAiMs: number;
  samples: number;
  fronts: number;
  fronts3: number;
  outHeavy: number;
  /** Revolutions: against the bot, against nations, and the bot's land lost to them (tiles). */
  revoltsBot: number;
  revoltsNations: number;
  revoltTiles: number;
  /** How the bot's revolutions went: outbreak minute and tiles, then how and when it ended. */
  revoltLog: string[];
}

export function playOne(
  mapId: string,
  difficulty: Difficulty,
  kind: BotKind,
  seed: number,
  minutes: number,
  gameMode: GameMode = 'ffa',
): string {
  const map = load(mapId);
  const nations = Math.min(30, map.meta.nations.length);
  const g = new Game(map, {
    ...defaultConfig(seed),
    mapId,
    mode: gameMode,
    nations,
    tribes: 40,
    players: [{ slot: 0, name: 'Bot', kind: 'human', team: 0, general: 'blitz' }],
    spawnSeconds: 30,
    difficulty,
    // Secession is off by default from 1.12 (LOYALTY=1 to measure with it); revolutions are on
    // from 1.14 (REVOLUTION=0 to measure without).
    features: {
      ...defaultConfig(seed).features,
      loyalty: process.env.LOYALTY === '1',
      ...(process.env.REVOLUTION ? { revolution: process.env.REVOLUTION === '1' } : {}),
    },
  });
  const bot = createBot(kind, seed, {
    attackRatio: Number(process.env.BOT_RATIO ?? 0.3),
    ...(process.env.BOT_BUILD ? { buildAlways: process.env.BOT_BUILD === '1' } : {}),
    ...(process.env.BOT_BUILD_MIN ? { buildMinutes: Number(process.env.BOT_BUILD_MIN) } : {}),
    ...(process.env.BOT_STRENGTH ? { strength: Number(process.env.BOT_STRENGTH) } : {}),
    ...(process.env.BOT_STRIKE ? { strike: Number(process.env.BOT_STRIKE) } : {}),
    ...(process.env.BOT_RESERVE ? { reserve: Number(process.env.BOT_RESERVE) } : {}),
  });
  bot.id = g.players.find((p) => p && p.kind === 'human')!.id;
  const t: Tally = {
    waves: 0,
    ripostes: 0,
    attackers: new Set(),
    peakGang: 0,
    alliances: 0,
    posts: 0,
    postsNear: 0,
    warships: new Set(),
    sunkBot: 0,
    sunkByBot: 0,
    raids: 0,
    nukes: 0,
    sanctions: 0,
    maxAiMs: 0,
    samples: 0,
    fronts: 0,
    fronts3: 0,
    outHeavy: 0,
    revoltsBot: 0,
    revoltsNations: 0,
    revoltTiles: 0,
    revoltLog: [],
  };
  const marks: string[] = [];
  let outcome = '';
  const isNation = (id: number) => g.players[id]?.kind === 'nation';
  let neighbours = new Set<number>();
  const t0 = performance.now();
  while (g.tick < 600 * minutes + g.startTick || g.phase === 'spawn') {
    if (g.phase === 'ended') break;
    g.step(bot.commands(g));
    // BOT_BOOST (measurement only): stands in for a player more skilled than the script
    // (sharper timing, better fronts) by multiplying the bot's troop growth.
    if (boost !== 1 && g.phase === 'playing') {
      const me = g.players[bot.id]!;
      if (me.alive && me.lastGrowth > 0)
        me.troops = Math.min(me.popCap, me.troops + me.lastGrowth * (boost - 1));
    }
    const m = g.tick - g.startTick;
    const me = g.players[bot.id]!;
    for (const e of g.events) {
      if (e.k === 'attackWave' && e.target === bot.id && isNation(e.attacker)) {
        t.waves++;
        if (e.riposte) t.ripostes++;
        t.attackers.add(e.attacker);
      } else if (e.k === 'alliance' && e.on && isNation(e.a) && isNation(e.b)) t.alliances++;
      else if (e.k === 'built' && e.kind === B.DefensePost && isNation(e.owner)) {
        t.posts++;
        if (neighbours.has(e.owner)) t.postsNear++;
      } else if (e.k === 'shipSunk') {
        if (e.owner === bot.id && isNation(e.by)) t.sunkBot++;
        if (e.by === bot.id) t.sunkByBot++;
      } else if (e.k === 'airStrike' && e.victim === bot.id) t.raids++;
      else if (e.k === 'nukeLaunch' && isNation(e.owner)) {
        const tile = Math.floor(e.ty) * g.map.width + Math.floor(e.tx);
        if (g.owner[tile] === bot.id) t.nukes++;
      } else if (e.k === 'council' && e.phase === 'result' && g.features.sanction?.target === bot.id)
        t.sanctions++;
      else if (e.k === 'revolution' && e.phase === 'start') {
        if (e.from === bot.id) {
          t.revoltsBot++;
          t.revoltTiles += e.tiles;
          t.revoltLog.push(`${(m / 600).toFixed(1)}m/${e.tiles}t`);
        } else t.revoltsNations++;
      } else if (e.k === 'revolution' && e.phase === 'spread') {
        if (e.from === bot.id) t.revoltLog.push(`spread+${e.tiles}t@${(m / 600).toFixed(1)}`);
      } else if (e.k === 'revolution' && e.from === bot.id) {
        const how = e.phase === 'over' ? 'over' : e.by === bot.id ? 'crushed' : 'seized';
        t.revoltLog.push(`${how}@${(m / 600).toFixed(1)}`);
      } else if (e.k === 'eliminated' && e.player === bot.id) outcome = `LOST ${(m / 600).toFixed(1)}`;
      else if (e.k === 'gameOver')
        outcome ||=
          e.winner === bot.id ? `WIN ${(m / 600).toFixed(1)}` : `LOST ${(m / 600).toFixed(1)} (${e.reason})`;
    }
    if (g.phase === 'playing' && m % 10 === 0) {
      const gang = new Set<number>();
      for (const a of g.attacks)
        if (!a.done && a.target === bot.id && isNation(a.attacker)) gang.add(a.attacker);
      t.peakGang = Math.max(t.peakGang, gang.size);
      // The bot's posture: nation fronts and troops out in attacks vs home.
      if (me.alive) {
        const fronts = new Set<number>();
        let out = 0;
        for (const a of g.attacks)
          if (!a.done && a.attacker === bot.id) {
            out += a.troops;
            if (a.target > 0 && g.players[a.target]!.kind !== 'tribe') fronts.add(a.target);
          }
        t.samples++;
        t.fronts += fronts.size;
        if (fronts.size >= 3) t.fronts3++;
        if (out >= me.troops * 0.8) t.outHeavy++;
      }
      for (const u of g.units) if (u.alive && u.type === U.Warship && isNation(u.owner)) t.warships.add(u.id);
    }
    if (g.phase === 'playing' && m % 300 === 0 && me.alive) {
      neighbours = new Set();
      for (const b of me.border) {
        const w = g.map.width;
        for (const v of [b - 1, b + 1, b - w, b + w]) {
          const o = g.owner[v] ?? 0;
          if (o !== bot.id && o > 0) neighbours.add(o);
        }
      }
    }
    if (process.env.VERBOSE && g.phase === 'playing' && m % Number(process.env.VERBOSE) === 0) {
      // Compact trace: the bot's land, army and attacks, who attacks it, the threat picture.
      const k = (v: number) => `${(v / 1000).toFixed(0)}k`;
      const out = g.attacks
        .filter((a) => !a.done && a.attacker === bot.id)
        .map((a) => `${a.target}:${k(a.troops)}`);
      const inc = g.attacks
        .filter((a) => !a.done && a.target === bot.id)
        .map((a) => `${a.attacker}:${k(a.troops)}`);
      const th = (g.ai as { threat?: { runaway: number; strikeAt: number } }).threat;
      console.log(
        `  ${(m / 600).toFixed(1)}min share ${((shares(g).get(bot.id) ?? 0) * 100) | 0}% troops ${k(me.troops)}/${k(me.popCap)} gold ${k(me.gold)} allies ${me.allies.size} | out ${out.join(' ')} | in ${inc.join(' ')} | runaway ${th?.runaway ?? '-'} strike ${th ? th.strikeAt - g.tick : '-'}`,
      );
    }
    if (g.phase === 'playing' && m > 0 && m % 3000 === 0) {
      const s = shares(g).get(bot.id) ?? 0;
      marks.push(`${m / 600}:${(s * 100).toFixed(0)}%`);
    }
  }
  const me = g.players[bot.id]!;
  if (!outcome) outcome = `share ${((shares(g).get(bot.id) ?? 0) * 100) | 0}%${me.alive ? '' : ' dead'}`;
  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  return (
    `${process.env.TAG ?? ''}${mapId.padEnd(10)} ${String(seed).padEnd(5)} ${difficulty.padEnd(10)} ${kind.padEnd(10)} ${outcome.padEnd(26)} ` +
    `${marks.join(' ')} | peakAtk ${bot.peakAttacks} fronts ${(t.fronts / Math.max(1, t.samples)).toFixed(1)} f3 ${((100 * t.fronts3) / Math.max(1, t.samples)) | 0}% outHeavy ${((100 * t.outHeavy) / Math.max(1, t.samples)) | 0}% | waves ${t.waves} (riposte ${t.ripostes}) from ${t.attackers.size} nations, gang≤${t.peakGang}` +
    ` | nation alliances ${t.alliances} | posts ${t.posts} (near ${t.postsNear}) | warships ${t.warships.size} sunkBot ${t.sunkBot} sunkByBot ${t.sunkByBot}` +
    ` | raids ${t.raids} nukes ${t.nukes} sanctions ${t.sanctions} | revolts bot ${t.revoltsBot} (${t.revoltTiles}t${t.revoltLog.length ? ` ${t.revoltLog.join(' ')}` : ''}) nations ${t.revoltsNations} (${secs}s)`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  for (const id of maps)
    for (const d of diffs)
      for (const k of botKinds) for (const s of seeds) console.log(playOne(id, d, k, s, maxMin, mode));
}
