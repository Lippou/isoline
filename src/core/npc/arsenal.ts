// The nations' strategic weapons and war chest (GAME_DESIGN.md §10, §13.2).
// - War chest (normal and up, TACTICS.warChest): what a nation's war needs and the economy
//   would never leave gold for — SAM batteries once threatened from the sky, an airfield and
//   a radar once at war, silos, a raid, a hydrogen bomb or a MIRV — is saved for: the gold is
//   kept back from cities, ports, factories, research centres and warships until it is bought.
// - Bombs (OpenFront's NationNukeBehavior / NationMIRVBehavior, by TACTICS.bombs): atom bombs
//   as before (revenge, the runaway, grudges, the leader); hydrogen bombs when affordable on a
//   target worth it (a third of the nations, the « hydro nations », save for them from hard);
//   from hard, a reconnaissance plane over the target first when an airfield reaches it (the
//   strike follows once the zone is spotted: SAM avoidance and arc then never miss); MIRVs at
//   a country about to win (TACTICS.mirvDenial of the current victory threshold's share) or
//   at whoever sends a MIRV at us, one decision in TACTICS.mirvHesitation dropped.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import { B, N, NUKE_COST, NUKE_RADIUS, NUKE_SPEED, RECON_RANGE } from '../game/constants';
import { applyCommand } from '../game/commands';
import { buildCost, levelsOwned } from '../buildings/buildings';
import { inService } from '../buildings/building';
import {
  hostileSams,
  launchSilo,
  maxLaunchable,
  nukeCost,
  samMissilesReady,
  samRangeOf,
} from '../units/nukes';
import { ARC_DOWN, ARC_UP, Trajectory, predictInterception } from '../units/trajectory';
import { airfieldFor, spotted } from '../units/air';
import { U } from '../units/unit';
import { buildingLock, nukeLock } from '../rules/tech';
import { currentThreshold, doomStage } from '../rules/victory';
import { hash2 } from '../rng';
import { TACTICS } from './tactics';
import { raidSavings, raider, scout, type AirMem } from './airpower';
import { runawayOf, solo } from './threat';

export interface ArsenalMem extends AirMem {
  lastNuke: number;
  grudge: Map<number, number>;
  /** A strike waiting for its reconnaissance: [target tile, bomb kind, tick it is given up]. */
  strike?: [tile: number, kind: number, until: number];
}

/** A strike waits at most this long (ticks) for its reconnaissance plane. */
const AI_STRIKE_WAIT = 150;
/** A hydrogen bomb is worth it on this many enemy building levels inside its blast, at least. */
const AI_HYDROGEN_LEVELS = 6;
/** Saving for a bomb starts once this share of its price is in the treasury (else the economy comes first). */
const AI_BOMB_SAVING = { hydrogen: 0.2, mirv: 0.4 } as const;
/** Gold kept back for a building the war needs, at most. */
const AI_WISH_CAP = 3_000_000;

/** One nation in three throws hydrogen bombs rather than atom bombs (OpenFront), from hard. */
export function hydroNation(game: Game, p: Player): boolean {
  return TACTICS[game.config.difficulty].bombs >= 2 && hash2(p.id, 7, game.config.seed) % 3 === 0;
}

// ------------------------------------------------------------------ war chest
export interface WarState {
  /** Being attacked, fighting the runaway, or an offensive against a country lately. */
  atWar: boolean;
  /** Countries p fights (attackers, targets, the runaway). */
  enemies: Set<number>;
  /** The personality's taste for nukes (TRAITS.nukes) and aggression. */
  nukes: number;
  aggression: number;
}

/** What a nation saves for: a building to buy first, and the gold kept back from everything else. */
export interface Wish {
  build: B | -1;
  reserve: number;
  /** The reserve is for a bomb (hydrogen or MIRV): the nuclear think may spend it. */
  bomb?: boolean;
}

/** Whether p is threatened from the sky: nuked, bombed, or (hard and up) fighting a country with silos. */
export function skyThreat(game: Game, p: Player, war: WarState): 'nuke' | 'raid' | 'silos' | null {
  if (game.ai.nukedBy.has(p.id)) return 'nuke';
  if (raider(game, p, 3000) > 0) return 'raid';
  if (TACTICS[game.config.difficulty].bombs >= 2)
    for (const id of war.enemies) if ((game.players[id]?.buildingCount[B.Silo] ?? 0) > 0) return 'silos';
  return null;
}

/** SAM levels a threatened nation wants (OpenFront's ratio per city; one on normal, two from hard). */
export function samsWanted(game: Game, p: Player): number {
  const tac = TACTICS[game.config.difficulty];
  return Math.max(1, Math.min(tac.bombs, Math.round(p.buildingCount[B.City]! * tac.samPerCity)));
}

/** Airfield levels a nation at war wants: one, two after a raid or for an aggressive one from hard. */
export function airfieldsWanted(game: Game, p: Player, war: WarState): number {
  const tac = TACTICS[game.config.difficulty];
  if (!war.atWar || tac.air < 1) return 0;
  return raider(game, p, 6000) > 0 || (tac.air >= 2 && war.aggression > 1) ? 2 : 1;
}

/**
 * Silo levels a nation saves for (hard and up): one after a nuclear strike or against the
 * runaway it fights (OpenFront nukes its crown), two for a nation fond of nukes. Elsewhere
 * silos stay an opportunistic purchase (tryBuild), as before. (Three against the runaway
 * left impossible games without a winner: every coalition member nuked the leader down.)
 */
export function silosWanted(game: Game, p: Player, war: WarState): number {
  const tac = TACTICS[game.config.difficulty];
  if (tac.bombs < 2 || p.buildingCount[B.City]! < 3) return 0;
  const runaway = runawayOf(game);
  const crown = runaway > 0 && runaway !== p.id && tac.crownNukes && war.enemies.has(runaway);
  if (crown || game.ai.nukedBy.has(p.id)) return war.nukes > 1 ? 2 : 1;
  return 0;
}

const unlocked = (game: Game, p: Player, b: B) => buildingLock(game, p, b) < 0;

/**
 * The war chest (normal and up): the most urgent purchase the war needs, and the gold kept
 * back for it. SAMs under a threat from the sky, the airfield, the radar (after a raid, or from
 * hard when the enemy flies), silos, then a raid or a bomb waiting for gold.
 */
export function warWish(game: Game, p: Player, m: ArsenalMem, war: WarState): Wish {
  const none: Wish = { build: -1, reserve: 0 };
  const tac = TACTICS[game.config.difficulty];
  if (!tac.warChest) return none;
  const cfg = game.config;
  const want = (b: B): Wish => ({ build: b, reserve: Math.min(AI_WISH_CAP, buildCost(game, p, b)) });
  const threat = skyThreat(game, p, war);
  if (threat && (cfg.allowNukes || cfg.features.air) && unlocked(game, p, B.Sam))
    if (threat !== 'raid' || p.buildingCount[B.Sam] === 0)
      if (levelsOwned(game, p, B.Sam) < samsWanted(game, p)) return want(B.Sam);
  if (
    cfg.features.air &&
    unlocked(game, p, B.Airfield) &&
    levelsOwned(game, p, B.Airfield) < airfieldsWanted(game, p, war)
  )
    return want(B.Airfield);
  if (
    cfg.features.radar &&
    p.buildingCount[B.Airfield]! > 0 &&
    p.buildingCount[B.Radar] === 0 &&
    unlocked(game, p, B.Radar)
  ) {
    let enemyFlies = false;
    for (const id of war.enemies)
      if ((game.players[id]?.buildingCount[B.Airfield] ?? 0) > 0) enemyFlies = true;
    if (raider(game, p, 3000) > 0 || (tac.air >= 2 && enemyFlies)) return want(B.Radar);
  }
  if (cfg.allowNukes && unlocked(game, p, B.Silo) && levelsOwned(game, p, B.Silo) < silosWanted(game, p, war))
    return want(B.Silo);
  const raid = raidSavings(game, m);
  if (raid > 0) return { build: -1, reserve: raid };
  const bomb = bombSavings(game, p, war);
  if (bomb > 0) return { build: -1, reserve: bomb, bomb: true };
  return none;
}

/** Gold kept for a hydrogen bomb (hydro nations) or a MIRV (victory denial), once within reach. */
function bombSavings(game: Game, p: Player, war: WarState): number {
  const tac = TACTICS[game.config.difficulty];
  if (tac.bombs < 2 || !game.config.allowNukes || p.buildingCount[B.Silo] === 0) return 0;
  if (nukeLock(game, p, N.Mirv) < 0) {
    const c = nukeCost(game, p, N.Mirv);
    if (p.gold >= c * AI_BOMB_SAVING.mirv && denialTarget(game, p) > 0) return c;
  }
  if (hydroNation(game, p) && war.atWar && nukeLock(game, p, N.Hydrogen) < 0) {
    const c = nukeCost(game, p, N.Hydrogen);
    if (p.gold >= c * AI_BOMB_SAVING.hydrogen) return c;
  }
  return 0;
}

// ------------------------------------------------------------------ bombs
/** The country about to win that p should deny with a MIRV (hard and up), -1 none. */
export function denialTarget(game: Game, p: Player): number {
  const tac = TACTICS[game.config.difficulty];
  if (tac.mirvDenial <= 0) return -1;
  // Whoever sends a MIRV at us gets one back (OpenFront's counter-MIRV).
  for (const u of game.units)
    if (u.alive && u.type === U.Nuke && u.kind === N.Mirv && u.owner !== p.id && game.owner[u.dest] === p.id)
      return u.owner;
  const th = currentThreshold(game);
  if (th > 100) return -1;
  // Victory denial: TACTICS.mirvDenial of the threshold in force (80 % → 55 % hard, 40 % impossible).
  const bar = (th / 100) * (tac.mirvDenial / 0.8);
  const total = Math.max(1, game.usefulLand);
  const team = new Map<number, number>();
  let leader: Player | null = null;
  for (const q of game.alivePlayers()) {
    if (q.kind === 'tribe') continue;
    if (q.team > 0) team.set(q.team, (team.get(q.team) ?? 0) + q.usefulTiles);
    if (!leader || q.usefulTiles > leader.usefulTiles) leader = q;
  }
  if (!leader || leader.id === p.id || game.friendly(p.id, leader.id) || p.allies.has(leader.id)) return -1;
  const land = leader.team > 0 && !solo(game) ? team.get(leader.team)! : leader.usefulTiles;
  return land / total >= bar && game.attackAllowed(p.id, leader.id, true) ? leader.id : -1;
}

/** Smart AIs flip the arc when the default one flies into an enemy SAM and the other doesn't. */
function arcAvoidingSams(game: Game, p: Player, kind: N, tile: number, smart: number): boolean {
  const silo = launchSilo(game, p, tile);
  if (!silo || !game.rng.chance(smart)) return true;
  const sams = hostileSams(game, p);
  const w = game.map.width;
  const [sx, sy, tx, ty] = [silo.x + 0.5, silo.y + 0.5, (tile % w) + 0.5, ((tile / w) | 0) + 0.5];
  const caught = (arc: number) =>
    predictInterception(
      new Trajectory(sx, sy, tx, ty, arc, game.map.height),
      tx,
      ty,
      NUKE_SPEED[kind],
      sams,
    ) >= 0;
  return !(caught(ARC_UP) && !caught(ARC_DOWN));
}

export interface NukeContext {
  /** The personality's taste for nukes (TRAITS.nukes). */
  nukes: number;
  /** The leader and runner-up by land (doomsday). */
  leader: number;
  runnerUp: number;
  /** Gold the war chest keeps for something else (revenge alone spends it). */
  reserve: number;
}

/** Enemy building levels inside a blast of `kind` at (x, y). */
function levelsUnder(game: Game, enemy: number, x: number, y: number, kind: N): number {
  const r = NUKE_RADIUS[kind];
  let n = 0;
  game.grid.query(x, y, r, (id) => {
    const b = game.buildings.get(id)!;
    if (b.owner === enemy && Math.hypot(b.x - x, b.y - y) <= r) n += b.level;
  });
  return n;
}

/** A nation's nuclear think (silos owned). Returns its work cost. */
export function tryNuke(game: Game, p: Player, m: ArsenalMem, ctx: NukeContext): number {
  if (p.buildingCount[B.Silo] === 0) return 0;
  const diff = game.difficulty();
  const tac = TACTICS[game.config.difficulty];
  // A strike waiting for its reconnaissance: once the zone is spotted (or the wait is over).
  if (m.strike) {
    const [tile, kind, until] = m.strike;
    const w = game.map.width;
    const seen = spotted(game, p.id, (tile % w) + 0.5, ((tile / w) | 0) + 0.5);
    if (!seen && game.tick < until) return 10;
    m.strike = undefined;
    const enemy = game.owner[tile]!;
    if (
      enemy > 0 &&
      enemy !== p.id &&
      game.attackAllowed(p.id, enemy, true) &&
      maxLaunchable(game, p, kind) > 0
    ) {
      fire(game, p, m, kind as N, tile, seen ? 1 : diff.targeting);
      return 120;
    }
  }
  // MIRV (hard and up): deny a victory, answer a MIRV.
  const denial = denialTarget(game, p);
  if (
    denial > 0 &&
    maxLaunchable(game, p, N.Mirv) > 0 &&
    !(tac.mirvHesitation > 0 && game.rng.chance(1 / tac.mirvHesitation))
  ) {
    // Warheads rain on the whole country: any tile of it will do (its capital, else its border).
    const q = game.players[denial]!;
    const tile = q.capital >= 0 && game.owner[q.capital] === q.id ? q.capital : q.border[0];
    if (tile !== undefined) {
      applyCommand(game, p.id, { t: 'nuke', kind: N.Mirv, tile, count: 1, up: true });
      m.lastNuke = game.tick;
      return 120;
    }
  }
  // Who deserves it? Revenge first, then the biggest grudge, then the leader (warmongers).
  let enemy = -1;
  for (const [victim, by] of game.ai.nukedBy) if (victim === p.id && game.players[by]?.alive) enemy = by;
  const revenge = enemy > 0;
  // Hard and up: the runaway leader (OpenFront nukes its crown), before old grudges.
  const runaway = runawayOf(game);
  if (enemy < 0 && runaway > 0 && runaway !== p.id && !p.allies.has(runaway) && tac.crownNukes)
    enemy = runaway;
  if (enemy < 0) {
    let g = 8 / ctx.nukes;
    for (const [id, v] of m.grudge) {
      if (v > g && game.players[id]?.alive && !p.allies.has(id)) {
        g = v;
        enemy = id;
      }
    }
  }
  if (enemy < 0 && ctx.nukes > 1.2 && game.tick - game.startTick > 9000) {
    if (ctx.leader !== p.id && ctx.leader > 0 && !p.allies.has(ctx.leader)) enemy = ctx.leader;
  }
  // Doomsday, from the rationing on: the leader strikes its nearest rival (each blast brings
  // midnight, and its victory, closer); the others strike the leader.
  if (enemy < 0 && doomStage(game) >= 2) {
    const target = ctx.leader === p.id ? ctx.runnerUp : ctx.leader;
    if (target > 0 && !p.allies.has(target)) enemy = target;
  }
  if (enemy < 0 || !game.attackAllowed(p.id, enemy, true)) return 10;
  if (maxLaunchable(game, p, N.Atom) === 0 && maxLaunchable(game, p, N.Hydrogen) === 0) return 10;
  // Target quality: densest cluster of enemy cities/silos (difficulty-dependent accuracy).
  let best = -1;
  let bestScore = -1;
  let bx = 0;
  let by = 0;
  for (const b of game.buildings.values()) {
    if (b.owner !== enemy) continue;
    let score =
      b.type === B.Silo
        ? 6
        : b.type === B.City
          ? 3 + b.level
          : b.type === B.Factory || b.type === B.Port
            ? 2
            : 1;
    // Avoid SAM-covered targets when the AI is smart enough.
    if (game.rng.chance(diff.targeting)) {
      game.grid.query(b.x, b.y, 140, (id) => {
        const s = game.buildings.get(id)!;
        if (
          s.type === B.Sam &&
          s.owner === enemy &&
          inService(s) &&
          Math.hypot(s.x - b.x, s.y - b.y) < samRangeOf(game, s)
        )
          score *= 0.4;
      });
    }
    score += game.rng.next() * (1 - diff.targeting) * 4;
    if (score > bestScore) [best, bestScore, bx, by] = [b.tile, score, b.x, b.y];
  }
  if (best < 0) {
    const q = game.players[enemy]!;
    if (q.border.length === 0) return 10;
    best = q.border[game.rng.int(0, q.border.length - 1)]!;
    bx = best % game.map.width;
    by = (best / game.map.width) | 0;
  }
  // The bomb: a hydrogen bomb on a target worth it, when affordable (as before: with half its
  // price to spare; a hydro nation from hard as soon as it can pay it); else atom bombs.
  const hCost = nukeCost(game, p, N.Hydrogen);
  const hWorth = tac.bombs >= 1 && levelsUnder(game, enemy, bx, by, N.Hydrogen) >= AI_HYDROGEN_LEVELS;
  const hydro =
    maxLaunchable(game, p, N.Hydrogen) > 0 &&
    (p.gold > hCost * 1.5 || (hWorth && (hydroNation(game, p) || p.gold > hCost + NUKE_COST[N.Atom])));
  const kind = hydro ? N.Hydrogen : N.Atom;
  if (maxLaunchable(game, p, kind) === 0) return 10;
  // The war chest's gold is kept for what it saves for, unless it is this very bomb, or revenge.
  if (!revenge && p.gold - ctx.reserve < nukeCost(game, p, kind)) return 10;
  // From hard: a reconnaissance plane over the target first (the strike waits for it).
  if (tac.bombs >= 2 && game.config.features.air) {
    const f = airfieldFor(game, p, bx + 0.5, by + 0.5);
    if (f && f.d <= RECON_RANGE && !spotted(game, p.id, bx + 0.5, by + 0.5) && scout(game, p, m, best)) {
      m.strike = [best, kind, game.tick + AI_STRIKE_WAIT];
      m.lastNuke = game.tick;
      return 60;
    }
  }
  fire(game, p, m, kind, best, diff.targeting);
  return 120;
}

/**
 * Launches at `tile`. Atom bombs go by three (as before) on easy; from normal a nation that
 * reads the defences (the targeting roll, certain once the zone is spotted) sends one bomb
 * per loaded SAM missile covering the target, plus the one that gets through, up to three.
 */
function fire(game: Game, p: Player, m: ArsenalMem, kind: N, tile: number, smart: number): void {
  let count = 1;
  if (kind === N.Atom) {
    count = 3;
    if (TACTICS[game.config.difficulty].bombs >= 1 && game.rng.chance(smart)) {
      const w = game.map.width;
      const tx = tile % w;
      const ty = (tile / w) | 0;
      let missiles = 0;
      game.grid.query(tx, ty, 110, (id) => {
        const s = game.buildings.get(id)!;
        if (
          s.type === B.Sam &&
          inService(s) &&
          !game.friendly(s.owner, p.id) &&
          Math.hypot(s.x - tx, s.y - ty) <= samRangeOf(game, s)
        )
          missiles += samMissilesReady(game, s);
      });
      count = Math.min(3, 1 + missiles);
    }
    count = Math.min(count, maxLaunchable(game, p, kind));
  }
  applyCommand(game, p.id, { t: 'nuke', kind, tile, count, up: arcAvoidingSams(game, p, kind, tile, smart) });
  m.lastNuke = game.tick;
}
