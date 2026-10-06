// The viewer's front lines on the client (core/rules/lines.ts): the one under a click.
import type { ClientState } from '../../engine/clientState';
import type { LineView } from '../../engine/protocol';
import { locate } from '../../core/rules/lines';

/** The viewer's line passing within `reach` tiles of `tile` (the nearest), or null. */
export function ownLineAt(s: ClientState, viewer: number, tile: number, reach = 2): LineView | null {
  if (tile < 0 || viewer <= 0) return null;
  const w = s.width;
  const [x, y] = [(tile % w) + 0.5, ((tile / w) | 0) + 0.5];
  let best: LineView | null = null;
  let bestD = reach;
  for (const l of s.lines) {
    if (l.owner !== viewer) continue;
    // An offensive line runs along a border, maybe in several stretches: its nearest tile.
    let d = Infinity;
    if (l.kind === 1)
      for (const t of l.tiles) d = Math.min(d, Math.hypot((t % w) + 0.5 - x, Math.floor(t / w) + 0.5 - y));
    else {
      const at = locate(l.pts, x, y);
      d = Math.hypot(at.px - x, at.py - y);
    }
    if (d <= bestD) [best, bestD] = [l, d];
  }
  return best;
}
