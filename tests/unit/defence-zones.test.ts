import { describe, expect, it } from 'vitest';
import { hatchSegments, hatchStep, insideOther, ZONE_STYLE } from '../../src/render/defenceZones';

const len = (s: number[]) => Math.hypot(s[2]! - s[0]!, s[3]! - s[1]!);
const total = (segs: number[][]) => segs.reduce((a, s) => a + len(s), 0);

describe('defence zones on the map', () => {
  it('hatches a circle with lines cut to it', () => {
    const segs = hatchSegments([{ x: 50, y: 50, r: 30 }], 4, '/');
    expect(segs.length).toBeGreaterThan(10);
    for (const [ax, ay, bx, by] of segs) {
      for (const [x, y] of [
        [ax!, ay!],
        [bx!, by!],
      ])
        expect(Math.hypot(x! - 50, y! - 50)).toBeLessThanOrEqual(30 + 1e-6);
      // "/": up and to the right on screen (y grows downwards).
      expect(Math.sign(bx! - ax!)).toBe(-Math.sign(by! - ay!));
    }
    // Lines `step` apart cover the disc's area: the length is about area / step.
    expect(total(segs)).toBeCloseTo((Math.PI * 30 * 30) / 4, -1);
  });

  it('merges overlapping zones: a line through two circles is drawn once (no stacked ink)', () => {
    const a = { x: 50, y: 50, r: 30 };
    const twice = hatchSegments([a, { ...a }], 4, '\\');
    expect(twice).toEqual(hatchSegments([a], 4, '\\'));
    // Two overlapping circles: the hatching covers their union, nothing more.
    const b = { x: 80, y: 50, r: 30 };
    const both = total(hatchSegments([a, b], 2, '/'));
    const sep = total(hatchSegments([a], 2, '/')) + total(hatchSegments([b], 2, '/'));
    // The lens they share (d = r): 2r²·acos(d/2r) − d/2·√(4r²−d²).
    const lens = 2 * 900 * Math.acos(0.5) - 15 * Math.sqrt(3600 - 900);
    expect(both).toBeLessThan(sep);
    expect((sep - both) * 2).toBeCloseTo(lens, -1);
  });

  it('keeps the hatching anchored while zooming: the step is a power of two', () => {
    expect(hatchStep(7, 1)).toBe(8);
    expect(hatchStep(7, 2)).toBe(4);
    expect(hatchStep(7, 0.5)).toBe(16);
    expect(hatchStep(7, 1.1)).toBe(hatchStep(7, 1));
  });

  it('leaves out the ring arcs inside another zone of the same kind', () => {
    const list = [
      { x: 0, y: 0, r: 10 },
      { x: 12, y: 0, r: 10 },
    ];
    expect(insideOther(list, 0, 10, 0)).toBe(true);
    expect(insideOther(list, 0, -10, 0)).toBe(false);
  });

  it('tells the kinds apart by pattern, not only by colour', () => {
    const sig = (k: keyof typeof ZONE_STYLE) => {
      const s = ZONE_STYLE[k];
      return JSON.stringify([s.hatch?.dir ?? null, s.ring.gap > 0 ? s.ring.dash : 0, !!s.ring.ticks]);
    };
    expect(new Set([sig('post'), sig('sam'), sig('radar')]).size).toBe(3);
  });
});

describe('defence zones: one pattern at a time', () => {
  it("leaves the SAMs' hatching out of the posts' zones (no cross-hatching)", () => {
    const sam = { x: 0, y: 0, r: 60 };
    const post = { x: 20, y: 0, r: 30 };
    const segs = hatchSegments([sam], 3, '\\', [post]);
    for (const [ax, ay, bx, by] of segs) {
      // No segment's middle (nor any point well inside) lies in the post's zone.
      for (const f of [0.1, 0.5, 0.9]) {
        const x = ax! + (bx! - ax!) * f;
        const y = ay! + (by! - ay!) * f;
        expect(Math.hypot(x - post.x, y - post.y)).toBeGreaterThanOrEqual(30 - 1e-6);
      }
    }
    const full = total(hatchSegments([sam], 3, '\\'));
    expect(full - total(segs)).toBeCloseTo((Math.PI * 900) / 3, -1);
  });
});
