// Local profile: cumulative stats, 30 achievements, titles, leaderboard, campaign stars.
import { readJson, writeJson } from '../bridge';
import type { FinalStats } from '../../engine/protocol';
import type { GameConfig } from '../../core/game/config';
import { toast } from './game.svelte';
import { t } from '../i18n/i18n.svelte';
import { sanitizeFlag, sanitizeFlagSpec, type FlagSpec, type PlayerFlag } from '../../core/data/flagSpec';

export const PROFILE_VERSION = 1;

export const ACHIEVEMENTS = [
  'firstGame',
  'firstWin',
  'tenGames',
  'worldWin',
  'giantWin',
  'threeMaps',
  'tycoon',
  'railBaron',
  'merchantPrince',
  'admiral',
  'nuclearOption',
  'hydrogen',
  'mirv',
  'ironDome',
  'builder',
  'architect',
  'expansionist',
  'blitzkrieg',
  'survivor',
  'doomsdayWin',
  'royaleWin',
  'teamWin',
  'humanity',
  'traitor',
  'loyal',
  'impossibleWin',
  'hardWin',
  'campaignFirst',
  'campaignAll',
  'allStars',
] as const;
export type AchievementId = (typeof ACHIEVEMENTS)[number];

export const TITLES = [
  { id: 'cartographer', need: 0 },
  { id: 'surveyor', need: 4 },
  { id: 'geometer', need: 9 },
  { id: 'strategist', need: 15 },
  { id: 'admiral', need: 21 },
  { id: 'isolineMaster', need: 30 },
] as const;

export interface Profile {
  version: number;
  name: string;
  title: string;
  created: string;
  totals: {
    games: number;
    wins: number;
    playTicks: number;
    tilesConquered: number;
    buildings: number;
    shipsSunk: number;
    nukes: number;
    intercepts: number;
    betrayals: number;
    gold: number;
  };
  mapsWon: string[];
  achievements: Record<string, string>; // id → ISO date
  leaderboard: { score: number; map: string; date: string; won: boolean; mode: string }[];
  campaign: Record<string, number>; // mission id → stars (0..3)
  /** Flag shown next to the player's name: generated from the name, a real country's, or the custom design. */
  flagChoice: FlagChoice;
  /** Real flag picked (flag-icons code), kept while another choice is active. */
  flagIso: string;
  /** The flag editor's design, kept while another choice is active. */
  customFlag: FlagSpec | null;
}

export type FlagChoice = 'generated' | 'iso' | 'custom';

function defaultProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    name: '',
    title: 'cartographer',
    created: new Date().toISOString(),
    totals: {
      games: 0,
      wins: 0,
      playTicks: 0,
      tilesConquered: 0,
      buildings: 0,
      shipsSunk: 0,
      nukes: 0,
      intercepts: 0,
      betrayals: 0,
      gold: 0,
    },
    mapsWon: [],
    achievements: {},
    leaderboard: [],
    campaign: {},
    flagChoice: 'generated',
    flagIso: '',
    customFlag: null,
  };
}

export const profile = $state<Profile>(defaultProfile());

export async function loadProfile(): Promise<void> {
  const raw = await readJson<Partial<Profile>>('profile', 'profile.json');
  const d = defaultProfile();
  Object.assign(
    profile,
    raw ? { ...d, ...raw, totals: { ...d.totals, ...(raw.totals ?? {}) }, version: PROFILE_VERSION } : d,
  );
  // The flag fields come from a file the user can edit: keep only valid values.
  profile.customFlag = sanitizeFlagSpec(profile.customFlag);
  const iso = sanitizeFlag({ iso: profile.flagIso });
  profile.flagIso = iso && 'iso' in iso ? iso.iso : '';
  if (!['generated', 'iso', 'custom'].includes(profile.flagChoice)) profile.flagChoice = 'generated';
  if (profile.flagChoice === 'iso' && !profile.flagIso) profile.flagChoice = 'generated';
  if (profile.flagChoice === 'custom' && !profile.customFlag) profile.flagChoice = 'generated';
}

/** The flag the player carries into games (undefined: the generated one). */
export function myFlag(): PlayerFlag | undefined {
  if (profile.flagChoice === 'iso' && profile.flagIso) return { iso: profile.flagIso };
  if (profile.flagChoice === 'custom' && profile.customFlag)
    return { spec: $state.snapshot(profile.customFlag) as FlagSpec };
  return undefined;
}

/** Choose the flag (and remember a design or a country for later). */
export function setMyFlag(choice: FlagChoice, value?: { iso?: string; spec?: FlagSpec }): void {
  if (value?.iso !== undefined) profile.flagIso = value.iso;
  if (value?.spec) profile.customFlag = sanitizeFlagSpec(value.spec);
  profile.flagChoice = choice;
  void saveProfile();
}

export function saveProfile(): Promise<boolean> {
  return writeJson('profile', 'profile.json', $state.snapshot(profile));
}

function unlock(id: AchievementId): void {
  if (profile.achievements[id]) return;
  profile.achievements[id] = new Date().toISOString();
  toast(`${t('achievement.unlocked')} — ${t(`achievement.${id}.name`)}`, 'good');
}

export function unlockedTitles(): string[] {
  const n = Object.keys(profile.achievements).length;
  return TITLES.filter((x) => n >= x.need).map((x) => x.id);
}

export function score(stats: FinalStats, me: number, won: boolean): number {
  const p = stats.players.find((x) => x.id === me);
  if (!p) return 0;
  const minutes = Math.max(1, (stats.tick - stats.startTick) / 600);
  return Math.round(
    p.stats.maxTiles / 10 +
      (won ? 5000 : 0) +
      p.stats.goldEarned / 20000 +
      p.stats.enemiesKilled / 2000 +
      (won ? 6000 / minutes : 0),
  );
}

export async function recordGameEnd(
  stats: FinalStats,
  me: number,
  won: boolean,
  config: GameConfig,
  missionId?: string,
): Promise<void> {
  const p = stats.players.find((x) => x.id === me);
  if (!p) return;
  const s = p.stats;
  const tt = profile.totals;
  tt.games++;
  if (won) tt.wins++;
  tt.playTicks += stats.tick - stats.startTick;
  tt.tilesConquered += s.tilesConquered;
  tt.buildings += s.buildingsBuilt;
  tt.shipsSunk += s.shipsSunk;
  tt.nukes += s.nukesLaunched;
  tt.intercepts += s.nukesIntercepted;
  tt.betrayals += s.betrayals;
  tt.gold += s.goldEarned;
  if (won && !profile.mapsWon.includes(config.mapId)) profile.mapsWon.push(config.mapId);
  const minutes = (stats.tick - stats.startTick) / 600;

  unlock('firstGame');
  if (won) unlock('firstWin');
  if (tt.games >= 10) unlock('tenGames');
  if (won && config.mapId === 'world') unlock('worldWin');
  if (won && config.mapId === 'world-giant') unlock('giantWin');
  if (profile.mapsWon.length >= 3) unlock('threeMaps');
  if (s.goldEarned >= 50_000_000) unlock('tycoon');
  if (s.trainGold >= 5_000_000) unlock('railBaron');
  if (s.tradeGold >= 5_000_000) unlock('merchantPrince');
  if (s.shipsSunk >= 10) unlock('admiral');
  if (s.nukesLaunched >= 1) unlock('nuclearOption');
  if (tt.intercepts >= 5) unlock('ironDome');
  if (tt.buildings >= 50) unlock('builder');
  if (s.buildingsBuilt >= 25) unlock('architect');
  if (s.maxTiles >= 100_000) unlock('expansionist');
  if (won && minutes < 15) unlock('blitzkrieg');
  if (minutes >= 30 && p.alive) unlock('survivor');
  if (won && config.mode === 'doomsday') unlock('doomsdayWin');
  if (won && config.mode === 'battleRoyale') unlock('royaleWin');
  if (won && config.mode === 'teams') unlock('teamWin');
  if (won && config.mode === 'humansVsNations') unlock('humanity');
  if (tt.betrayals >= 1) unlock('traitor');
  if (won && s.betrayals === 0) unlock('loyal');
  if (won && config.difficulty === 'impossible') unlock('impossibleWin');
  if (won && (config.difficulty === 'hard' || config.difficulty === 'impossible')) unlock('hardWin');
  if (missionId && profile.campaign['m1']) unlock('campaignFirst');
  checkCampaignAchievements();

  if (!missionId) {
    profile.leaderboard.push({
      score: score(stats, me, won),
      map: config.mapId,
      date: new Date().toISOString(),
      won,
      mode: config.mode,
    });
    profile.leaderboard.sort((a, b) => b.score - a.score);
    profile.leaderboard = profile.leaderboard.slice(0, 20);
  }
  await saveProfile();
}

/** Track individual nuke kinds as they are launched (called by the game controller). */
export function noteLaunch(kind: number): void {
  const had = Object.keys(profile.achievements).length;
  if (kind === 1) unlock('hydrogen');
  if (kind === 2) unlock('mirv');
  if (Object.keys(profile.achievements).length !== had) void saveProfile();
}

export function checkCampaignAchievements(): void {
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
  if (profile.campaign['m1']) unlock('campaignFirst');
  if (ids.every((id) => (profile.campaign[id] ?? 0) > 0)) unlock('campaignAll');
  if (ids.every((id) => (profile.campaign[id] ?? 0) >= 3)) unlock('allStars');
}

export async function recordMission(id: string, stars: number): Promise<void> {
  profile.campaign[id] = Math.max(profile.campaign[id] ?? 0, stars);
  checkCampaignAchievements();
  await saveProfile();
}
