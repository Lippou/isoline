// Radar early warning (GAME_DESIGN.md §11): view-only intelligence computed in the simulation
// worker, never part of the simulation (no state, no command). A hostile bomber, fighter
// patrol, reconnaissance plane or transport bound for the viewer's land is reported once,
// as soon as it flies (or sails) into the viewer's radar coverage (or an ally's). Without
// a radar, the viewer only learns of it at the impact or the landing.
import type { Game } from '../core/game/state';
import type { GameEvent } from '../core/game/events';
import { BUILDING_KEYS } from '../core/game/constants';
import { U } from '../core/units/unit';
import { AIR_OUTBOUND, radarSees } from '../core/units/air';
import { TRANSPORT_RETREATING } from '../core/units/ships';

/** The scan runs twice a second. */
const SCAN_EVERY = 5;

export class RadarWatch {
  private warned = new Set<number>();

  /** Warnings for `viewer` this tick (empty most ticks). */
  scan(g: Game, viewer: number): GameEvent[] {
    if (g.tick % SCAN_EVERY !== 0 || viewer <= 0 || !g.config.features.radar) return [];
    const me = g.player(viewer);
    if (!me || !me.alive) return [];
    const out: GameEvent[] = [];
    const live = new Set<number>();
    const w = g.map.width;
    for (const u of g.units) {
      if (!u.alive || g.friendly(u.owner, viewer)) continue;
      let key = '';
      let tile = -1;
      const params: Record<string, string | number> = { by: u.owner };
      if (u.type === U.Bomber && u.kind === AIR_OUTBOUND) {
        const b = u.target >= 0 ? g.buildings.get(u.target) : undefined;
        if (b && b.owner === viewer) {
          key = 'notify.radar.bomber';
          params.building = BUILDING_KEYS[b.type]!;
          tile = b.tile;
        } else if (!b && u.dest >= 0 && g.owner[u.dest] === viewer) {
          key = 'notify.radar.bomberLand';
          tile = u.dest;
        }
      } else if ((u.type === U.Fighter && u.kind === AIR_OUTBOUND) || u.type === U.Recon) {
        const t = Math.floor(u.ty) * w + Math.floor(u.tx);
        if (g.owner[t] === viewer) {
          key = u.type === U.Recon ? 'notify.radar.recon' : 'notify.radar.fighter';
          tile = t;
        }
      } else if (u.type === U.Transport && u.dest === viewer && u.kind !== TRANSPORT_RETREATING) {
        key = 'notify.radar.transport';
        params.troops = Math.round(u.troops);
        tile = u.target;
      }
      if (!key) continue;
      live.add(u.id);
      if (this.warned.has(u.id) || !radarSees(g, viewer, u.x, u.y)) continue;
      this.warned.add(u.id);
      const e: GameEvent = {
        k: 'notify',
        to: viewer,
        key,
        level: u.type === U.Bomber ? 'danger' : 'warn',
        params,
      };
      if (tile >= 0) e.tile = tile;
      out.push(e);
    }
    for (const id of this.warned) if (!live.has(id)) this.warned.delete(id);
    return out;
  }

  reset(): void {
    this.warned.clear();
  }
}
