import { describe, expect, it } from 'vitest';
import { RailLayer, railCurve } from '../../src/render/railLayer';
import type { ClientState } from '../../src/engine/clientState';
import type { RailView } from '../../src/engine/protocol';

const W = 200;
/** A staircase path (A* on 8 neighbours): two steps right, one diagonal, n times. */
function stairs(x0: number, y0: number, n: number): number[] {
  const out = [y0 * W + x0];
  let x = x0;
  let y = y0;
  for (let k = 0; k < n; k++) {
    x++;
    out.push(y * W + x);
    if (k % 3 === 2) y++;
    else x++;
    out.push(y * W + x);
  }
  return out;
}

function fakeState(rails: RailView[]): ClientState {
  return { width: W, height: W, rails, railsVersion: 0 } as unknown as ClientState;
}

function layer(state: ClientState, reduced = false): RailLayer {
  return new RailLayer(state, {
    ink: () => 0x3366aa,
    seen: () => true,
    particles: () => 1,
    reducedMotion: () => reduced,
    inkKey: () => 'none',
  });
}

const VIEW: [number, number, number, number] = [0, 0, W, W];

describe('railways (render)', () => {
  it('the drawn line has a point per tile, keeps both stations and smooths the staircase', () => {
    const tiles = stairs(10, 10, 20);
    const p = railCurve(tiles, W);
    expect(p.length).toBe(tiles.length * 2);
    expect([p[0], p[1]]).toEqual([10.5, 10.5]);
    const last = tiles[tiles.length - 1]!;
    expect([p[p.length - 2], p[p.length - 1]]).toEqual([(last % W) + 0.5, ((last / W) | 0) + 0.5]);
    // Near the tiles (trains drawn on it stay by their tile), and no sharp turn left.
    let worstTurn = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i]!;
      expect(Math.hypot(p[i * 2]! - (t % W) - 0.5, p[i * 2 + 1]! - ((t / W) | 0) - 0.5)).toBeLessThan(1);
      if (i >= 2 && i < tiles.length - 3) {
        const a = Math.atan2(p[i * 2 + 1]! - p[i * 2 - 1]!, p[i * 2]! - p[i * 2 - 2]!);
        const b = Math.atan2(p[i * 2 + 3]! - p[i * 2 + 1]!, p[i * 2 + 2]! - p[i * 2]!);
        worstTurn = Math.max(worstTurn, Math.abs(b - a));
      }
    }
    expect(worstTurn).toBeLessThan(0.2); // the raw staircase turns by 45° (0.785)
  });

  it('rails there from the start appear at once; new ones are laid, lost ones torn up', () => {
    const a: RailView = { id: 1, owner: 2, tiles: stairs(10, 10, 15) };
    const b: RailView = { id: 2, owner: 2, tiles: stairs(10, 60, 15) };
    const s = fakeState([a]);
    const l = layer(s);
    l.update(4, VIEW, 1 / 60);
    expect(l.animating).toEqual({ building: 0, tearing: 0 });
    s.rails = [a, b];
    s.railsVersion++;
    l.update(4, VIEW, 1 / 60);
    expect(l.animating).toEqual({ building: 1, tearing: 0 });
    // Laid within a few seconds.
    for (let k = 0; k < 6 * 60; k++) l.update(4, VIEW, 1 / 60);
    expect(l.animating.building).toBe(0);
    s.rails = [b];
    s.railsVersion++;
    l.update(4, VIEW, 1 / 60);
    expect(l.animating).toEqual({ building: 0, tearing: 1 });
    for (let k = 0; k < 3 * 60; k++) l.update(4, VIEW, 1 / 60);
    expect(l.animating.tearing).toBe(0);
  });

  it('reduced motion: a short fade instead of the construction', () => {
    const a: RailView = { id: 1, owner: 2, tiles: stairs(10, 10, 30) };
    const s = fakeState([]);
    const l = layer(s, true);
    l.update(4, VIEW, 1 / 60);
    s.rails = [a];
    s.railsVersion++;
    l.update(4, VIEW, 1 / 60);
    expect(l.animating.building).toBe(1);
    for (let k = 0; k < 60; k++) l.update(4, VIEW, 1 / 60);
    expect(l.animating.building).toBe(0);
  });

  it('a train is drawn on the track, and one ahead of the railhead finishes the line', () => {
    const a: RailView = { id: 7, owner: 2, tiles: stairs(10, 10, 30) };
    const s = fakeState([]);
    const l = layer(s);
    l.update(4, VIEW, 1 / 60);
    s.rails = [a];
    s.railsVersion++;
    l.update(4, VIEW, 1 / 60);
    const p = railCurve(a.tiles, W);
    const at = l.trainAt(99, 7, 12, 1, 0)!;
    expect(at[0]).toBeCloseTo(p[24]!, 5);
    expect(at[1]).toBeCloseTo(p[25]!, 5);
    expect(l.trainAt(98, 3, 0, 1, 0)).toBeNull(); // unknown rail: the caller keeps its position
    // From the far end: the whole line is laid by the next frames.
    l.trainAt(97, 7, a.tiles.length - 1, 1, 0);
    l.update(4, VIEW, 1 / 60);
    expect(l.animating.building).toBe(0);
  });
});
