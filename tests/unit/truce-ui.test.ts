// The interface's reading of the world's truce (ui/game/truce.ts): the same rule as
// Game.truce / Game.inTruce, so that menus, the aircraft panel and the hover card name the
// summit or the Council's ceasefire before the order is refused.
import { describe, expect, it } from 'vitest';
import { truceCovers, truceOf } from '../../src/ui/game/truce';
import type { WorldView } from '../../src/engine/protocol';

const world = (patch: Partial<WorldView>) => ({ event: null, ceasefireUntil: -1, ...patch }) as WorldView;

describe('truce as the HUD sees it', () => {
  it('names a peace summit or the Council ceasefire, with the ticks left', () => {
    expect(truceOf(world({}), 100)).toBeNull();
    expect(truceOf(world({ ceasefireUntil: 400 }), 100)).toEqual({ reason: 'ceasefire', left: 300 });
    expect(truceOf(world({ ceasefireUntil: 400, event: { id: 'peaceSummit', until: 400 } }), 100)).toEqual({
      reason: 'summit',
      left: 300,
    });
    // A Council ceasefire outlasting the summit is named after it.
    expect(
      truceOf(world({ ceasefireUntil: 900, event: { id: 'peaceSummit', until: 400 } }), 100)!.reason,
    ).toBe('ceasefire');
    expect(truceOf(world({ ceasefireUntil: 400 }), 400)).toBeNull();
  });

  it('covers two countries, never a tribe or a revolution', () => {
    const players = new Map([
      [1, { kind: 'human' }],
      [2, { kind: 'nation' }],
      [3, { kind: 'tribe' }],
    ]);
    expect(truceCovers(players, 1, 2)).toBe(true);
    expect(truceCovers(players, 1, 3)).toBe(false);
    expect(truceCovers(players, 1, 1)).toBe(false);
    expect(truceCovers(players, 1, 0)).toBe(false);
  });
});
