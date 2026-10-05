// Player feedback (1.16): « le nombre de nations doit être équivalent à la difficulté choisie ».
// The lobby's default nation count scales with the difficulty around the map's own default.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIONS_BY_DIFFICULTY, nationsForDifficulty } from '../../src/core/map/nationPick';
import type { MapMeta } from '../../src/core/map/gamemap';
import type { Difficulty } from '../../src/core/game/config';

const MAPS_DIR = path.resolve(import.meta.dirname, '../../assets/maps');
const meta = (id: string) =>
  JSON.parse(fs.readFileSync(path.join(MAPS_DIR, `${id}.json`), 'utf8')) as MapMeta;
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'impossible'];
const counts = (id: string) => {
  const m = meta(id);
  return DIFFS.map((d) => nationsForDifficulty(m.defaultNations ?? 30, m.nations.length, d));
};

describe('default nation count by difficulty', () => {
  it('Hard keeps the map default; Easy has fewer, Impossible more', () => {
    expect(NATIONS_BY_DIFFICULTY.hard).toBe(1);
    expect(counts('world')).toEqual([26, 37, 43, 52]);
    expect(counts('world-giant')).toEqual([104, 147, 173, 208]);
    expect(counts('europe')).toEqual([30, 43, 50, 50]);
  });

  it('never exceeds the map list, and grows with the difficulty on every shipped map', () => {
    const index = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, 'index.json'), 'utf8')) as {
      id: string;
      nations: number;
      defaultNations?: number;
    }[];
    for (const m of index) {
      const c = DIFFS.map((d) => nationsForDifficulty(m.defaultNations ?? 30, m.nations, d));
      for (let k = 1; k < c.length; k++) expect(c[k], m.id).toBeGreaterThanOrEqual(c[k - 1]!);
      for (const n of c) expect(n, m.id).toBeLessThanOrEqual(m.nations);
      expect(c[2], m.id).toBe(Math.min(m.nations, m.defaultNations ?? 30));
    }
  });

  it('a small map on Easy keeps at least 12 rivals (or all it has)', () => {
    expect(counts('black-sea')).toEqual([12, 13, 15, 15]);
    expect(nationsForDifficulty(30, 8, 'easy')).toBe(8);
    expect(nationsForDifficulty(10, 10, 'easy')).toBe(10);
    // Custom maps start from 30 (the former default), capped by their list.
    expect(nationsForDifficulty(30, 200, 'easy')).toBe(18);
    expect(nationsForDifficulty(30, 200, 'impossible')).toBe(36);
    expect(nationsForDifficulty(30, 0, 'hard')).toBe(0);
  });
});
