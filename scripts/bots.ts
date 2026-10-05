// Scripted test players (headless, deterministic): they stand in for a human in balance
// measurements of the nations' AI (scripts/versus.ts). They issue ordinary commands
// through the same path as a real client and draw from their own RNG, never game.rng.
// All three spawn on open land away from the nations, grab the wilderness and the tribes,
// answer an attack at once (a counter-wave bigger than the incoming one) and attack the
// weakest neighbours (net of the troops they have out elsewhere) with waves above their
// army, keeping their own army near the regeneration sweet spot.
//
// - aggressive: the attack-only snowball of an experienced OpenFront player (the 1.11
//   feedback: « a bit of building early, then just attacking »). Cities for 6 minutes, the
//   military branch, then war on up to 8 fronts at once, nothing else.
// - mixed: a competent player: builds all game long (cities, ports, factories), fortifies
//   the fronts it is attacked on, offers alliances to the neighbours it will not fight,
//   picks fewer, safer fights (4 fronts, targets under 0.8× its army).
// - builder: a calm player: economy first, no war on a nation for 10 minutes (wilderness and
//   tribes only), alliances with every neighbour willing, then careful wars on much weaker
//   neighbours (2 fronts, targets under 0.6× its army).
import type { Game } from '../src/core/game/state';
import type { Player } from '../src/core/game/player';
import type { StampedCommand } from '../src/core/net/commands';
import { Rng } from '../src/core/rng';
import { B } from '../src/core/game/constants';
import { HABITABLE, IS_LAND, SPEED } from '../src/core/map/terrain';
import { MAX_LEVEL, buildCost, checkPlacement } from '../src/core/buildings/buildings';
import { validSpawnTile } from '../src/core/game/spawn';
import { isResearched, techId } from '../src/core/rules/tech';
import { lineAcross, linesOf } from '../src/core/rules/lines';

export type BotKind = 'aggressive' | 'mixed' | 'builder';

export interface Bot {
  readonly kind: BotKind;
  /** Player id of the bot (set once the game is built). */
  id: number;
  /** Commands for this tick. */
  commands(game: Game): StampedCommand[];
  /** Peak number of own land attacks under way at once. */
  peakAttacks: number;
}

const NB = new Int32Array(4);

/** Owners adjacent to p's border (sampled), with a contact tile each (0 = wilderness). */
function contacts(game: Game, p: Player, samples = 400): Map<number, { tile: number; contact: number }> {
  const out = new Map<number, { tile: number; contact: number }>();
  const border = p.border;
  const step = Math.max(1, Math.floor(border.length / samples));
  for (let k = 0; k < border.length; k += step) {
    const t = border[k]!;
    const n = game.map.neighbors4(t, NB);
    for (let j = 0; j < n; j++) {
      const v = NB[j]!;
      const o = game.owner[v]!;
      if (o === p.id || !IS_LAND[game.map.terrain[v]!] || game.isDead(v)) continue;
      const e = out.get(o);
      if (e) e.contact++;
      else out.set(o, { tile: v, contact: 1 });
    }
  }
  return out;
}

/** An owned habitable tile some way inside p (towards its centroid), or -1. */
function interior(game: Game, p: Player, rng: Rng): number {
  const w = game.map.width;
  const [cx, cy] = p.centroid(w);
  for (let tries = 0; tries < 10; tries++) {
    const t = p.border[rng.int(0, Math.max(0, p.border.length - 1))] ?? p.spawnTile;
    const f = 0.2 + rng.next() * 0.8;
    const x = Math.round((t % w) + (cx - (t % w)) * f);
    const y = Math.round(((t / w) | 0) + (cy - ((t / w) | 0)) * f);
    if (!game.map.inBounds(x, y)) continue;
    const tile = y * w + x;
    if (game.owner[tile] === p.id && HABITABLE[game.map.terrain[tile]!]) return tile;
  }
  return -1;
}

/** Build `kind` somewhere valid (or upgrade the lowest one). Returns the command or null. */
function buildCommand(game: Game, p: Player, kind: B, rng: Rng, near = -1): StampedCommand | null {
  if (p.gold < buildCost(game, p, kind)) return null;
  for (let k = 0; k < 12; k++) {
    let tile: number;
    if (near >= 0) {
      const w = game.map.width;
      const x = (near % w) + rng.int(-6, 6);
      const y = ((near / w) | 0) + rng.int(-6, 6);
      tile = game.map.inBounds(x, y) ? y * w + x : -1;
    } else tile = kind === B.Port ? (p.coast[rng.int(0, p.coast.length - 1)] ?? -1) : interior(game, p, rng);
    if (tile >= 0 && checkPlacement(game, p, kind, tile) === 'ok')
      return { p: p.id, c: { t: 'build', kind, tile } };
  }
  if (near >= 0) return null;
  let up: { id: number; level: number } | null = null;
  for (const b of game.buildings.values())
    if (
      b.owner === p.id &&
      b.type === kind &&
      b.buildLeft === 0 &&
      b.upgradeLeft === 0 &&
      b.level < MAX_LEVEL[kind]
    )
      if (!up || b.level < up.level) up = b;
  return up ? { p: p.id, c: { t: 'upgrade', id: up.id } } : null;
}

/**
 * Where an experienced player spawns: the valid tile with the most free land around it and
 * the fewest countries already settled nearby (grid of candidates, deterministic).
 */
export function chooseSpawn(game: Game): number {
  const w = game.map.width;
  const h = game.map.height;
  const stepC = Math.max(8, Math.round(Math.sqrt(game.map.size / 4000)));
  const R = Math.max(12, stepC * 2);
  const others: [number, number][] = [];
  for (const q of game.players)
    if (q && q.spawnTile >= 0 && q.kind === 'nation') others.push([q.spawnTile % w, (q.spawnTile / w) | 0]);
  let best = -1;
  let bestScore = -Infinity;
  for (let y = R; y < h - R; y += stepC)
    for (let x = R; x < w - R; x += stepC) {
      const tile = y * w + x;
      if (!validSpawnTile(game, tile)) continue;
      let free = 0;
      let taken = 0;
      for (let dy = -R; dy <= R; dy += 3)
        for (let dx = -R; dx <= R; dx += 3) {
          const t = (y + dy) * w + x + dx;
          const ter = game.map.terrain[t]!;
          if (!IS_LAND[ter]) continue;
          // Plains settle fastest and cheapest: open country weighs most.
          if (game.owner[t] === 0) free += HABITABLE[ter] ? 16.5 / Math.max(16.5, SPEED[ter]!) : 0.2;
          else taken++;
        }
      // Away from the nations: room to grow before the first war.
      let near = 4 * R;
      for (const [ox, oy] of others) near = Math.min(near, Math.hypot(ox - x, oy - y));
      const score = free - 4 * taken + 2 * near;
      if (score > bestScore) {
        bestScore = score;
        best = tile;
      }
    }
  return best;
}

const MILITARY_PLAN = ['military.1', 'industry.1', 'military.2', 'industry.2', 'military.3', 'military.4'];
const MIXED_PLAN = [
  'economy.1',
  'military.1',
  'industry.1',
  'economy.2',
  'military.2',
  'industry.2',
  'military.3',
  'defense.1',
];
const ECONOMY_PLAN = ['economy.1', 'industry.1', 'economy.2', 'industry.2', 'defense.1', 'economy.3'];

function researchCommand(p: Player, plan: string[]): StampedCommand | null {
  if (p.researching >= 0) return null;
  for (const key of plan) {
    const id = techId(key);
    if (id >= 0 && !isResearched(p.tech, id)) return { p: p.id, c: { t: 'research', tech: id } };
  }
  return null;
}

export interface BotOptions {
  /** Seconds between two decisions (a human clicks about once a second). */
  every?: number;
  /** Minutes during which gold goes into cities (the attack-only player stops then). */
  buildMinutes?: number;
  /** Keep building all game long (cities, ports, factories). */
  buildAlways?: boolean;
  /** Minutes before the first war on a nation (wilderness and tribes only until then). */
  peaceMinutes?: number;
  /** Fronts kept open at once (wilderness and tribes included). */
  maxFronts?: number;
  /** Least share of the army sent on a new front against a nation. */
  attackRatio?: number;
  /** Nations attacked must have fewer troops than this share of its own (net of their other fronts). */
  strength?: number;
  /** Share of its troop ceiling it waits for before an offensive on a nation, and keeps home. */
  strike?: number;
  reserve?: number;
  /** Fortify the fronts it is attacked on (defensive lines). */
  defend?: boolean;
  /** Offer alliances to the neighbours it does not mean to fight. */
  courts?: boolean;
  /** Troops kept home against the strongest hostile neighbour, as a share of its army. */
  guard?: number;
  /** Ganged up on (two nations or more attacking it), it stops its offensives and holds its fronts. */
  turtle?: boolean;
}

const PRESETS: Record<BotKind, Required<Omit<BotOptions, 'every'>> & { plan: string[] }> = {
  aggressive: {
    buildMinutes: 6,
    buildAlways: false,
    peaceMinutes: 0,
    maxFronts: 8,
    attackRatio: 0.3,
    strength: 1,
    strike: 0.5,
    reserve: 0.25,
    defend: false,
    courts: false,
    guard: 0,
    turtle: false,
    plan: MILITARY_PLAN,
  },
  mixed: {
    buildMinutes: 6,
    buildAlways: true,
    peaceMinutes: 0,
    maxFronts: 4,
    attackRatio: 0.3,
    strength: 0.8,
    strike: 0.5,
    reserve: 0.25,
    defend: true,
    courts: true,
    guard: 0.8,
    turtle: true,
    plan: MIXED_PLAN,
  },
  builder: {
    buildMinutes: 6,
    buildAlways: true,
    peaceMinutes: 10,
    maxFronts: 2,
    attackRatio: 0.3,
    strength: 0.6,
    strike: 0.6,
    reserve: 0.3,
    defend: true,
    courts: true,
    guard: 0.8,
    turtle: true,
    plan: ECONOMY_PLAN,
  },
};

export function createBot(kind: BotKind, seed: number, opts: BotOptions = {}): Bot {
  const rng = new Rng(seed ^ 0x5eed);
  const every = Math.round((opts.every ?? 1) * 10);
  const o = { ...PRESETS[kind], ...opts };
  let lastBoat = -1000;
  let lastFront = -1000;
  let lastCourt = -1000;
  const bot: Bot = {
    kind,
    id: -1,
    peakAttacks: 0,
    commands(game) {
      const out: StampedCommand[] = [];
      const p = game.players[bot.id];
      if (!p) return out;
      if (game.phase === 'spawn') {
        if (!p.spawned) {
          const tile = chooseSpawn(game);
          if (tile >= 0) out.push({ p: p.id, c: { t: 'spawn', tile } });
        }
        return out;
      }
      if (game.phase !== 'playing' || !p.alive) return out;
      let mine = 0;
      for (const a of game.attacks) if (!a.done && a.attacker === p.id) mine++;
      if (mine > bot.peakAttacks) bot.peakAttacks = mine;
      if ((game.tick - game.startTick) % every !== 0) return out;
      return play(game, p, out);
    },
  };

  /** Troops q has out in attacks (not home to defend). */
  function outgoing(game: Game, q: Player): number {
    let n = 0;
    for (const a of game.attacks) if (!a.done && a.attacker === q.id) n += a.troops;
    return n;
  }

  function play(game: Game, p: Player, out: StampedCommand[]): StampedCommand[] {
    const minutes = (game.tick - game.startTick) / 600;
    const cap = p.popCap;
    const nb = contacts(game, p);
    const effective = (q: Player) => Math.max(0, q.troops - outgoing(game, q) * 0.7);
    const peace = minutes < o.peaceMinutes;
    // Diplomacy: alliance offers from beyond its borders are welcome (from anyone for a
    // courting player); a courting player offers alliances to the neighbours it will not fight.
    for (const [from] of p.allyRequests)
      out.push({ p: p.id, c: { t: 'allyAnswer', target: from, accept: o.courts || !nb.has(from) } });
    if (o.courts && game.tick - lastCourt > 300) {
      lastCourt = game.tick;
      for (const id of nb.keys()) {
        const q = id > 0 ? game.players[id]! : null;
        if (!q || q.kind === 'tribe' || p.allies.has(id) || p.allyRequests.has(id)) continue;
        if (peace || effective(q) > p.troops * o.strength)
          out.push({ p: p.id, c: { t: 'allyRequest', target: id } });
      }
    }
    const r = researchCommand(p, o.plan);
    if (r) out.push(r);
    const incoming = new Map<number, number>();
    for (const a of game.attacks)
      if (!a.done && a.target === p.id) incoming.set(a.attacker, (incoming.get(a.attacker) ?? 0) + a.troops);
    // Gold: cities in the opening (all game long with ports and factories for a builder);
    // defensive lines (rules/lines.ts) on the fronts it is attacked on.
    if (o.defend)
      for (const [att, tr] of incoming) {
        const n = nb.get(att);
        if (n && tr > p.troops * 0.15 && linesOf(game, p.id).length < 2 + p.tiles / 4000) {
          const across = lineAcross(game, p, n.tile, att, 5, 14);
          if (across)
            out.push({ p: p.id, c: { t: 'line', kind: 0, pts: across.pts, side: across.side, ratio: 0.1 } });
          if (incoming.size < 2) break;
        }
      }
    if (minutes < o.buildMinutes || o.buildAlways) {
      let k: B = B.City;
      if (p.coast.length > 0 && p.buildingCount[B.Port] === 0 && p.buildingCount[B.City]! >= 2) k = B.Port;
      else if (o.buildAlways && p.buildingCount[B.City]! >= 3 && rng.chance(0.3))
        k = p.coast.length > 0 && rng.chance(0.5) ? B.Port : B.Factory;
      const c = buildCommand(game, p, k, rng);
      if (c) out.push(c);
    }
    const active = new Map<number, number>();
    for (const a of game.attacks)
      if (!a.done && a.attacker === p.id && !a.boat)
        active.set(a.target, (active.get(a.target) ?? 0) + a.troops);
    let troops = p.troops;
    const send = (tile: number, amount: number, id: number) => {
      const ratio = Math.min(0.6, Math.max(0.01, amount / Math.max(1, troops)));
      out.push({ p: p.id, c: { t: 'attack', tile, ratio } });
      active.set(id, (active.get(id) ?? 0) + troops * ratio);
      troops -= troops * ratio;
    };
    // Ganged up on: hold the fronts (no new offensive on a nation, only the biggest wave answered).
    let gang = 0;
    for (const id of incoming.keys()) if (game.players[id]!.kind !== 'tribe') gang++;
    const ganged = o.turtle && gang >= 2;
    // 1. Answer an attack at once: enough to wipe the wave out in the clash.
    for (const [att, tr] of [...incoming].sort((x, y) => y[1] - x[1])) {
      const n = nb.get(att);
      if (!n || active.has(att) || !game.attackAllowed(p.id, att, true) || troops < tr * 1.4) continue;
      send(n.tile, tr * 1.15, att);
      if (ganged) break;
    }
    // 2. Free land: the cheapest growth.
    if (nb.has(0) && !active.has(0) && troops > cap * 0.3) send(nb.get(0)!.tile, troops * 0.35, 0);
    // 3. Offensives, at most one new front every 3 s: tribes as soon as it can, then nations
    //    weaker than its army (net of the troops they have out on other fronts), the weakest
    //    first, with waves well above their army (losses grow with the defender's army over
    //    the wave's), while the nations under attack together stay weaker than it.
    let committed = 0;
    for (const id of active.keys()) if (id > 0) committed += effective(game.players[id]!);
    // Home army: a share of the ceiling, and (careful players) most of the strongest hostile neighbour's.
    let strongest = 0;
    for (const id of nb.keys()) {
      const q = id > 0 ? game.players[id]! : null;
      if (q && q.kind !== 'tribe' && !p.allies.has(id)) strongest = Math.max(strongest, effective(q));
    }
    const floor = Math.max(cap * o.reserve, o.guard * strongest);
    if (game.tick - lastFront >= 30) {
      const targets = [...nb.entries()]
        .filter(([id]) => id > 0 && !active.has(id))
        .map(([id, n]) => ({ id, n, q: game.players[id]! }))
        .filter(({ q }) => q.alive && !p.allies.has(q.id) && game.attackAllowed(p.id, q.id, true))
        .filter(({ q }) => q.kind === 'tribe' || (!peace && !ganged))
        .sort((a, b) => effective(a.q) - effective(b.q) || a.id - b.id);
      for (const { q, n } of targets) {
        if (active.size >= o.maxFronts) break;
        const tribe = q.kind === 'tribe';
        const spare = troops - floor;
        if (troops < cap * (tribe ? 0.3 : o.strike)) continue;
        if (!tribe && committed + effective(q) > p.troops * o.strength) continue;
        const want = effective(q) * (tribe ? 1.7 : 1.3);
        if (spare < want * (tribe ? 1 : 0.8)) continue;
        send(n.tile, Math.min(spare, Math.max(want, tribe ? 0 : troops * o.attackRatio)), q.id);
        lastFront = game.tick;
        break;
      }
    }
    // 4. A full army feeds the offensive against the weakest target.
    if (!ganged && troops > cap * 0.75 && troops * 0.8 >= floor) {
      let best: { tile: number; v: number; id: number } | null = null;
      for (const id of active.keys()) {
        const q = id > 0 ? game.players[id]! : null;
        const n = nb.get(id);
        if (!q || !n) continue;
        if (!best || effective(q) < best.v) best = { tile: n.tile, v: effective(q), id };
      }
      if (best) send(best.tile, troops * 0.2, best.id);
    }
    // 5. Boxed in (only allies or the sea around): a landing on the weakest coast in reach.
    if (
      !peace &&
      active.size === 0 &&
      troops > cap * 0.5 &&
      game.tick - lastBoat > 300 &&
      p.coast.length > 0
    ) {
      lastBoat = game.tick;
      let best: Player | null = null;
      for (const q of game.alivePlayers())
        if (
          q.id !== p.id &&
          q.coast.length > 0 &&
          !p.allies.has(q.id) &&
          game.attackAllowed(p.id, q.id, true)
        )
          if (!best || q.troops < best.troops) best = q;
      if (best)
        out.push({
          p: p.id,
          c: { t: 'boat', tile: best.coast[rng.int(0, best.coast.length - 1)]!, ratio: 0.3 },
        });
    }
    return out;
  }

  return bot;
}
