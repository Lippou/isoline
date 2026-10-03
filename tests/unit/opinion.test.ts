import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, run } from '../helpers';
import {
  ALLIANCE_RENEW_WINDOW,
  ALLIANCE_TICKS,
  ATTACK_RELATION,
  GIFT_GOLD_CHUNK,
  RELATION_BETRAYED,
  TRADE_WARMTH_WINDOW,
  WARMTH,
} from '../../src/core/game/constants';
import { Player } from '../../src/core/game/player';
import { commonEnemy, enemiesOf, giftRelation, noteTrade } from '../../src/core/rules/diplomacy';
import { opinionLevel, opinionOf, roundRelation } from '../../src/core/rules/opinion';
import { allianceOdds } from '../../src/core/npc/ai';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';
import type { Game } from '../../src/core/game/state';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

/** Sum of a relation's causes (they always add up to the relation). */
const causeSum = (p: Player, other: number) =>
  Object.values(p.relationCauses.get(other) ?? {}).reduce((a, b) => a + b, 0);

/** Two humans far apart (1 west, 2 east), already playing. */
function pair(): { g: Game; a: Player; b: Player } {
  const g = testGame(asciiMap(FIELD, 6), 2);
  startWith(g, [
    [25, 20],
    [90, 20],
  ]);
  return { g, a: g.players[1]!, b: g.players[2]! };
}

/** Steps until the relation pass (every 10 ticks) has run `n` more times. */
function seconds(g: Game, n: number): void {
  run(g, n * 10);
}

describe('relation causes', () => {
  it('add up to the relation through clamps and decay', () => {
    const p = new Player(1, { fr: 'A', en: 'A' }, 'nation');
    p.updateRelation(2, RELATION_BETRAYED, 'betrayed');
    p.updateRelation(2, ATTACK_RELATION.normal, 'attacked');
    expect(p.relation(2)).toBe(-100);
    const c = p.relationCauses.get(2)!;
    expect(c.betrayed! + c.attacked!).toBeCloseTo(-100, 9);
    expect(c.betrayed! / c.attacked!).toBeCloseTo(100 / 70, 9); // scaled alike
    p.updateRelation(2, 30, 'gift');
    expect(causeSum(p, 2)).toBeCloseTo(p.relation(2), 9);
    for (let k = 0; k < 50; k++) {
      p.decayRelations(0.5);
      expect(causeSum(p, 2)).toBeCloseTo(p.relation(2), 6);
    }
    for (let k = 0; k < 200; k++) p.decayRelations(0.5);
    expect(p.relations.has(2)).toBe(false);
    expect(p.relationCauses.has(2)).toBe(false);
  });

  it('a relation without a known cause (older saves) reads as past feelings', () => {
    const p = new Player(1, { fr: 'A', en: 'A' }, 'nation');
    p.relations.set(2, -30);
    p.decayRelations(0.5);
    expect(p.relationCauses.get(2)).toEqual({ past: -29.5 });
  });

  it('attacks and betrayals are told apart (OpenFront values unchanged)', () => {
    const { g, a, b } = pair();
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    expect(a.allies.has(2)).toBe(true);
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(b.relation(1)).toBe(RELATION_BETRAYED);
    expect(Object.keys(b.relationCauses.get(1)!)).toContain('betrayed');
    expect(causeSum(b, 1)).toBeCloseTo(b.relation(1), 9);
  });
});

describe('goodwill (Isoline)', () => {
  it('allies warm to each other up to the alliance ceiling, higher once the alliance has lasted', () => {
    const { g, a, b } = pair();
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    expect(a.allySince.get(2)).toBe(g.tick - 1);
    seconds(g, 20);
    // +0.5 a second, net of the decay.
    expect(b.relation(1)).toBeGreaterThan(9);
    expect(b.relation(1)).toBeLessThan(11);
    seconds(g, 200);
    expect(b.relation(1)).toBeCloseTo(WARMTH.ally.ceiling, 0);
    expect(a.relation(2)).toBeCloseTo(WARMTH.ally.ceiling, 0);
    expect(opinionOf(g, b, a).reasons[0]![0]).toBe('ally');
    // Renewed past its first term: a long-standing alliance.
    while (g.tick < a.allySince.get(2)! + ALLIANCE_TICKS - ALLIANCE_RENEW_WINDOW + 20) g.step([]);
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    const since = a.allySince.get(2)!;
    while (g.tick < since + ALLIANCE_TICKS + 10) g.step([]);
    seconds(g, 60);
    expect(b.relation(1)).toBeCloseTo(WARMTH.longAlly.ceiling, 0);
    const o = opinionOf(g, b, a);
    expect(o.level).toBe('friendly');
    expect(o.reasons[0]![0]).toBe('longAlly');
    // Betrayed: the goodwill of the former alliance remains beside the betrayal.
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(b.allySince.has(1)).toBe(false);
    const after = new Map(opinionOf(g, b, a).reasons);
    expect(after.get('betrayed')).toBe(RELATION_BETRAYED);
    expect(after.get('formerAlly')).toBeGreaterThan(50);
  });

  it('trade keeps goodwill alive for a minute after the last payment', () => {
    const { g, a, b } = pair();
    noteTrade(g, a, b);
    seconds(g, 30);
    expect(b.relation(1)).toBeGreaterThan(5);
    expect(b.relationCauses.get(1)!.trade).toBeCloseTo(b.relation(1), 6);
    run(g, TRADE_WARMTH_WINDOW);
    const peak = b.relation(1);
    expect(peak).toBeLessThanOrEqual(WARMTH.trade.ceiling);
    expect(b.lastTrade.has(1)).toBe(false);
    seconds(g, 10);
    expect(b.relation(1)).toBeLessThan(peak); // decaying again
  });

  it('countries fighting the same enemy warm to each other', () => {
    const g = testGame(asciiMap(FIELD, 6), 3);
    startWith(g, [
      [20, 20],
      [60, 20],
      [100, 20],
    ]);
    // 1 and 3 both attack 2 in the middle.
    const own = (pid: number, x0: number, x1: number) => {
      for (let y = 6; y < 36; y++) for (let x = x0; x < x1; x++) g.setOwner(g.map.idx(x, y), pid);
    };
    own(1, 6, 40);
    own(2, 40, 80);
    own(3, 80, 114);
    for (const p of g.players) if (p) p.troops = 400_000;
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.2 }),
      cmd(3, { t: 'attack', tile: g.map.idx(75, 20), ratio: 0.2 }),
    ]);
    const enemies = enemiesOf(g);
    expect(commonEnemy(enemies, 1, 3)).toBe(true);
    expect(commonEnemy(enemies, 1, 2)).toBe(false);
    seconds(g, 3);
    const [p1, p2, p3] = [1, 2, 3].map((id) => g.players[id]!);
    expect(p1!.relation(3)).toBeGreaterThan(0);
    expect(p3!.relationCauses.get(1)!.enemy).toBeGreaterThan(0);
    expect(p2!.relation(1)).toBeLessThan(0); // the shared enemy resents both
  });

  it('gifts earn goodwill as in OpenFront (gold by chunks, troops past a threshold)', () => {
    const { g, a, b } = pair();
    g.config.allowDonations = true;
    const chunk = Math.round(GIFT_GOLD_CHUNK.normal * (1 + g.tick / (ALLIANCE_TICKS + g.startTick)));
    expect(giftRelation(g, b, chunk * 3, 0)).toBe(15);
    expect(giftRelation(g, b, chunk * 100, 0)).toBe(100);
    expect(giftRelation(g, b, chunk - 1, 0)).toBe(0);
    b.popCap = 100_000;
    expect(giftRelation(g, b, 0, 20_000)).toBe(50);
    expect(giftRelation(g, b, 0, 5_000)).toBe(0);
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    a.gold = chunk * 4;
    g.step([cmd(1, { t: 'donate', target: 2, gold: chunk * 4, troops: 0 })]);
    expect(b.relationCauses.get(1)!.gift).toBeGreaterThan(0);
  });
});

describe('opinion view', () => {
  it('levels follow OpenFront bands, values never round a resentment to 0', () => {
    expect(opinionLevel(-60)).toBe('hostile');
    expect(opinionLevel(-50)).toBe('wary');
    expect(opinionLevel(-0.5)).toBe('wary');
    expect(opinionLevel(0)).toBe('neutral');
    expect(opinionLevel(25)).toBe('cordial');
    expect(opinionLevel(50)).toBe('friendly');
    expect(roundRelation(-0.4)).toBe(-1);
    expect(roundRelation(0)).toBe(0);
  });

  it('a nation attacked by the viewer resents it, and its alliance odds drop to 0', () => {
    const { g, a } = pair();
    const n = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    for (let y = 6; y < 36; y++) for (let x = 40; x < 60; x++) g.setOwner(g.map.idx(x, y), n.id);
    for (let y = 6; y < 36; y++) for (let x = 6; x < 40; x++) g.setOwner(g.map.idx(x, y), 1);
    n.spawned = true;
    n.alive = true;
    n.personality = 'diplomat';
    n.troops = 50_000;
    a.troops = 200_000;
    let o = opinionOf(g, n, a);
    expect(o.value).toBe(0);
    expect(o.level).toBe('neutral');
    // Fair odds: the same function decides the nation's answer.
    expect(o.accept).toBeCloseTo(allianceOdds(g, n, a).p, 9);
    expect(o.odds.some(([k]) => k === 'stronger')).toBe(true);
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.1 })]);
    o = opinionOf(g, n, a);
    expect(o.value).toBe(ATTACK_RELATION.normal);
    expect(o.level).toBe('hostile');
    expect(o.reasons).toEqual([['attacked', ATTACK_RELATION.normal]]);
    expect(o.accept).toBe(0);
    expect(o.refusal).toBe('resent');
  });

  it('causes survive a save and the game goes on identically', () => {
    const { g, a, b } = pair();
    noteTrade(g, a, b);
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    seconds(g, 12);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(g)));
    const h = restoreSnapshot(g.map, snap);
    expect(h.players[2]!.relationCauses.get(1)).toEqual(b.relationCauses.get(1));
    expect(h.players[2]!.allySince.get(1)).toBe(b.allySince.get(1));
    run(g, 300);
    run(h, 300);
    expect(hashGame(h)).toBe(hashGame(g));
    expect(h.players[2]!.relation(1)).toBe(b.relation(1));
  });
});
