// The nations' air force (GAME_DESIGN.md §11, §13.2). Aircraft are bought from a budget: a
// share of the nation's income (TACTICS.airShare) builds up as an air credit while it owns
// an airfield, and planes are only launched against that credit (and above a small treasury
// reserve), so that the air war never starves the economy. What a nation does with it
// depends on the difficulty (TACTICS.air):
//   0 (easy)       bombers now and then at whatever building of its enemy is in reach;
//   1 (normal)     raids on SAMs before a nuclear
//                  strike, then on silos, airfields and the most valuable buildings, avoiding
//                  loaded SAMs (unless it can empty them); reconnaissance over its offensives
//                  (one in two) and before half of its raids; fighters at transports sailing
//                  for its coast (bombers beyond the fighters' reach) and at bombers its
//                  radars see coming; from 1.16 its raids also go for the enemy's ships at
//                  sea (invasion transports, warships, trade ships);
//   2 (hard)       + reconnaissance before every raid (a spotted building loses two levels),
//                  an escort fighter when interceptors would rise against the bombers,
//                  fighters at any bomber in sight;
//   3 (impossible) + saturation raids (up to 4 bombers to empty a SAM), fighters even where
//                  the free interceptors would rise, when several bombers come at once.
// Planes in flight are listed once per tick for every nation (a derived cache, not state).
import { ashBlocks } from '../rules/worldEvents';
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import type { Building } from '../buildings/building';
import { inService } from '../buildings/building';
import {
  A,
  AIR_COST,
  AIR_SPEED,
  B,
  BOMBER_RANGE,
  FIGHTER_RANGE,
  RECON_RANGE,
  SCRAMBLE_SIGHT,
} from '../game/constants';
import { applyCommand } from '../game/commands';
import { U, type Unit } from '../units/unit';
import { unitById } from '../units/ships';
import { AIR_OUTBOUND, airfieldFor, alertReady, isShip, radarSees, spotted } from '../units/air';
import { samMissilesReady, samRangeOf } from '../units/nukes';
import { airLock } from '../rules/tech';
import { TACTICS } from './tactics';

/** What the air force remembers (part of the nation's AI memory, hence of saves). */
export interface AirMem {
  /** Last bombing raid, reconnaissance flight and fighter sortie. */
  lastRaid?: number;
  lastRecon?: number;
  lastFighter?: number;
  /** Gold the air force may still spend (a share of the income since the first airfield). */
  airCredit?: number;
  /** The nation's lifetime gold earnings when the credit was last topped up. */
  airEarned?: number;
  /** A raid waiting for gold: [gold it needs, tick until which the nation saves for it]. */
  raidFund?: [gold: number, until: number];
  /** The country p last launched an offensive against (ai.ts). */
  warOn?: number;
}

/** Ticks between two raids (÷ aggression × difficulty), reconnaissance flights and fighter sorties. */
export const AI_RAID_COOLDOWN = 450;
export const AI_RECON_COOLDOWN = 600;
export const AI_FIGHTER_COOLDOWN = 200;
/** A raid is remembered this long (airfield, radar, Aerospace)… */
export const AI_RAID_MEMORY = 6000;
/** …and avenged by bombers this long after it. */
export const AI_RETALIATION = 1800;
/** Gold a nation keeps for its economy before paying for planes (1 M before 1.11). */
export const AI_AIR_RESERVE = 250_000;
/** A raid that waits for gold is saved for this long (ticks) before it is given up. */
export const AI_RAID_FUND_TICKS = 600;
/** Easy nations raid this many times less often. */
const EASY_RAID_SLOWDOWN = 3;

/** Who bombed p within the last `window` ticks (-1: nobody). */
export function raider(game: Game, p: Player, window: number): number {
  const r = game.ai.raidedBy.get(p.id);
  return r && game.tick - r[1] <= window ? r[0] : -1;
}

// ------------------------------------------------------------------ planes in flight
let cacheGame: Game | null = null;
let cacheTick = -1;
let cachePlanes: Unit[] = [];
let cacheBoats: Unit[] = [];

/** Aircraft and transports in flight / at sea this tick (rebuilt once per tick). */
function traffic(game: Game): { planes: Unit[]; boats: Unit[] } {
  if (cacheGame !== game || cacheTick !== game.tick) {
    cacheGame = game;
    cacheTick = game.tick;
    cachePlanes = [];
    cacheBoats = [];
    for (const u of game.units) {
      if (!u.alive) continue;
      if (u.type === U.Transport) cacheBoats.push(u);
      else if (u.type >= U.Fighter && u.type <= U.Recon) cachePlanes.push(u);
    }
  }
  return { planes: cachePlanes, boats: cacheBoats };
}

// ------------------------------------------------------------------ budget
/** Tops up the air credit with the air force's share of the gold earned since the last look. */
function topUp(game: Game, p: Player, m: AirMem, aggression: number): void {
  const tac = TACTICS[game.config.difficulty];
  const earned = p.stats.goldEarned;
  const gained = Math.max(0, earned - (m.airEarned ?? earned));
  m.airEarned = earned;
  const cap = AIR_COST[A.Bomber] * (2 + tac.air);
  const share = tac.airShare * Math.max(0.6, Math.min(1.4, aggression));
  m.airCredit = Math.min(cap, (m.airCredit ?? 0) + gained * share);
}

/** Whether the credit and the treasury (above AI_AIR_RESERVE) both cover `gold`. */
function canPay(p: Player, m: AirMem, gold: number, reserve = AI_AIR_RESERVE): boolean {
  return (m.airCredit ?? 0) >= gold && p.gold - reserve >= gold;
}

function launch(game: Game, p: Player, m: AirMem, kind: A, tile: number): boolean {
  const before = p.gold;
  applyCommand(game, p.id, { t: 'air', kind, tile });
  if (p.gold >= before) return false;
  m.airCredit = (m.airCredit ?? 0) - (before - p.gold);
  return true;
}

/** Sends a reconnaissance plane over `tile` when one can reach it (true when it took off). */
export function scout(game: Game, p: Player, m: AirMem, tile: number): boolean {
  if (airLock(game, p) >= 0 || !canPay(p, m, AIR_COST[A.Recon], AI_AIR_RESERVE / 2)) return false;
  const w = game.map.width;
  const f = airfieldFor(game, p, (tile % w) + 0.5, ((tile / w) | 0) + 0.5);
  if (!f || f.d > RECON_RANGE) return false;
  if (!launch(game, p, m, A.Recon, tile)) return false;
  m.lastRecon = game.tick;
  return true;
}

export interface AirContext {
  /** The personality's aggression (raids are more frequent, the credit bigger). */
  aggression: number;
  /** Attacks under way at p, by attacker (troops). */
  incoming: Map<number, number>;
  /** A land contact tile with each neighbour (owner → tile). */
  contact: (owner: number) => number;
  /** The runaway p fights as a coalition member (-1: none). */
  runaway: number;
  /** The country p's last offensive went at, while that war is recent (-1: none). */
  recentWar: number;
}

/** One look at the sky for nation p, which owns an airfield. Returns its work cost. */
export function thinkAir(game: Game, p: Player, m: AirMem, ctx: AirContext): number {
  if (airLock(game, p) >= 0) return 0;
  topUp(game, p, m, ctx.aggression);
  let cost = 20;
  cost += defendSky(game, p, m);
  cost += strike(game, p, m, ctx);
  return cost;
}

// ------------------------------------------------------------------ fighters
/**
 * Fighters (normal and up). A hostile transport sailing for our coast within reach of an
 * airfield; a hostile bomber on its way to one of our buildings, seen in time (radar coverage
 * on normal; anywhere without the fog from hard), when the free interceptors on alert would
 * not rise against it (none ready, or the target out of their sight) — on impossible also
 * when several bombers come at the same building. The fighter patrols over the target.
 */
function defendSky(game: Game, p: Player, m: AirMem): number {
  const tac = TACTICS[game.config.difficulty];
  if (tac.air < 1 || game.tick - (m.lastFighter ?? -10_000) <= AI_FIGHTER_COOLDOWN) return 0;
  const price = AIR_COST[A.Fighter];
  if (p.gold < price + AI_AIR_RESERVE / 2) return 0;
  const w = game.map.width;
  const { planes, boats } = traffic(game);
  let cost = 10;
  for (const u of boats) {
    if (u.dest !== p.id || game.friendly(u.owner, p.id)) continue;
    if (u.troops < Math.max(2_000, p.troops * 0.03)) continue;
    const f = airfieldFor(game, p, u.x, u.y);
    if (!f) continue;
    const tile = Math.floor(u.y) * w + Math.floor(u.x);
    if (f.d <= FIGHTER_RANGE) {
      if (launch(game, p, m, A.Fighter, tile)) {
        m.lastFighter = game.tick;
        return cost + 30;
      }
      continue;
    }
    // Beyond the fighters' reach (1.16): a bomber at a big invasion fleet, budget allowing.
    if (
      f.d <= BOMBER_RANGE &&
      u.troops >= Math.max(5_000, p.troops * 0.05) &&
      canPay(p, m, AIR_COST[A.Bomber], AI_AIR_RESERVE / 2) &&
      launch(game, p, m, A.Bomber, tile)
    ) {
      m.lastFighter = game.tick;
      return cost + 30;
    }
  }
  if (planes.length === 0) return cost;
  cost += planes.length;
  const fog = game.config.features.fog;
  for (const u of planes) {
    if (u.type !== U.Bomber || u.kind !== AIR_OUTBOUND || game.friendly(u.owner, p.id)) continue;
    const b = u.target >= 0 ? game.buildings.get(u.target) : undefined;
    // A bomber after a ship (units/air.ts: its id in `patrol`) threatens the ship's owner.
    const ship = u.patrol >= 0 ? unitById(game, u.patrol) : undefined;
    const victim = b ? b.owner : ship?.alive ? ship.owner : (game.owner[u.dest] ?? 0);
    if (victim !== p.id) continue;
    const seen = (tac.air >= 2 && !fog) || radarSees(game, p.id, u.x, u.y);
    if (!seen) continue;
    // Already covered: a fighter of ours over the target, or an interceptor that will rise.
    if (
      planes.some(
        (v) => v.owner === p.id && v.type === U.Fighter && (v.tx - u.tx) ** 2 + (v.ty - u.ty) ** 2 < 400,
      )
    )
      continue;
    let raid = 0;
    for (const v of planes)
      if (v.type === U.Bomber && v.kind === AIR_OUTBOUND && v.owner === u.owner && v.target === u.target)
        raid++;
    if (alertCovers(game, p, u.tx, u.ty) && !(tac.air >= 3 && raid >= 2)) continue;
    const f = airfieldFor(game, p, u.tx, u.ty);
    if (!f || f.d > FIGHTER_RANGE) continue;
    // In time: over the target before the bombs (or soon after, to catch it on its way home).
    const fighterEta = f.d / AIR_SPEED[A.Fighter];
    const bomberEta = Math.hypot(u.x - u.tx, u.y - u.ty) / AIR_SPEED[A.Bomber];
    if (fighterEta > bomberEta + 15) continue;
    if (launch(game, p, m, A.Fighter, Math.floor(u.ty) * w + Math.floor(u.tx))) {
      m.lastFighter = game.tick;
      return cost + 30;
    }
  }
  return cost;
}

/** Whether a loaded interceptor of p would rise against a bomber over (x, y). */
function alertCovers(game: Game, p: Player, x: number, y: number): boolean {
  let covered = false;
  game.grid.query(x, y, FIGHTER_RANGE, (id) => {
    if (covered) return;
    const f = game.buildings.get(id)!;
    if (f.type !== B.Airfield || f.owner !== p.id || !inService(f) || alertReady(f) < 0) return;
    const d = Math.hypot(f.x + 0.5 - x, f.y + 0.5 - y);
    if (d <= SCRAMBLE_SIGHT || (d <= FIGHTER_RANGE && radarSees(game, p.id, x, y))) covered = true;
  });
  return covered;
}

/** Whether interceptors of a country hostile to p would rise against a bomber over (x, y). */
function interceptorsAt(game: Game, p: Player, x: number, y: number): boolean {
  let found = false;
  game.grid.query(x, y, FIGHTER_RANGE, (id) => {
    if (found) return;
    const s = game.buildings.get(id)!;
    if (s.type !== B.Airfield || !inService(s) || game.friendly(s.owner, p.id) || alertReady(s) < 0) return;
    const d = Math.hypot(s.x - x, s.y - y);
    if (d <= (radarSees(game, s.owner, x, y) ? FIGHTER_RANGE : SCRAMBLE_SIGHT)) found = true;
  });
  return found;
}

// ------------------------------------------------------------------ raids
/** The country p fights: its offensive's target, its biggest attacker, the runaway, whoever bombed it. */
function enemyOf(game: Game, p: Player, ctx: AirContext): Player | null {
  let enemy = -1;
  for (const a of game.attacks)
    if (!a.done && a.attacker === p.id && a.target > 0 && game.players[a.target]!.kind !== 'tribe')
      enemy = a.target;
  if (enemy < 0) {
    let most = 0;
    for (const [att, troops] of ctx.incoming) {
      if (troops > most && game.players[att]?.kind !== 'tribe') {
        enemy = att;
        most = troops;
      }
    }
  }
  if (enemy < 0 && ctx.runaway > 0) enemy = ctx.runaway;
  if (enemy < 0) enemy = raider(game, p, AI_RETALIATION);
  // Between two offensives the war goes on: the country of the last one.
  if (enemy < 0) enemy = ctx.recentWar;
  const q = enemy > 0 ? game.players[enemy] : null;
  if (!q || !q.alive || game.friendly(p.id, q.id) || !game.attackAllowed(p.id, q.id, true)) return null;
  return q;
}

function strike(game: Game, p: Player, m: AirMem, ctx: AirContext): number {
  const tac = TACTICS[game.config.difficulty];
  const diff = game.difficulty();
  const w = game.map.width;
  const q = enemyOf(game, p, ctx);
  if (!q) return 0;
  let cost = 10;

  // Reconnaissance over the front of an offensive under way (cheaper losses there).
  const front = ctx.contact(q.id);
  if (
    tac.air >= 1 &&
    front >= 0 &&
    game.attacks.some((a) => !a.done && a.attacker === p.id && a.target === q.id) &&
    game.tick - (m.lastRecon ?? -10_000) > AI_RECON_COOLDOWN &&
    game.rng.chance(diff.targeting >= 0.9 ? 1 : 0.5) &&
    !spotted(game, p.id, (front % w) + 0.5, Math.floor(front / w) + 0.5) &&
    scout(game, p, m, front)
  )
    cost += 30;

  // Bombing raid.
  const every =
    (AI_RAID_COOLDOWN / Math.max(0.5, ctx.aggression * diff.aggression)) *
    (tac.air === 0 ? EASY_RAID_SLOWDOWN : 1);
  const bomber = AIR_COST[A.Bomber];
  if (game.tick - (m.lastRaid ?? -10_000) < every || (m.airCredit ?? 0) < bomber) return cost;
  m.lastRaid = game.tick;
  cost += 80;
  const fields: Building[] = [];
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === B.Airfield && inService(b)) fields.push(b);
  if (fields.length === 0) return cost;
  const nukes = game.config.allowNukes && p.buildingCount[B.Silo]! > 0;
  const sams: { b: Building; range: number }[] = [];
  for (const b of game.buildings.values())
    if (b.type === B.Sam && inService(b) && !game.friendly(b.owner, p.id))
      sams.push({ b, range: samRangeOf(game, b) });
  // Reconnaissance first (two levels a hit): always from hard, half the time on normal.
  const recon = tac.air >= 2 || (tac.air === 1 && game.rng.chance(0.5));
  let best: { tile: number; x: number; y: number } | null = null;
  let bestScore = 0;
  let bestNeed = 1;
  let bestEscort = false;
  /** Scores a raid at (x, y) worth `value` before the defences on the way. */
  const consider = (x: number, y: number, tile: number, value: number): void => {
    let f0: Building | null = null;
    let d0 = Infinity;
    for (const f of fields) {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < d0) [f0, d0] = [f, d];
    }
    if (!f0 || d0 > BOMBER_RANGE) return;
    // No raid through a volcanic ash cloud (world event): the flight would be refused.
    if (ashBlocks(game, f0.x + 0.5, f0.y + 0.5, x + 0.5, y + 0.5)) return;
    let score = value;
    // Defences on the way: every nation sees the SAMs guarding the target itself (one bomber
    // per loaded missile); the smart ones also those along the route and the interceptors.
    let need = 1;
    const smart = game.rng.chance(diff.targeting);
    for (const s of sams) {
      const d = smart ? segmentDist(s.b.x, s.b.y, f0.x, f0.y, x, y) : Math.hypot(s.b.x - x, s.b.y - y);
      if (d <= s.range) need += samMissilesReady(game, s.b);
    }
    let escort = false;
    if (smart && interceptorsAt(game, p, x, y)) {
      // An escort patrol over the target shoots the interceptors down (hard and up, within fighter reach).
      escort = tac.air >= 2 && d0 <= FIGHTER_RANGE;
      if (!escort) score *= 0.5;
    }
    if (recon && !spotted(game, p.id, x + 0.5, y + 0.5)) score *= 1.5;
    score = score / need + game.rng.next() * (1 - diff.targeting) * 3;
    if (score > bestScore) [best, bestScore, bestNeed, bestEscort] = [{ tile, x, y }, score, need, escort];
  };
  for (const b of game.buildings.values())
    if (b.owner === q.id) consider(b.x, b.y, b.tile, buildingValue(b, nukes));
  // Its fleet at sea (1.16, normal and up): invasion transports (the troops aboard go down
  // with them) and veteran warships, when they are worth a bomber.
  if (tac.air >= 1)
    for (const u of game.units) {
      if (!u.alive || u.owner !== q.id || !isShip(u.type)) continue;
      const value = shipValue(u, p);
      if (value <= 0) continue;
      consider(u.x - 0.5, u.y - 0.5, Math.floor(u.y) * w + Math.floor(u.x), value);
    }
  const aim = best as { tile: number; x: number; y: number } | null;
  if (!aim || bestScore < 1) return cost;
  // Emptying a SAM takes a bomber per loaded missile, plus the one that gets through.
  const most = tac.air >= 3 ? 4 : tac.air >= 1 ? 2 : 1;
  if (bestNeed > most) return cost;
  const bombers = bestNeed * bomber;
  if ((m.airCredit ?? 0) < bombers) return cost;
  if (p.gold - AI_AIR_RESERVE < bombers) {
    // Worth it but not affordable yet: the nation saves for it (TACTICS.warChest).
    if (tac.warChest) m.raidFund = [bombers + AI_AIR_RESERVE, game.tick + AI_RAID_FUND_TICKS];
    return cost;
  }
  m.raidFund = undefined;
  // Reconnaissance (faster) and the escort (faster still) take off first and get there before
  // the bombers — when the treasury allows them on top of the bombers.
  let spare = p.gold - AI_AIR_RESERVE - bombers;
  if (bestEscort && spare >= AIR_COST[A.Fighter] && launch(game, p, m, A.Fighter, aim.tile))
    spare -= AIR_COST[A.Fighter];
  if (recon && spare >= AIR_COST[A.Recon] && !spotted(game, p.id, aim.x + 0.5, aim.y + 0.5))
    scout(game, p, m, aim.tile);
  for (let k = 0; k < bestNeed; k++) launch(game, p, m, A.Bomber, aim.tile);
  return cost + 40;
}

/** What a raid on b is worth (before the defences). */
function buildingValue(b: Building, nukes: boolean): number {
  switch (b.type) {
    case B.Sam:
      return nukes ? 6 : 2;
    case B.Silo:
      return 4 + b.level;
    case B.Airfield:
      return 4;
    case B.City:
      return 2 + 0.6 * b.level;
    case B.Lab:
      return 2.5;
    case B.Factory:
    case B.Port:
      return 1.5 + 0.3 * b.level;
    default:
      return 1;
  }
}

/**
 * What a raid on ship u is worth to p (0: not worth a bomber): an invasion transport by the
 * troops it carries (more when it sails for p's coast), a veteran warship; a trade ship or a
 * small transport never (a bomber costs more than it would sink).
 */
function shipValue(u: Unit, p: Player): number {
  if (u.type === U.Transport) {
    const big = u.troops >= Math.max(15_000, p.troops * 0.04);
    if (u.dest !== p.id && !big) return 0;
    return Math.min(6, 1.5 + u.troops / 20_000) * (u.dest === p.id ? 1.5 : 1);
  }
  if (u.type === U.Warship) return u.kills >= 2 ? 1 + Math.min(1.5, u.kills * 0.2) : 0;
  return 0;
}

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - ax - k * dx, py - ay - k * dy);
}

/** Gold a nation is saving for a raid (0: none, or the plan expired). */
export function raidSavings(game: Game, m: AirMem): number {
  const f = m.raidFund;
  return f && f[1] > game.tick ? f[0] : 0;
}
