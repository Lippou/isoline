import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, makeGame, run, invariants } from '../helpers';
import {
  ALLIANCE_TICKS,
  ATTACK_RELATION,
  RELATION_BETRAYED,
  RELATION_TRAITOR_NEIGHBOR,
  TEMP_EMBARGO_TICKS,
  TRAITOR_MARK_TICKS,
  B,
  OVERTIME_START,
  DOOMSDAY_GRACE,
  BATTLE_ROYALE_STEP,
  GENERAL_COOLDOWN,
  COUNCIL_PERIOD,
  COUNCIL_VOTE_TICKS,
  LOYALTY_SECESSION_THRESHOLD,
} from '../../src/core/game/constants';
import { currentThreshold } from '../../src/core/rules/victory';
import { placeBuilding, buildCost } from '../../src/core/buildings/buildings';
import { nextTechCost, techId, techSam, techSpeedMultiplier, TIER_COST } from '../../src/core/rules/tech';
import { recountResources, resourceBonus } from '../../src/core/rules/resources';
import { Resource } from '../../src/core/map/terrain';
import { hashGame } from '../../src/core/net/hash';
import {
  takeSnapshot,
  restoreSnapshot,
  snapshotFromJson,
  snapshotToJson,
  rleEncode,
  rleDecodeInto,
} from '../../src/core/net/snapshot';
import type { StampedCommand } from '../../src/core/net/commands';
import { isWellFormed } from '../../src/core/net/commands';
import { isNight, dayPhase } from '../../src/core/rules/features';
import { mapFromDisk } from '../helpers';

const FIELD = [
  '~~~~~~~~~~~~~~~~~~~~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~..................~',
  '~~~~~~~~~~~~~~~~~~~~',
];

describe('diplomacy', () => {
  it('alliances form, expire without penalty and can be renewed', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    expect(b.allyRequests.has(1)).toBe(true);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(a.allies.get(2)).toBe(g.tick - 1 + ALLIANCE_TICKS);
    // Renewal window: both ask again.
    for (let k = 0; k < ALLIANCE_TICKS - 100; k++) g.step([]);
    const exp = a.allies.get(2)!;
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyRequest', target: 1 })]);
    expect(a.allies.get(2)!).toBeGreaterThan(exp);
    for (let k = 0; k < ALLIANCE_TICKS + 20; k++) g.step([]);
    expect(a.allies.has(2)).toBe(false);
    expect(a.isTraitor(g.tick)).toBe(false);
  });

  it('refusals, donations and team checks', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: false })]);
    expect(a.allies.has(2)).toBe(false);
    a.gold = 1_000_000;
    g.step([cmd(1, { t: 'donate', target: 2, gold: 500_000, troops: 0 })]);
    expect(b.gold).toBeLessThan(400_000); // not allied → refused
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyRequest', target: 1 })]); // crossing requests = accept
    expect(a.allies.has(2)).toBe(true);
    const bg = b.gold;
    g.step([cmd(1, { t: 'donate', target: 2, gold: 500_000, troops: 1000 })]);
    expect(b.gold - bg).toBeGreaterThan(499_000);
    g.step([cmd(1, { t: 'embargoAll', on: true, exceptTeam: false })]);
    expect(a.embargo.has(2)).toBe(true);
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(a.allies.has(2)).toBe(false);
    // Breaking an alliance is a betrayal (as in OpenFront): traitor for 30 s.
    expect(a.isTraitor(g.tick)).toBe(true);
    for (let k = 0; k < TRAITOR_MARK_TICKS; k++) g.step([]);
    expect(a.isTraitor(g.tick)).toBe(false);
  });

  it('an attacked country stops trading with its attacker and resents it; an alliance lifts the embargo', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [45, 20],
    ]);
    // They touch (and player 2 is big enough not to be annexed on the first tile it loses).
    for (let y = 6; y < 36; y++) for (let x = 6; x < 80; x++) g.setOwner(g.map.idx(x, y), x < 41 ? 1 : 2);
    const [a, b] = [g.players[1]!, g.players[2]!];
    a.troops = 80_000;
    expect(a.hasEmbargoWith(b, g.tick)).toBe(false);
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.3 })]);
    expect(b.embargoUntil.get(1)).toBe(g.tick - 1 + TEMP_EMBARGO_TICKS);
    expect(a.hasEmbargoWith(b, g.tick)).toBe(true);
    expect(b.relation(1)).toBe(ATTACK_RELATION.normal); // OpenFront: −70 on medium
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(a.hasEmbargoWith(b, g.tick)).toBe(false);
  });

  it('each wave sent at a country is announced to it (screen-edge flash), reinforcements included', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [45, 20],
    ]);
    for (let y = 6; y < 36; y++) for (let x = 6; x < 80; x++) g.setOwner(g.map.idx(x, y), x < 41 ? 1 : 2);
    g.players[1]!.troops = 200_000;
    const waves = () => g.events.filter((e) => e.k === 'attackWave');
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.2 })]);
    const [w1] = waves();
    expect(w1).toMatchObject({ attacker: 1, target: 2 });
    expect(w1!.k === 'attackWave' && w1!.troops).toBeGreaterThan(30_000);
    expect(w1!.k === 'attackWave' && g.map.x(w1!.tile)).toBeGreaterThanOrEqual(40); // on the front
    g.step([]);
    expect(waves()).toHaveLength(0);
    // A second wave joins the attack under way: announced again.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.2 })]);
    expect(waves()).toHaveLength(1);
  });

  it('a wave answering our attack under way is a riposte; one we did not provoke is an invasion', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [45, 20],
    ]);
    for (let y = 6; y < 36; y++) for (let x = 6; x < 80; x++) g.setOwner(g.map.idx(x, y), x < 41 ? 1 : 2);
    g.players[1]!.troops = 200_000;
    g.players[2]!.troops = 200_000;
    const wave = () => g.events.find((e) => e.k === 'attackWave') as { riposte: boolean; attacker: number };
    // 1 attacks 2: an invasion of 2.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.1 })]);
    expect(wave()).toMatchObject({ attacker: 1, riposte: false });
    // 2 strikes back while 1's attack is under way: a riposte (1's screen shows no red edges)…
    g.step([cmd(2, { t: 'attack', tile: g.map.idx(35, 20), ratio: 0.3 })]);
    expect(wave()).toMatchObject({ attacker: 2, riposte: true });
    // …even when the clash ended 1's attack in the process (it was read first).
    expect(g.attacks.some((a) => !a.done && a.attacker === 1 && a.target === 2)).toBe(false);
    // 2 reinforces its push into 1's land, with no attack of 1's left to answer: an invasion.
    for (let k = 0; k < 5; k++) g.step([]);
    g.step([cmd(2, { t: 'attack', tile: g.map.idx(35, 20), ratio: 0.1 })]);
    expect(wave()).toMatchObject({ attacker: 2, riposte: false });
    // 1 strikes back at that attack (begun first): a riposte for 2.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(45, 20), ratio: 0.6 })]);
    expect(wave()).toMatchObject({ attacker: 1, riposte: true });
  });

  it('validates command shapes', () => {
    expect(isWellFormed({ t: 'attack', tile: 3, ratio: 0.5 })).toBe(true);
    expect(isWellFormed({ t: 'attack', tile: 3, ratio: 2 })).toBe(false);
    expect(isWellFormed({ t: 'nuke', kind: 0, tile: 1, count: 99 })).toBe(false);
    expect(isWellFormed({ t: 'nuke', kind: 0, tile: 1, count: 2, up: false })).toBe(true);
    expect(isWellFormed({ t: 'nuke', kind: 0, tile: 1, count: 2, up: 'down' })).toBe(false);
    expect(isWellFormed({ t: 'bogus' })).toBe(false);
    expect(isWellFormed(null)).toBe(false);
    expect(isWellFormed({ t: 'shipMove', ids: [1, 2], tile: 4, patrol: true })).toBe(true);
    expect(isWellFormed({ t: 'boatRetreat', id: 12 })).toBe(true);
    expect(isWellFormed({ t: 'boatRetreat', id: 1.5 })).toBe(false);
    expect(isWellFormed({ t: 'boatRetreat' })).toBe(false);
  });
});

describe('betrayal (OpenFront)', () => {
  /** Player 1 (west) betrays its ally 2 (far east); 3 and 4 border player 1, 4 is 2's teammate. */
  function betrayal() {
    const g = testGame(asciiMap(FIELD, 6), 4);
    startWith(g, [
      [25, 20],
      [95, 20],
      [48, 12],
      [48, 28],
    ]);
    const own = (pid: number, x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.setOwner(g.map.idx(x, y), pid);
    };
    own(1, 6, 6, 40, 36);
    own(3, 40, 6, 60, 21);
    own(4, 40, 21, 60, 36);
    const [p1, p2, p3, p4] = [1, 2, 3, 4].map((id) => g.players[id]!);
    p2!.team = p4!.team = 1;
    g.step([cmd(1, { t: 'allyRequest', target: 2 }), cmd(2, { t: 'allyRequest', target: 1 })]);
    expect(p1!.allies.has(2)).toBe(true);
    return { g, p1: p1!, p2: p2!, p3: p3!, p4: p4! };
  }

  it('the traitor is marked 30 s; the victim turns hostile (−100), its other neighbours distrustful (−40)', () => {
    const { g, p1, p2, p3, p4 } = betrayal();
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(p1.isTraitor(g.tick)).toBe(true);
    expect(p1.traitorUntil - g.tick + 1).toBe(TRAITOR_MARK_TICKS);
    expect(p1.debuffUntil).toBe(p1.traitorUntil);
    expect(p2.relation(1)).toBe(RELATION_BETRAYED);
    expect(p3.relation(1)).toBe(RELATION_TRAITOR_NEIGHBOR);
    expect(p4.relation(1)).toBe(0); // the victim's teammate is spared the neighbour malus
    expect(p2.hasEmbargoWith(p1, g.tick)).toBe(true);
    // Relations ease back to neutral by 0.05 a tick.
    const t0 = g.tick;
    while (g.tick < t0 + 100) g.step([]);
    expect(p2.relation(1)).toBeCloseTo(-95, 9);
    expect(p3.relation(1)).toBeCloseTo(-35, 9);
    run(g, 2000);
    expect(p2.relations.has(1)).toBe(false);
    expect(p1.isTraitor(g.tick)).toBe(false);
  });

  it('nations distrust a traitor: they refuse its alliances, drop it as an ally and attack it', () => {
    const { g, p1 } = betrayal();
    // Player 3's land goes to a nation allied with the future traitor, player 4's and the
    // west of player 1's to four tribes.
    const n = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    const tribes = [0, 1, 2, 3].map((k) => g.addPlayer({ fr: `T${k}`, en: `T${k}` }, 'tribe'));
    for (let y = 6; y < 36; y++) {
      for (let x = 40; x < 60; x++) g.setOwner(g.map.idx(x, y), y < 21 ? n.id : tribes[0]!.id);
      for (let x = 6; x < 20; x++) g.setOwner(g.map.idx(x, y), tribes[1 + Math.floor((y - 6) / 10)]!.id);
    }
    for (const q of [n, ...tribes]) {
      q.spawned = true;
      q.alive = true;
      q.troops = 1_000_000; // (cut back to their ceilings by the economy)
    }
    n.personality = 'diplomat';
    g.step([cmd(1, { t: 'allyRequest', target: n.id }), cmd(n.id, { t: 'allyRequest', target: 1 })]);
    expect(p1.allies.has(n.id)).toBe(true);
    p1.troops = 100_000; // under ×1.2 the nation's army: fair game
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(p1.isTraitor(g.tick)).toBe(true);
    expect(n.relation(1)).toBe(RELATION_TRAITOR_NEIGHBOR);
    let nationAttack = false;
    let tribeAttack = false;
    const t0 = g.tick;
    while (g.tick < t0 + TRAITOR_MARK_TICKS) {
      g.step([]);
      for (const a of g.attacks) {
        if (a.target !== 1) continue;
        if (a.attacker === n.id) nationAttack = true;
        if (tribes.some((q) => q.id === a.attacker)) tribeAttack = true; // one think in three
      }
    }
    expect(nationAttack).toBe(true);
    expect(tribeAttack).toBe(true);
    // The nation dropped its traitor ally without becoming a traitor itself.
    expect(n.allies.has(1)).toBe(false);
    expect(n.isTraitor(g.tick)).toBe(false);
  });

  it('a nation that resents the traitor turns down its alliance requests', () => {
    const { g, p1 } = betrayal();
    const n = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    for (let y = 6; y < 21; y++) for (let x = 40; x < 60; x++) g.setOwner(g.map.idx(x, y), n.id);
    n.spawned = true;
    n.alive = true;
    n.personality = 'diplomat';
    p1.troops = 200_000; // too strong for the nation to fall on it
    g.step([cmd(1, { t: 'allyBreak', target: 2 })]);
    expect(n.relation(1)).toBe(RELATION_TRAITOR_NEIGHBOR);
    g.step([cmd(1, { t: 'allyRequest', target: n.id })]);
    let refused = false;
    for (let k = 0; k < 150 && !refused; k++) {
      g.step([]);
      refused = g.events.some((e) => e.k === 'notify' && e.to === 1 && e.key === 'notify.allianceRefused');
    }
    expect(refused).toBe(true);
    expect(p1.allies.has(n.id)).toBe(false);
    expect(g.attacks.some((a) => a.attacker === n.id && a.target === 1)).toBe(false);
  });
});

describe('victory & modes', () => {
  it('territory threshold wins; overtime lowers it in FFA', () => {
    const g = testGame(asciiMap(FIELD, 4), 2, { victoryThreshold: 80 });
    startWith(g, [
      [10, 10],
      [70, 10],
    ]);
    expect(currentThreshold(g)).toBe(80);
    g.startTick = g.tick - OVERTIME_START - 1;
    expect(currentThreshold(g)).toBe(80);
    g.startTick = g.tick - OVERTIME_START - 5 * 600 - 1;
    expect(currentThreshold(g)).toBe(70);
    g.startTick = g.tick - OVERTIME_START - 3 * 5 * 600 - 1;
    expect(currentThreshold(g)).toBe(50);
    g.startTick = g.tick - OVERTIME_START - 120 * 600;
    expect(currentThreshold(g)).toBe(35); // floor: 35 % from 60 min on
    g.startTick = g.tick;
    const p = g.players[1]!;
    for (let i = 0; i < g.map.size; i++)
      if (g.map.isLand(i) && g.owner[i] === 0 && g.map.x(i) < 68) g.setOwner(i, 1);
    expect(p.usefulTiles / g.usefulLand).toBeGreaterThan(0.8);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(g.phase).toBe('ended');
    expect(g.victory.winner).toBe(1);
    expect(g.victory.reason).toBe('territory');
  });

  it('doomsday clock drains players below the threshold', () => {
    const g = testGame(asciiMap(FIELD, 12), 2, { mode: 'doomsday' });
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    g.startTick = g.tick - DOOMSDAY_GRACE - 1;
    const p = g.players[2]!;
    g.step([]);
    p.troops = p.popCap; // at the troop ceiling: no regeneration to offset the drain
    const troops = p.troops;
    for (let k = 0; k < 40; k++) g.step([]);
    expect(g.victory.doomsday).toBe(2);
    // ~1.5 % share each: both under 2 % → troops drain.
    expect(p.troops).toBeLessThan(troops);
  });

  it('battle royale shrinks the ring and kills outer tiles', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { mode: 'battleRoyale' });
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const land = g.usefulLand;
    for (let k = 0; k < BATTLE_ROYALE_STEP + 60; k++) g.step([]);
    expect(g.usefulLand).toBeLessThan(land);
    expect(g.isDead(g.map.idx(7, 7))).toBe(true);
  });

  it('a human can keep playing after the end: no further victory, the result is kept', () => {
    /** Player 1 wins on territory; `extra` commands are then applied tick by tick. */
    const play = (extra: (tick: number) => StampedCommand[]) => {
      const g = testGame(asciiMap(FIELD, 4), 2, { victoryThreshold: 80 });
      startWith(g, [
        [10, 10],
        [70, 10],
      ]);
      g.addPlayer({ fr: 'Nation', en: 'Nation' }, 'nation');
      // Asked while the match is running: nothing happens.
      g.step([cmd(1, { t: 'continue' })]);
      expect(g.victory.continued).toBeUndefined();
      for (let i = 0; i < g.map.size; i++)
        if (g.map.isLand(i) && g.owner[i] === 0 && g.map.x(i) < 68) g.setOwner(i, 1);
      for (let k = 0; k < 10; k++) g.step([]);
      expect(g.phase).toBe('ended');
      const end = g.tick;
      for (let k = 0; k < 120; k++) g.step(extra(g.tick - end));
      return g;
    };
    expect(isWellFormed({ t: 'continue' })).toBe(true);
    const script = (k: number): StampedCommand[] =>
      k === 3
        ? [cmd(3, { t: 'continue' })] // not a human: ignored
        : k === 5
          ? [cmd(1, { t: 'continue' })]
          : k === 40
            ? [cmd(2, { t: 'surrender' })] // the last rival falls: still no end
            : [];
    const g = play(script);
    expect(g.phase).toBe('playing');
    expect(g.victory.continued).toBe(true);
    expect(g.victory.winner).toBe(1);
    expect(g.victory.reason).toBe('territory');
    expect(g.victory.endTick).toBeLessThan(g.tick - 100);
    expect(g.players[2]!.alive).toBe(false);
    // The simulation runs again: the economy pays, attacks can be launched.
    const p = g.players[1]!;
    const gold = p.gold;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(75, 10), ratio: 0.5 })]);
    expect(g.attacks.length).toBe(1);
    for (let k = 0; k < 20; k++) g.step([]);
    expect(p.gold).toBeGreaterThan(gold);
    expect(g.phase).toBe('playing');
    // The command goes through the log: replays and snapshots stay deterministic.
    expect(hashGame(play(script))).toBe(hashGame(play(script)));
    const r = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(r.phase).toBe('playing');
    expect(r.victory.continued).toBe(true);
    for (let k = 0; k < 20; k++) [g, r].forEach((x) => x.step([]));
    expect(hashGame(r)).toBe(hashGame(g));
    // Without the command, the match stays over.
    const idle = play(() => []);
    expect(idle.phase).toBe('ended');
  });
});

describe('original features', () => {
  it('research progresses with research centres and applies effects', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
    g.config.features.tech = true;
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    placeBuilding(g, p, B.Lab, g.map.idx(30, 20), true)!.level = 5;
    const logistics = techId('military.2'); // prerequisites studied on the way
    g.step([cmd(1, { t: 'research', tech: logistics })]);
    expect(nextTechCost(p, logistics)).toBe(TIER_COST[0]);
    for (let k = 0; k < 2000; k++) g.step([]);
    expect(p.tech[1]).toBeGreaterThanOrEqual(2);
    expect(techSpeedMultiplier(p)).toBeGreaterThan(1);
    p.tech[4] = 4;
    expect(techSam(p).targets).toBe(2);
  });

  it('strategic deposits grant bonuses', () => {
    const map = asciiMap(FIELD, 6);
    map.meta.deposits = [
      { x: 30, y: 20, type: Resource.Oil },
      { x: 33, y: 20, type: Resource.RareMetals },
    ];
    const g = testGame(map, 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    recountResources(g);
    const bonus = resourceBonus(g, p);
    expect(bonus.gold).toBeGreaterThan(0);
    expect(bonus.buildDiscount).toBeGreaterThan(0);
    expect(buildCost(g, p, B.Silo)).toBeLessThan(1_000_000);
  });

  it('generals: ability then cooldown', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    p.generalReadyTick = 0;
    g.step([cmd(1, { t: 'general', tile: 0 })]);
    expect(p.blitzUntil).toBeGreaterThan(g.tick);
    expect(p.generalReadyTick).toBe(g.tick - 1 + GENERAL_COOLDOWN);
  });

  it('world council opens, counts weighted votes and applies the result', () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { features: { council: true } as never });
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    g.startTick = g.tick - COUNCIL_PERIOD;
    g.step([]);
    expect(g.features.council).not.toBeNull();
    g.step([cmd(1, { t: 'vote', option: 2 }), cmd(2, { t: 'vote', option: 2 })]);
    for (let k = 0; k < COUNCIL_VOTE_TICKS + 2; k++) g.step([]);
    expect(g.features.council).toBeNull();
    expect(g.features.ceasefireUntil).toBeGreaterThan(g.tick);
    expect(g.attackAllowed(1, 2, true)).toBe(false);
  });

  it('day/night cycle lasts 8 minutes', () => {
    expect(isNight(0)).toBe(false);
    expect(isNight(2400)).toBe(true);
    expect(dayPhase(4800)).toBe(0);
  });

  it('low loyalty with few troops can trigger a secession', () => {
    const g = testGame(asciiMap(FIELD, 8), 1, {
      victoryThreshold: 101,
      features: { loyalty: true } as never,
    });
    startWith(g, [[30, 28]]);
    const p = g.players[1]!;
    for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i) && g.owner[i] === 0) g.setOwner(i, 1);
    g.loyalty.fill(10);
    p.troops = 100;
    let seceded = false;
    for (let k = 0; k < 400 && !seceded; k++) {
      g.step([]);
      if (g.events.some((e) => e.k === 'secession')) seceded = true;
    }
    expect(seceded).toBe(true);
    expect(g.players.length).toBeGreaterThan(2);
    expect(invariants(g)).toEqual([]);
  });

  it('rebels are no gold farm: no treasury, no loot, and land taken back from them stays loyal', () => {
    const g = testGame(asciiMap(FIELD, 8), 1, {
      victoryThreshold: 101,
      features: { loyalty: true } as never,
    });
    startWith(g, [[30, 28]]);
    const p = g.players[1]!;
    for (let i = 0; i < g.map.size; i++) if (g.map.isLand(i) && g.owner[i] === 0) g.setOwner(i, 1);
    g.loyalty.fill(10);
    p.troops = 100;
    let secession: Extract<(typeof g.events)[number], { k: 'secession' }> | undefined;
    let notice: (typeof g.events)[number] | undefined;
    for (let k = 0; k < 400 && !secession; k++) {
      g.step([]);
      secession = g.events.find((e) => e.k === 'secession') as typeof secession;
      notice = g.events.find((e) => e.k === 'notify' && e.key === 'notify.secessionRegion');
    }
    expect(secession).toBeDefined();
    const rebel = g.players[secession!.tribe]!;
    expect(rebel.kind).toBe('tribe');
    expect(rebel.rebelOf).toBe(1);
    // The player is told where, and by whom: a dispatch on the seed tile naming the rebels.
    expect(notice).toMatchObject({ to: 1, level: 'danger', tile: secession!.tile });
    expect((notice as { params: Record<string, number> }).params).toMatchObject({ tribe: rebel.id });
    const region: number[] = [];
    for (let i = 0; i < g.map.size; i++) if (g.owner[i] === rebel.id) region.push(i);
    // A rebel hoards nothing (a tribe banks TRIBE_INCOME a second).
    for (let k = 0; k < 300; k++) g.step([]);
    expect(rebel.gold).toBe(0);
    // Crushing the rebellion pays no loot, and the land comes home loyal.
    p.troops = 500_000;
    let loot = 0;
    for (let k = 0; k < 900 && rebel.alive; k++) {
      g.step(k % 20 === 0 ? [cmd(1, { t: 'attack', tile: region[0]!, ratio: 0.5 })] : []);
      for (const e of g.events) if (e.k === 'loot' && e.owner === 1) loot += e.amount;
    }
    expect(rebel.alive).toBe(false);
    expect(loot).toBe(0);
    const back = region.filter((t) => g.owner[t] === 1);
    expect(back.length).toBeGreaterThan(0);
    for (const t of back) expect(g.loyalty[t]!).toBeGreaterThanOrEqual(LOYALTY_SECESSION_THRESHOLD);
    expect(invariants(g)).toEqual([]);
  });

  it('defence posts and SAMs: AI-independent placement on owned land', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { victoryThreshold: 101 });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    p.gold = 10_000_000;
    expect(placeBuilding(g, p, B.Sam, g.map.idx(30, 20))).not.toBeNull();
  });
});

describe('determinism & snapshots', () => {
  it('migrates 1.1.0 snapshots: build counters are rebuilt from the buildings held', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[25, 20]]);
    g.config.features.resources = false;
    g.config.features.tech = false;
    placeBuilding(g, g.players[1]!, B.City, g.map.idx(25, 20), true);
    const old = JSON.parse(snapshotToJson(takeSnapshot(g))) as ReturnType<typeof takeSnapshot>;
    old.version = 1;
    delete (old.players[1] as Record<string, unknown>).levelsBuilt;
    const r = restoreSnapshot(g.map, old);
    expect(r.players[1]!.levelsBuilt[B.City]).toBe(1);
    expect(buildCost(r, r.players[1]!, B.City)).toBe(250_000);
  });

  const script = (tick: number): StampedCommand[] => {
    if (tick === 5) return [{ p: 1, c: { t: 'spawn', tile: 0 } }];
    return [];
  };

  it('same seed + same commands = same hash (world map, AI nations)', () => {
    const a = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    const b = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    run(a, 900, script);
    run(b, 900, script);
    expect(hashGame(a)).toBe(hashGame(b));
    const c = makeGame('black-sea', { nations: 8, tribes: 10, players: [], seed: 999 });
    run(c, 900, script);
    expect(hashGame(c)).not.toBe(hashGame(a));
  });

  it('restoring a snapshot reproduces the exact future', () => {
    const a = makeGame('black-sea', { nations: 8, tribes: 10, players: [] });
    run(a, 700);
    const snap = snapshotFromJson(snapshotToJson(takeSnapshot(a)));
    const b = restoreSnapshot(mapFromDisk('black-sea'), snap);
    expect(hashGame(b)).toBe(hashGame(a));
    run(a, 600);
    run(b, 600);
    expect(hashGame(b)).toBe(hashGame(a));
    expect(invariants(b)).toEqual([]);
  });

  it('RLE codec round-trips', () => {
    const src = new Uint16Array([0, 0, 0, 5, 5, 9, 0, 0]);
    const dst = new Uint16Array(src.length);
    rleDecodeInto(rleEncode(src), dst);
    expect(dst).toEqual(src);
  });
});

describe('automated nations', () => {
  it('nations expand, build, ally and stay consistent over 4 minutes', () => {
    const g = makeGame('europe', { nations: 25, tribes: 30, players: [], difficulty: 'hard' });
    run(g, 2400);
    const nations = g.players.filter((p) => p && p.kind === 'nation');
    expect(nations.some((p) => p!.tiles > 5000)).toBe(true);
    expect(g.buildings.size).toBeGreaterThan(10);
    expect(invariants(g)).toEqual([]);
  });
});

describe('sandbox threshold', () => {
  it('a threshold above 100 % disables both victory and overtime', () => {
    const map = asciiMap(
      Array.from({ length: 10 }, () => '.'.repeat(10)),
      4,
    );
    for (const [th, expected] of [
      [101, 101],
      [80, 35], // 60 min in: the overtime floor
    ] as const) {
      const g = testGame(map, 2, { victoryThreshold: th });
      startWith(g, [
        [5, 5],
        [30, 30],
      ]);
      (g as { tick: number }).tick = g.startTick + 60 * 60 * 10;
      expect(currentThreshold(g)).toBe(expected);
    }
  });
});
