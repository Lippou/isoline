// Technology tree (original feature): 5 branches × 4 levels, research points from cities.
import type { Player } from '../game/player';
import { T } from '../map/terrain';

export const BRANCHES = ['economy', 'military', 'naval', 'nuclear', 'defense'] as const;
export const TECH_COST = [60, 150, 300, 500] as const;

/** i18n keys of every tech: tech.<branch>.<level 1..4>. */
export function techKey(branch: number, level: number): string {
  return `tech.${BRANCHES[branch]}.${level}`;
}

/** Research points per tick produced by a player. */
export function researchRate(p: Player): number {
  return (0.5 + 0.5 * p.cityLevels) / 10;
}

export function nextTechCost(p: Player, branch: number): number {
  const lvl = p.tech[branch]!;
  return lvl >= 4 ? Infinity : TECH_COST[lvl]!;
}

export function updateResearch(p: Player): string | null {
  if (p.researching < 0) return null;
  p.researchPoints += researchRate(p);
  const cost = nextTechCost(p, p.researching);
  if (p.researchPoints >= cost) {
    p.researchPoints -= cost;
    p.tech[p.researching]!++;
    const key = techKey(p.researching, p.tech[p.researching]!);
    if (p.tech[p.researching]! >= 4) p.researching = -1;
    return key;
  }
  return null;
}

const lv = (p: Player, b: number) => p.tech[b]!;

export function techMagMultiplier(p: Player, terrain: number): number {
  let m = 1;
  if (lv(p, 1) >= 1 && (terrain === T.Mountain || terrain === T.Hills)) m *= 0.9;
  if (lv(p, 1) >= 3) m *= 0.9;
  return m;
}

export function techSpeedMultiplier(p: Player): number {
  let m = 1;
  if (lv(p, 1) >= 2) m *= 1.1;
  if (lv(p, 1) >= 4) m *= 1.15;
  return m;
}

export function techEconomy(p: Player): number {
  let m = 1;
  if (lv(p, 0) >= 1) m *= 1.1;
  if (lv(p, 0) >= 3) m *= 1.15;
  return m;
}

export function techTrainBonus(p: Player): number {
  return lv(p, 0) >= 2 ? 1.1 : 1;
}

export function techBuildCost(p: Player): number {
  let m = 1;
  if (lv(p, 0) >= 4) m *= 0.9;
  if (lv(p, 4) >= 3) m *= 0.95;
  return m;
}

export function techNaval(p: Player): { hp: number; damage: number; speed: number; trade: number } {
  return {
    hp: lv(p, 2) >= 1 ? 1.2 : 1,
    damage: lv(p, 2) >= 2 ? 1.2 : 1,
    speed: lv(p, 2) >= 3 ? 1.25 : 1,
    trade: lv(p, 2) >= 4 ? 1.3 : 1,
  };
}

export function techNukes(p: Player): { cost: number; reload: number } {
  let cost = 1;
  if (lv(p, 3) >= 1) cost *= 0.9;
  if (lv(p, 3) >= 3) cost *= 0.85;
  return { cost, reload: lv(p, 3) >= 2 ? 1.25 : 1 };
}

export function techSam(p: Player): { range: number; targets: number } {
  let range = 0;
  let targets = 0;
  if (lv(p, 4) >= 1) range += 10;
  if (lv(p, 4) >= 2) targets += 1;
  if (lv(p, 4) >= 4) {
    targets += 1;
    range += 15;
  }
  return { range, targets };
}

/** Machine-readable effects for the UI tooltip and GAME_DESIGN.md. */
export const TECH_EFFECTS: readonly (readonly string[])[] = [
  ['+10% worker income', '+10% train revenue', '+15% worker income', '−10% building costs'],
  ['−10% losses in hills & mountains', '+10% attack speed', '−10% losses everywhere', '+15% attack speed'],
  ['+20% warship HP', '+20% warship damage', '+25% ship speed', '+30% trade income'],
  ['−10% nuke costs', '+25% silo reload speed', '−15% nuke costs', 'MIRV +2 warheads'],
  ['SAM range +10', 'SAM +1 simultaneous target', '−5% building costs', 'SAM +1 target, range +15'],
];
