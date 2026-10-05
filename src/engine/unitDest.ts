// Where a unit is heading, as one tile (packed in the unit buffer's Dest slot): what the
// map's hover card prints as "to Morocco" (src/ui/game/unitHover.ts). View only.
import type { Game } from '../core/game/state';
import type { Unit } from '../core/units/unit';
import { U } from '../core/units/unit';

/**
 * Destination tile of a unit, −1 when it has none worth naming: a transport's landing (or
 * the home coast once turned back), the port a merchant sails to, the station a train runs
 * to; a missile's target. Warships patrol, planes carry their target point (tx, ty) already.
 */
export function unitDestTile(
  game: Game,
  u: Unit,
  rails?: ReadonlyMap<number, Game['rails'][number]>,
): number {
  switch (u.type) {
    case U.Nuke:
      return u.dest;
    case U.Transport:
      return u.target;
    case U.Merchant:
      return game.buildings.get(u.dest)?.tile ?? -1;
    case U.Train: {
      const r = rails ? rails.get(u.rail) : game.rails.find((x) => x.id === u.rail);
      if (!r || !r.alive) return -1;
      return game.buildings.get(u.dir === 1 ? r.b : r.a)?.tile ?? -1;
    }
    default:
      return -1;
  }
}
