import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import {
  B,
  CAPITAL_AI_DELAY,
  CAPITAL_DISORG_TICKS,
  CAPITAL_MOVE_COOLDOWN,
  GOLD_PER_TICK,
} from '../../src/core/game/constants';
import type { Game } from '../../src/core/game/state';
import type { Player } from '../../src/core/game/player';
import type { GameEvent } from '../../src/core/game/events';
import {
  bestCapitalSpot,
  capitalGoldMult,
  capitalGrowthMult,
  capitalSpeedMult,
  capitalSpotError,
  isDisorganised,
  spotError,
} from '../../src/core/rules/capital';
import { Attack, attackLogic } from '../../src/core/rules/combat';
import { placeBuilding } from '../../src/core/buildings/buildings';
import { isWellFormed } from '../../src/core/net/commands';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

/** Hands every land tile of the rectangle [x0, x1) × [y0, y1) to player `pid`. */
function own(g: Game, pid: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (g.map.isLand(g.map.idx(x, y))) g.setOwner(g.map.idx(x, y), pid);
}

/** Two humans: player 1 holds the west half (x < 60), player 2 the east half. */
function duel(): { g: Game; a: Player; b: Player } {
  const g = testGame(asciiMap(FIELD, 6), 2);
  startWith(g, [
    [30, 20],
    [90, 20],
  ]);
  own(g, 1, 6, 6, 60, 36);
  own(g, 2, 60, 6, 114, 36);
  return { g, a: g.players[1]!, b: g.players[2]! };
}

const notices = (g: Game, to: number) =>
  g.events.filter((e): e is Extract<GameEvent, { k: 'notify' }> => e.k === 'notify' && e.to === to);

describe('capital', () => {
  it('humans and nations govern from their spawn tile; tribes have no capital', () => {
    const map = asciiMap(FIELD, 6);
    map.meta.nations = [{ name: { fr: 'N', en: 'N' }, x: 90, y: 20, flagSeed: 1 }] as never;
    map.meta.spawnPoints = [[60, 30]];
    const g = testGame(map, 1, { nations: 1, tribes: 1 });
    expect(g.players[1]!.capital).toBe(-1); // nothing before the match starts
    startWith(g, [[30, 20]]);
    const human = g.players[1]!;
    const nation = g.players.find((q) => q?.kind === 'nation')!;
    const tribe = g.players.find((q) => q?.kind === 'tribe')!;
    expect(human.capital).toBe(g.map.idx(30, 20));
    expect(nation.capital).toBe(g.map.idx(90, 20));
    expect(tribe.capital).toBe(-1);
    // A brand-new capital: no malus, and a first move needs no waiting.
    expect(capitalGoldMult(g, human)).toBe(1);
    expect(human.capitalSetTick).toBe(-1);
  });

  it('a capital taken by a land attack disorganises its owner for 60 s and yields 10 % of its gold', () => {
    const { g, a, b } = duel();
    // Player 2's capital, a few rows behind the front line (set directly for the test).
    b.capital = g.map.idx(64, 20);
    a.troops = 2_000_000;
    b.troops = 20_000;
    a.gold = 0;
    b.gold = 1_000_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(60, 20), ratio: 0.5 })]);
    let lost: Extract<GameEvent, { k: 'capitalLost' }> | undefined;
    let guard = 0;
    while (b.capital >= 0 && guard++ < 300) {
      g.step([]);
      lost ??= g.events.find((e): e is Extract<GameEvent, { k: 'capitalLost' }> => e.k === 'capitalLost');
      if (b.capital < 0) {
        expect(notices(g, 2).some((e) => e.key === 'notify.capitalLost' && e.level === 'danger')).toBe(true);
        expect(notices(g, 1).some((e) => e.key === 'notify.capitalTaken')).toBe(true);
        expect(notices(g, -1).some((e) => e.key === 'event.capitalFell')).toBe(true);
      }
    }
    // Halt the offensive: player 2 survives without its capital.
    g.step(g.attacks.map((x) => cmd(1, { t: 'cancelAttack', id: x.id })));
    expect(b.alive).toBe(true);
    expect(b.capital).toBe(-1);
    expect(lost).toMatchObject({ player: 2, by: 1, tile: g.map.idx(64, 20) });
    // 10 % of the treasury (≈ 1 M, plus a few seconds of income) changed hands.
    expect(lost!.gold).toBeGreaterThanOrEqual(100_000);
    expect(lost!.gold).toBeLessThan(102_000);
    expect(a.gold).toBeGreaterThanOrEqual(lost!.gold);
    const fell = b.capitalLostTick;
    expect(b.disorgUntil).toBe(fell + CAPITAL_DISORG_TICKS);
    // Disorganised: −25 % troop growth, −25 % passive gold, attacks 20 % slower.
    expect(isDisorganised(g, b)).toBe(true);
    expect(capitalGrowthMult(g, b)).toBe(0.75);
    expect(capitalSpeedMult(g, b)).toBe(0.8);
    g.step([]);
    expect(b.income).toBe(Math.floor(GOLD_PER_TICK.human * 0.75));
    const strike = new Attack(9999, 2, 1, 50_000, g.tick);
    const tile = g.map.idx(50, 30);
    const slow = attackLogic(g, strike, tile, 10).tickFraction;
    const until = b.disorgUntil;
    b.disorgUntil = -1;
    const normal = attackLogic(g, strike, tile, 10).tickFraction;
    b.disorgUntil = until;
    expect(slow / normal).toBeCloseTo(1 / 0.8, 9);
    // After the minute: still no capital, a lingering −10 % on the passive income.
    while (g.tick < fell + CAPITAL_DISORG_TICKS) g.step([]);
    expect(isDisorganised(g, b)).toBe(false);
    g.step([]);
    expect(b.income).toBe(Math.floor(GOLD_PER_TICK.human * 0.9));
    // The player chooses a new seat deep inside: everything back to normal.
    g.step([cmd(2, { t: 'moveCapital', tile: g.map.idx(100, 20) })]);
    expect(b.capital).toBe(g.map.idx(100, 20));
    g.step([]);
    expect(b.income).toBe(GOLD_PER_TICK.human);
  });

  it('a capital razed by a nuke (tile back to the wilderness) is lost with nobody to loot it', () => {
    const { g, b } = duel();
    b.gold = 500_000;
    const cap = b.capital;
    g.setOwner(cap, 0);
    g.step([]);
    expect(b.capital).toBe(-1);
    expect(b.disorgUntil).toBe(g.tick - 1 + CAPITAL_DISORG_TICKS);
    expect(notices(g, 2).some((e) => e.key === 'notify.capitalRazed')).toBe(true);
    // (The tick's income came first: 10 % of 500,100.)
    expect(g.events.some((e) => e.k === 'capitalLost' && e.by === 0 && e.gold === 50_010)).toBe(true);
    expect(b.gold).toBe(500_100 - 50_010);
    expect(g.events.some((e) => e.k === 'loot')).toBe(false);
  });

  it('moveCapital: own land only, away from foreign borders and fallout, once per 5 min', () => {
    const { g, a, b } = duel();
    const at = (x: number, y: number) => g.map.idx(x, y);
    const refused = (key: string) => notices(g, 1).some((e) => e.key === key);
    const start = a.capital;
    g.step([cmd(1, { t: 'moveCapital', tile: at(80, 20) })]);
    expect(refused('error.capital.notOwned')).toBe(true);
    // Player 2's land starts at x = 60: x = 56 is 4 tiles away, x = 54 is 6.
    g.step([cmd(1, { t: 'moveCapital', tile: at(56, 20) })]);
    expect(refused('error.capital.front')).toBe(true);
    g.setFallout(at(20, 20), 120);
    g.step([cmd(1, { t: 'moveCapital', tile: at(20, 20) })]);
    expect(refused('error.capital.fallout')).toBe(true);
    expect(a.capital).toBe(start);
    g.step([cmd(1, { t: 'moveCapital', tile: at(54, 20) })]);
    expect(a.capital).toBe(at(54, 20));
    expect(notices(g, 1).some((e) => e.key === 'notify.capitalMoved')).toBe(true);
    expect(g.events.some((e) => e.k === 'capitalMoved' && e.player === 1)).toBe(true);
    // A second move must wait 5 minutes.
    g.step([cmd(1, { t: 'moveCapital', tile: at(20, 30) })]);
    const cd = notices(g, 1).find((e) => e.key === 'error.capital.cooldown');
    expect(cd?.params?.s).toBe(CAPITAL_MOVE_COOLDOWN / 10);
    expect(a.capital).toBe(at(54, 20));
    while (g.tick < a.capitalSetTick + CAPITAL_MOVE_COOLDOWN) g.step([]);
    g.step([cmd(1, { t: 'moveCapital', tile: at(20, 30) })]);
    expect(a.capital).toBe(at(20, 30));
    // A lost capital is re-established at once, cooldown or not.
    g.setOwner(a.capital, 0);
    g.step([]);
    expect(a.capital).toBe(-1);
    g.step([cmd(1, { t: 'moveCapital', tile: at(30, 25) })]);
    expect(a.capital).toBe(at(30, 25));
    // Allies' land does not count as a foreign border.
    g.step([cmd(2, { t: 'moveCapital', tile: at(63, 20) })]);
    expect(notices(g, 2).some((e) => e.key === 'error.capital.front')).toBe(true);
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    expect(b.allies.has(1)).toBe(true);
    g.step([cmd(2, { t: 'moveCapital', tile: at(63, 20) })]);
    expect(b.capital).toBe(at(63, 20));
    // Tribes never hold one; malformed orders are dropped.
    expect(isWellFormed({ t: 'moveCapital', tile: 12 })).toBe(true);
    expect(isWellFormed({ t: 'moveCapital', tile: 1.5 })).toBe(false);
    expect(isWellFormed({ t: 'moveCapital' })).toBe(false);
  });

  it('the placement check is shared by the client preview', () => {
    const { g, a } = duel();
    const view = {
      owner: g.owner,
      terrain: g.map.terrain,
      fallout: g.fallout,
      flags: g.flags,
      width: g.map.width,
      height: g.map.height,
    };
    for (const x of [20, 50, 54, 55, 56, 58, 80])
      expect(capitalSpotError(view, g.map.idx(x, 20), 1, () => false)).toBe(
        spotError(g, a, g.map.idx(x, 20)),
      );
  });

  it('nations re-establish a lost capital by themselves after 10 s, in their largest interior city', () => {
    const map = asciiMap(FIELD, 6);
    map.meta.nations = [{ name: { fr: 'N', en: 'N' }, x: 90, y: 20, flagSeed: 1 }] as never;
    const g = testGame(map, 1, { nations: 1 });
    startWith(g, [[20, 20]]);
    const n = g.players.find((q) => q?.kind === 'nation')!;
    own(g, n.id, 70, 6, 114, 36);
    const city = placeBuilding(g, n, B.City, g.map.idx(100, 28), true)!;
    expect(city.buildLeft).toBe(0);
    g.setOwner(n.capital, 0); // razed
    g.step([]);
    const fell = n.capitalLostTick;
    expect(fell).toBe(g.tick - 1);
    expect(n.capital).toBe(-1);
    while (g.tick < fell + CAPITAL_AI_DELAY) {
      g.step([]);
      expect(n.capital).toBe(-1);
    }
    g.step([]);
    expect(n.capital).toBe(city.tile);
    expect(spotError(g, n, n.capital)).toBe('ok');
    expect(g.events.some((e) => e.k === 'capitalMoved' && e.player === n.id)).toBe(true);
    // Without cities: the deepest valid spot.
    const g2 = testGame(map, 1, { nations: 1 });
    startWith(g2, [[20, 20]]);
    const n2 = g2.players.find((q) => q?.kind === 'nation')!;
    own(g2, n2.id, 70, 6, 114, 36);
    own(g2, 1, 6, 6, 70, 36);
    const spot = bestCapitalSpot(g2, n2);
    expect(spotError(g2, n2, spot)).toBe('ok');
    expect(spot % g2.map.width).toBeGreaterThan(80);
  });

  it('save/load keeps the capital state; old saves get a capital at their largest city', () => {
    const { g, a, b } = duel();
    placeBuilding(g, a, B.City, g.map.idx(40, 12), true);
    const lv2 = placeBuilding(g, a, B.City, g.map.idx(20, 28), true)!;
    lv2.level = 2;
    g.setOwner(b.capital, 1);
    g.step([]);
    expect(b.capital).toBe(-1);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    const r = restoreSnapshot(g.map, snap);
    for (const id of [1, 2]) {
      const [p, q] = [g.players[id]!, r.players[id]!];
      expect([q.capital, q.disorgUntil, q.capitalLostTick, q.capitalSetTick]).toEqual([
        p.capital,
        p.disorgUntil,
        p.capitalLostTick,
        p.capitalSetTick,
      ]);
    }
    const script = (k: number) =>
      k === 5 ? [cmd(2, { t: 'moveCapital' as const, tile: g.map.idx(100, 20) })] : [];
    for (let k = 0; k < 60; k++) {
      g.step(script(k));
      r.step(script(k));
    }
    expect(r.players[2]!.capital).toBe(g.map.idx(100, 20));
    expect(hashGame(r)).toBe(hashGame(g));
    // A 1.2 save: no capital fields at all.
    const old = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    for (const raw of old.players as (Record<string, unknown> | null)[]) {
      if (!raw) continue;
      delete raw.capital;
      delete raw.disorgUntil;
      delete raw.capitalLostTick;
      delete raw.capitalSetTick;
    }
    const m = restoreSnapshot(g.map, old);
    expect(m.players[1]!.capital).toBe(lv2.tile);
    expect(m.players[2]!.capital).toBeGreaterThanOrEqual(0);
    expect(m.owner[m.players[2]!.capital]).toBe(2);
    expect(m.players[2]!.disorgUntil).toBe(-1);
  });
});
