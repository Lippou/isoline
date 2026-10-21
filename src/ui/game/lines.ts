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

/** Tiles from a click within which an offensive line facing that country takes the attack. */
export const LINE_ATTACK_REACH = 12;

/**
 * The viewer's offensive line an "Attack" on `target` at `tile` goes from (1.26.3): the selected
 * line if it faces that country, else the nearest one facing it within LINE_ATTACK_REACH — not
 * yet launched and holding troops. Null: a plain attack along the whole border.
 */
export function attackLineFor(
  s: ClientState,
  viewer: number,
  target: number,
  tile: number,
  selected = -1,
): LineView | null {
  if (tile < 0 || viewer <= 0 || target <= 0) return null;
  const ready = (l: LineView) =>
    l.owner === viewer && l.kind === 1 && l.target === target && l.attack < 0 && l.troops >= 1;
  const sel = s.lines.find((l) => l.id === selected);
  if (sel && ready(sel)) return sel;
  const w = s.width;
  const [x, y] = [tile % w, (tile / w) | 0];
  let best: LineView | null = null;
  let bestD = LINE_ATTACK_REACH;
  for (const l of s.lines) {
    if (!ready(l)) continue;
    for (const t of l.tiles) {
      const d = Math.hypot((t % w) - x, Math.floor(t / w) - y);
      if (d <= bestD) [best, bestD] = [l, d];
    }
  }
  return best;
}
