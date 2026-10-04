// Team games (1.11.0): teammates are allies for good — never attacked, gifts allowed, the
// nations of a team help each other (OpenFront's donateTroops); ships keep their map size.
import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, makeGame, run } from '../helpers';
import { isTeammate, teammatesOf } from '../../src/ui/game/team';
import { shipPx } from '../../src/render/ships';
import { U } from '../../src/core/units/unit';
import type { PlayerView } from '../../src/engine/protocol';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

describe('teammates', () => {
  it('cannot attack each other but can give each other gold and troops, without a pact', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [45, 20],
    ]);
    for (let y = 6; y < 36; y++) for (let x = 6; x < 80; x++) g.setOwner(g.map.idx(x, y), x < 41 ? 1 : 2);
    const [a, b] = [g.players[1]!, g.players[2]!];
    a.team = b.team = 1;
    a.troops = 80_000;
    a.gold = 1_000_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.3 })]);
    expect(g.attacks.some((x) => x.attacker === 1 && x.target === 2)).toBe(false);
    expect(a.allies.has(2)).toBe(false); // no pact: teammates for good
    const [bg, bt] = [b.gold, b.troops];
    g.step([cmd(1, { t: 'donate', target: 2, gold: 400_000, troops: 10_000 })]);
    expect(b.gold - bg).toBeGreaterThan(399_000);
    expect(b.troops - bt).toBeGreaterThan(9_000);
    // An alliance offer between teammates is pointless: ignored.
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    expect(b.allyRequests.has(1)).toBe(false);
  });

  it('the nations of a team never fight each other and send troops to a teammate at war', () => {
    const g = makeGame('europe', {
      mode: 'teams',
      nations: 16,
      tribes: 6,
      difficulty: 'hard',
      players: [],
    });
    let sameTeam = 0;
    let gifts = 0;
    run(g, 10 * 60 * 10, (_tick, game) => {
      for (const a of game.attacks) {
        const A = game.players[a.attacker];
        const T = game.players[a.target];
        if (!a.done && A && T && a.target > 0 && A.team > 0 && A.team === T.team) sameTeam++;
      }
      for (const e of game.events)
        if (e.k === 'notify' && e.key === 'notify.donation') {
          const from = game.players[(e.params as { from: number }).from]!;
          if (from.team > 0 && from.team === game.players[e.to]!.team) gifts++;
        }
      return [];
    });
    expect(sameTeam).toBe(0);
    expect(gifts).toBeGreaterThan(0);
  });

  it('are recognised by the interface (same team > 0, the viewer aside)', () => {
    const pv = (id: number, team: number, alive = true) => ({ id, team, alive, tiles: id }) as PlayerView;
    const list = [pv(1, 1), pv(2, 1), pv(3, 2), pv(4, 1, false), pv(5, 0)];
    const map = new Map(list.map((p) => [p.id, p]));
    expect(isTeammate(map, 1, 2)).toBe(true);
    expect(isTeammate(map, 1, 3)).toBe(false);
    expect(isTeammate(map, 1, 1)).toBe(false);
    expect(isTeammate(map, 5, 5)).toBe(false);
    expect(
      isTeammate(
        new Map([
          [5, pv(5, 0)],
          [6, pv(6, 0)],
        ]),
        5,
        6,
      ),
    ).toBe(false);
    expect(teammatesOf(list, 1).map((p) => p.id)).toEqual([2]);
    expect(teammatesOf(list, 5)).toEqual([]);
  });
});

describe('ships on the map', () => {
  it('keep their length in tiles whatever the zoom, with a few pixels at least', () => {
    for (const type of [U.Transport, U.Warship, U.Merchant]) {
      const near = shipPx(type, 8) / 8;
      expect(shipPx(type, 4) / 4).toBeCloseTo(near);
      expect(shipPx(type, 16) / 16).toBeCloseTo(near);
      // Zoomed out they never grow against the map; far out, a small dot remains.
      expect(shipPx(type, 1) / 1).toBeGreaterThanOrEqual(near);
      expect(shipPx(type, 0.5)).toBeGreaterThanOrEqual(6);
      expect(shipPx(type, 0.5)).toBeLessThanOrEqual(10);
    }
    expect(shipPx(U.Warship, 4)).toBeGreaterThan(shipPx(U.Transport, 4));
  });
});
