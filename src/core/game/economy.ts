// Troops and passive gold (OpenFront model): a single troop pool regenerating
// towards a ceiling set by land and completed cities, and a flat gold income.
import type { Game } from './state';
import type { Player } from './player';
import {
  B,
  GOLD_PER_TICK,
  MAX_GOLD,
  TICKS_PER_SECOND,
  TRIBE_REGEN_MULT,
  TRIBE_TROOPS_DIVISOR,
  TROOPS_BASE,
  TROOPS_PER_CITY_LEVEL,
  TROOPS_TILE_EXP,
  TROOPS_TILE_K,
  TROOP_REGEN_BASE,
  TROOP_REGEN_DIV,
  TROOP_REGEN_EXP,
} from './constants';
import { resourceBonus } from '../rules/resources';
import { techEconomy, techTroopCap } from '../rules/tech';
import { capitalGoldMult, capitalGrowthMult } from '../rules/capital';

/** Sum of the levels of p's completed cities (cities under construction add nothing yet). */
export function completedCityLevels(game: Game, p: Player): number {
  let n = 0;
  for (const b of game.buildings.values())
    if (b.owner === p.id && b.type === B.City && b.buildLeft === 0) n += b.level;
  return n;
}

/**
 * Troop ceiling: 2 × (usefulTiles^0.6 × 800 + 25,000) + 60,000 per completed
 * city level; a third of that for tribes, × the difficulty for nations.
 */
export function maxTroops(game: Game, p: Player, cityLevels = completedCityLevels(game, p)): number {
  const land = Math.pow(Math.max(0, p.usefulTiles), TROOPS_TILE_EXP) * TROOPS_TILE_K;
  let max = 2 * (land + TROOPS_BASE) + TROOPS_PER_CITY_LEVEL * cityLevels;
  if (p.kind === 'tribe') max /= TRIBE_TROOPS_DIVISOR;
  else if (p.kind === 'nation') max *= game.difficulty().troops;
  if (p.kind !== 'tribe' && game.config.features.tech) max *= techTroopCap(p); // Conscription
  return max;
}

/**
 * Troops gained this tick given the ceiling `max`:
 * (10 + troops^0.73 / 5) × (1 − troops / max), clamped to the ceiling. Above the
 * ceiling the factor turns negative and the army shrinks back towards it.
 */
export function troopRegen(game: Game, p: Player, max: number): number {
  const troops = Math.max(0, p.troops);
  let add = (TROOP_REGEN_BASE + Math.pow(troops, TROOP_REGEN_EXP) / TROOP_REGEN_DIV) * (1 - troops / max);
  if (p.kind === 'tribe') add *= TRIBE_REGEN_MULT;
  else if (p.kind === 'nation') add *= game.difficulty().regen;
  if (add > 0) {
    if (game.config.features.resources) add *= 1 + resourceBonus(game, p).growth;
    add *= game.features.growthMult;
    // Disorganised after losing the capital (rules/capital.ts).
    add *= capitalGrowthMult(game, p);
  }
  return Math.min(troops + add, max) - troops;
}

// Scratch buffer: completed city levels per player id, rebuilt every tick.
let cityLevelsBuf = new Float64Array(0);

export function updateEconomy(game: Game): void {
  const tick = game.tick;
  if (cityLevelsBuf.length < game.players.length) cityLevelsBuf = new Float64Array(game.players.length * 2);
  const cityLevels = cityLevelsBuf;
  cityLevels.fill(0);
  for (const b of game.buildings.values())
    if (b.type === B.City && b.buildLeft === 0) cityLevels[b.owner]! += b.level;

  for (const p of game.alivePlayers()) {
    // --- troops
    const max = maxTroops(game, p, cityLevels[p.id]!);
    p.popCap = max;
    const growth = troopRegen(game, p, max);
    p.lastGrowth = growth;
    p.troops = Math.max(0, p.troops + growth);

    // --- gold
    if (p.kind === 'tribe') {
      // Tribes trade and hoard: their treasury is the prize for conquering them. Rebels
      // (a seceded region) hoard nothing: crushing a rebellion is no gold mine.
      p.income = p.rebelOf > 0 ? 0 : Math.floor(GOLD_PER_TICK.tribe * game.config.goldMultiplier);
      p.gold = Math.min(MAX_GOLD, p.gold + p.income);
      continue;
    }
    const sanctioned = game.features.sanction && game.features.sanction.target === p.id ? 0.5 : 1;
    // Capital lost: disorganised, then still without a seat of government (rules/capital.ts).
    const mult =
      game.config.goldMultiplier * game.features.incomeMult * sanctioned * capitalGoldMult(game, p);
    const techMult = game.config.features.tech ? techEconomy(p) : 1;
    const base = Math.floor(GOLD_PER_TICK[p.kind] * mult * techMult);
    const res = game.config.features.resources
      ? Math.floor((resourceBonus(game, p).gold / TICKS_PER_SECOND) * mult)
      : 0;
    const perTick = base + res;
    p.income = perTick;
    p.incomeBreakdown.base = base * TICKS_PER_SECOND;
    p.incomeBreakdown.resources = res * TICKS_PER_SECOND;
    addGold(p, perTick);
    if (tick % 50 === 0) {
      // Trade/train figures are accumulated elsewhere; decay the displayed averages.
      p.incomeBreakdown.trade *= 0.8;
      p.incomeBreakdown.trains *= 0.8;
    }
  }
}

export function addGold(p: Player, amount: number): void {
  p.gold = Math.min(MAX_GOLD, p.gold + amount);
  if (amount > 0) p.stats.goldEarned += amount;
}
