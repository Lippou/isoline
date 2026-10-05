import { describe, expect, it } from 'vitest';
import { sunkAt } from '../../src/render/ships';
import { NUKE_FALLOUT_RADIUS, N } from '../../src/core/game/constants';

describe('ships going under (render)', () => {
  it('a ship hit by shells (shipSunk at its position) goes under, even drawn a little behind', () => {
    const dooms = [{ x: 100, y: 50, r: 0 }];
    expect(sunkAt(dooms, 100, 50, true)).toBe(true);
    expect(sunkAt(dooms, 101.2, 50.6, true)).toBe(true);
  });

  it('a ship that lands its troops or reaches port far from any sinking just goes', () => {
    expect(sunkAt([], 100, 50, true)).toBe(false);
    expect(sunkAt([{ x: 100, y: 50, r: 0 }], 110, 50, true)).toBe(false);
  });

  it('a nuclear blast sinks every ship within its fallout', () => {
    const rf = NUKE_FALLOUT_RADIUS[N.Atom];
    const dooms = [{ x: 0, y: 0, r: rf }];
    expect(sunkAt(dooms, rf * 0.9, 0, true)).toBe(true);
    expect(sunkAt(dooms, rf + 10, 0, true)).toBe(false);
  });

  it('an abandoned fleet (its country gone) sinks', () => {
    expect(sunkAt([], 5, 5, false)).toBe(true);
  });
});
