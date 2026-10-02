// Population growth (bell curve peaking at 42 % troops/cap), troop/worker
// rebalancing and gold income.
import type { Game } from './state';
import type { Player } from './player';
import {
  BASE_INCOME,
  GROWTH_MAX,
  GROWTH_PEAK,
  GROWTH_SIGMA_HIGH,
  GROWTH_SIGMA_LOW,
  MAX_GOLD,
  POP_BASE,
  POP_PER_CITY_LEVEL,
  REBALANCE_RATE,
  TERRITORY_EXP,
  TERRITORY_K,
  TICKS_PER_SECOND,
  WORKER_INCOME,
  TRIBE_INCOME,
  TRIBE_MAX_TROOPS,
} from './constants';
import { resourceBonus } from '../rules/resources';
import { techEconomy } from '../rules/tech';

export function populationCap(game: Game, p: Player): number {
  const territory = TERRITORY_K * Math.pow(Math.max(0, p.usefulTiles), TERRITORY_EXP);
  let cap = POP_BASE + POP_PER_CITY_LEVEL * p.cityLevels + territory;
  if (game.config.features.resources) cap *= 1 + resourceBonus(game, p).growth * 0.5;
  return cap;
}

/** Bell-shaped growth factor in [0, 1] of the troops/cap ratio. */
export function growthCurve(ratio: number): number {
  const s = ratio < GROWTH_PEAK ? GROWTH_SIGMA_LOW : GROWTH_SIGMA_HIGH;
  const z = (ratio - GROWTH_PEAK) / s;
  return Math.exp(-z * z);
}

export function updateEconomy(game: Game): void {
  const diff = game.difficulty();
  const tick = game.tick;
  for (const p of game.alivePlayers()) {
    const cap = populationCap(game, p);
    p.popCap = cap;
    const pop = p.troops + p.workers;
    // --- growth
    let growth: number;
    if (pop < cap) {
      growth = GROWTH_MAX * cap * growthCurve(p.troops / cap) * (1 - pop / cap);
      if (p.kind === 'nation') growth *= diff.troops;
      // Tribes grow like a nation, then stop once they reach their troop ceiling.
      if (p.kind === 'tribe' && p.troops >= TRIBE_MAX_TROOPS) growth = 0;
      if (game.config.features.resources) growth *= 1 + resourceBonus(game, p).growth;
      growth *= game.features.growthMult;
      growth = Math.min(growth, cap - pop);
    } else {
      growth = -(pop - cap) * 0.01;
    }
    p.lastGrowth = growth;
    const ratio = autoRatio(p, cap);
    if (growth > 0) {
      p.troops += growth * ratio;
      p.workers += growth * (1 - ratio);
    } else if (pop > 0) {
      p.troops += (growth * p.troops) / pop;
      p.workers += (growth * p.workers) / pop;
    }
    // --- rebalance towards the requested troop ratio
    const total = p.troops + p.workers;
    if (total > 0) {
      const want = total * ratio;
      const maxMove = total * REBALANCE_RATE;
      const delta = Math.max(-maxMove, Math.min(maxMove, want - p.troops));
      if (delta > 0) {
        const moved = Math.min(delta, p.workers);
        p.workers -= moved;
        p.troops += moved;
      } else if (delta < 0) {
        const moved = Math.min(-delta, p.troops);
        p.troops -= moved;
        p.workers += moved;
      }
    }
    if (p.troops < 0) p.troops = 0;
    if (p.workers < 0) p.workers = 0;

    // --- gold
    if (p.kind === 'tribe') {
      // Tribes trade and hoard: their treasury is the prize for conquering them.
      p.income = TRIBE_INCOME / TICKS_PER_SECOND;
      p.gold = Math.min(MAX_GOLD, p.gold + p.income);
      continue;
    }
    const sanctioned = game.features.sanction && game.features.sanction.target === p.id ? 0.5 : 1;
    const mult =
      game.config.goldMultiplier *
      game.features.incomeMult *
      sanctioned *
      (p.kind === 'nation' ? diff.income : 1);
    const techMult = game.config.features.tech ? techEconomy(p) : 1;
    const base = BASE_INCOME[p.kind] * mult;
    const workers = p.workers * WORKER_INCOME * mult * techMult;
    const res = game.config.features.resources ? resourceBonus(game, p).gold * mult : 0;
    const perSecond = base + workers + res;
    const perTick = perSecond / TICKS_PER_SECOND;
    p.income = perTick;
    p.incomeBreakdown.base = base;
    p.incomeBreakdown.workers = workers;
    p.incomeBreakdown.resources = res;
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

/** troopRatio 0 means "simple mode": keep troops near the growth optimum. */
function autoRatio(p: Player, cap: number): number {
  if (p.troopRatio > 0) return p.troopRatio;
  const pop = p.troops + p.workers;
  if (pop <= 0) return 0.6;
  return Math.min(0.95, Math.max(0.2, (GROWTH_PEAK * cap) / pop));
}
