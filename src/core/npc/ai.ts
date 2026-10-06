// Automated nations and tribes. Runs inside the deterministic simulation:
// every decision uses game.rng and a deterministic work budget (no wall clock),
// so all lockstep peers compute identical AI behaviour.
import type { Game } from '../game/state';
import type { Difficulty } from '../game/config';
import type { Player, Personality } from '../game/player';
import { applyCommand } from '../game/commands';
import {
  B,
  CAPITAL_MOVE_COST,
  LINE_MAX_PER_PLAYER,
  LINE_DEFENSE_SETUP,
  LINE_BREAK_RATIO,
  LINE_OFFENSE_SETUP,
  LINE_REACH,
  MIN_BUILDING_SPACING,
  RELATION_HOSTILE,
  REVOLUTION_PUSH_CHANCE,
  samRange,
} from '../game/constants';
import { HABITABLE, IS_LAND } from '../map/terrain';
import { MAX_LEVEL, buildCost, checkPlacement, levelsOwned } from '../buildings/buildings';
import { planBoat } from '../units/ships';
import { samRangeOf } from '../units/nukes';
import { pathLength } from '../map/nav';
import { castVote } from '../rules/features';
import { NATION_RESEARCH, isResearched, lockFor, planGoal, techId, techSam } from '../rules/tech';
import { maxTroops } from '../game/economy';
import type { Building } from '../buildings/building';
import { doomStage, doomSurvivalShare, outsideNextZone, shares } from '../rules/victory';
import { bestCapitalSpot, capitalCooldown, frontDistance } from '../rules/capital';
import { TACTICS, type Tactics } from './tactics';
import {
  assessThreats,
  frontsOf,
  joinsCoalition,
  runawayOf,
  striking,
  untilStrike,
  type ThreatState,
} from './threat';
import { thinkNavy } from './navy';
import { AI_RAID_MEMORY, raider, thinkAir } from './airpower';
import { skyThreat, tryNuke, warWish, type ArsenalMem, type WarState, type Wish } from './arsenal';
import { thinkGeneral } from './generals';
import { barricadesUp, guerrilla, nextSpread } from '../rules/revolution';
import { LineKind, lineAcross, linesOf, locate } from '../rules/lines';

/** A nation's memory (part of the AI state, hence of saves; the air force's and the arsenal's included). */
interface Mem extends ArsenalMem {
  nextThink: number;
  lastAttack: number;
  /** Last offensive against another player (wars are deliberate, not continuous). */
  lastWar: number;
  lastBoat: number;
  lastBuild: number;
  lastDiplo: number;
  pendingAnswers: Map<number, number>; // requester → tick to answer
  /** Ally whose alliance is left to lapse (boxed in by allies with an idle army), -1 none. */
  prey?: number;
  /** Who took our cities, and when (1.12: a city is worth taking back). */
  took?: Map<number, number>;
  /** Each attacker's biggest wave at us and when it last pressed (1.12: a spent wave is answered). */
  waves?: Map<number, [peak: number, tick: number]>;
  /** Start of the last coalition strike window joined (one strike per window). */
  lastStrike?: number;
  /** Last look at the capital's safety (moving it is weighed at most every AI_CAPITAL_CHECK ticks). */
  lastCapital?: number;
}

export interface AIState {
  mem: Map<number, Mem>;
  nukedBy: Map<number, number>; // victim → last attacker
  /** Victim of a bombing raid → its last raider and when (units/air.ts). */
  raidedBy: Map<number, [by: number, tick: number]>;
  cursor: number;
  /** Shared threat picture: growth, fronts, the runaway and the coalition's strikes (threat.ts; absent before 1.12). */
  threat?: ThreatState;
}

export function createAIState(): AIState {
  return { mem: new Map(), nukedBy: new Map(), raidedBy: new Map(), cursor: 1 };
}

interface Traits {
  aggression: number; // propensity to attack
  attackFactor: number; // required strength ratio
  build: number;
  trade: number;
  diplomacy: number;
  nukes: number;
  naval: number;
  /** Research centre levels wanted per city level. */
  research: number;
}

const TRAITS: Record<Personality, Traits> = {
  expansionist: {
    aggression: 1.2,
    attackFactor: 1.0,
    build: 0.8,
    trade: 0.6,
    diplomacy: 0.5,
    nukes: 0.6,
    naval: 0.6,
    research: 0.3,
  },
  builder: {
    aggression: 0.7,
    attackFactor: 1.4,
    build: 1.5,
    trade: 1.0,
    diplomacy: 0.8,
    nukes: 0.5,
    naval: 0.6,
    research: 0.55,
  },
  merchant: {
    aggression: 0.6,
    attackFactor: 1.5,
    build: 1.1,
    trade: 1.6,
    diplomacy: 1.0,
    nukes: 0.4,
    naval: 1.3,
    research: 0.45,
  },
  diplomat: {
    aggression: 0.6,
    attackFactor: 1.3,
    build: 1.0,
    trade: 1.1,
    diplomacy: 1.8,
    nukes: 0.3,
    naval: 0.8,
    research: 0.5,
  },
  isolationist: {
    aggression: 0.5,
    attackFactor: 1.6,
    build: 1.2,
    trade: 0.5,
    diplomacy: 0.4,
    nukes: 0.8,
    naval: 1.0,
    research: 0.5,
  },
  warmonger: {
    aggression: 1.6,
    attackFactor: 0.85,
    build: 0.7,
    trade: 0.4,
    diplomacy: 0.3,
    nukes: 1.5,
    naval: 1.0,
    research: 0.35,
  },
};

/** Research centre wishes × difficulty: harder nations invest more in research. */
const AI_RESEARCH = { easy: 0.8, normal: 1, hard: 1.15, impossible: 1.3 } as const;

const NB = new Int32Array(4);
/** Nations think every 3–6 s (× difficulty): a measured, management-heavy pace. */
const AI_THINK_MIN = 30;
const AI_THINK_MAX = 60;
/**
 * Minimum delay between two expansion orders, and between two wars, in ticks. With
 * OpenFront's combat (fronts ~2.5× faster than Isoline's former ones) wars are spaced a
 * little more to keep AI games around 25–60 min (100 s; 130 s before the troop ceilings were
 * lowered: smaller armies take less land per offensive); an idle army shortens it by
 * AI_WAR_IDLE_SPEEDUP.
 */
const AI_EXPAND_COOLDOWN = 40;
const AI_WAR_COOLDOWN = 1000;
const AI_WAR_IDLE_SPEEDUP = 1.5;
const AI_BUILD_COOLDOWN = 120;
/** Extra strength a nation wants over its target before declaring war. */
const AI_STRENGTH_MARGIN = 1.0;
/** Troops above this share of the ceiling barely regenerate: even peaceful nations use them. */
const AI_IDLE_ARMY = 0.85;
/** Nations attack a neighbouring traitor with fewer troops than this many times theirs (OpenFront). */
const AI_TRAITOR_MARGIN = 1.2;
/** Nations turn down 90 % of a traitor's alliance requests (OpenFront). */
const AI_TRAITOR_REFUSAL = 0.9;
/** Goodwill (positive relation) adds this much acceptance per point (+60 → +0.24). */
const AI_GOODWILL_ODDS = 0.004;
/** Nations never stab an ally they feel this friendly towards (OpenFront's « Friendly »). */
const AI_FRIENDLY = 50;
/**
 * An offensive's size, as a share of the target's army. With OpenFront's losses an attack
 * as big as the defender's whole army sweeps it away; nations bite instead (a fifth to a
 * quarter of the land per offensive), so that wars last several offensives. Three quarters
 * since the troop ceilings were lowered (half before): per-tile losses do not shrink with
 * the armies, so the same share of the target's army took less land.
 */
const AI_BITE = 0.75;
/** A city taken by a country is remembered this long (ticks): it is fought sooner. */
const AI_RETAKE_MEMORY = 3000;
/** Acceptance added between two partners of the coalition against the runaway. */
const AI_COALITION_ODDS = 0.3;
/** Ticks between two looks at the capital's safety. */
const AI_CAPITAL_CHECK = 300;
/** A nation moves its capital only with this many times the price in its treasury. */
const AI_CAPITAL_GOLD_MARGIN = 1.5;
/**
 * Front lines (rules/lines.ts): half-length and depth behind the border of a line laid
 * across an enemy's way, the army's share on a defensive (offensive) line, and how long one
 * stays before coming down when idle.
 */
const AI_LINE_HALF = 14;
const AI_LINE_BACK = 5;
const AI_LINE_RATIO = 0.12;
const AI_OFFENSE_LINE_RATIO = 0.12;
const AI_LINE_KEEP = 3000;
/** A wave is spent once the troops still pressing fall under this share of its peak. */
const AI_SPENT_WAVE = 0.3;
/** Coalition strikes: the members stop starting other ventures this long before one (ticks)… */
const AI_STRIKE_SAVING = 200;
/** Ticks between two nuclear thinks (÷ the personality's taste for nukes; doubled from normal). */
const AI_NUKE_COOLDOWN = 300;
/** A wave is forgotten this long (ticks) after it last pressed. */
const AI_WAVE_MEMORY = 600;
/**
 * War research (normal and up, at war; prerequisites on the way): attack speed and losses
 * first, then SAM batteries, Combined arms, Aerospace (airfields), Blitzkrieg, silos, radar.
 * From hard, silos and Aerospace come before Combined arms: before 1.12.1 the whole military
 * branch came first, and Aerospace (reached through Blitzkrieg) arrived 20 to 35 minutes in,
 * when most AI games were nearly over — and silos later still (no hard nation had one).
 */
const WAR_RESEARCH: Record<'normal' | 'hard', readonly string[]> = {
  normal: [
    'military.1',
    'military.2',
    'defense.1',
    'military.3',
    'industry.3',
    'military.4',
    'nuclear.2',
    'defense.2',
    'military.5',
  ],
  hard: [
    'military.1',
    'military.2',
    'defense.1',
    'industry.3',
    'nuclear.2',
    'military.3',
    'defense.2',
    'military.4',
    'nuclear.3',
    'military.5',
  ],
};

function mem(game: Game, p: Player): Mem {
  let m = game.ai.mem.get(p.id);
  if (!m) {
    m = {
      nextThink: game.tick + game.rng.int(0, 20),
      lastAttack: -1000,
      lastWar: -1000,
      lastBoat: -1000,
      lastBuild: -1000,
      lastNuke: -10_000,
      lastDiplo: -1000,
      grudge: new Map(),
      pendingAnswers: new Map(),
    };
    game.ai.mem.set(p.id, m);
  }
  return m;
}

export function updateAI(game: Game): void {
  if (game.phase !== 'playing') return;
  const diff = game.difficulty();
  assessThreats(game);
  noteCaptures(game);
  // Deterministic work budget: each think costs units; stop when exhausted.
  let budget = game.aiBudget;
  const n = game.players.length;
  for (let k = 1; k < n && budget > 0; k++) {
    const id = ((game.ai.cursor + k - 1) % (n - 1)) + 1;
    const p = game.players[id]!;
    if (!p.alive || p.kind === 'human') continue;
    const m = mem(game, p);
    if (game.tick < m.nextThink) continue;
    if (p.kind === 'tribe') {
      budget -= thinkTribe(game, p, m);
      m.nextThink = game.tick + game.rng.int(40, 70);
    } else {
      budget -= thinkNation(game, p, m);
      m.nextThink = game.tick + Math.round(game.rng.int(AI_THINK_MIN, AI_THINK_MAX) * diff.think);
    }
    game.ai.cursor = id;
  }
}

/** Cities taken this tick: their former owners remember who took them (Mem.took). */
function noteCaptures(game: Game): void {
  const w = game.map.width;
  for (const e of game.events) {
    if (e.k !== 'capture') continue;
    const bid = game.buildingAt[Math.floor(e.y) * w + Math.floor(e.x)] ?? -1;
    const b = bid >= 0 ? game.buildings.get(bid) : undefined;
    if (!b || b.type !== B.City || b.owner !== e.by) continue;
    const victim = game.players[e.owner];
    if (!victim || victim.kind !== 'nation' || !victim.alive) continue;
    const m = game.ai.mem.get(victim.id);
    if (!m) continue;
    (m.took ??= new Map()).set(e.by, game.tick);
  }
}

// ------------------------------------------------------------ perception
interface Neighbor {
  id: number;
  contact: number;
  tile: number;
}

/** Sample border tiles to find adjacent owners (0 = wilderness). Cost ≈ samples. */
function neighbors(game: Game, p: Player, samples: number): Map<number, Neighbor> {
  const out = new Map<number, Neighbor>();
  const border = p.border;
  if (border.length === 0) return out;
  const step = Math.max(1, Math.floor(border.length / samples));
  const offset = game.rng.int(0, step - 1);
  for (let k = offset; k < border.length; k += step) {
    const t = border[k]!;
    const c = game.map.neighbors4(t, NB);
    for (let j = 0; j < c; j++) {
      const v = NB[j]!;
      const o = game.owner[v]!;
      // Battle royale: land the zone is about to leave is worth nothing.
      if (o === p.id || !IS_LAND[game.map.terrain[v]!] || game.isDead(v) || outsideNextZone(game, v))
        continue;
      const e = out.get(o);
      if (e) e.contact++;
      else out.set(o, { id: o, contact: 1, tile: v });
    }
  }
  return out;
}

function incomingAttacks(game: Game, p: Player): Map<number, number> {
  const m = new Map<number, number>();
  for (const a of game.attacks)
    if (!a.done && a.target === p.id) m.set(a.attacker, (m.get(a.attacker) ?? 0) + a.troops);
  return m;
}

/** Troop ceiling (refreshed every tick by the economy). */
function troopCap(game: Game, p: Player): number {
  return p.popCap > 0 ? p.popCap : maxTroops(game, p);
}

function hasAttack(game: Game, p: Player, target: number): boolean {
  return game.attacks.some((a) => !a.done && a.attacker === p.id && a.target === target);
}

// ------------------------------------------------------------------ tribes
function thinkTribe(game: Game, p: Player, m: Mem): number {
  const nb = neighbors(game, p, 24);
  if (p.revolution) return thinkRebels(game, p, m, nb);
  const cap = troopCap(game, p);
  // OpenFront's tribes fall on a neighbouring traitor, one think in three.
  const traitors = [...nb.values()].filter(
    (n) => n.id > 0 && game.players[n.id]!.isTraitor(game.tick) && game.attackAllowed(p.id, n.id, true),
  );
  if (traitors.length > 0 && game.rng.chance(1 / 3)) {
    applyCommand(game, p.id, {
      t: 'attack',
      tile: traitors[game.rng.int(0, traitors.length - 1)]!.tile,
      ratio: 0.25,
    });
    m.lastAttack = game.tick;
    return 30;
  }
  if (nb.has(0) && !hasAttack(game, p, 0) && p.troops > cap * 0.25) {
    applyCommand(game, p.id, { t: 'attack', tile: nb.get(0)!.tile, ratio: 0.12 });
    m.lastAttack = game.tick;
  } else if (game.rng.chance(0.08)) {
    // Occasionally raid a weaker non-human neighbour.
    for (const n of nb.values()) {
      if (n.id === 0) continue;
      const q = game.players[n.id]!;
      if (q.kind !== 'human' && q.troops < p.troops * 0.5 && game.attackAllowed(p.id, q.id, true)) {
        applyCommand(game, p.id, { t: 'attack', tile: n.tile, ratio: 0.25 });
        break;
      }
    }
  }
  return 30;
}

/**
 * Rebels (rules/revolution.ts) neither settle the wild nor raid third parties: now and then
 * they push into their former country's land with a fifth of their troops.
 */
function thinkRebels(game: Game, p: Player, m: Mem, nb: Map<number, Neighbor>): number {
  const home = nb.get(p.rebelOf);
  if (
    home &&
    p.troops > 1500 &&
    !hasAttack(game, p, p.rebelOf) &&
    game.attackAllowed(p.id, p.rebelOf, true) &&
    game.rng.chance(REVOLUTION_PUSH_CHANCE)
  ) {
    applyCommand(game, p.id, { t: 'attack', tile: home.tile, ratio: 0.2 });
    m.lastAttack = game.tick;
  }
  return 30;
}

/**
 * The revolution risen in p's land, when p touches it and is not attacking it yet, with the
 * share of p's army that should take it back. Retaking it is costly (rules/revolution.ts:
 * guerrilla, barricades): p estimates the toll — the rebels' army plus what every tile of
 * guerrilla costs — and commits that much (a fifth of its army at least, three fifths at
 * most), or waits: behind the barricades, or while the toll is beyond its means (unless the
 * revolt is about to spread and p can still pay most of it).
 */
function revoltTarget(
  game: Game,
  p: Player,
  nb: Map<number, Neighbor>,
  cap: number,
): { n: Neighbor; ratio: number } | null {
  if (p.troops < cap * 0.15) return null;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!q.revolution || q.rebelOf !== p.id) continue;
    if (hasAttack(game, p, q.id) || !game.attackAllowed(p.id, q.id, true)) return null;
    if (barricadesUp(game, q)) return null;
    const need = revoltToll(game, p, q);
    const spread = nextSpread(game, q);
    const urgent = spread.holds && spread.in >= 0 && spread.in < 200;
    if (need > p.troops * (urgent ? 0.8 : 0.6)) return null;
    return { n, ratio: Math.min(0.6, Math.max(0.2, need / Math.max(1, p.troops))) };
  }
  return null;
}

/**
 * Troops p should commit to crush the revolution `q`: the rebels' army and, for every tile
 * they hold, the guerrilla's toll (combat.ts attackLogic on average ground at the most
 * favourable ratio), with a margin.
 */
export function revoltToll(game: Game, p: Player, q: Player): number {
  const g = guerrilla(game, q, p.id);
  const density = q.troops / Math.max(1, q.tiles);
  const perTile = 90 * 0.6 * (0.463 + 0.0039 * density) * g.mag;
  return 1.3 * (q.troops + q.tiles * perTile) + 2000;
}

/**
 * What it takes to beat q's army: its troops, and those on its front lines counted at the
 * price of breaking them (LINE_BREAK_RATIO to 1 head-on) — a country dug in behind
 * its lines is no soft target, whatever its free army.
 */
function defenders(q: Player): number {
  return q.troops + q.lineTroops * LINE_BREAK_RATIO;
}

// ----------------------------------------------------------------- nations
function thinkNation(game: Game, p: Player, m: Mem): number {
  const t = TRAITS[p.personality];
  const diff = game.difficulty();
  const tac = TACTICS[game.config.difficulty];
  let cost = 40;
  const cap = troopCap(game, p);
  const incoming = incomingAttacks(game, p);
  const underAttack = incoming.size > 0;
  for (const [att, troops] of incoming) m.grudge.set(att, (m.grudge.get(att) ?? 0) + troops / 1000);

  const nb = neighbors(game, p, 80);
  cost += 80;
  // The runaway (threat.ts) and our part against it: its neighbours fight it together.
  const runaway = runawayOf(game);
  const member =
    runaway > 0 && runaway !== p.id && !game.sameTeam(p.id, runaway) && joinsCoalition(game, p.id, runaway);
  const front = member && nb.has(runaway) && !p.allies.has(runaway);

  // What the war looks like (the war chest, the air force, the generals read it).
  const enemies = enemiesOf(game, p, incoming, runaway, member);
  const war: WarState = {
    atWar: underAttack || front || game.tick - m.lastWar < 3000 || raider(game, p, AI_RAID_MEMORY) > 0,
    enemies,
    nukes: t.nukes,
    aggression: t.aggression,
  };

  // 1-2. Research: the personality's plan, economy first (prerequisites are studied on the
  // way); a nation under nuclear fire switches to SAM batteries until it has them. From
  // normal, a nation at war studies the military branch first (1.12), with SAMs, silos and
  // Aerospace on the way (1.12.1).
  if (game.config.features.tech) {
    const silos = front && tac.lines >= 2 && game.players[runaway]!.buildingCount[B.Silo]! > 0;
    // Threatened from the sky: SAM batteries (normal: nuked; from hard: also an enemy's silos).
    const threat = tac.adaptiveResearch ? skyThreat(game, p, war) : null;
    const sam = game.ai.nukedBy.has(p.id) || silos || threat === 'silos' ? lockFor(p.tech, 'sam') : -1;
    // Bombed (normal and up): interceptors need an airfield, so Aerospace comes next, then the radar.
    const raided = game.config.features.air && tac.air >= 1 && raider(game, p, AI_RAID_MEMORY) > 0;
    const air = sam < 0 && raided ? lockFor(p.tech, 'airfield') : -1;
    const radar =
      sam < 0 && air < 0 && raided && game.config.features.radar && p.buildingCount[B.Airfield]! > 0
        ? lockFor(p.tech, 'radar')
        : -1;
    const urgent = sam >= 0 ? sam : air >= 0 ? air : radar;
    let goal = urgent;
    if (goal < 0 && p.researching < 0) {
      const atWar = tac.adaptiveResearch && (underAttack || front || game.tick - m.lastWar < 1500);
      goal = atWar ? warGoal(p, game.config.difficulty === 'normal' ? 'normal' : 'hard') : -1;
      if (goal < 0) goal = planGoal(p.tech, NATION_RESEARCH[p.personality]);
    }
    if (goal >= 0 && goal !== p.researching) applyCommand(game, p.id, { t: 'research', tech: goal });
  }

  // 3. Defence: counter-attack, fortify the front, guard the capital, answer spent waves.
  if (underAttack) cost += defend(game, p, m, tac, nb, incoming, runaway);
  retireLines(game, p, underAttack);
  // Offensive lines whose troops have waited long enough go over the top (1.20), their
  // arrow on the enemy's capital (1.22), else straight across the border.
  for (const l of linesOf(game, p.id))
    if (
      l.kind === LineKind.Offensive &&
      l.attack < 0 &&
      l.aim < 0 &&
      l.readyTick <= game.tick &&
      l.troops >= 1
    ) {
      const q = game.players[l.target];
      const aim =
        q && q.capital >= 0 && game.owner[q.capital] === q.id ? q.capital : l.tiles[l.tiles.length >> 1];
      if (aim !== undefined) applyCommand(game, p.id, { t: 'lineLaunch', id: l.id, aim });
    }
  if (tac.counter) cost += answerSpentWaves(game, p, m, nb, incoming, cap);

  // 4. Expansion & offensive choice.
  const sinceAttack = game.tick - m.lastAttack;
  // Doomsday clock (GAME_DESIGN.md §14.2): from the survival of the strongest on, a country
  // near the bar grabs land at once, and every war comes sooner (midnight ends the game).
  const doom = doomStage(game);
  const bar = doomSurvivalShare(game);
  const myShare = bar > 0 ? (shares(game).get(p.team > 0 ? -p.team : p.id) ?? 0) * 100 : 100;
  const urgent = bar > 0 && myShare < bar * 1.5;
  const ready = p.troops > cap * ((urgent ? 0.2 : 0.36) / Math.max(0.5, t.aggression * diff.aggression));
  // Offensives against players are spaced out (51–260 s, shorter for aggressive nations);
  // an idle army (near its ceiling, no longer regenerating) is sent 1.5 times as often.
  const idle = p.troops > cap * AI_IDLE_ARMY;
  const warCooldown =
    AI_WAR_COOLDOWN /
    Math.max(0.5, t.aggression * diff.aggression) /
    (idle ? AI_WAR_IDLE_SPEEDUP : 1) /
    (doom >= 3 ? 2 : 1);
  // The coalition first: timed strikes on the runaway, its weak moments, feeding the offensive.
  const joined = front && coalitionAttack(game, p, m, nb, cap, runaway);
  if (!joined && member && !front && striking(game)) cost += coalitionLanding(game, p, m, runaway);
  // Saving for the next strike: no new venture in the last 20 s before it.
  const saving = front && untilStrike(game) < AI_STRIKE_SAVING;
  // A revolution in our land (rules/revolution.ts) is put down first: our own region, its
  // buildings come home intact, and the rebels push into us meanwhile. No war cooldown.
  const retake = !joined && sinceAttack > AI_EXPAND_COOLDOWN ? revoltTarget(game, p, nb, cap) : null;
  if (retake) {
    applyCommand(game, p.id, { t: 'attack', tile: retake.n.tile, ratio: retake.ratio });
    m.lastAttack = game.tick;
  } else if (!joined && !saving && ready && sinceAttack > AI_EXPAND_COOLDOWN) {
    // A neighbouring traitor is fair game whatever the war cooldown (OpenFront's findTraitor).
    const traitor = member ? null : traitorTarget(game, p, nb);
    if (traitor) {
      applyCommand(game, p.id, {
        t: 'attack',
        tile: traitor.tile,
        ratio: offensiveRatio(p, game.players[traitor.id]!, t),
      });
      m.lastAttack = game.tick;
      m.lastWar = game.tick;
      m.warOn = traitor.id;
    } else if (nb.has(0) && !hasAttack(game, p, 0)) {
      applyCommand(game, p.id, { t: 'attack', tile: nb.get(0)!.tile, ratio: 0.25 + 0.1 * t.aggression });
      m.lastAttack = game.tick;
    } else {
      const target =
        game.tick - m.lastWar > warCooldown ? pickTarget(game, p, nb, m, t, cap, member ? runaway : 0) : null;
      const q = target ? game.players[target.id]! : null;
      // Hard and up keep a reserve against their strongest hostile neighbour (OpenFront).
      const ratio = q ? reserveRatio(game, p, nb, q, offensiveRatio(p, q, t), tac) : 0;
      if (target && q && ratio > 0) {
        // Hard and up dig an offensive line in first against a country (it acts after 30 s:
        // the war's later waves push out from it).
        if (tac.lines >= 2 && q.kind !== 'tribe' && linesNear(game, p, target.tile, LineKind.Offensive) === 0)
          layOffensive(game, p, m, target.tile, q.id);
        applyCommand(game, p.id, { t: 'attack', tile: target.tile, ratio });
        m.lastAttack = game.tick;
        if (q.kind !== 'tribe') [m.lastWar, m.warOn] = [game.tick, q.id];
      } else if (!target) {
        // Nothing to attack: a landing overseas, else (team games) troops for a teammate at war.
        const sail = idle || nb.size === 0 || (nb.size === 1 && nb.has(0) === false && game.rng.chance(0.3));
        const sailed = sail && !member ? tryBoat(game, p, m, t, idle) : 0;
        cost += sailed;
        if (sailed < 400 && donateTroops(game, p, cap)) m.lastAttack = game.tick;
      }
    }
  } else if (!joined && nb.size === 0 && p.troops > cap * 0.5) {
    cost += tryBoat(game, p, m, t, idle);
  }

  // 4b. The general (generals.ts): Blitz with a new offensive; from hard Rampart, Sabotage, Propaganda.
  let pressing = 0;
  let worst = -1;
  for (const [att, troops] of incoming) {
    pressing += troops;
    if (worst < 0 || troops > incoming.get(worst)!) worst = att;
  }
  cost += thinkGeneral(game, p, {
    offensive: m.lastWar === game.tick ? (p.capital >= 0 ? p.capital : p.spawnTile) : -1,
    incoming: pressing,
    contact: worst >= 0 ? (nb.get(worst)?.tile ?? -1) : -1,
    enemies,
  });

  // 5. Economy: build things (from normal, defensive lines on the border with the runaway), the
  // war chest first: what the war needs is saved for (arsenal.ts).
  const wish = warWish(game, p, m, war);
  if (game.tick - m.lastBuild > AI_BUILD_COOLDOWN / t.build) {
    const post = front ? fortifyAgainst(game, p, m, tac, nb.get(runaway)!.tile, runaway) : 0;
    cost += post > 0 ? post : tryBuild(game, p, m, t, underAttack, wish, war, nb);
  }

  // 6. Diplomacy. Boxed in by allies with an idle army, a nation lets the alliance with
  // its weakest neighbour lapse (and courts nobody new) so that it can fight again.
  if (m.prey === undefined || m.prey < 0 || !p.allies.has(m.prey))
    m.prey = p.troops > cap * AI_IDLE_ARMY ? lapsingAlly(game, p, nb) : -1;
  const prey = m.prey;
  if (game.tick - m.lastDiplo > 80) {
    m.lastDiplo = game.tick;
    cost += diplomacy(game, p, m, t, nb, prey, wish.reserve);
  }
  answerRequests(game, p, m, prey);

  // 7. Nukes (arsenal.ts); a strike waiting for its reconnaissance is followed up at once.
  // Every 30 s ÷ the taste for nukes on easy (as before), every 60 s from normal: the silos
  // and SAMs bought since 1.12.1 turned hard and impossible games into nuclear stalemates.
  const nukeEvery = (tac.bombs >= 1 ? AI_NUKE_COOLDOWN * 2 : AI_NUKE_COOLDOWN) / t.nukes;
  if (game.config.allowNukes && (m.strike || game.tick - m.lastNuke > nukeEvery)) {
    const l = leader(game);
    cost += tryNuke(game, p, m, {
      nukes: t.nukes,
      leader: l,
      runnerUp: doomStage(game) >= 2 ? runnerUp(game, l) : -1,
      reserve: wish.bomb ? 0 : wish.reserve,
    });
  }

  // 7b. Air power (airpower.ts): raids, reconnaissance, fighters, within the air force's budget.
  if (game.config.features.air && p.buildingCount[B.Airfield]! > 0)
    cost += thinkAir(game, p, m, {
      aggression: t.aggression,
      incoming,
      contact: (owner) => nb.get(owner)?.tile ?? -1,
      runaway: member && front ? runaway : -1,
      recentWar: m.warOn !== undefined && game.tick - m.lastWar < 3000 ? m.warOn : -1,
    });

  // 8. Warships (navy.ts): bought against the threats, sent where they matter (the war chest kept).
  if (game.config.allowPorts && p.buildingCount[B.Port]! > 0)
    cost += thinkNavy(game, p, {
      enemies,
      war: warTarget(game, p, incoming, runaway, member),
      naval: t.naval,
      reserve: wish.reserve,
    });

  // 9. Council vote: sanctions on a runaway leader (normal and up), else as before.
  if (game.features.council && !game.features.council.votes.has(p.id)) {
    const leaderId = leader(game);
    const option =
      leaderId === p.id
        ? 2
        : runaway > 0 && leaderId === runaway
          ? 0
          : underAttack
            ? 2
            : m.grudge.size && t.nukes < 1
              ? 1
              : 0;
    castVote(game, p, option);
  }
  return cost;
}

/** The first war technology not yet researched (WAR_RESEARCH), -1 when all are. */
function warGoal(p: Player, plan: 'normal' | 'hard'): number {
  for (const key of WAR_RESEARCH[plan]) {
    const id = techId(key);
    if (id >= 0 && !isResearched(p.tech, id)) return id;
  }
  return -1;
}

/** p's lines of `kind` standing within reach of `tile` (rules/lines.ts). */
function linesNear(game: Game, p: Player, tile: number, kind: LineKind): number {
  const w = game.map.width;
  const x = (tile % w) + 0.5;
  const y = ((tile / w) | 0) + 0.5;
  let n = 0;
  for (const l of linesOf(game, p.id)) {
    if (l.kind !== kind) continue;
    const at = locate(l.pts, x, y);
    if (Math.hypot(at.px - x, at.py - y) <= LINE_REACH + 6) n++;
  }
  return n;
}

/**
 * Lays a defensive line across the way of `enemy` at `contact` (a tile on our common
 * border): a few tiles inside our land, square to where its land lies, facing it, with
 * `ratio` of the army on it. True when laid.
 */
function layLine(game: Game, p: Player, m: Mem, contact: number, enemy: number, ratio: number): boolean {
  if (linesOf(game, p.id).length >= LINE_MAX_PER_PLAYER) return false;
  const across = lineAcross(game, p, contact, enemy, AI_LINE_BACK, AI_LINE_HALF);
  if (!across) return false;
  const { pts, side } = across;
  const before = game.lines.length;
  applyCommand(game, p.id, { t: 'line', kind: 0, pts, side, ratio });
  if (game.lines.length === before) return false;
  m.lastBuild = game.tick;
  return true;
}

/**
 * Lays an offensive line on our border with `enemy` (1.22), as much of it as its troops
 * allow round `contact`. True when laid.
 */
function layOffensive(game: Game, p: Player, m: Mem, contact: number, enemy: number): boolean {
  if (linesOf(game, p.id).length >= LINE_MAX_PER_PLAYER) return false;
  const before = game.lines.length;
  applyCommand(game, p.id, { t: 'lineBorder', target: enemy, at: contact, ratio: AI_OFFENSE_LINE_RATIO });
  if (game.lines.length === before) return false;
  m.lastBuild = game.tick;
  return true;
}

/**
 * Lines no longer needed come down, their troops back in the army: after AI_LINE_KEEP, a
 * defensive line once nobody attacks us, an offensive one once we attack nobody; an
 * emptied one at once.
 */
function retireLines(game: Game, p: Player, underAttack: boolean): void {
  for (const l of [...linesOf(game, p.id)]) {
    // (A launched line is its attack's front.)
    if (l.attack >= 0) continue;
    // An emptied line (it held a push to its last man) comes down at once.
    if (l.troops < 1) {
      applyCommand(game, p.id, { t: 'lineRemove', id: l.id });
      continue;
    }
    const laid = l.readyTick - (l.kind === LineKind.Offensive ? LINE_OFFENSE_SETUP : LINE_DEFENSE_SETUP);
    if (game.tick - laid < AI_LINE_KEEP) continue;
    const idle =
      l.kind === LineKind.Defensive
        ? !underAttack
        : !game.attacks.some((a) => !a.done && a.attacker === p.id && a.target > 0);
    if (idle) applyCommand(game, p.id, { t: 'lineRemove', id: l.id });
  }
}

/**
 * Under attack: OpenFront's defence. The biggest attacker's push is met in the clash; the
 * front is fortified once the incoming troops reach 35 % of ours (a defensive line where
 * OpenFront built defence posts: one on easy and normal, up to TACTICS.lines from hard,
 * ceil(share / 0.4)); from normal, a capital close to the front gets a line and, if a safer
 * seat exists, moves away.
 */
function defend(
  game: Game,
  p: Player,
  m: Mem,
  tac: Tactics,
  nb: Map<number, Neighbor>,
  incoming: Map<number, number>,
  runaway: number,
): number {
  let cost = 20;
  let worst = -1;
  let worstTroops = 0;
  let total = 0;
  for (const [att, troops] of incoming) {
    total += troops;
    if (troops > worstTroops) {
      worst = att;
      worstTroops = troops;
    }
  }
  // Waves remembered (answerSpentWaves).
  if (tac.counter) {
    const waves = (m.waves ??= new Map());
    for (const [att, troops] of incoming) {
      const w = waves.get(att);
      if (!w || troops > w[0]) waves.set(att, [troops, game.tick]);
      else w[1] = game.tick;
    }
  }
  const enemy = game.players[worst];
  if (!enemy || !nb.has(worst) || !game.attackAllowed(p.id, worst, true)) return cost;
  const contact = nb.get(worst)!.tile;
  // A push of our own revolution is no reason to charge its barricades (revoltTarget decides).
  const ours = enemy.revolution && enemy.rebelOf === p.id;
  if (p.troops > worstTroops * 0.8 && !hasAttack(game, p, worst) && !ours) {
    applyCommand(game, p.id, { t: 'attack', tile: contact, ratio: counterRatio(p, enemy, worstTroops) });
    m.lastAttack = game.tick;
  }
  // Fortify the contact zone. Before 1.12 (easy): only when the counter-attack was out of reach.
  const share = total / Math.max(1, p.troops);
  const fortify =
    tac.runaway > 0 ? share >= 0.35 || worst === runaway : !(p.troops > worstTroops * 0.8) || share >= 1;
  if (fortify && game.tick - m.lastBuild > 30) {
    const want = Math.min(tac.lines, Math.max(1, Math.ceil(share / 0.4)));
    if (
      linesNear(game, p, contact, LineKind.Defensive) < want &&
      layLine(game, p, m, contact, worst, AI_LINE_RATIO)
    )
      cost += 30;
  }
  // The capital near the front: a line before it, then a safer seat (5-min cooldown).
  if (tac.counter && p.capital >= 0 && game.tick - (m.lastCapital ?? -AI_CAPITAL_CHECK) >= AI_CAPITAL_CHECK) {
    m.lastCapital = game.tick;
    cost += 40;
    const d = frontDistance(game, p, p.capital, 12);
    if (d <= 6) {
      if (linesNear(game, p, p.capital, LineKind.Defensive) === 0 && game.tick - m.lastBuild > 30)
        layLine(game, p, m, contact, worst, AI_LINE_RATIO);
      // Moving a standing capital costs 1 M gold and a minute of disorganisation (1.18):
      // still cheaper than losing it (the same disorganisation, a tenth of the treasury).
      if (capitalCooldown(game, p) === 0 && p.gold >= CAPITAL_MOVE_COST * AI_CAPITAL_GOLD_MARGIN) {
        cost += 80;
        const spot = bestCapitalSpot(game, p);
        if (spot >= 0 && spot !== p.capital && frontDistance(game, p, spot, 20) >= d + 6)
          applyCommand(game, p.id, { t: 'moveCapital', tile: spot });
      }
    }
  }
  return cost;
}

/**
 * Normal and up: an attacker whose wave has broken (the troops still pressing fell under
 * AI_SPENT_WAVE of its peak) and whose home army is now weaker than ours is struck back
 * at once, before it can regroup.
 */
function answerSpentWaves(
  game: Game,
  p: Player,
  m: Mem,
  nb: Map<number, Neighbor>,
  incoming: Map<number, number>,
  cap: number,
): number {
  if (!m.waves || m.waves.size === 0) return 0;
  for (const [att, [peak, at]] of m.waves) {
    if (game.tick - at > AI_WAVE_MEMORY) {
      m.waves.delete(att);
      continue;
    }
    if ((incoming.get(att) ?? 0) > peak * AI_SPENT_WAVE) continue;
    const q = game.players[att];
    const n = nb.get(att);
    if (!q || !q.alive || q.kind === 'tribe' || !n || p.allies.has(att)) continue;
    if (!game.attackAllowed(p.id, att, true) || hasAttack(game, p, att)) continue;
    if (q.troops > p.troops * 0.9 || p.troops < cap * 0.25) continue;
    applyCommand(game, p.id, {
      t: 'attack',
      tile: n.tile,
      ratio: Math.min(0.5, Math.max(0.2, (q.troops * 1.2) / p.troops)),
    });
    m.waves.delete(att);
    m.lastAttack = game.tick;
    m.lastWar = game.tick;
    m.warOn = att;
    return 30;
  }
  return 10;
}

/**
 * A coalition member on the runaway's border. In each strike window (threat.ts: every
 * 150 / 120 / 60 s on normal / hard / impossible, all members at once) it throws everything
 * above a reserve (TACTICS.strikeReserve) at the runaway; on impossible it also hits the
 * runaway between strikes whenever its home army is spread thin (three fronts or more, or
 * fewer troops than ours). It feeds an offensive under way. Returns whether it attacked.
 */
function coalitionAttack(
  game: Game,
  p: Player,
  m: Mem,
  nb: Map<number, Neighbor>,
  cap: number,
  runaway: number,
): boolean {
  if (!game.attackAllowed(p.id, runaway, true)) return false;
  const tac = TACTICS[game.config.difficulty];
  const q = game.players[runaway]!;
  const tile = nb.get(runaway)!.tile;
  const attacking = hasAttack(game, p, runaway);
  const go = (ratio: number): true => {
    applyCommand(game, p.id, { t: 'attack', tile, ratio });
    m.lastAttack = game.tick;
    m.lastWar = game.tick;
    m.warOn = runaway;
    return true;
  };
  const strikeAt = game.ai.threat?.strikeAt ?? -1;
  if (striking(game) && (m.lastStrike ?? -1) < strikeAt && p.troops >= cap * 0.35) {
    m.lastStrike = strikeAt;
    return go(Math.min(0.6, Math.max(0.2, 1 - (cap * tac.strikeReserve) / p.troops)));
  }
  if (game.tick - m.lastAttack <= AI_EXPAND_COOLDOWN) return false;
  const thin = frontsOf(game, runaway) >= 3 || q.troops < p.troops * 0.7;
  if (!attacking && thin && tac.harass && p.troops > cap * 0.4)
    return go(Math.min(0.5, Math.max(0.25, (q.troops * 0.8) / p.troops)));
  if (attacking && p.troops > cap * 0.6) return go(0.25);
  return false;
}

/** A coalition member without a border with the runaway lands on its coast during a strike (hard and up). */
function coalitionLanding(game: Game, p: Player, m: Mem, runaway: number): number {
  const tac = TACTICS[game.config.difficulty];
  const q = game.players[runaway]!;
  const strikeAt = game.ai.threat?.strikeAt ?? -1;
  if (tac.navy < 2 || (m.lastStrike ?? -1) >= strikeAt || !game.config.allowPorts) return 0;
  if (p.coast.length === 0 || q.coast.length === 0 || p.troops < troopCap(game, p) * 0.4) return 0;
  m.lastStrike = strikeAt;
  const before = game.units.length;
  applyCommand(game, p.id, { t: 'boat', tile: q.coast[game.rng.int(0, q.coast.length - 1)]!, ratio: 0.25 });
  if (game.units.length > before) {
    m.lastBoat = game.tick;
    m.lastAttack = game.tick;
    return 400;
  }
  return 60;
}

/** Normal and up: defensive lines along the border with the runaway (TACTICS.lines of them near the contact). */
function fortifyAgainst(
  game: Game,
  p: Player,
  m: Mem,
  tac: Tactics,
  contact: number,
  runaway: number,
): number {
  if (linesNear(game, p, contact, LineKind.Defensive) >= tac.lines) return 0;
  return layLine(game, p, m, contact, runaway, AI_LINE_RATIO) ? 60 : 0;
}

/**
 * The share of the army sent at q, cut so that a reserve stays home against the strongest
 * hostile neighbour (TACTICS.reserve × its troops, OpenFront hard 0.75 / impossible 0.9).
 * 0 when the offensive would leave too little (below 10 % of the army). Tribes and the
 * wilderness need no reserve.
 */
function reserveRatio(
  game: Game,
  p: Player,
  nb: Map<number, Neighbor>,
  q: Player,
  ratio: number,
  tac: Tactics,
): number {
  if (tac.reserve <= 0 || q.kind === 'tribe') return ratio;
  let strongest = 0;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const o = game.players[n.id]!;
    if (o.kind === 'tribe' || game.friendly(p.id, o.id)) continue;
    if (o.troops > strongest) strongest = o.troops;
  }
  const keep = tac.reserve * strongest;
  const r = Math.min(ratio, 1 - keep / Math.max(1, p.troops));
  return r >= 0.1 ? r : 0;
}

/** Countries p fights: its offensives' targets, its attackers, the runaway for a coalition member. */
function enemiesOf(
  game: Game,
  p: Player,
  incoming: Map<number, number>,
  runaway: number,
  member: boolean,
): Set<number> {
  const out = new Set<number>(incoming.keys());
  for (const a of game.attacks) if (!a.done && a.attacker === p.id && a.target > 0) out.add(a.target);
  if (member) out.add(runaway);
  return out;
}

/** The country p fights hardest: the runaway for a member, else its biggest attacker, else its offensive's target. */
function warTarget(
  game: Game,
  p: Player,
  incoming: Map<number, number>,
  runaway: number,
  member: boolean,
): number {
  if (member) return runaway;
  let best = -1;
  let most = 0;
  for (const [att, troops] of incoming)
    if (troops > most && game.players[att]?.kind !== 'tribe') [best, most] = [att, troops];
  if (best > 0) return best;
  for (const a of game.attacks)
    if (!a.done && a.attacker === p.id && a.target > 0 && game.players[a.target]!.kind !== 'tribe')
      return a.target;
  return -1;
}

/**
 * Counter-attack size: enough to wipe out the incoming push in the clash (opposing attacks
 * cancel out), plus a strike at the attacker's home army only when we clearly outnumber it
 * (a leftover facing a bigger army would just crawl and bleed).
 */
function counterRatio(p: Player, enemy: Player, incoming: number): number {
  let send = incoming * 1.1;
  if (p.troops - send > enemy.troops * 1.5) send += enemy.troops;
  return Math.min(0.6, send / Math.max(1, p.troops));
}

/**
 * Share of the army sent on an offensive against q: a bite of AI_BITE of its army, within
 * limits (12–50 %, 55 % for aggressive nations; 40 / 45 % before the troop ceilings were
 * lowered, when late-game wars between large empires stalled).
 */
function offensiveRatio(p: Player, q: Player, t: Traits): number {
  const need = (defenders(q) * AI_BITE) / Math.max(1, p.troops);
  return Math.min(0.55, Math.max(0.12, Math.min(0.5, need)) * Math.min(1.2, t.aggression));
}

/**
 * The weakest neighbouring traitor not markedly stronger than p (OpenFront's findTraitor,
 * troops under ×AI_TRAITOR_MARGIN), allies included except on easy: they drop it first
 * (no betrayal: it is a traitor). Null when there is none, or p already attacks it.
 */
function traitorTarget(game: Game, p: Player, nb: Map<number, Neighbor>): Neighbor | null {
  let best: Neighbor | null = null;
  let bestTroops = Infinity;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!q.isTraitor(game.tick) || q.troops >= p.troops * AI_TRAITOR_MARGIN) continue;
    if (p.allies.has(q.id) && game.config.difficulty === 'easy') continue;
    if (!game.attackAllowed(p.id, q.id, true) || hasAttack(game, p, q.id)) continue;
    if (q.troops < bestTroops) {
      bestTroops = q.troops;
      best = n;
    }
  }
  return best;
}

function leader(game: Game): number {
  let best = -1;
  let bt = -1;
  for (const p of game.alivePlayers()) {
    if (p.kind !== 'tribe' && p.tiles > bt) {
      bt = p.tiles;
      best = p.id;
    }
  }
  return best;
}

/** The largest country after `leaderId` (tribes aside), -1 if none. */
function runnerUp(game: Game, leaderId: number): number {
  let best = -1;
  let bt = -1;
  for (const p of game.alivePlayers()) {
    if (p.kind !== 'tribe' && p.id !== leaderId && p.tiles > bt) {
      bt = p.tiles;
      best = p.id;
    }
  }
  return best;
}

function pickTarget(
  game: Game,
  p: Player,
  nb: Map<number, Neighbor>,
  m: Mem,
  t: Traits,
  cap: number,
  coalition: number,
): Neighbor | null {
  const diff = game.difficulty();
  const factor = p.troops > cap * AI_IDLE_ARMY ? Math.min(1, t.attackFactor) : t.attackFactor;
  const doomLeader = doomStage(game) >= 3 ? leader(game) : -1;
  const runaway = runawayOf(game);
  let best: Neighbor | null = null;
  let bestScore = 0;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!game.attackAllowed(p.id, q.id, true)) continue;
    // Our own revolution is put down when it is worth it (revoltTarget), never as a war target.
    if (q.revolution && q.rebelOf === p.id) continue;
    // A coalition member fights the runaway (coalitionAttack), not its partners: tribes only.
    if (coalition > 0 && q.kind !== 'tribe') continue;
    const allied = p.allies.has(q.id);
    if (allied) {
      // Betrayal: rare, only against much weaker allies, and never a friend of long standing.
      if (p.relation(q.id) >= AI_FRIENDLY) continue;
      if (!(game.rng.chance(diff.betrayal * 0.1 * t.aggression) && q.troops < p.troops * 0.35)) continue;
    }
    const strength = p.troops / Math.max(1, defenders(q));
    // A country that took our cities is fought sooner (1.12, normal and up).
    const took = m.took?.get(q.id);
    const avenge =
      took !== undefined && game.tick - took < AI_RETAKE_MEMORY && TACTICS[game.config.difficulty].counter;
    // A revolution is no easy tribe (guerrilla, rules/revolution.ts): fought like a country.
    const easy = q.kind === 'tribe' && !q.revolution;
    if (strength < factor * AI_STRENGTH_MARGIN * (avenge ? 0.8 : 1) && !easy) continue;
    let score = strength * n.contact;
    if (avenge) score *= 2;
    // Overextended: a country fighting on several fronts has its army spread thin (1.12).
    const fronts = q.kind === 'tribe' ? 0 : frontsOf(game, q.id);
    if (fronts >= 2 && diff.aggression >= 1) score *= 1 + 0.25 * Math.min(4, fronts - 1);
    // The runaway, for the nations outside the coalition.
    if (q.id === runaway) score *= 2;
    if (easy) score *= 2.5;
    if (q.kind === 'human') score *= 0.9 + 0.3 * diff.aggression;
    score *= 1 + (m.grudge.get(q.id) ?? 0) * 0.05;
    if (q.isTraitor(game.tick)) score *= 1.5;
    // OpenFront's "hated" players (relation below −50: betrayed us, attacked us hard).
    if (p.relation(q.id) < RELATION_HOSTILE) score *= 1.5;
    // Doomsday, the final stretch: the countries behind gang up on the leader before midnight.
    if (q.id === doomLeader && p.id !== q.id) score *= 3;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** A tile of p a few steps from `near` towards p's centroid (interior placement). */
function innerTile(game: Game, p: Player, near: number, steps: number): number {
  const w = game.map.width;
  const [cx, cy] = p.centroid(w);
  let x = near % w;
  let y = (near / w) | 0;
  const d = Math.hypot(cx - x, cy - y) || 1;
  x = Math.round(x + ((cx - x) / d) * steps);
  y = Math.round(y + ((cy - y) / d) * steps);
  if (!game.map.inBounds(x, y)) return -1;
  const tile = y * w + x;
  return game.owner[tile] === p.id ? tile : -1;
}

/** A random owned interior tile (sample border tile, walk towards the centroid). */
function randomInterior(game: Game, p: Player): number {
  if (p.border.length === 0) return p.spawnTile;
  for (let tries = 0; tries < 6; tries++) {
    const b = p.border[game.rng.int(0, p.border.length - 1)]!;
    const tile = innerTile(game, p, b, game.rng.int(6, 30));
    if (tile >= 0 && HABITABLE[game.map.terrain[tile]!]) return tile;
  }
  return -1;
}

/** Above this many structures per owned tile, nations upgrade rather than build (OpenFront). */
const AI_UPGRADE_DENSITY = 1 / 1500;

/** p's completed building of `kind` with the lowest level that can still be upgraded. */
function upgradeTarget(game: Game, p: Player, kind: B): Building | null {
  let best: Building | null = null;
  for (const b of game.buildings.values()) {
    if (
      b.owner !== p.id ||
      b.type !== kind ||
      b.buildLeft > 0 ||
      b.upgradeLeft > 0 ||
      b.level >= MAX_LEVEL[kind]
    )
      continue;
    if (!best || b.level < best.level) best = b;
  }
  return best;
}

/** A valid tile for a new `kind` (a few random tries), or -1. */
function findSpot(game: Game, p: Player, kind: B): number {
  for (let k = 0; k < 6; k++) {
    const c = kind === B.Port ? p.coast[game.rng.int(0, p.coast.length - 1)]! : randomInterior(game, p);
    if (c >= 0 && checkPlacement(game, p, kind, c) === 'ok' && !outsideNextZone(game, c)) return c;
  }
  return -1;
}

/** A valid tile for a new `kind` between rMin and rMax tiles of (x, y) (a few random tries), or -1. */
function spotAround(
  game: Game,
  p: Player,
  kind: B,
  x: number,
  y: number,
  rMin: number,
  rMax: number,
  tries = 8,
): number {
  const w = game.map.width;
  for (let k = 0; k < tries; k++) {
    const a = game.rng.next() * Math.PI * 2;
    const r = rMin + game.rng.next() * (rMax - rMin);
    const tx = Math.round(x + Math.cos(a) * r);
    const ty = Math.round(y + Math.sin(a) * r);
    if (!game.map.inBounds(tx, ty)) continue;
    const c = ty * w + tx;
    if (game.owner[c] === p.id && checkPlacement(game, p, kind, c) === 'ok' && !outsideNextZone(game, c))
      return c;
  }
  return -1;
}

/**
 * Where a military building goes (normal and up): an airfield 20–40 tiles behind the front
 * with the country p fights (bombers reach 300 tiles, fighters and interceptors 90), a radar
 * beside its airfield, a SAM beside the most valuable building no SAM of its covers yet.
 * -1: anywhere (findSpot).
 */
function militarySpot(game: Game, p: Player, kind: B, war: WarState, nb: Map<number, Neighbor>): number {
  if (TACTICS[game.config.difficulty].air < 1) return -1;
  if (kind === B.Airfield) {
    for (const id of war.enemies) {
      const n = nb.get(id);
      if (!n) continue;
      for (let k = 0; k < 4; k++) {
        const tile = innerTile(game, p, n.tile, 20 + game.rng.int(0, 20));
        if (tile >= 0 && checkPlacement(game, p, kind, tile) === 'ok' && !outsideNextZone(game, tile))
          return tile;
      }
    }
    return -1;
  }
  if (kind === B.Radar) {
    for (const b of game.buildings.values())
      if (b.owner === p.id && b.type === B.Airfield) return spotAround(game, p, kind, b.x, b.y, 15, 30);
    return -1;
  }
  if (kind === B.Sam) {
    const sams: Building[] = [];
    for (const b of game.buildings.values()) if (b.owner === p.id && b.type === B.Sam) sams.push(b);
    const bare: [Building, number][] = [];
    for (const b of game.buildings.values()) {
      if (b.owner !== p.id || (b.type !== B.City && b.type !== B.Silo && b.type !== B.Airfield)) continue;
      if (sams.some((s) => Math.hypot(s.x - b.x, s.y - b.y) < samRangeOf(game, s) * 0.7)) continue;
      bare.push([b, b.type === B.City ? b.level : 4]);
    }
    // Since 1.15 a SAM reaches half as far (24.5 tiles at level 1): it stands as close to
    // what it guards as the building spacing allows (15 tiles), within 70 % of its reach,
    // and the next most valuable building is tried when there is no room around the first.
    bare.sort((a, b) => b[1] - a[1] || a[0].id - b[0].id);
    const tech = game.config.features.tech ? techSam(p).range : 0;
    const rMax = Math.max(MIN_BUILDING_SPACING + 2, (samRange(1) + tech) * 0.7);
    for (const [b] of bare.slice(0, 3)) {
      const tile = spotAround(game, p, kind, b.x, b.y, MIN_BUILDING_SPACING, rMax, 16);
      if (tile >= 0) return tile;
    }
    return -1;
  }
  return -1;
}

/** Builds (or, crowded or without room, upgrades) a `kind`; true when ordered. */
function buildOne(game: Game, p: Player, m: Mem, kind: B, crowded: boolean, spot: number): boolean {
  const upgradeFirst = crowded && p.buildingCount[kind]! > 0 && MAX_LEVEL[kind] > 1;
  const tile = upgradeFirst ? -1 : spot >= 0 ? spot : findSpot(game, p, kind);
  if (tile >= 0) {
    applyCommand(game, p.id, { t: 'build', kind, tile });
    m.lastBuild = game.tick;
    return true;
  }
  // No room (or crowded): upgrade an existing one instead.
  const up = upgradeTarget(game, p, kind);
  if (up) {
    applyCommand(game, p.id, { t: 'upgrade', id: up.id });
    m.lastBuild = game.tick;
    return true;
  }
  return false;
}

/** Buildings placed for the war (militarySpot). */
const MILITARY: readonly B[] = [B.Silo, B.Sam, B.Radar, B.Airfield];

function tryBuild(
  game: Game,
  p: Player,
  m: Mem,
  t: Traits,
  underAttack: boolean,
  wish: Wish,
  war: WarState,
  nb: Map<number, Neighbor>,
): number {
  const counts = p.buildingCount;
  let structures = 0;
  for (let k = 0; k < counts.length; k++) structures += counts[k]!;
  const crowded = structures > p.tiles * AI_UPGRADE_DENSITY;
  const tac = TACTICS[game.config.difficulty];
  // The war chest (normal and up): what the war needs first, as soon as the gold is there.
  if (wish.build !== -1 && p.gold >= buildCost(game, p, wish.build)) {
    const kind: B = wish.build;
    if (buildOne(game, p, m, kind, crowded, militarySpot(game, p, kind, war, nb))) return 60;
  }
  // Cities come first (every level adds 60k troops to the ceiling); ports and
  // factories follow the city levels, silos and SAMs once the treasury allows.
  const scored: [B, number][] = [[B.City, 1.5 * t.build]];
  const cities = p.cityLevels;
  const ports = levelsOwned(game, p, B.Port);
  if (game.config.allowPorts && p.coast.length > 0 && t.trade > 0.3 && ports < Math.max(1, 0.75 * cities))
    scored.push([B.Port, (ports === 0 ? 2.2 : 1.2) * t.trade]);
  const factories = levelsOwned(game, p, B.Factory);
  if (game.config.allowFactories && cities >= 2 && factories < cities / 2)
    scored.push([B.Factory, factories === 0 ? 1.9 : 1.0]);
  // Wishes count levels: an upgrade fulfils them as well as a new building. Treasury gates
  // halved in 1.11 with late-game gold (GAME_DESIGN.md §5.4): nations now rarely sit on more
  // than a city's price, and kept away from silos, SAMs and aircraft.
  // Hard and up, a runaway on the map: a silo to strike it (the war chest saves for it since
  // 1.12.1; three silos before), SAMs when it has silos itself.
  const runaway = runawayOf(game);
  const crown = runaway > 0 && runaway !== p.id && TACTICS[game.config.difficulty].crownNukes;
  if (
    game.config.allowNukes &&
    p.gold > (crown ? 800_000 : 1_250_000) &&
    levelsOwned(game, p, B.Silo) < (t.nukes > 1 ? 2 : 1) &&
    game.tick - game.startTick > 3000
  )
    scored.push([B.Silo, (crown ? 2 : 1.4) * t.nukes]);
  const silosAgainst = crown && game.players[runaway]!.buildingCount[B.Silo]! > 0;
  if (
    game.config.allowNukes &&
    (game.ai.nukedBy.has(p.id) || p.gold > 3_000_000 || (silosAgainst && p.gold > 1_000_000)) &&
    // (One SAM level for 3 city levels; 5 before 1.15, when a SAM reached twice as far.)
    levelsOwned(game, p, B.Sam) < 1 + cities / 3
  )
    scored.push([B.Sam, game.ai.nukedBy.has(p.id) ? 3 : silosAgainst ? 2 : 1.2]);
  // Air power (GAME_DESIGN.md §11): from normal the war chest buys the airfields (arsenal.ts);
  // easy nations only build one at war with gold to spare (it then flies now and then). A
  // radar to guide the interceptors (or, with the fog, to see).
  const raided = raider(game, p, AI_RAID_MEMORY) > 0;
  const flies = game.config.features.air && tac.air >= 1;
  if (
    game.config.features.air &&
    tac.air === 0 &&
    war.atWar &&
    p.gold > 2_000_000 &&
    counts[B.Airfield] === 0
  )
    scored.push([B.Airfield, 0.8 * t.aggression]);
  const radarUse = game.config.features.fog || (flies && (counts[B.Airfield]! > 0 || raided));
  if (game.config.features.radar && radarUse && counts[B.Radar]! < 1 && p.gold > 600_000)
    scored.push([B.Radar, raided ? 1.8 : 0.9]);
  // Research centres: their levels follow the city levels, by personality and difficulty.
  if (game.config.features.tech && cities >= 1) {
    const labs = levelsOwned(game, p, B.Lab);
    const want = Math.max(1, Math.round(cities * t.research * AI_RESEARCH[game.config.difficulty]));
    if (labs < want) scored.push([B.Lab, labs === 0 ? 1.8 : 0.6 + t.research]);
  }
  if (underAttack) scored[0]![1] *= 0.5;
  // Weighted draw among what the treasury allows: cities stay the likeliest, but with
  // capped prices a rich nation would otherwise buy nothing but cities, never a SAM. The
  // war chest's reserve holds back everything but what it saves for.
  const affordable = scored.filter(
    ([kind]) => p.gold - (kind === wish.build ? 0 : wish.reserve) >= buildCost(game, p, kind),
  );
  while (affordable.length > 0) {
    let total = 0;
    for (const [, w] of affordable) total += w;
    let r = game.rng.next() * total;
    let pick = 0;
    while (pick < affordable.length - 1 && r > affordable[pick]![1]) r -= affordable[pick++]![1];
    const [kind] = affordable.splice(pick, 1)[0]!;
    // Crowded land: upgrades cost the same and need no room.
    const spot = MILITARY.includes(kind) ? militarySpot(game, p, kind, war, nb) : -1;
    if (buildOne(game, p, m, kind, crowded, spot)) return 60;
  }
  return 30;
}

function tryBoat(game: Game, p: Player, m: Mem, _t: Traits, idle = false): number {
  if (game.tick - m.lastBoat < 250 || p.coast.length === 0 || !game.config.allowPorts) return 0;
  m.lastBoat = game.tick;
  // Look for a weak foreign coast within ~250 tiles of one of our coastal tiles.
  const w = game.map.width;
  const from = p.coast[game.rng.int(0, p.coast.length - 1)]!;
  const fx = from % w;
  const fy = (from / w) | 0;
  for (let tries = 0; tries < 30; tries++) {
    const x = fx + game.rng.int(-250, 250);
    const y = fy + game.rng.int(-150, 150);
    if (!game.map.inBounds(x, y)) continue;
    const tile = y * w + x;
    // Landings aim at habitable shores, not at an ice sheet or a cliff of high peaks.
    if (!HABITABLE[game.map.terrain[tile]!] || game.isDead(tile) || outsideNextZone(game, tile)) continue;
    const o = game.owner[tile]!;
    if (o === p.id || (o > 0 && (game.friendly(o, p.id) || !game.attackAllowed(p.id, o, true)))) continue;
    if (o > 0 && game.players[o]!.troops > p.troops * 0.7) continue;
    // Never into a revolution's guerrilla by sea (our own is revoltTarget's business).
    if (o > 0 && game.players[o]!.revolution) continue;
    // A shore in sight can lie thousands of tiles away by water (around a spiral, up a
    // long river): such a landing kept a third of the army at sea for over ten minutes.
    const plan = planBoat(game, p, tile);
    if (plan.path && pathLength(plan.path, w) > 4 * Math.hypot(x - fx, y - fy) + 200) continue;
    applyCommand(game, p.id, { t: 'boat', tile, ratio: 0.3 });
    return 400;
  }
  // An idle army with nothing in reach crosses the ocean: the weakest coastal country anywhere.
  if (idle) {
    let best: Player | null = null;
    for (const q of game.alivePlayers()) {
      if (q.id === p.id || q.coast.length === 0 || q.troops > p.troops * 0.9 || q.revolution) continue;
      if (game.friendly(p.id, q.id) || !game.attackAllowed(p.id, q.id, true)) continue;
      if (!best || q.troops < best.troops) best = q;
    }
    if (best) {
      const before = game.units.length;
      applyCommand(game, p.id, {
        t: 'boat',
        tile: best.coast[game.rng.int(0, best.coast.length - 1)]!,
        ratio: 0.35,
      });
      if (game.units.length > before) return 400;
    }
  }
  return 60;
}

/** Odds that a nation with nothing to attack sends its spare troops to a teammate (OpenFront). */
const AI_DONATE_ODDS: Record<Difficulty, number> = { easy: 0, normal: 0.25, hard: 0.5, impossible: 1 };
/** Share of its troop ceiling a nation keeps when it gives troops (OpenFront's reserve: 30–40 %). */
const AI_DONATE_RESERVE = 0.35;

/**
 * Team games (OpenFront's AiAttackBehavior.donateTroops, its last strategy): the teammate at
 * war (attacking or attacked) with the lowest share of its troop ceiling gets every troop
 * above p's reserve. Never on easy; 25 % of the time on normal, 50 % on hard, always on
 * impossible. Teammates are allies for good: they help each other like allies would.
 */
function donateTroops(game: Game, p: Player, cap: number): boolean {
  if (p.team <= 0 || !game.config.allowDonations) return false;
  const odds = AI_DONATE_ODDS[game.config.difficulty];
  if (odds <= 0 || (odds < 1 && !game.rng.chance(odds))) return false;
  const spare = p.troops - cap * AI_DONATE_RESERVE;
  if (spare < 1) return false;
  let best: Player | null = null;
  let bestShare = Infinity;
  for (const id of teammatesOf(game, p)) {
    const q = game.players[id]!;
    if (!game.attacks.some((a) => !a.done && (a.target === id || a.attacker === id))) continue;
    const share = q.troops / Math.max(1, troopCap(game, q));
    if (share < bestShare) {
      bestShare = share;
      best = q;
    }
  }
  if (!best) return false;
  applyCommand(game, p.id, { t: 'donate', target: best.id, gold: 0, troops: spare });
  return true;
}

/** p's living teammates (team games), by id. */
function teammatesOf(game: Game, p: Player): number[] {
  const out: number[] = [];
  if (p.team <= 0) return out;
  for (const q of game.alivePlayers()) if (q.id !== p.id && q.team === p.team) out.push(q.id);
  return out;
}

/** The weakest allied land neighbour when every neighbouring country is an ally (-1 otherwise). */
function lapsingAlly(game: Game, p: Player, nb: Map<number, Neighbor>): number {
  let weakest = -1;
  let weakestTroops = Infinity;
  for (const n of nb.values()) {
    if (n.id === 0) continue;
    const q = game.players[n.id]!;
    if (!p.allies.has(q.id)) {
      if (game.attackAllowed(p.id, q.id, true)) return -1; // an open front already
      continue;
    }
    if (q.troops < weakestTroops) {
      weakestTroops = q.troops;
      weakest = q.id;
    }
  }
  return weakest;
}

/**
 * OpenFront's embargoes (NationExecution.handleEmbargoesToHostileNations): a nation stops
 * trading with anyone it feels hostile towards (relation −50 or lower); it lifts the embargo
 * once back to neutral, never on impossible. In team games, from hard, it trades with its
 * team only. (OpenFront's hard nations wait for friendship: a relation that practically
 * never comes back, and the scripted builder who trades its way up stopped winning on hard.)
 */
export function embargoes(game: Game, p: Player): void {
  if (!TACTICS[game.config.difficulty].embargoes) return;
  const d = game.config.difficulty;
  const hard = d === 'hard' || d === 'impossible';
  if (hard && p.team > 0 && game.config.mode === 'teams') {
    for (const q of game.alivePlayers())
      if (q.kind !== 'tribe' && q.team !== p.team && !p.embargo.has(q.id))
        applyCommand(game, p.id, { t: 'embargo', target: q.id, on: true });
    return;
  }
  for (const [id, r] of p.relations) {
    if (r > RELATION_HOSTILE || p.embargo.has(id) || game.sameTeam(p.id, id)) continue;
    const q = game.players[id];
    if (q && q.alive && q.kind !== 'tribe') applyCommand(game, p.id, { t: 'embargo', target: id, on: true });
  }
  if (d === 'impossible') return;

  for (const id of [...p.embargo])
    if (p.relation(id) >= 0 || !game.players[id]?.alive)
      applyCommand(game, p.id, { t: 'embargo', target: id, on: false });
}

function diplomacy(
  game: Game,
  p: Player,
  m: Mem,
  t: Traits,
  nb: Map<number, Neighbor>,
  prey: number,
  reserve: number,
): number {
  const runaway = runawayOf(game);
  const member = runaway > 0 && joinsCoalition(game, p.id, runaway);
  // Propose alliances to strong neighbours we have no grudge against (nor a bad relation, OpenFront).
  // Never to the runaway (OpenFront); a coalition member courts its partners against it.
  for (const n of nb.values()) {
    if (n.id === 0 || prey >= 0 || n.id === runaway) continue;
    const q = game.players[n.id]!;
    // Teammates are allies for good (no pact to sign): an offer would be wasted.
    if (
      q.kind === 'tribe' ||
      game.friendly(p.id, q.id) ||
      (m.grudge.get(q.id) ?? 0) > 5 ||
      q.isTraitor(game.tick)
    )
      continue;
    if (p.relation(q.id) < 0) continue;
    const exp = p.allies.get(q.id);
    if (exp !== undefined) continue;
    const strongerThanMe = q.troops > p.troops * 1.1;
    const partner = member && joinsCoalition(game, q.id, runaway);
    if (game.rng.chance(0.15 * t.diplomacy * (strongerThanMe || partner ? 1.6 : 0.6) * (partner ? 2 : 1))) {
      applyCommand(game, p.id, { t: 'allyRequest', target: q.id });
      return 20;
    }
  }
  // Renew alliances about to expire.
  for (const [ally, exp] of p.allies) {
    if (ally !== prey && ally !== runaway && exp - game.tick < 280 && game.rng.chance(0.6 * t.diplomacy))
      applyCommand(game, p.id, { t: 'allyRequest', target: ally });
  }
  embargoes(game, p);
  // Help allies and teammates under attack (teammates first: they are allies for good): from
  // 1.5 M of gold to spare beyond the war chest (3 M before 1.12.1: nations almost never gave).
  if (game.config.allowDonations && p.gold - reserve > 1_500_000 && game.rng.chance(0.1 * t.diplomacy)) {
    for (const friend of [...teammatesOf(game, p), ...p.allies.keys()]) {
      if (game.attacks.some((a) => !a.done && a.target === friend)) {
        applyCommand(game, p.id, { t: 'donate', target: friend, gold: p.gold * 0.1, troops: 0 });
        break;
      }
    }
  }
  return 20;
}

/** What weighs on a nation's answer to an alliance offer (shares of probability). */
export type OddsFactor =
  'temper' | 'stronger' | 'weaker' | 'grudge' | 'betrayed' | 'human' | 'goodwill' | 'coalition';

/**
 * How likely nation p is to accept q's alliance offer, and why. `p` is the probability of
 * the roll (0.02 … 0.95); `refusal` a reason that turns the offer down whatever the roll:
 * p resents q (relation below 0, OpenFront), q is running away with the map (1.12, from
 * normal: OpenFront's nations never ally with the runaway leader) — or q is a traitor,
 * refused 9 times in 10. `chance` combines them: the honest odds of an offer sent now.
 */
export function allianceOdds(
  game: Game,
  p: Player,
  q: Player,
): {
  p: number;
  chance: number;
  refusal: 'resent' | 'runaway' | 'traitor' | null;
  factors: [OddsFactor, number][];
} {
  const t = TRAITS[p.personality];
  const diff = game.difficulty();
  const grudge = game.ai.mem.get(p.id)?.grudge.get(q.id) ?? 0;
  const factors: [OddsFactor, number][] = [['temper', 0.35 * t.diplomacy]];
  factors.push(q.troops > p.troops ? ['stronger', 0.25] : ['weaker', -0.1]);
  if (grudge > 0) factors.push(['grudge', -grudge * 0.05]);
  if (p.betrayedBy.has(q.id) || q.isTraitor(game.tick)) factors.push(['betrayed', -0.6]);
  if (q.kind === 'human') factors.push(['human', -0.1 * diff.aggression]);
  // Isoline's goodwill (alliances, trade, gifts, common enemies) makes a yes likelier.
  const rel = p.relation(q.id);
  if (rel > 0) factors.push(['goodwill', rel * AI_GOODWILL_ODDS]);
  // Partners against the runaway (1.12).
  const runaway = runawayOf(game);
  if (runaway > 0 && joinsCoalition(game, p.id, runaway) && joinsCoalition(game, q.id, runaway))
    factors.push(['coalition', AI_COALITION_ODDS]);
  let sum = 0;
  for (const [, v] of factors) sum += v;
  const roll = Math.max(0.02, Math.min(0.95, sum));
  const refusal =
    rel < 0 ? 'resent' : q.id === runaway ? 'runaway' : q.isTraitor(game.tick) ? 'traitor' : null;
  const chance =
    refusal === 'resent' || refusal === 'runaway'
      ? 0
      : refusal === 'traitor'
        ? roll * (1 - AI_TRAITOR_REFUSAL)
        : roll;
  return { p: roll, chance, refusal, factors };
}

function answerRequests(game: Game, p: Player, m: Mem, prey: number): void {
  for (const [from] of p.allyRequests) {
    if (!m.pendingAnswers.has(from)) m.pendingAnswers.set(from, game.tick + game.rng.int(20, 60));
  }
  for (const [from, at] of m.pendingAnswers) {
    if (!p.allyRequests.has(from)) {
      m.pendingAnswers.delete(from);
      continue;
    }
    if (game.tick < at) continue;
    m.pendingAnswers.delete(from);
    const q = game.players[from]!;
    const odds = allianceOdds(game, p, q);
    const pAccept = odds.p;
    // OpenFront: a traitor is nearly always turned down, and so is anyone we feel badly about
    // (and, from normal, the runaway leader).
    const distrust =
      odds.refusal === 'runaway' ||
      p.relation(from) < 0 ||
      (q.isTraitor(game.tick) && game.rng.chance(AI_TRAITOR_REFUSAL));
    applyCommand(game, p.id, {
      t: 'allyAnswer',
      target: from,
      accept: !distrust && from !== prey && game.rng.chance(pAccept),
    });
  }
}
