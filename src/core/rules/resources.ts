// Strategic resources (original feature): owning a deposit's centre tile grants a bonus.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import { Resource } from '../map/terrain';

export interface ResourceBonus {
  gold: number; // extra gold per second
  nukeDiscount: number; // 0..0.4
  growth: number; // 0..0.4 extra growth
  buildDiscount: number; // 0..0.3
  counts: [number, number, number, number];
}

const EMPTY: ResourceBonus = { gold: 0, nukeDiscount: 0, growth: 0, buildDiscount: 0, counts: [0, 0, 0, 0] };

export const OIL_GOLD = 400;
export const URANIUM_DISCOUNT = 0.08;
export const FERTILE_GROWTH = 0.06;
export const RARE_DISCOUNT = 0.05;

/** Recount deposits per player (cheap: deposits are few). */
export function recountResources(game: Game): void {
  const counts = new Map<number, [number, number, number, number]>();
  for (const d of game.map.meta.deposits) {
    const o = game.owner[game.map.idx(d.x, d.y)]!;
    if (o === 0) continue;
    let c = counts.get(o);
    if (!c) {
      c = [0, 0, 0, 0];
      counts.set(o, c);
    }
    if (d.type >= Resource.Oil && d.type <= Resource.RareMetals) c[d.type - 1]!++;
  }
  const bonus = new Map<number, ResourceBonus>();
  for (const [o, c] of counts) {
    bonus.set(o, {
      gold: c[0] * OIL_GOLD,
      nukeDiscount: Math.min(0.4, c[1] * URANIUM_DISCOUNT),
      growth: Math.min(0.4, c[2] * FERTILE_GROWTH),
      buildDiscount: Math.min(0.3, c[3] * RARE_DISCOUNT),
      counts: c,
    });
  }
  game.features.resourceBonus = bonus;
}

export function resourceBonus(game: Game, p: Player): ResourceBonus {
  return game.features.resourceBonus.get(p.id) ?? EMPTY;
}
