// Pacing benchmark: headless games between nations and tribes, reporting the
// leader's share of useful land every 5 minutes and when (if) the game ends, then what
// the nations did with aviation and radars (built, flown, struck, shot down).
// Usage: npx tsx scripts/pacing.ts [mapId,mapId…] [difficulty] [maxMinutes] [mode] [seed,seed…] [income|builder]
// Nations: the map's default lobby count (NATIONS=n to override), with 40 tribes.
// With the doomsday or battle royale mode, the mode's happenings are counted too
// (milestones and clock pushes; zone closings and land lost to the zone).
// `income` adds, every 5 minutes, the gold earned over the last minute by the leader and
// the median nation, by source (passive, resources, trade ships, trains, loot), with their
// cities / ports / factories (levels) and troop ceiling. `builder` also turns the largest
// nation at minute 3 into a human-like builder: on top of its AI, every second it spends
// its treasury on cities, ports and factories placed to join the rail network
// (GAME_DESIGN.md §5, the late-game income check).
import fs from 'node:fs';
import path from 'node:path';
import { loadMap } from '../src/core/map/format';
import type { MapMeta } from '../src/core/map/gamemap';
import { Game } from '../src/core/game/state';
import { defaultConfig, type Difficulty, type GameMode } from '../src/core/game/config';
import { shares as leaderShares } from '../src/core/rules/victory';
import { B, BUILDING_KEYS, DOOM_UNIT, RAIL_CONNECT_RANGE } from '../src/core/game/constants';
import { U, UNIT_KEYS } from '../src/core/units/unit';
import type { Player } from '../src/core/game/player';
import { applyCommand } from '../src/core/game/commands';
import { MAX_LEVEL, buildCost, checkPlacement, levelsOwned } from '../src/core/buildings/buildings';
import { IS_LAND } from '../src/core/map/terrain';
import { samRangeOf } from '../src/core/units/nukes';
import { inService } from '../src/core/buildings/building';

const ROOT = path.resolve(import.meta.dirname, '..');
const maps = (process.argv[2] ?? 'europe,black-sea,world').split(',');
const difficulty = (process.argv[3] ?? 'normal') as Difficulty;
const maxMin = Number(process.argv[4] ?? 60);
const mode = (process.argv[5] ?? 'ffa') as GameMode;
const seeds = (process.argv[6] ?? '1234').split(',').map(Number);
const report = process.argv[7] ?? '';
/** Minutes between two income reports (PACING_EVERY, default 5). */
const EVERY = Number(process.env.PACING_EVERY ?? 5);
// TAC="impossible.bombs=1,hard.airShare=0.2" (tuning experiments, as in versus.ts): overrides
// the nations' tactics (src/core/npc/tactics.ts).
if (process.env.TAC) {
  const { TACTICS } = await import('../src/core/npc/tactics');
  const table = TACTICS as unknown as Record<string, Record<string, number | boolean>>;
  for (const kv of process.env.TAC.split(',')) {
    const [key, v] = kv.split('=');
    const [d, f] = key!.split('.');
    if (table[d!]) table[d!]![f!] = v === 'true' ? true : v === 'false' ? false : Number(v);
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

const minutes = (g: Game) => ((g.tick - g.startTick) / 600).toFixed(1);

function main(): void {
  run();
  console.log(revoltSummary());
}

function run(): void {
  for (const id of maps) {
    const map = load(id);
    for (const seed of seeds) {
      // The map's default lobby count (1.15: one per ~9 000 land tiles, e.g. 173 on the Giant
      // World); NATIONS=30 for the former fixed 30.
      const nations = Math.min(
        Number(process.env.NATIONS ?? map.meta.defaultNations ?? 30),
        map.meta.nations.length,
      );
      const g = new Game(map, {
        ...defaultConfig(seed),
        mapId: id,
        mode,
        nations,
        tribes: 40,
        players: [],
        spawnSeconds: 1,
        difficulty,
        // LOYALTY=1: with secessions (off by default since 1.12); REVOLUTION=0: without
        // revolutions (on by default since 1.14).
        features: {
          ...defaultConfig(seed).features,
          ...(process.env.LOYALTY ? { loyalty: process.env.LOYALTY === '1' } : {}),
          ...(process.env.REVOLUTION ? { revolution: process.env.REVOLUTION === '1' } : {}),
        },
      });
      const marks: string[] = [];
      const happenings: string[] = [];
      const pushes = new Map<string, number>();
      let nukes = 0;
      let intercepted = 0;
      // Launches at a target inside a hostile SAM's reach; nations' city levels under their own SAMs.
      let atCovered = 0;
      const cover: number[] = [];
      let land0 = 0;
      const air = airCounter();
      const tools = toolCounter();
      const revolts = revolutionCounter();
      const income = report ? incomeCounter() : null;
      let builder = -1;
      const t0 = performance.now();
      while (g.phase !== 'ended' && g.tick < maxMin * 600) {
        g.step([]);
        air.observe(g);
        tools.observe(g);
        revolts.observe(g);
        if (income) {
          const m = g.tick - g.startTick;
          if (report === 'builder' && builder < 0 && g.phase === 'playing' && m >= 1800)
            builder = [...g.alivePlayers()]
              .filter((p) => p.kind === 'nation')
              .sort((a, b) => b.tiles - a.tiles || a.id - b.id)[0]!.id;
          if (builder > 0 && m % 10 === 0) build(g, g.players[builder]!);
          income.observe(g);
          if (g.phase === 'playing' && m > 0 && m % (600 * EVERY) === 0)
            income.print(g, m / 600, builder, `${nukes}`);
        }
        if (land0 === 0 && g.phase === 'playing') land0 = g.usefulLand;
        for (const e of g.events) {
          if (e.k === 'nukeLaunch') {
            nukes++;
            if (samCovers(g, e.owner, e.tx, e.ty)) atCovered++;
          }
          if (e.k === 'intercept') intercepted++;
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
          cover.push(cityCover(g));
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
        const meanCover = cover.length ? cover.reduce((a, b) => a + b, 0) / cover.length : 0;
        extra = ` | launches ${nukes} intercepted ${intercepted} at-SAM ${atCovered} | city levels under SAM ${(meanCover * 100).toFixed(0)}%`;
      } else if (mode === 'battleRoyale') {
        const lost = land0 > 0 ? Math.round((1 - g.usefulLand / land0) * 100) : 0;
        extra = ` | ${happenings.join(' ')} | land lost ${lost}% | launches ${nukes}`;
      }
      console.log(
        `${id.padEnd(14)} ${seed} ${difficulty} ${mode} ${end.padEnd(22)} ${marks.join(' ')}${extra}  (${((performance.now() - t0) / 1000).toFixed(0)} s)`,
      );
      console.log(`${''.padEnd(14)} air: ${air.report()}`);
      console.log(`${''.padEnd(14)} revolutions: ${revolts.report()}`);
      const toolbox = tools.finish(g);
      console.log(
        `${''.padEnd(14)} tools: ${Object.entries(toolbox)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      );
      // TOOLS_OUT=file: one JSON line per game (scripts aggregate the toolbox audit from it).
      if (process.env.TOOLS_OUT)
        fs.appendFileSync(
          process.env.TOOLS_OUT,
          JSON.stringify({ map: id, seed, difficulty, mode, end, min: Number(minutes(g)), tools: toolbox }) +
            '\n',
        );
    }
  }
}

/** Whether a SAM hostile to `owner` covers (tx, ty). */
function samCovers(g: Game, owner: number, tx: number, ty: number): boolean {
  for (const b of g.buildings.values())
    if (
      b.type === B.Sam &&
      inService(b) &&
      !g.friendly(b.owner, owner) &&
      Math.hypot(b.x + 0.5 - tx, b.y + 0.5 - ty) <= samRangeOf(g, b)
    )
      return true;
  return false;
}

/** The share of the nations' city levels within reach of one of their own SAMs. */
function cityCover(g: Game): number {
  let all = 0;
  let covered = 0;
  for (const c of g.buildings.values()) {
    if (c.type !== B.City || g.players[c.owner]?.kind !== 'nation') continue;
    all += c.level;
    for (const s of g.buildings.values())
      if (
        s.type === B.Sam &&
        s.owner === c.owner &&
        inService(s) &&
        Math.hypot(s.x - c.x, s.y - c.y) <= samRangeOf(g, s)
      ) {
        covered += c.level;
        break;
      }
  }
  return all ? covered / all : 0;
}

/**
 * Revolutions (rules/revolution.ts) over one game: each outbreak (minute, victim's share of
 * the land then, tiles risen) and how it ended — `over` (rejoined), `crushed` by its country,
 * `seized` by another — and when, with how long it lasted (seconds) and how many times it
 * spread (+n). The durations of every game run so far are summed up at the end.
 */
const revoltDurations: { how: string; secs: number }[] = [];
function revolutionCounter() {
  const live = new Map<number, { text: string; tick: number; spreads: number }>();
  const done: string[] = [];
  return {
    observe(g: Game) {
      for (const e of g.events) {
        if (e.k !== 'revolution') continue;
        if (e.phase === 'start') {
          const from = g.players[e.from]!;
          const share = Math.round((from.usefulTiles / Math.max(1, g.usefulLand)) * 100);
          // The army that defected, as a share of the country's army before the outbreak.
          const rebels = g.players[e.tribe]!.troops;
          const army = Math.round((100 * rebels) / Math.max(1, rebels + from.troops));
          live.set(e.tribe, {
            text: `${minutes(g)}m ${share}%-${e.tiles}t army-${army}%`,
            tick: g.tick,
            spreads: 0,
          });
        } else if (e.phase === 'spread') {
          const r = live.get(e.tribe);
          if (r) r.spreads++;
        } else {
          const how = e.phase === 'over' ? 'over' : e.by === e.from ? 'crushed' : 'seized';
          const r = live.get(e.tribe);
          const secs = r ? Math.round((g.tick - r.tick) / 10) : 0;
          revoltDurations.push({ how, secs });
          done.push(`${r?.text ?? '?'} ${how}@${minutes(g)} (${secs}s${r?.spreads ? ` +${r.spreads}` : ''})`);
          live.delete(e.tribe);
        }
      }
    },
    report: () => {
      const all = [...done, ...[...live.values()].map((v) => `${v.text} live`)];
      return all.length ? `n=${all.length} ${all.join(', ')}` : 'none';
    },
  };
}

/** Median duration (s) of the revolutions put down, and how many ran their course. */
function revoltSummary(): string {
  const down = revoltDurations
    .filter((d) => d.how !== 'over')
    .map((d) => d.secs)
    .sort((a, b) => a - b);
  const over = revoltDurations.length - down.length;
  const med = down.length ? down[Math.floor((down.length - 1) / 2)]! : 0;
  return `revolutions: ${revoltDurations.length}, put down ${down.length} (median ${med} s), ran their course ${over}`;
}

/** Aviation and radar usage over one game, read from the simulation's events and units. */
function airCounter() {
  const seen = new Set<number>();
  const c: Record<string, number> = {};
  const add = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
  return {
    observe(g: Game) {
      for (const e of g.events) {
        if (e.k === 'built' && e.kind === B.Radar) add('radarLv');
        else if (e.k === 'built' && e.kind === B.Airfield) add('airfieldLv');
        else if (e.k === 'explosion' && e.kind === 11) add('bombRuns');
        else if (e.k === 'airStrike' && e.type >= 0) {
          add(`hit.${BUILDING_KEYS[e.type]}`);
          add('levelsKnocked', e.levels);
          if (e.destroyed) add('destroyed');
        } else if (e.k === 'airStrike' && e.ship !== undefined && e.ship >= 0) {
          // Bombers against ships (1.16): the ship hit, and whether one went down.
          add(`hit.ship.${UNIT_KEYS[e.ship]}`);
          if (e.destroyed) add('shipsSunk');
        } else if (e.k === 'planeDown') add(`downed.${UNIT_KEYS[e.kind]}.${e.cause}`);
        else if (e.k === 'scramble') add(e.radar ? 'scrambles.radar' : 'scrambles');
      }
      for (const u of g.units) {
        if (u.type < U.Fighter || u.type > U.Recon || seen.has(u.id)) continue;
        seen.add(u.id);
        add(`launched.${UNIT_KEYS[u.type]}`);
      }
    },
    report: () =>
      Object.entries(c)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ') || 'nothing',
  };
}

/**
 * The nations' whole toolbox over one game (what a human can do, GAME_DESIGN.md §13.2):
 * buildings completed and upgraded by type, bombs by kind, planes by role, warships and
 * transports, alliances, betrayals, gifts, embargoes, capital moves, generals, offensives,
 * and at the end the share of the surviving nations with each unlock researched.
 */
function toolCounter() {
  const seen = new Set<number>();
  const c: Record<string, number> = {};
  const add = (k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
  const nation = (g: Game, id: number) => g.players[id]?.kind === 'nation';
  const NUKES = ['atom', 'hydrogen', 'mirv'];
  return {
    observe(g: Game) {
      for (const e of g.events) {
        if (e.k === 'built' && nation(g, e.owner)) add(`b.${BUILDING_KEYS[e.kind]}`);
        else if (e.k === 'nukeLaunch' && nation(g, e.owner) && e.kind <= 2) add(`n.${NUKES[e.kind]}`);
        else if (e.k === 'airStrike' && nation(g, e.owner) && e.type >= 0) add('a.hits');
        else if (e.k === 'planeDown' && nation(g, e.by)) add(`a.downed.${e.cause}`);
        else if (e.k === 'scramble' && nation(g, e.owner)) add('a.scramble');
        else if (e.k === 'alliance' && e.on && nation(g, e.a) && nation(g, e.b)) add('d.alliance');
        else if (e.k === 'betrayal' && nation(g, e.traitor)) add('d.betrayal');
        else if (e.k === 'capitalMoved' && nation(g, e.player)) add('capitalMoved');
        else if (e.k === 'general' && nation(g, e.player)) add(`g.${e.ability}`);
        else if (e.k === 'attackWave' && nation(g, e.attacker) && e.target > 0)
          add(g.players[e.target]!.kind === 'tribe' ? 'w.tribe' : 'w.country');
        else if (e.k === 'notify' && e.key === 'notify.donation' && nation(g, Number(e.params?.from))) {
          if (Number(e.params?.gold) > 0) add('d.giftGold');
          if (Number(e.params?.troops) > 0) add('d.giftTroops');
        } else if (e.k === 'notify' && e.key === 'notify.embargoOn' && nation(g, Number(e.params?.by)))
          add('d.embargo');
      }
      for (const u of g.units) {
        if (seen.has(u.id) || !nation(g, u.owner)) continue;
        if (u.type === U.Fighter) add(u.kind === 2 ? 'a.interceptor' : 'a.fighter');
        else if (u.type === U.Bomber) add('a.bomber');
        else if (u.type === U.Recon) add('a.recon');
        else if (u.type === U.Warship) add('s.warship');
        else if (u.type === U.Transport) add('s.transport');
        else continue;
        seen.add(u.id);
      }
    },
    finish(g: Game): Record<string, number> {
      const alive = [...g.alivePlayers()].filter((p) => p.kind === 'nation');
      const share = (f: (p: Player) => boolean) =>
        alive.length ? Math.round((100 * alive.filter(f).length) / alive.length) : 0;
      // Branch levels: industry 3 = Aerospace, defense 1 / 2 = SAM / radar, nuclear 2 / 3 / 5 = silo / H / MIRV.
      c['%aero'] = share((p) => p.tech[5]! >= 3);
      c['%radarTech'] = share((p) => p.tech[4]! >= 2);
      c['%samTech'] = share((p) => p.tech[4]! >= 1);
      c['%siloTech'] = share((p) => p.tech[3]! >= 2);
      c['%hTech'] = share((p) => p.tech[3]! >= 3);
      c['%mirvTech'] = share((p) => p.tech[3]! >= 5);
      c['%airfield'] = share((p) => p.buildingCount[B.Airfield]! > 0);
      c['%radar'] = share((p) => p.buildingCount[B.Radar]! > 0);
      c['%sam'] = share((p) => p.buildingCount[B.Sam]! > 0);
      c['%silo'] = share((p) => p.buildingCount[B.Silo]! > 0);
      c['goldEnd'] = Math.round(alive.reduce((s, p) => s + p.gold, 0) / Math.max(1, alive.length) / 1000);
      // Gold earned by the surviving nations over the game (k per nation), and per minute.
      const earned = alive.reduce((s, p) => s + p.stats.goldEarned, 0) / Math.max(1, alive.length) / 1000;
      c['goldEarned'] = Math.round(earned);
      c['goldPerMin'] = Math.round(earned / Math.max(1, (g.tick - g.startTick) / 600));
      return Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
    },
  };
}

// ------------------------------------------------------------------ income report
interface Sums {
  passive: number;
  res: number;
  trade: number;
  trains: number;
  total: number;
}
const zero = (): Sums => ({ passive: 0, res: 0, trade: 0, trains: 0, total: 0 });

/** Gold earned by source over the last minute, for every player. */
function incomeCounter() {
  const prev = new Map<number, { trade: number; trains: number; total: number }>();
  let window = new Map<number, Sums>();
  let last = window;
  return {
    observe(g: Game) {
      for (const p of g.alivePlayers()) {
        if (p.kind === 'tribe') continue;
        const was = prev.get(p.id) ?? { trade: 0, trains: 0, total: 0 };
        const s = window.get(p.id) ?? zero();
        const res = p.incomeBreakdown.resources / 10;
        s.passive += p.income - res;
        s.res += res;
        s.trade += p.stats.tradeGold - was.trade;
        s.trains += p.stats.trainGold - was.trains;
        s.total += p.stats.goldEarned - was.total;
        window.set(p.id, s);
        prev.set(p.id, { trade: p.stats.tradeGold, trains: p.stats.trainGold, total: p.stats.goldEarned });
      }
      if ((g.tick - g.startTick) % 600 === 0) [last, window] = [window, new Map()];
    },
    print(g: Game, minute: number, builder: number, launched: string) {
      const nations = [...g.alivePlayers()]
        .filter((p) => p.kind === 'nation')
        .sort((a, b) => b.tiles - a.tiles);
      if (nations.length === 0) return;
      const rows: [string, Player][] = [['leader', nations[0]!]];
      rows.push(['median', nations[Math.floor(nations.length / 2)]!]);
      const b = builder > 0 ? g.players[builder]! : null;
      if (b && b.alive) rows.push(['builder', b]);
      let trains = 0;
      let merchants = 0;
      const fleet = new Map<number, number>();
      for (const u of g.units)
        if (u.alive && u.type === U.Train) trains++;
        else if (u.alive && u.type === U.Merchant) {
          merchants++;
          fleet.set(u.owner, (fleet.get(u.owner) ?? 0) + 1);
        }
      const k = (v: number) => `${(v / 60_000).toFixed(1)}k`; // per second over the minute
      let cities = 0;
      let earned = 0;
      for (const p of g.alivePlayers()) if (p.kind === 'nation') cities += levelsOwned(g, p, B.City);
      for (const s of last.values()) earned += s.total;
      console.log(
        `  ${String(minute).padStart(2)}min world   nations' city levels ${cities}, gold earned ${(earned / 60_000).toFixed(0)}k/s, launches ${launched}`,
      );
      for (const [label, p] of rows) {
        const s = last.get(p.id) ?? zero();
        const loot = s.total - s.passive - s.res - s.trade - s.trains;
        const lv = (t: B) => levelsOwned(g, p, t);
        console.log(
          `  ${String(minute).padStart(2)}min ${label.padEnd(7)} ${k(s.total).padStart(7)}/s = passive ${k(s.passive)} res ${k(s.res)} trade ${k(s.trade)} trains ${k(s.trains)} loot ${k(loot)}` +
            ` | ${(p.tiles / 1000).toFixed(0)}k tiles, city ${lv(B.City)} port ${lv(B.Port)} fact ${lv(B.Factory)} lab ${lv(B.Lab)}` +
            ` ${fleet.get(p.id) ?? 0} at sea | cap ${(p.popCap / 1e6).toFixed(2)}M troops ${(p.troops / 1e6).toFixed(2)}M gold ${(p.gold / 1e6).toFixed(1)}M` +
            (label === 'leader'
              ? ` | world trains ${trains} merchants ${merchants}${g.features.tradeMult > 1 ? ' BOOM' : ''}`
              : ''),
        );
      }
    },
  };
}

/** A random owned land tile, a few steps inside the border. */
function interior(g: Game, p: Player): number {
  const w = g.map.width;
  const [cx, cy] = p.centroid(w);
  for (let tries = 0; tries < 8; tries++) {
    const t = p.border[g.rng.int(0, Math.max(0, p.border.length - 1))] ?? p.spawnTile;
    const x0 = t % w;
    const y0 = (t / w) | 0;
    const f = g.rng.next();
    const x = Math.round(x0 + (cx - x0) * f);
    const y = Math.round(y0 + (cy - y0) * f);
    const tile = y * w + x;
    if (g.map.inBounds(x, y) && g.owner[tile] === p.id && IS_LAND[g.map.terrain[tile]!]) return tile;
  }
  return -1;
}

/** Stations (cities, ports, factories) within rail range of `tile`, factories counted apart. */
function railNeighbours(g: Game, tile: number): { stations: number; factories: number } {
  const w = g.map.width;
  const x = tile % w;
  const y = (tile / w) | 0;
  let stations = 0;
  let factories = 0;
  g.grid.query(x, y, RAIL_CONNECT_RANGE, (id) => {
    const o = g.buildings.get(id);
    if (!o || Math.hypot(o.x - x, o.y - y) > RAIL_CONNECT_RANGE) return;
    if (o.type === B.Factory) factories++;
    else if (o.type === B.City || o.type === B.Port) stations++;
  });
  return { stations, factories };
}

/**
 * A human-like builder: cities, ports and factories in turn, each placed where it joins the
 * most of the rail network (12 candidate spots), upgrading the smallest one when no spot is left.
 */
const BUILD_CYCLE = [B.City, B.Port, B.Factory, B.City, B.Port, B.City];
let cycle = 0;
function build(g: Game, p: Player): void {
  if (!p.alive || g.phase !== 'playing') return;
  for (let n = 0; n < 4; n++) {
    let kind = BUILD_CYCLE[cycle % BUILD_CYCLE.length]!;
    if (kind === B.Port && p.coast.length === 0) kind = B.City;
    if (p.gold < buildCost(g, p, kind)) return;
    cycle++;
    let best = -1;
    let bestScore = -1;
    for (let k = 0; k < 12; k++) {
      const tile = kind === B.Port ? p.coast[g.rng.int(0, p.coast.length - 1)]! : interior(g, p);
      if (tile < 0 || checkPlacement(g, p, kind, tile) !== 'ok') continue;
      const nb = railNeighbours(g, tile);
      const score = kind === B.Factory ? nb.stations : nb.factories * 10 + nb.stations;
      if (score > bestScore) [best, bestScore] = [tile, score];
    }
    if (best >= 0) {
      applyCommand(g, p.id, { t: 'build', kind, tile: best });
      continue;
    }
    let up: { id: number; level: number } | null = null;
    for (const b of g.buildings.values())
      if (
        b.owner === p.id &&
        b.type === kind &&
        b.buildLeft === 0 &&
        b.upgradeLeft === 0 &&
        b.level < MAX_LEVEL[kind]
      )
        if (!up || b.level < up.level) up = b;
    if (up) applyCommand(g, p.id, { t: 'upgrade', id: up.id });
  }
}

main();
