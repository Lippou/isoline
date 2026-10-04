// How well the nations play, by difficulty (GAME_DESIGN.md §9). These knobs only shape
// decisions: they grant no troops, gold or vision (the resource handicaps are the
// DIFFICULTY table of game/config.ts, OpenFront's). Easy nations play as before 1.12.
import type { Difficulty } from '../game/config';

export interface Tactics {
  /**
   * A country is a runaway once its land reaches this multiple of the runner-up's
   * (OpenFront's findRunawayLeader: medium 3×, hard 2×, impossible 1.5×), or grows this
   * much faster than the others (see threat.ts). 0: nations never notice.
   */
  runaway: number;
  /** Least share of the useful land a runaway holds (a big lead on a crowded map, not a duel of minnows). */
  runawayShare: number;
  /**
   * Coalitions against the runaway: share of its neighbours that join the timed strikes (1:
   * all), and seconds between two strikes. 0: none (each nation fights alone).
   */
  coalition: number;
  strikeEvery: number;
  /** Share of its troop ceiling a member keeps home when it strikes (the rest goes, up to 60 % of its army). */
  strikeReserve: number;
  /** Between strikes, members hit the runaway whenever it is spread thin (3 fronts, or fewer troops than theirs). */
  harass: boolean;
  /** Nukes (and the silos and SAMs for them) aimed at the runaway (OpenFront nukes its crown). */
  crownNukes: boolean;
  /**
   * Troops a nation keeps home before a war elsewhere: this share of its strongest hostile
   * neighbour's army (OpenFront hard 0.75, impossible 0.9).
   */
  reserve: number;
  /** Defence posts per threatened front (OpenFront: hard/impossible ceil(incoming share / 0.4)). */
  posts: number;
  /**
   * Naval play: 0 spawns warships and leaves them where they are (before 1.12); 1 hunts the
   * transports sailing at it; 2 also concentrates its fleet where enemy warships are and
   * guards its ports; 3 also raids the ports and merchants of the enemy it fights.
   */
  navy: number;
  /** Strikes back at an attacker whose wave is spent, retakes lost cities, moves a threatened capital. */
  counter: boolean;
  /** Research follows the situation (war: military and defence; nuked: SAMs) instead of a fixed plan. */
  adaptiveResearch: boolean;
}

export const TACTICS: Record<Difficulty, Tactics> = {
  easy: {
    runaway: 0,
    runawayShare: 1,
    coalition: 0,
    strikeEvery: 0,
    strikeReserve: 0,
    harass: false,
    crownNukes: false,
    reserve: 0,
    posts: 1,
    navy: 0,
    counter: false,
    adaptiveResearch: false,
  },
  normal: {
    runaway: 3,
    runawayShare: 0.15,
    coalition: 0.5,
    strikeEvery: 150,
    strikeReserve: 0.4,
    harass: false,
    crownNukes: false,
    reserve: 0.5,
    posts: 1,
    navy: 1,
    counter: true,
    adaptiveResearch: true,
  },
  hard: {
    runaway: 2,
    runawayShare: 0.1,
    coalition: 0.5,
    strikeEvery: 120,
    strikeReserve: 0.3,
    harass: false,
    crownNukes: true,
    reserve: 0.75,
    posts: 2,
    navy: 2,
    counter: true,
    adaptiveResearch: true,
  },
  impossible: {
    runaway: 1.5,
    runawayShare: 0.08,
    coalition: 1,
    strikeEvery: 60,
    strikeReserve: 0.2,
    harass: true,
    crownNukes: true,
    reserve: 0.9,
    posts: 3,
    navy: 3,
    counter: true,
    adaptiveResearch: true,
  },
};
