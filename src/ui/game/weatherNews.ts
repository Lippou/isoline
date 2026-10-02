// Weather briefs in the journal: a storm or a fog bank forming near the viewer's lands
// or fleet, with what it does — at most one every 90 seconds.
import type { ClientState } from '../../engine/clientState';
import type { WeatherCell } from '../../core/rules/weather';
import { FOG_SIGHT, STORM_SHIP_SPEED } from '../../core/rules/weather';
import { UNIT_STRIDE } from '../../engine/protocol';
import { U } from '../../core/units/unit';
import { hud } from '../stores/game.svelte';
import { t } from '../i18n/i18n.svelte';

/** Ticks between two weather briefs. */
const THROTTLE = 900;
/** A cell counts as near when it comes this close (tiles) to the viewer's land. */
const MARGIN = 25;

export class WeatherNews {
  private known = new Set<number>();
  private primed = false;
  private lastAt = -Infinity;

  /** Call on every tick: reports new cells near the viewer (cells present at load are not news). */
  check(st: ClientState, viewer: number): void {
    const w = st.world;
    if (!w) return;
    const ids = new Set<number>();
    for (const c of w.weather) {
      const id = c.born * 2 + c.kind;
      ids.add(id);
      if (this.known.has(id)) continue;
      if (!this.primed || viewer <= 0 || st.tick - this.lastAt < THROTTLE || !near(st, viewer, c)) continue;
      this.lastAt = st.tick;
      const key = c.kind === 0 ? 'weather.stormNear' : 'weather.fogNear';
      const pct = Math.round((1 - (c.kind === 0 ? STORM_SHIP_SPEED : FOG_SIGHT)) * 100);
      hud.log = [
        ...hud.log.slice(-199),
        {
          tick: st.tick,
          text: t(key, { pct }),
          level: 'info',
          key,
          params: { pct },
          tile: Math.floor(c.y) * st.width + Math.floor(c.x),
        },
      ];
    }
    this.known = ids;
    this.primed = true;
  }
}

/** Does the cell reach the viewer's land (with a margin) or one of its ships? */
function near(st: ClientState, viewer: number, c: WeatherCell): boolean {
  const r = c.r + MARGIN;
  const step = Math.max(2, Math.floor(r / 10));
  const w = st.width;
  for (let y = Math.max(0, Math.floor(c.y - r)); y <= Math.min(st.height - 1, c.y + r); y += step)
    for (let x = Math.max(0, Math.floor(c.x - r)); x <= Math.min(w - 1, c.x + r); x += step)
      if ((x - c.x) ** 2 + (y - c.y) ** 2 <= r * r && st.owner[y * w + x] === viewer) return true;
  for (let k = 0; k < st.unitCount; k++) {
    const o = k * UNIT_STRIDE;
    const type = st.units[o + 1]!;
    if (st.units[o + 2] !== viewer || (type !== U.Transport && type !== U.Warship && type !== U.Merchant))
      continue;
    if ((st.units[o + 3]! - c.x) ** 2 + (st.units[o + 4]! - c.y) ** 2 <= c.r * c.r) return true;
  }
  return false;
}
