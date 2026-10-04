// Lobby options for one match. Everything the simulation needs to be reproduced
// (together with the seed and the command log) lives in GameConfig.
import type { GenParams } from '../map/generator';
import type { PlayerFlag } from '../data/flagSpec';

export type GameMode =
  'ffa' | 'teams' | 'humansVsNations' | 'tribes' | 'doomsday' | 'battleRoyale' | 'campaign';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'impossible';
export type GeneralType = 'blitz' | 'rampart' | 'sabotage' | 'propaganda';
export const GENERALS: readonly GeneralType[] = ['blitz', 'rampart', 'sabotage', 'propaganda'];

export interface PlayerSlot {
  /** Stable slot id (also the network client id for humans). */
  slot: number;
  name: string;
  kind: 'human' | 'nation';
  team: number;
  general: GeneralType;
  color?: number;
  spectator?: boolean;
  /** Chosen flag (cosmetic: shown by the interface, never read by the rules). */
  flag?: PlayerFlag;
}

export interface FeatureToggles {
  weather: boolean;
  fog: boolean;
  tech: boolean;
  resources: boolean;
  loyalty: boolean;
  events: boolean;
  generals: boolean;
  air: boolean;
  radar: boolean;
  council: boolean;
}

export interface GameConfig {
  version: number;
  seed: number;
  mapId: string;
  /** Present when mapId refers to a procedural map. */
  procedural?: GenParams;
  mode: GameMode;
  teamCount: number;
  difficulty: Difficulty;
  nations: number;
  tribes: number;
  players: PlayerSlot[];
  victoryThreshold: number; // percent of useful land
  spawnSeconds: number;
  goldMultiplier: number;
  /** Sandbox: starting gold for humans and nations. */
  startGold: number;
  gameSpeed: number;
  allowPorts: boolean;
  allowNukes: boolean;
  allowDonations: boolean;
  allowFactories: boolean;
  waterNukes: boolean;
  decontamination: boolean;
  allowSpectators: boolean;
  features: FeatureToggles;
  /** Campaign mission id (mode 'campaign'). */
  mission?: string;
}

/**
 * Features on in a new game. Loyalty and secessions are off (1.12.0, the player's request:
 * « je veux pouvoir jouer en solo comme je jouerais en multijoueur »); the lobby can still
 * switch them on. A save or a replay keeps the features of its own game (GameConfig).
 */
export function defaultFeatures(): FeatureToggles {
  return {
    weather: true,
    fog: false,
    tech: true,
    resources: true,
    loyalty: false,
    events: true,
    generals: true,
    air: true,
    radar: true,
    council: true,
  };
}

export function defaultConfig(seed: number): GameConfig {
  return {
    version: 1,
    seed,
    mapId: 'world',
    mode: 'ffa',
    teamCount: 2,
    difficulty: 'normal',
    nations: 30,
    tribes: 60,
    players: [{ slot: 0, name: 'Player', kind: 'human', team: 0, general: 'blitz' }],
    victoryThreshold: 80,
    spawnSeconds: 30,
    goldMultiplier: 1,
    startGold: 0,
    gameSpeed: 1,
    allowPorts: true,
    allowNukes: true,
    allowDonations: true,
    allowFactories: true,
    waterNukes: false,
    decontamination: false,
    allowSpectators: true,
    features: defaultFeatures(),
  };
}

/**
 * Nation handicaps (OpenFront: easy / medium / hard / impossible). `troops` scales
 * their troop ceiling and starting troops, `regen` their troop regeneration; gold
 * income is the same for everyone.
 */
export const DIFFICULTY = {
  easy: { troops: 0.5, regen: 0.9, aggression: 0.6, targeting: 0.4, betrayal: 0.05, think: 1.6 },
  normal: { troops: 0.75, regen: 0.95, aggression: 1, targeting: 0.7, betrayal: 0.12, think: 1 },
  hard: { troops: 1, regen: 1, aggression: 1.3, targeting: 0.9, betrayal: 0.2, think: 0.8 },
  impossible: { troops: 1.25, regen: 1.05, aggression: 1.6, targeting: 1, betrayal: 0.3, think: 0.6 },
} as const satisfies Record<Difficulty, Record<string, number>>;
