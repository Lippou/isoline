import { describe, expect, it } from 'vitest';
import { asciiMap, testGame } from '../helpers';
import { computeLabels } from '../../src/core/game/labels';

describe('map labels', () => {
  it('a country smaller than the label grid still gets an anchor on its own land', () => {
    const rows = Array.from({ length: 40 }, () => '~' + '.'.repeat(78) + '~');
    const g = testGame(asciiMap(rows), 2);
    // Player 1 holds a wide block; player 2 a 2×2 patch between the grid samples (every 4 tiles, offset 2).
    for (let y = 4; y < 30; y++) for (let x = 4; x < 40; x++) g.setOwner(g.map.idx(x, y), 1);
    for (let y = 33; y < 35; y++) for (let x = 60; x < 62; x++) g.setOwner(g.map.idx(x, y), 2);
    const labels = computeLabels(g);
    const big = labels.get(1)!;
    expect(big[2]).toBeGreaterThan(4);
    const small = labels.get(2);
    expect(small).toBeDefined();
    const [x, y] = small!;
    expect(g.owner[g.map.idx(Math.floor(x), Math.floor(y))]).toBe(2);
  });
});
