// What a wave of troops sent at us looks like on screen (InvasionFlash.svelte and the map).
// An invasion lights only the screen edge — or the two edges of a corner — facing the
// attack; when its front is in view, the nearest edge glows softly and the front itself is
// marked on the map. A riposte (the wave answers our own attack on that country, under way
// first) is that country's defence, not an invasion: no red edges, a brass pulse on the
// front and a dispatch instead. Pure functions, unit-tested.

/** How a wave sent at `me` is shown: an invasion, a riposte, or nothing (not at us). */
export type WaveKind = 'invasion' | 'riposte' | null;

export function classifyWave(e: { target: number; riposte?: boolean }, me: number): WaveKind {
  if (me <= 0 || e.target !== me) return null;
  return e.riposte ? 'riposte' : 'invasion';
}

/** Glow of each screen edge, 0 (off) … 1. */
export interface EdgeGlow {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EdgeCue {
  edges: EdgeGlow;
  /** Where the glow peaks along the screen's border (fractions of the width and height). */
  ex: number;
  ey: number;
  /** The front is in view: the map marks it (and its nearest edge glows softly). */
  onScreen: boolean;
}

/** A second edge lights up when the attack lies this close to the diagonal (a corner). */
const CORNER = 0.6;
/** Glow of the nearest edge when the front is already in view. */
const IN_VIEW = 0.55;

/**
 * The edges facing a point of the front at screen position (sx, sy) on a w × h screen
 * (null: unknown position — the top edge). Off screen: the edge the attack lies beyond,
 * plus the neighbouring one when it comes from a corner. In view: the nearest edge, softly.
 */
export function edgesToward(sx: number | null, sy: number | null, w: number, h: number): EdgeCue {
  const edges: EdgeGlow = { top: 0, right: 0, bottom: 0, left: 0 };
  if (sx === null || sy === null || !Number.isFinite(sx) || !Number.isFinite(sy) || w <= 1 || h <= 1) {
    edges.top = 1;
    return { edges, ex: 0.5, ey: 0, onScreen: false };
  }
  // Direction from the centre, in half-screens (|u| > 1: beyond that edge).
  const ux = (sx - w / 2) / (w / 2);
  const uy = (sy - h / 2) / (h / 2);
  const m = Math.max(Math.abs(ux), Math.abs(uy), 1e-6);
  const ex = 0.5 + ux / m / 2;
  const ey = 0.5 + uy / m / 2;
  if (m <= 1) {
    // In view: the nearest edge.
    const d = { left: sx, right: w - sx, top: sy, bottom: h - sy };
    const near = (Object.keys(d) as (keyof EdgeGlow)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
    edges[near] = IN_VIEW;
    const at =
      near === 'left' ? [0, sy / h] : near === 'right' ? [1, sy / h] : [sx / w, near === 'top' ? 0 : 1];
    return { edges, ex: at[0]!, ey: at[1]!, onScreen: true };
  }
  const x: keyof EdgeGlow = ux < 0 ? 'left' : 'right';
  const y: keyof EdgeGlow = uy < 0 ? 'top' : 'bottom';
  const [major, minor, rx, ry] = Math.abs(ux) >= Math.abs(uy) ? [x, y, ux, uy] : [y, x, uy, ux];
  edges[major] = 1;
  const r = Math.abs(ry) / Math.abs(rx);
  if (r >= CORNER) edges[minor] = Math.min(1, 0.5 + (r - CORNER) / (1 - CORNER) / 2);
  return { edges, ex, ey, onScreen: false };
}
