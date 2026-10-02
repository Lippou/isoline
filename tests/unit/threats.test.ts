import { describe, expect, it } from 'vitest';
import { asciiMap, startWith, testGame } from '../helpers';
import type { Game } from '../../src/core/game/state';
import type { Player } from '../../src/core/game/player';
import { launchAttack, finishAttack } from '../../src/core/rules/combat';
import {
  THREAT_GRACE,
  THREAT_MEMORY,
  THREAT_MIN_TICKS,
  ThreatWatch,
  aiAimsAt,
} from '../../src/engine/threats';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

function own(g: Game, pid: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (g.map.isLand(g.map.idx(x, y))) g.setOwner(g.map.idx(x, y), pid);
}

/** Player 1 (the viewer) holds the west half, player 2 the east half; the clock is moved by hand. */
function border(): {
  g: Game;
  a: Player;
  b: Player;
  watch: ThreatWatch;
  scan: (ticks?: number) => ReturnType<ThreatWatch['update']>;
} {
  const g = testGame(asciiMap(FIELD, 6), 2);
  startWith(g, [
    [30, 20],
    [90, 20],
  ]);
  own(g, 1, 6, 6, 60, 36);
  own(g, 2, 60, 6, 114, 36);
  const watch = new ThreatWatch();
  const a = g.players[1]!;
  return {
    g,
    a,
    b: g.players[2]!,
    watch,
    // View-only: no simulation step, only the clock moves (the scan runs once a second).
    scan: (ticks = 10) => {
      g.tick += ticks;
      return watch.update(g, a);
    },
  };
}

describe('threatened borders (view only)', () => {
  it('a much bigger neighbour raises the alert only with hostile intent', () => {
    const { g, a, b, scan } = border();
    a.troops = 100_000;
    b.troops = 300_000;
    expect(scan()).toEqual([]); // strong but peaceful
    b.updateRelation(1, -60); // it resents us
    const [t] = scan();
    expect(t).toMatchObject({ id: 2, ratio: 3, why: 'hostile' });
    // Pinned on the shared border (x = 59 | 60).
    expect(Math.floor(t!.x)).toBeGreaterThanOrEqual(59);
    expect(Math.floor(t!.x)).toBeLessThanOrEqual(60);
    // Our own feelings do not count: only the neighbour's intent.
    b.relations.clear();
    a.updateRelation(2, -100);
    expect(new ThreatWatch().update(g, a)).toEqual([]);
  });

  it('hysteresis: enters at ×1.75, holds down to ×1.4, shows at least 20 s, survives a 30 s lull', () => {
    const { a, b, scan } = border();
    a.troops = 100_000;
    b.updateRelation(1, -80);
    b.troops = 170_000;
    expect(scan()).toEqual([]); // under ×1.75
    b.troops = 180_000;
    expect(scan()).toHaveLength(1);
    b.troops = 150_000; // between ×1.4 and ×1.75: still up
    expect(scan(100)).toHaveLength(1);
    b.troops = 120_000; // below ×1.4, but shown for less than 20 s
    expect(scan(THREAT_MIN_TICKS - 120)).toHaveLength(1);
    expect(scan(30)).toEqual([]);
    b.troops = 160_000; // back over ×1.4 but under ×1.75: does not come back
    expect(scan()).toEqual([]);
    b.troops = 200_000;
    expect(scan()).toHaveLength(1);
    // The grudge fades: the alert lingers THREAT_GRACE, then clears.
    scan(THREAT_MIN_TICKS);
    b.relations.clear();
    expect(scan(THREAT_GRACE)).toHaveLength(1);
    expect(scan(20)).toEqual([]);
  });

  it('recent hostilities count for 3 minutes; allies and tribes never threaten', () => {
    const { g, a, b, watch, scan } = border();
    a.troops = 100_000;
    b.troops = 400_000;
    const strike = launchAttack(g, 2, 1, 1_000)!;
    expect(strike).not.toBeNull();
    watch.update(g, a); // tracked tick by tick
    finishAttack(g, strike, false);
    g.attacks = [];
    expect(scan()[0]).toMatchObject({ id: 2, why: 'war' });
    scan(THREAT_MEMORY);
    expect(scan(THREAT_GRACE)).toEqual([]);
    // An ally is never a threat, whatever it feels.
    b.updateRelation(1, -90);
    expect(scan()).toHaveLength(1);
    a.allies.set(2, g.tick + 3000);
    b.allies.set(1, g.tick + 3000);
    expect(scan()).toEqual([]);
  });

  it('AI intelligence: an idle nation army aims at its weakest neighbour', () => {
    const { g, a, b } = border();
    const n = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    n.alive = n.spawned = true;
    own(g, n.id, 60, 6, 114, 20); // north-east, touching both humans
    n.popCap = 500_000;
    n.troops = 450_000; // ≥ 85 % of its ceiling: idle
    a.troops = 50_000;
    b.troops = 80_000;
    expect(aiAimsAt(g, n, a)).toBe(true);
    expect(aiAimsAt(g, n, b)).toBe(false);
    n.troops = 300_000; // regenerating: no telling
    expect(aiAimsAt(g, n, a)).toBe(false);
    // A grudge (it lost troops to us) is enough.
    g.ai.mem.set(n.id, { grudge: new Map([[1, 8]]) } as never);
    expect(aiAimsAt(g, n, a)).toBe(true);
    const watch = new ThreatWatch();
    g.tick += 10;
    expect(watch.update(g, a).find((t) => t.id === n.id)).toMatchObject({ why: 'plan', ratio: 6 });
  });
});
