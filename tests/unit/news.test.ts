// The news reports how each country fell: the elimination event carries its cause.
import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd } from '../helpers';
import type { Game } from '../../src/core/game/state';
import type { GameEvent } from '../../src/core/game/events';
import { WORLD_EVENTS, WORLD_EVENT_TICKS } from '../../src/core/rules/features';
import { TradeLedger, embargoesOf } from '../../src/engine/tradeLedger';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

function duel(): Game {
  const g = testGame(asciiMap(FIELD, 6), 3);
  startWith(g, [
    [25, 20],
    [60, 20],
    [95, 20],
  ]);
  return g;
}

const fall = (events: GameEvent[]) => events.find((e) => e.k === 'eliminated');

describe('elimination causes', () => {
  it('surrender', () => {
    const g = duel();
    g.step([cmd(2, { t: 'surrender' })]);
    expect(fall(g.events)).toMatchObject({ k: 'eliminated', player: 2, by: 0, cause: 'surrender' });
    const note = g.events.find((e) => e.k === 'notify' && e.key === 'event.eliminated');
    expect(note).toMatchObject({ params: { player: 2, cause: 'surrender' } });
  });

  it('conquered by the country that takes the last tile', () => {
    const g = duel();
    g.step([]);
    for (let i = 0; i < g.owner.length; i++) if (g.owner[i] === 2) g.setOwner(i, 1);
    expect(fall(g.events)).toMatchObject({ player: 2, by: 1, cause: 'conquered' });
    expect(g.players[2]!.alive).toBe(false);
  });

  it('razed: the last tiles go back to the wilderness', () => {
    const g = duel();
    g.step([]);
    for (let i = 0; i < g.owner.length; i++) if (g.owner[i] === 3) g.setOwner(i, 0);
    expect(fall(g.events)).toMatchObject({ player: 3, by: 0, cause: 'nuked' });
  });
});

describe('world events', () => {
  it('every event has a duration', () => {
    for (const id of WORLD_EVENTS) expect(WORLD_EVENT_TICKS[id]).toBeGreaterThan(0);
  });
});

describe('trade ledger', () => {
  const pay = (k: 'tradePay' | 'trainPay', owner: number, amount: number, x = 0, y = 0): GameEvent => ({
    k,
    x,
    y,
    owner,
    amount,
  });

  it('pairs both ends of a delivery and credits the viewer with its partner', () => {
    const l = new TradeLedger();
    l.track(
      [
        pay('tradePay', 1, 1000, 5, 5), // our merchant: our home port…
        pay('tradePay', 2, 1300, 40, 9), // …and the destination (naval research ×1.3)
        pay('trainPay', 3, 200, 7, 7), // a foreign train at our station…
        pay('trainPay', 1, 200, 7, 7), // …pays us as the host
        pay('trainPay', 1, 90, 8, 8), // our train in our own city: domestic
        pay('tradePay', 4, 500, 3, 3), // pirated cargo: a single payout, not ours
      ],
      1,
      100,
    );
    const g = duel();
    g.addPlayer({ fr: 'C', en: 'C' }, 'nation').alive = true;
    const rows = l.partners(g, g.players[1]!);
    expect(rows.find((r) => r.id === 2)).toMatchObject({ sea: 1000, rail: 0 });
    expect(rows.find((r) => r.id === 3)).toMatchObject({ sea: 0, rail: 200 });
    expect(rows.some((r) => r.id === 4)).toBe(false);
  });

  it('lists embargoes both ways, manual and temporary', () => {
    const g = duel();
    g.step([cmd(1, { t: 'embargo', target: 2, on: true }), cmd(3, { t: 'embargo', target: 1, on: true })]);
    g.players[2]!.embargoUntil.set(1, g.tick + 100);
    const e = embargoesOf(g, g.players[1]!);
    expect(e.find((r) => r.id === 2)).toMatchObject({ mine: true, theirs: false, theirsFor: 100 });
    expect(e.find((r) => r.id === 3)).toMatchObject({ mine: false, theirs: true, mineFor: 0 });
  });
});
