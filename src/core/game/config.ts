// Lobby options for one match. Everything the simulation needs to be reproduced
// (together with the seed and the command log) lives in GameConfig.
import type { GenParams } from '../map/generator';

export type GameMode =
  'ffa' | 'teams' | 'humansVsNations' | 'tribes' | 'doomsday' | 'battleRoyale' | 'campaign' | 'tutorial';
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

export function defaultFeatures(): FeatureToggles {
  return {
    weather: true,
    fog: false,
    tech: true,
    resources: true,
    loyalty: true,
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

export const DIFFICULTY = {
  easy: { income: 0.7, aggression: 0.6, targeting: 0.4, betrayal: 0.05, troops: 0.85, think: 1.6 },
  normal: { income: 1, aggression: 1, targeting: 0.7, betrayal: 0.12, troops: 1, think: 1 },
  hard: { income: 1.35, aggression: 1.3, targeting: 0.9, betrayal: 0.2, troops: 1.15, think: 0.8 },
  impossible: { income: 1.9, aggression: 1.6, targeting: 1, betrayal: 0.3, troops: 1.35, think: 0.6 },
} as const satisfies Record<Difficulty, Record<string, number>>;
