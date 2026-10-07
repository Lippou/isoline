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
  /**
   * Defensive lines per threatened front, where OpenFront builds defence posts (hard and
   * impossible: ceil(incoming share / 0.4)); from 2, offensive lines before a war too.
   */
  lines: number;
  /**
   * Organises its defensive lines (1.24.1: their slowdown doubled after 10 s): 'always' once
   * laid; 'capital' only the line guarding its capital (easy, normal: every line organised
   * froze the fronts of normal world games, a leader stuck under 30 % for half an hour).
   */
  organize: 'always' | 'capital';
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
  /**
   * Air power (npc/airpower.ts, GAME_DESIGN.md §11): 0 rare and clumsy (an airfield only with
   * gold to spare, bombers now and then, no reconnaissance, fighters nor escort); 1 airfields
   * once at war, raids on valuable buildings,
   * reconnaissance over offensives, fighters against transports and radar-detected bombers;
   * 2 + reconnaissance before every raid (two levels a hit), escorts against interceptors,
   * fighters against any bomber in sight; 3 + saturation raids (up to 4 bombers through a SAM).
   */
  air: number;
  /** Share of its income a nation lets its air force spend (the rest goes to its economy). */
  airShare: number;
  /**
   * Saves for what its war needs (airfield, SAMs, radar, silos, a raid, a bomb) instead of
   * spending every coin on cities, ports, factories and warships the moment it can.
   */
  warChest: boolean;
  /** SAM levels wanted per city level once threatened from the sky (OpenFront: 0.15 / 0.2 / 0.25 / 0.3). */
  samPerCity: number;
  /**
   * Strategic weapons: 0 atom bombs as before; 1 + hydrogen bombs when affordable and worth
   * it; 2 + reconnaissance over the target first, a third of the nations save for hydrogen
   * bombs (OpenFront's « hydro nations »), MIRVs deny a victory (NationMIRVBehavior).
   */
  bombs: number;
  /** MIRV at a country holding this share of the useful land (OpenFront: hard 55 %, impossible 40 %); 0 never. */
  mirvDenial: number;
  /** A MIRV decision is dropped one time in this many (OpenFront's hesitation: hard 8, impossible 16). */
  mirvHesitation: number;
  /** Embargoes on hostile countries (OpenFront: every difficulty; lifted at neutral, friendly or never). */
  embargoes: boolean;
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
    lines: 1,
    organize: 'capital',
    navy: 0,
    counter: false,
    adaptiveResearch: false,
    air: 0,
    airShare: 0.1,
    warChest: false,
    samPerCity: 0.15,
    bombs: 0,
    mirvDenial: 0,
    mirvHesitation: 0,
    embargoes: true,
  },
  normal: {
    runaway: 3,
    runawayShare: 0.15,
    coalition: 0.5,
    strikeEvery: 150,
    strikeReserve: 0.4,
    harass: false,
    // Normal too (1.24.1, the player: « les IA doivent remplacer un joueur »): a player
    // facing a runaway goes nuclear.
    crownNukes: true,
    reserve: 0.5,
    lines: 1,
    organize: 'capital',
    navy: 1,
    counter: true,
    adaptiveResearch: true,
    air: 1,
    airShare: 0.2,
    warChest: true,
    samPerCity: 0.2,
    bombs: 1,
    mirvDenial: 0,
    mirvHesitation: 0,
    embargoes: true,
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
    lines: 2,
    organize: 'always',
    navy: 2,
    counter: true,
    adaptiveResearch: true,
    air: 2,
    airShare: 0.3,
    warChest: true,
    samPerCity: 0.25,
    bombs: 2,
    mirvDenial: 0.55,
    mirvHesitation: 8,
    embargoes: true,
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
    lines: 3,
    organize: 'always',
    navy: 3,
    counter: true,
    adaptiveResearch: true,
    air: 3,
    airShare: 0.35,
    warChest: true,
    samPerCity: 0.3,
    bombs: 2,
    mirvDenial: 0.4,
    mirvHesitation: 16,
    embargoes: true,
  },
};
