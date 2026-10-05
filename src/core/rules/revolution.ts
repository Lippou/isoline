// Revolutions (GAME_DESIGN.md §6.5): Isoline's own world rule against snowballing, for
// humans and nations alike. A country holding far more land than anyone else now and then
// sees a distant region rise up: the region (recent conquests first, never near the capital)
// becomes a rebel faction with part of the local garrison. Rebels are a tribe without gold:
// no treasury, no income, nothing to loot; they neither trade nor sign alliances, push a
// little into their former country, and their buildings stand idle (occupied) while they
// hold them. Their former country takes them back intact; anyone else finds them burnt.
// Retaking the region is hard work (1.16): guerrilla in every street (attackers lose more
// troops and advance slower there, the former country most of all), barricades right after
// the outbreak, rebels levying troops like a country, no annexation of their last tiles,
// and a revolt left standing spreads into its country's neighbouring land.
// Unless put down earlier, a revolution runs out of steam after REVOLUTION_TICKS and its
// land rejoins its country. Deterministic: the match's PRNG, drawn only when a country
// qualifies (games without a runaway leader keep their exact course).
import type { Game } from '../game/state';
import { Noise2D } from '../noise';
import type { Player } from '../game/player';
import type { LocalizedName } from '../map/gamemap';
import {
  B,
  LOYALTY_SETTLED,
  REBEL_COLOR,
  REVOLUTION_BARRICADE_MULT,
  REVOLUTION_BARRICADE_TICKS,
  REVOLUTION_CAPITAL_SAFE,
  REVOLUTION_CHANCE_BASE,
  REVOLUTION_CHANCE_EXTRA,
  REVOLUTION_CHECK_TICKS,
  REVOLUTION_COOLDOWN,
  REVOLUTION_GRACE,
  REVOLUTION_GUERRILLA_HOME,
  REVOLUTION_GUERRILLA_MAG,
  REVOLUTION_GUERRILLA_SPEED,
  REVOLUTION_LAND,
  REVOLUTION_LEVY,
  REVOLUTION_MAX_TILES,
  REVOLUTION_MIN_LEAD,
  REVOLUTION_MIN_SHARE,
  REVOLUTION_MIN_TILES,
  REVOLUTION_SPREAD_EVERY,
  REVOLUTION_SPREAD_FIRST,
  REVOLUTION_SPREAD_HOLD,
  REVOLUTION_SPREAD_LAND,
  REVOLUTION_TICKS,
  REVOLUTION_TROOPS,
  REVOLUTION_TROOPS_MAX,
} from '../game/constants';
import { IS_LAND } from '../map/terrain';

/** How far ahead the leader is, and the chance of a revolution at the next draw. */
export interface RevolutionPressure {
  leader: number;
  /** Leader's share of the useful land (0..1). */
  share: number;
  /** Leader's land over the largest country outside its team's. */
  lead: number;
  /** 0 below the bars, else REVOLUTION_CHANCE_BASE … BASE + EXTRA. */
  chance: number;
}

/**
 * The leader among humans and nations (useful land), its share and its lead over the
 * largest country outside its team, and the chance of a revolution at the next draw.
 * The chance grows with the lead (×1.6 → ×4) and the share (20 % → 50 %).
 */
export function revolutionPressure(game: Game): RevolutionPressure {
  let leader: Player | null = null;
  for (const p of game.alivePlayers())
    if (p.kind !== 'tribe' && (!leader || p.usefulTiles > leader.usefulTiles)) leader = p;
  if (!leader) return { leader: -1, share: 0, lead: 0, chance: 0 };
  let second = 0;
  for (const p of game.alivePlayers())
    if (p.kind !== 'tribe' && p.id !== leader.id && !game.sameTeam(p.id, leader.id))
      second = Math.max(second, p.usefulTiles);
  const share = leader.usefulTiles / Math.max(1, game.usefulLand);
  const lead = leader.usefulTiles / Math.max(1, second);
  let chance = 0;
  if (share >= REVOLUTION_MIN_SHARE && lead >= REVOLUTION_MIN_LEAD) {
    const byLead = Math.min(1, (lead - REVOLUTION_MIN_LEAD) / (4 - REVOLUTION_MIN_LEAD));
    const byShare = Math.min(1, (share - REVOLUTION_MIN_SHARE) / (0.5 - REVOLUTION_MIN_SHARE));
    chance = REVOLUTION_CHANCE_BASE + (REVOLUTION_CHANCE_EXTRA * (byLead + byShare)) / 2;
  }
  return { leader: leader.id, share, lead, chance };
}

/** The revolution under way against `p` (null: none). */
export function liveRevolutionOf(game: Game, p: Player): Player | null {
  for (const q of game.alivePlayers()) if (q.revolution && q.rebelOf === p.id) return q;
  return null;
}

/** Whether `rebel` is a revolution under way (not over, not crushed). */
export function liveRevolution(game: Game, rebel: Player): boolean {
  return rebel.revolution && rebel.alive && rebel.revoltUntil > game.tick;
}

/** Whether the barricades still stand (REVOLUTION_BARRICADE_TICKS after the outbreak). */
export function barricadesUp(game: Game, rebel: Player): boolean {
  return liveRevolution(game, rebel) && game.tick < rebel.revoltStart + REVOLUTION_BARRICADE_TICKS;
}

/**
 * Guerrilla: how much more an attack by `attacker` into `rebel`'s land costs — `mag`
 * multiplies its losses, `speed` the time each tile takes. 1 and 1 outside a revolution.
 * Every attacker alike (humans and nations), the former country ×REVOLUTION_GUERRILLA_HOME
 * on losses, everything ×REVOLUTION_BARRICADE_MULT while the barricades stand.
 */
export function guerrilla(game: Game, rebel: Player, attacker: number): { mag: number; speed: number } {
  if (!liveRevolution(game, rebel)) return { mag: 1, speed: 1 };
  const bar = barricadesUp(game, rebel) ? REVOLUTION_BARRICADE_MULT : 1;
  const home = attacker === rebel.rebelOf ? REVOLUTION_GUERRILLA_HOME : 1;
  return { mag: REVOLUTION_GUERRILLA_MAG * home * bar, speed: REVOLUTION_GUERRILLA_SPEED * bar };
}

/**
 * Contagion: the next spread of `rebel` into its country, in ticks from now (-1: none left
 * before the revolt runs out of steam), and whether it holds enough of its land to spread.
 */
export function nextSpread(game: Game, rebel: Player): { in: number; holds: boolean } {
  if (!liveRevolution(game, rebel) || rebel.revoltSpreadAt < 0) return { in: -1, holds: false };
  return {
    in: Math.max(0, rebel.revoltSpreadAt - game.tick),
    holds: rebel.tiles >= REVOLUTION_SPREAD_HOLD * rebel.revoltLand,
  };
}

export function updateRevolutions(game: Game): void {
  // Endings first: rebels whose time is up rejoin their country (checked every second);
  // those still holding their ground spread meanwhile.
  if (game.tick % 10 === 0)
    for (const q of [...game.alivePlayers()]) {
      if (!q.revolution || q.revoltUntil < 0) continue;
      if (game.tick >= q.revoltUntil) endRevolution(game, q);
      else if (q.revoltSpreadAt >= 0 && game.tick >= q.revoltSpreadAt) {
        const next = q.revoltSpreadAt + REVOLUTION_SPREAD_EVERY;
        q.revoltSpreadAt = next < q.revoltUntil ? next : -1;
        if (q.tiles >= REVOLUTION_SPREAD_HOLD * q.revoltLand) spreadRevolution(game, q);
      }
    }
  if (!game.config.features.revolution) return;
  const rel = game.tick - game.startTick;
  if (rel < REVOLUTION_GRACE || rel % REVOLUTION_CHECK_TICKS !== 0) return;
  const pr = revolutionPressure(game);
  if (pr.chance <= 0) return;
  const p = game.players[pr.leader]!;
  if (game.tick < p.revoltReadyTick || liveRevolutionOf(game, p)) return;
  if (!game.rng.chance(pr.chance)) return;
  startRevolution(game, p);
}

/**
 * A region of `p` rises up (also the QA hook, whatever the bars). Returns the rebels, or
 * null when no region fits (too small a country, nothing far enough from the capital).
 */
export function startRevolution(game: Game, p: Player): Player | null {
  if (!p.alive || p.kind === 'tribe' || game.phase !== 'playing') return null;
  const seed = pickSeed(game, p);
  if (seed < 0) return null;
  const want = Math.max(
    REVOLUTION_MIN_TILES,
    Math.min(REVOLUTION_MAX_TILES, Math.round(p.tiles * REVOLUTION_LAND)),
  );
  const region = growRegion(game, p, seed, want);
  if (region.length < REVOLUTION_MIN_TILES / 2) return null;

  const rebel = game.addPlayer(revolutionName(game, p, region), 'tribe');
  rebel.rebelOf = p.id;
  rebel.revolution = true;
  rebel.revoltUntil = game.tick + REVOLUTION_TICKS;
  rebel.revoltTiles = region.length;
  rebel.revoltLand = region.length;
  rebel.revoltStart = game.tick;
  rebel.revoltSpreadAt = game.tick + REVOLUTION_SPREAD_FIRST;
  rebel.color = REBEL_COLOR;
  rebel.flagSeed = game.rng.nextU32();
  rebel.spawned = true;
  rebel.spawnTile = seed;
  // The region's garrison defects (troops in proportion to its land, taken from the country)
  // and the locals join it. Above their ceiling (a tribe's), the rebels melt away over time.
  const density = p.troops / Math.max(1, p.tiles);
  const troops = Math.min(p.troops * REVOLUTION_TROOPS_MAX, density * region.length * REVOLUTION_TROOPS);
  p.troops -= troops;
  rebel.troops = troops * REVOLUTION_LEVY + 1000;
  rebel.revoltDensity = rebel.troops / region.length;
  for (const t of region) game.setOwner(t, rebel.id);
  // Its buildings (taken as they stand, Game.onBuildingTileCaptured) stand idle meanwhile.
  let cities = 0;
  for (const b of game.buildings.values()) {
    if (b.owner !== rebel.id) continue;
    if (b.type === B.City) cities++;
    b.occupiedLeft = b.occupiedTotal = REVOLUTION_TICKS;
  }
  game.buildingsDirty = true;
  game.buildingsVersion++;
  p.revoltReadyTick = game.tick + REVOLUTION_COOLDOWN;
  p.revolutions++;
  game.emit({
    k: 'revolution',
    phase: 'start',
    from: p.id,
    tribe: rebel.id,
    tile: seed,
    tiles: region.length,
    by: 0,
  });
  const params = { tribe: rebel.id, player: p.id, tiles: region.length, cities, min: REVOLUTION_TICKS / 600 };
  game.notify(p.id, 'notify.revolution', 'danger', params, seed);
  game.notify(-1, 'event.revolution', 'warn', params, seed);
  return rebel;
}

/**
 * Contagion: the revolt wins over a band of its country's land next to it
 * (REVOLUTION_SPREAD_LAND × its first region, grown breadth-first from their common border,
 * never near the capital), with the garrison there, like the outbreak.
 */
function spreadRevolution(game: Game, rebel: Player): void {
  const p = game.players[rebel.rebelOf];
  if (!p || !p.alive || p.kind === 'tribe') return;
  const map = game.map;
  const w = map.width;
  const [hx, hy] = home(game, p);
  const safe2 = REVOLUTION_CAPITAL_SAFE * REVOLUTION_CAPITAL_SAFE;
  const want = Math.max(1, Math.round(rebel.revoltTiles * REVOLUTION_SPREAD_LAND));
  const ok = (v: number) =>
    game.owner[v] === p.id &&
    !!IS_LAND[map.terrain[v]!] &&
    v !== p.capital &&
    ((v % w) - hx) ** 2 + (((v / w) | 0) - hy) ** 2 >= safe2;
  const region = growOrganic(game, rebel.border, want, ok);
  if (region.length === 0) return;
  const density = p.troops / Math.max(1, p.tiles);
  const troops = Math.min(
    (p.troops * REVOLUTION_TROOPS_MAX) / 2,
    density * region.length * REVOLUTION_TROOPS,
  );
  p.troops -= troops;
  rebel.troops += troops * REVOLUTION_LEVY;
  for (const t of region) game.setOwner(t, rebel.id);
  const left = Math.max(0, rebel.revoltUntil - game.tick);
  for (const b of game.buildings.values()) {
    if (b.owner !== rebel.id || b.occupiedLeft > 0) continue;
    b.occupiedLeft = b.occupiedTotal = left;
  }
  game.buildingsDirty = true;
  game.buildingsVersion++;
  rebel.revoltLand += region.length;
  const at = region[0]!;
  game.emit({
    k: 'revolution',
    phase: 'spread',
    from: p.id,
    tribe: rebel.id,
    tile: at,
    tiles: region.length,
    by: 0,
  });
  game.notify(p.id, 'notify.revolutionSpread', 'danger', { tribe: rebel.id, tiles: region.length }, at);
}

/** The revolution runs out of steam: its land rejoins its country (or the wild, if gone). */
export function endRevolution(game: Game, rebel: Player): void {
  const home = game.players[rebel.rebelOf];
  const back = home && home.alive ? home.id : 0;
  rebel.revoltUntil = -1; // (no longer "crushed" when its last tile goes)
  rebel.revoltSpreadAt = -1;
  const own = game.owner;
  let tiles = 0;
  let at = rebel.spawnTile;
  for (let i = 0; i < own.length; i++) {
    if (own[i] !== rebel.id) continue;
    if (tiles === 0) at = i;
    tiles++;
    game.setOwner(i, back);
  }
  if (rebel.alive) game.eliminate(rebel, back, at);
  game.emit({
    k: 'revolution',
    phase: 'over',
    from: rebel.rebelOf,
    tribe: rebel.id,
    tile: at,
    tiles,
    by: back,
  });
  if (back > 0) game.notify(back, 'notify.revolutionOver', 'good', { tribe: rebel.id, tiles }, at);
}

/** Game.eliminate: a revolution lost its last tile before running out of steam. */
export function revolutionCrushed(game: Game, rebel: Player, by: number, tile: number): void {
  if (!rebel.revolution || rebel.revoltUntil < 0) return;
  rebel.revoltUntil = -1;
  game.emit({ k: 'revolution', phase: 'crushed', from: rebel.rebelOf, tribe: rebel.id, tile, tiles: 0, by });
  const home = game.players[rebel.rebelOf];
  if (!home || !home.alive) return;
  if (by === home.id) game.notify(home.id, 'notify.revolutionCrushed', 'good', { tribe: rebel.id }, tile);
  else if (by > 0) game.notify(home.id, 'notify.revolutionSeized', 'warn', { tribe: rebel.id, by }, tile);
}

// ------------------------------------------------------------------ region
const NB = new Int32Array(4);

/**
 * Where it starts: of up to 48 border tiles drawn at random, the one farthest from the
 * capital (its centre without one), conquered land counting double the distance (land
 * taken from another country, not settled from the wild). None within the safe radius.
 */
function pickSeed(game: Game, p: Player): number {
  const w = game.map.width;
  const [hx, hy] = home(game, p);
  const safe2 = REVOLUTION_CAPITAL_SAFE * REVOLUTION_CAPITAL_SAFE;
  const pool = p.border.length > 0 ? p.border : p.coast;
  if (pool.length === 0) return -1;
  let best = -1;
  let bestScore = 0;
  const draws = Math.min(48, pool.length);
  for (let k = 0; k < draws; k++) {
    const t = pool[game.rng.int(0, pool.length - 1)]!;
    if (game.owner[t] !== p.id || !IS_LAND[game.map.terrain[t]!]) continue;
    const d2 = ((t % w) - hx) ** 2 + (((t / w) | 0) - hy) ** 2;
    if (d2 < safe2) continue;
    const score = d2 * (game.loyalty[t]! < LOYALTY_SETTLED ? 4 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

function home(game: Game, p: Player): [number, number] {
  const w = game.map.width;
  if (p.capital >= 0) return [p.capital % w, (p.capital / w) | 0];
  return p.centroid(w);
}

/** A coherent region of p's land grown from `seed` (`want` tiles at most), never near the capital. */
function growRegion(game: Game, p: Player, seed: number, want: number): number[] {
  const map = game.map;
  const w = map.width;
  const [hx, hy] = home(game, p);
  const safe2 = REVOLUTION_CAPITAL_SAFE * REVOLUTION_CAPITAL_SAFE;
  const ok = (v: number) =>
    game.owner[v] === p.id &&
    !!IS_LAND[map.terrain[v]!] &&
    v !== p.capital &&
    ((v % w) - hx) ** 2 + (((v / w) | 0) - hy) ** 2 >= safe2;
  return ok(seed) ? growOrganic(game, [seed], want, ok) : [];
}

/**
 * A region shaped like a real one, not the diamond of a breadth-first fill: grown from
 * `sources` (each tile next to the region so far, so it stays in one piece), the nearest
 * first, where "near" is the distance to the source it grew from, stretched and shrunk by
 * a low-frequency noise (lobes and bays at the region's scale) plus a finer one (a ragged
 * edge). Deterministic: the noise is seeded from the game's rng.
 */
export function growOrganic(
  game: Game,
  sources: readonly number[],
  want: number,
  ok: (tile: number) => boolean,
): number[] {
  const map = game.map;
  const w = map.width;
  const noise = new Noise2D(game.rng.nextU32());
  const r0 = Math.max(4, Math.sqrt(want / Math.PI));
  const lobe = 1 / (r0 * 0.9);
  const edge = 1 / 5;
  const origin = new Map<number, number>();
  const heap = new TileHeap();
  const push = (v: number, from: number) => {
    origin.set(v, from);
    const x = v % w;
    const y = (v / w) | 0;
    const d = Math.hypot(x - (from % w), y - ((from / w) | 0));
    const stretch = Math.max(0.25, 1 + 0.75 * noise.fbm(x * lobe, y * lobe, 3));
    heap.push(v, d * stretch + r0 * 0.35 * noise.fbm(x * edge + 91.7, y * edge - 33.1, 2));
  };
  for (const s of sources) {
    if (origin.has(s)) continue;
    if (ok(s)) push(s, s);
    else {
      // A border tile of the rebels: grow from its neighbours on the country's side.
      origin.set(s, s);
      const n = map.neighbors4(s, NB);
      for (let j = 0; j < n; j++) {
        const v = NB[j]!;
        if (!origin.has(v) && ok(v)) push(v, s);
      }
    }
  }
  const region: number[] = [];
  while (heap.size > 0 && region.length < want) {
    const t = heap.pop();
    region.push(t);
    const from = origin.get(t)!;
    const n = map.neighbors4(t, NB);
    for (let j = 0; j < n; j++) {
      const v = NB[j]!;
      if (!origin.has(v) && ok(v)) push(v, from);
    }
  }
  return region;
}

/** A binary min-heap of tiles by priority (ties: the lower tile, so every client agrees). */
class TileHeap {
  private tiles: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.tiles.length;
  }
  private less(i: number, j: number): boolean {
    const a = this.prio[i]!;
    const b = this.prio[j]!;
    return a < b || (a === b && this.tiles[i]! < this.tiles[j]!);
  }
  private swap(i: number, j: number): void {
    [this.tiles[i], this.tiles[j]] = [this.tiles[j]!, this.tiles[i]!];
    [this.prio[i], this.prio[j]] = [this.prio[j]!, this.prio[i]!];
  }
  push(tile: number, p: number): void {
    this.tiles.push(tile);
    this.prio.push(p);
    let i = this.tiles.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): number {
    const top = this.tiles[0]!;
    const lastT = this.tiles.pop()!;
    const lastP = this.prio.pop()!;
    if (this.tiles.length > 0) {
      this.tiles[0] = lastT;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.tiles.length && this.less(l, m)) m = l;
        if (r < this.tiles.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

/**
 * « Révolutionnaires de Pologne » / "Polish… " — named after the map's country nearest to the
 * region's centre (the land the rebels stand on), else after the country they rise against.
 */
function revolutionName(game: Game, p: Player, region: number[]): LocalizedName {
  const w = game.map.width;
  let sx = 0;
  let sy = 0;
  for (const t of region) {
    sx += t % w;
    sy += (t / w) | 0;
  }
  const cx = sx / region.length;
  const cy = sy / region.length;
  let place: LocalizedName = p.name;
  let bd = Infinity;
  for (const n of game.map.meta.nations ?? []) {
    const d = (n.x - cx) ** 2 + (n.y - cy) ** 2;
    if (d < bd) {
      bd = d;
      place = n.name;
    }
  }
  const fr = place.fr || place.en;
  const en = place.en || place.fr;
  const de = /^[AEIOUÉÈÊÎÔ]/i.test(fr) ? "d'" : 'de ';
  return { fr: `Révolutionnaires ${de}${fr}`, en: `${en} Revolutionaries` };
}
