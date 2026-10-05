// The nations' generals (GAME_DESIGN.md §15.7): each nation has one, like a human player,
// and uses its ability when it pays (TACTICS.generals): from normal, Blitz the moment it
// launches an offensive against a country; from hard, also Rampart when an attack that could
// break it (75 % of its troops or more) presses near its capital on a front held by a defence
// post, Sabotage on a train or merchant ship of the country it fights, and Propaganda once
// captured buildings worth two levels or more are under occupation. Easy nations never use
// theirs. (Rampart on every heavily attacked front, tried first, left a third of the hard and
// impossible AI games without a winner after 60 minutes.)
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import { LINE_REACH } from '../game/constants';
import { LineKind, linesOf, locate } from '../rules/lines';
import { applyCommand } from '../game/commands';
import { U } from '../units/unit';
import { TACTICS } from './tactics';

/** Share of the army pressing at us from which Rampart is worth it (an attack that could break us). */
const AI_RAMPART_SHARE = 0.75;
/** …at a front this close to its capital (tiles): Rampart on every front left games without a winner. */
const AI_RAMPART_CAPITAL = 25;
/** Occupied levels from which Propaganda is worth it. */
const AI_PROPAGANDA_LEVELS = 2;

export interface GeneralContext {
  /** Tile of the front of an offensive against a country launched this think (-1: none). */
  offensive: number;
  /** Troops pressing at us, in all, and a contact tile with the biggest attacker (-1: none). */
  incoming: number;
  contact: number;
  /** The countries p fights. */
  enemies: Set<number>;
}

/** Uses p's general when it pays. Returns its work cost. */
export function thinkGeneral(game: Game, p: Player, ctx: GeneralContext): number {
  const level = TACTICS[game.config.difficulty].generals;
  if (level < 1 || !game.config.features.generals || game.tick < p.generalReadyTick) return 0;
  const tile = pick(game, p, ctx, level);
  if (tile >= 0) applyCommand(game, p.id, { t: 'general', tile });
  return 10;
}

function pick(game: Game, p: Player, ctx: GeneralContext, level: number): number {
  switch (p.general) {
    case 'blitz':
      return ctx.offensive;
    case 'rampart':
      return level >= 2 &&
        ctx.contact >= 0 &&
        ctx.incoming >= p.troops * AI_RAMPART_SHARE &&
        nearCapital(game, p, ctx.contact) &&
        lineNear(game, p, ctx.contact)
        ? ctx.contact
        : -1;
    case 'sabotage': {
      if (level < 2 || ctx.enemies.size === 0) return -1;
      const w = game.map.width;
      for (const u of game.units)
        if (u.alive && (u.type === U.Train || u.type === U.Merchant) && ctx.enemies.has(u.owner))
          return Math.floor(u.y) * w + Math.floor(u.x);
      return -1;
    }
    case 'propaganda': {
      if (level < 2) return -1;
      let levels = 0;
      for (const b of game.buildings.values()) if (b.owner === p.id && b.occupiedLeft > 0) levels += b.level;
      return levels >= AI_PROPAGANDA_LEVELS ? (p.capital >= 0 ? p.capital : p.spawnTile) : -1;
    }
  }
  return -1;
}

/** Whether `tile` lies within AI_RAMPART_CAPITAL tiles of p's capital. */
function nearCapital(game: Game, p: Player, tile: number): boolean {
  if (p.capital < 0) return false;
  const w = game.map.width;
  return (
    Math.hypot((tile % w) - (p.capital % w), ((tile / w) | 0) - ((p.capital / w) | 0)) <= AI_RAMPART_CAPITAL
  );
}

/** Whether a defensive line of p stands near `tile` (the Rampart doubles what lines hold back). */
function lineNear(game: Game, p: Player, tile: number): boolean {
  const w = game.map.width;
  const x = (tile % w) + 0.5;
  const y = ((tile / w) | 0) + 0.5;
  return linesOf(game, p.id).some((l) => {
    if (l.kind !== LineKind.Defensive) return false;
    const at = locate(l.pts, x, y);
    return Math.hypot(at.px - x, at.py - y) <= LINE_REACH + 6;
  });
}
