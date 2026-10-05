import { describe, expect, it } from 'vitest';
import { asciiMap, testGame } from '../helpers';
import { computeLabels } from '../../src/core/game/labels';
import { focusView, FOCUS_MAX_ZOOM } from '../../src/ui/game/focus';

/** A 240 × 120 plain with a big country (1) and a small one (2) of the given tiles. */
function world(small: [number, number][]) {
  const rows = Array.from({ length: 120 }, () => '~' + '.'.repeat(238) + '~');
  const g = testGame(asciiMap(rows), 2);
  for (let y = 4; y < 100; y++) for (let x = 4; x < 120; x++) g.setOwner(g.map.idx(x, y), 1);
  for (const [x, y] of small) g.setOwner(g.map.idx(x, y), 2);
  return g;
}

describe('focus on a country (leaderboard click)', () => {
  it('a one-tile country: centred on its tile, zoomed in close enough to see it', () => {
    // (161, 63): a tile the label grid (every 4 tiles, offset 2) does not sample.
    const g = world([[161, 63]]);
    const labels = computeLabels(g);
    const label = labels.get(2)!;
    expect(label).toBeDefined();
    const f = focusView(g.owner, g.map.width, 2, label, g.players[2]!.tiles, 1600, 900)!;
    expect(f).not.toBeNull();
    // The camera centres on the tile itself.
    expect(f.x).toBeCloseTo(161.5, 5);
    expect(f.y).toBeCloseTo(63.5, 5);
    expect(f.box).toEqual([161, 63, 162, 64]);
    // 1.14 stopped at ×6 (a 6 px speck); now the tile is at least 16 px on screen.
    expect(f.zoom).toBeGreaterThanOrEqual(16);
    expect(f.zoom).toBeLessThanOrEqual(FOCUS_MAX_ZOOM);
  });

  it('a one-tile country on a grid sample (label half-size of a whole grid cell) zooms just as close', () => {
    const g = world([[162, 62]]);
    const label = computeLabels(g).get(2)!;
    expect(label[2]).toBeGreaterThan(1); // the coarse grid overstates its size
    const f = focusView(g.owner, g.map.width, 2, label, 1, 1600, 900)!;
    expect(f.x).toBeCloseTo(162.5, 5);
    expect(f.y).toBeCloseTo(62.5, 5);
    expect(f.zoom).toBeGreaterThanOrEqual(16);
  });

  it('a stale or missing label still finds the tile', () => {
    const g = world([[200, 20]]);
    for (const label of [
      [10, 10, 0] as [number, number, number],
      [150, 100, 0.5] as [number, number, number],
    ]) {
      const f = focusView(g.owner, g.map.width, 2, label, 1, 1600, 900)!;
      expect(f.x).toBeCloseTo(200.5, 5);
      expect(f.y).toBeCloseTo(20.5, 5);
    }
  });

  it('a few tiles: the whole country in view, centred on its land', () => {
    const tiles: [number, number][] = [];
    for (let y = 50; y < 56; y++) for (let x = 170; x < 180; x++) tiles.push([x, y]);
    const g = world(tiles);
    const f = focusView(g.owner, g.map.width, 2, computeLabels(g).get(2)!, tiles.length, 1600, 900)!;
    expect(f.x).toBeCloseTo(175, 5);
    expect(f.y).toBeCloseTo(53, 5);
    // 10 tiles wide on screen: about a fifth of the view's height, all of it visible.
    const px = 10 * f.zoom;
    expect(px).toBeGreaterThan(120);
    expect(px).toBeLessThan(900);
  });

  it('a big country keeps the label-based framing', () => {
    const g = world([[161, 63]]);
    const label = computeLabels(g).get(1)!;
    const f = focusView(g.owner, g.map.width, 1, label, g.players[1]!.tiles, 1600, 900)!;
    expect(f.x).toBe(label[0]);
    expect(f.y).toBe(label[1]);
    expect(f.zoom).toBeLessThanOrEqual(6);
  });

  it('no land, nothing to show', () => {
    const g = world([]);
    expect(focusView(g.owner, g.map.width, 2, [0, 0, 0], 0, 1600, 900)).toBeNull();
  });
});
