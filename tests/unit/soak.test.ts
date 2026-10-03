// Regressions found by the headless soak tests (AI games + random commands on every map).
import { describe, expect, it, vi } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

describe('soak regressions', () => {
  it('an eliminated player keeps no alliance nor pending offer', () => {
    const g = testGame(asciiMap(FIELD, 6), 3);
    startWith(g, [
      [25, 20],
      [60, 20],
      [95, 20],
    ]);
    const [a, b, c] = [g.players[1]!, g.players[2]!, g.players[3]!];
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true }), cmd(3, { t: 'allyRequest', target: 1 })]);
    expect(a.allies.has(2)).toBe(true);
    expect(a.allyRequests.has(3)).toBe(true);
    g.step([cmd(1, { t: 'surrender' })]);
    expect(a.alive).toBe(false);
    expect(b.allies.has(1)).toBe(false);
    // The loser's own side used to survive: a spectating loser saw expired pacts counting down.
    expect(a.allies.size).toBe(0);
    expect(a.allyRequests.size).toBe(0);
    expect(c.alive).toBe(true);
  });

  it('a save keeps only the turns its snapshot already ran', async () => {
    // saves.ts reaches the Electron bridge through `window` when it loads.
    vi.stubGlobal('window', {});
    const { migrateSave } = await import('../../src/ui/game/saves');
    vi.unstubAllGlobals();
    const raw = {
      format: 'isoline-save' as const,
      version: 1,
      date: '',
      slot: 1,
      mapName: { fr: '', en: '' },
      tick: 120,
      viewer: 1,
      snapshot: { core: { tick: 120 } } as never,
      turns: [
        [50, [[1, { t: 'surrender' as const }]]],
        [119, [[1, { t: 'ping' as const, tile: 3, kind: 0 }]]],
        // Recorded while the worker was serialising the game: never simulated by the save.
        [120, [[1, { t: 'ping' as const, tile: 4, kind: 0 }]]],
        [121, [[1, { t: 'ping' as const, tile: 5, kind: 0 }]]],
      ] as never,
    };
    expect(migrateSave(raw).turns.map(([t]) => t)).toEqual([50, 119]);
  });
});
