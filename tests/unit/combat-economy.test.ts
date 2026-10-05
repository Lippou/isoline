import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd, invariants, makeGame } from '../helpers';
import { maxTroops } from '../../src/core/game/economy';
import {
  B,
  BUILD_TICKS,
  RAIL_CONNECT_RANGE,
  RAIL_MAX_SEGMENT,
  RETREAT_DELAY_TICKS,
  RETREAT_MALUS,
  SPAWN_IMMUNITY_TICKS,
  TRAITOR_DEBUFF_TICKS,
} from '../../src/core/game/constants';
import { buildCost, checkPlacement, placeBuilding, upgradeCost } from '../../src/core/buildings/buildings';
import { inService } from '../../src/core/buildings/building';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';
import { attackLogic, largeTerritoryBonus, launchAttack } from '../../src/core/rules/combat';
import { claimDisc } from '../../src/core/game/spawn';
import type { Game } from '../../src/core/game/state';
import { U } from '../../src/core/units/unit';
import { buildWarship, tradeCapacity, tradeGold, warshipCost } from '../../src/core/units/ships';
import { trainStopGold } from '../../src/core/units/trains';

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

/** maxTroops of a human: 2 × (tiles^0.6 × 800 + 25k) + 60k per completed city level. */
const humanMax = (tiles: number, cityLevels: number) =>
  2 * (Math.pow(tiles, 0.6) * 800 + 25_000) + 60_000 * cityLevels;

describe('spawn', () => {
  it("claims OpenFront's 52-tile spawn disc and grants immunity to humans", () => {
    const g = testGame(asciiMap(FIELD, 6), 2, { spawnSeconds: 2 });
    g.step([cmd(1, { t: 'spawn', tile: g.map.idx(30, 20) })]);
    const p = g.players[1]!;
    // Radius 4 around the corner of the clicked tile: an 8 × 8 disc, x 26..33, y 16..23.
    expect(p.tiles).toBe(52);
    expect(g.owner[g.map.idx(26, 20)]).toBe(1);
    expect(g.owner[g.map.idx(33, 20)]).toBe(1);
    expect(g.owner[g.map.idx(34, 20)]).toBe(0);
    expect(g.owner[g.map.idx(26, 16)]).toBe(0);
    // Moving the spawn releases the previous disc (player 2 has not chosen yet).
    g.step([cmd(1, { t: 'spawn', tile: g.map.idx(80, 20) })]);
    expect(g.owner[g.map.idx(30, 20)]).toBe(0);
    expect(g.owner[g.map.idx(80, 20)]).toBe(1);
    expect(g.phase).toBe('spawn');
    g.step([cmd(2, { t: 'spawn', tile: g.map.idx(30, 30) })]);
    // Once every human has placed, the match starts at once (no waiting for the timer).
    expect(g.phase).toBe('playing');
    expect(p.immuneUntil).toBe(g.tick - 1 + SPAWN_IMMUNITY_TICKS);
    expect(invariants(g)).toEqual([]);
  });

  it('auto-spawns humans who did not choose, on a spawn point', () => {
    const map = asciiMap(FIELD, 6);
    map.meta.spawnPoints = [[40, 20]];
    const g = testGame(map, 1, { spawnSeconds: 0.2 });
    while (g.phase === 'spawn') g.step([]);
    expect(g.players[1]!.tiles).toBe(52);
  });

  it('nations and tribes start on the same 52-tile disc as humans (OpenFront)', () => {
    const g = makeGame('black-sea', { nations: 10, tribes: 20, players: [] });
    const starts = g.players.filter((p) => p !== null).map((p) => p.tiles);
    expect(starts.length).toBeGreaterThanOrEqual(25);
    // Only a coast or a neighbour can clip a disc.
    expect(Math.max(...starts)).toBe(52);
    expect(starts.filter((t) => t === 52).length).toBeGreaterThan(starts.length * 0.7);
    expect(invariants(g)).toEqual([]);
  });
});

describe('land combat', () => {
  it('expands into wilderness and returns leftover troops', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[20, 20]]);
    const p = g.players[1]!;
    const before = p.tiles;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(30, 20), ratio: 0.5 })]);
    for (let k = 0; k < 200; k++) g.step([]);
    expect(p.tiles).toBeGreaterThan(before + 300);
    expect(g.attacks.length).toBe(0);
    expect(invariants(g)).toEqual([]);
  });

  it('terrain sets the losses (mag) and the tile cost: mountains 120 / 25 against plains 80 / 16.5', () => {
    const g = testGame(asciiMap(['~~~~~~', '~..MM~', '~..MM~', '~~~~~~'], 5), 1);
    startWith(g, [[7, 7]]);
    const a = launchAttack(g, 1, 0, 1000)!;
    const plains = attackLogic(g, a, g.map.idx(11, 7), 10);
    const mountain = attackLogic(g, a, g.map.idx(20, 7), 10);
    expect(mountain.attackerLoss / plains.attackerLoss).toBeCloseTo(120 / 80, 6);
    // 2,000 × cost / 1,000 troops: 33 and 50, both inside the [5, 100] clamp.
    expect(mountain.tickFraction / plains.tickFraction).toBeCloseTo(25 / 16.5, 6);
  });

  it('cancelling halts the attack for 2 s, then 75 % of its troops come home (all from the wilderness)', () => {
    const { g, p, d } = arena(200_000, 100_000);
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(150, 30), ratio: 0.5 })]);
    for (let k = 0; k < 3; k++) g.step([]);
    const a = g.attacks[0]!;
    g.step([cmd(1, { t: 'cancelAttack', id: a.id })]);
    expect(a.retreatAt).toBe(g.tick - 1 + RETREAT_DELAY_TICKS);
    const tiles = d.tiles;
    const inAttack = a.troops;
    while (g.tick < a.retreatAt) {
      g.step([]);
      expect(d.tiles).toBe(tiles); // halted
      expect(a.troops).toBe(inAttack);
    }
    const before = p.troops;
    g.step([]);
    expect(a.done).toBe(true);
    expect(g.attacks.length).toBe(0);
    // (lastGrowth: this tick's regeneration)
    expect(p.troops - p.lastGrowth - before).toBeCloseTo(inAttack * (1 - RETREAT_MALUS), 3);
    // From the wilderness nothing is lost.
    const w = testGame(asciiMap(FIELD, 6), 1);
    startWith(w, [[20, 20]]);
    const q = w.players[1]!;
    w.step([cmd(1, { t: 'attack', tile: w.map.idx(30, 20), ratio: 0.5 })]);
    const wa = w.attacks[0]!;
    w.step([cmd(1, { t: 'cancelAttack', id: wa.id })]);
    for (let k = 0; k < RETREAT_DELAY_TICKS - 1; k++) w.step([]);
    const [troops, sent] = [q.troops, wa.troops];
    w.step([]);
    expect(wa.done).toBe(true);
    expect(q.troops - q.lastGrowth - troops).toBeCloseTo(sent, 3);
  });

  it('no attack without a shared border: an error, and no betrayal, embargo or troops spent', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [80, 20],
    ]);
    const [a, b] = [g.players[1]!, g.players[2]!];
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    const troops = a.troops;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(80, 20), ratio: 0.5 })]);
    expect(g.events.some((e) => e.k === 'notify' && e.to === 1 && e.key === 'error.noFrontier')).toBe(true);
    expect(g.attacks.length).toBe(0);
    expect(g.units.some((u) => u.type === U.Transport)).toBe(false);
    expect(a.troops - a.lastGrowth).toBeCloseTo(troops, 6);
    expect(a.allies.has(2)).toBe(true);
    expect(a.isTraitor(g.tick)).toBe(false);
    expect(b.embargoUntil.has(1)).toBe(false);
    expect(b.relation(1)).toBe(0);
    // Wilderness: only when it is linked to our land by unowned land (within 200 tiles).
    const isl = testGame(asciiMap(['~~~~~~~~~~~~', '~...~~~~...~', '~...~~~~...~', '~~~~~~~~~~~~'], 8), 1);
    startWith(isl, [[12, 12]]);
    isl.step([cmd(1, { t: 'attack', tile: isl.map.idx(80, 12), ratio: 0.5 })]);
    expect(isl.attacks.length).toBe(0);
    expect(isl.events.some((e) => e.k === 'notify' && e.key === 'error.noFrontier')).toBe(true);
    isl.step([cmd(1, { t: 'attack', tile: isl.map.idx(28, 20), ratio: 0.5 })]);
    expect(isl.attacks.length).toBe(1);
  });

  it('immune players cannot be attacked; allies cannot fight; attacking an ally is a betrayal', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [40, 20],
    ]);
    own(g, 1, 6, 6, 36, 36); // the two countries touch
    g.players[2]!.immuneUntil = g.tick + 100;
    expect(g.attackAllowed(1, 2, true)).toBe(false);
    g.players[2]!.immuneUntil = -1;
    g.step([cmd(1, { t: 'allyRequest', target: 2 })]);
    g.step([cmd(2, { t: 'allyAnswer', target: 1, accept: true })]);
    expect(g.players[1]!.allies.has(2)).toBe(true);
    expect(g.attackAllowed(1, 2, false)).toBe(false);
    // Betrayal by attacking.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(40, 20), ratio: 0.2 })]);
    const t = g.players[1]!;
    expect(t.allies.has(2)).toBe(false);
    expect(t.isTraitor(g.tick)).toBe(true);
    expect(t.debuffUntil).toBeGreaterThan(g.tick);
    expect(g.players[2]!.hasEmbargoWith(t, g.tick)).toBe(true);
    expect(g.attacks.some((a) => a.attacker === 1 && a.target === 2)).toBe(true);
  });

  it('opposing attacks clash: the bigger stack goes on, minus the smaller one', () => {
    const { g, p, d } = arena(100_000, 100_000);
    const a = launchAttack(g, 1, 2, 50_000)!;
    expect(launchAttack(g, 2, 1, 30_000)).toBeNull(); // wiped out in the clash
    expect(a.troops).toBe(20_000);
    const b = launchAttack(g, 2, 1, 60_000)!; // wipes out what is left of player 1's push
    expect(a.done).toBe(true);
    expect(b.troops).toBe(40_000);
    expect(p.troops + d.troops).toBe(200_000); // (orders took no troops here: nothing refunded)
  });

  it('an attack out of troops dies, one out of land comes home; a country below 100 tiles is annexed', () => {
    // A 50:1 attack crosses a 12 × 12 country: once under 100 tiles, the rest is annexed.
    const g = testGame(asciiMap(FIELD, 6), 2, { victoryThreshold: 101 });
    startWith(g, [
      [20, 20],
      [56, 20],
    ]);
    own(g, 2, 50, 14, 62, 26);
    own(g, 1, 6, 6, 50, 36);
    const [p, d] = [g.players[1]!, g.players[2]!];
    expect(d.tiles).toBe(144);
    p.troops = 1_000_000;
    d.troops = 20_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(50, 20), ratio: 1 })]);
    for (let k = 0; k < 20 && d.alive; k++) g.step([]);
    expect(d.alive).toBe(false);
    expect(d.tiles).toBe(0);
    for (let y = 14; y < 26; y++) for (let x = 50; x < 62; x++) expect(g.owner[g.map.idx(x, y)]).toBe(1);
    expect(invariants(g)).toEqual([]);
    // A 1:10 push is spent at the border: its last troops die, nothing comes home.
    const h = arena(10_000, 100_000);
    h.g.step([cmd(1, { t: 'attack', tile: h.front, ratio: 1 })]);
    for (let k = 0; k < 300 && h.g.attacks.length; k++) h.g.step([]);
    expect(h.g.attacks.length).toBe(0);
    expect(h.p.stats.troopsLost).toBeCloseTo(10_000, 3);
  });

  it('eliminates a player who loses every tile', () => {
    const g = testGame(asciiMap(FIELD, 4), 2);
    startWith(g, [
      [15, 12],
      [30, 12],
    ]);
    // (Troops far above the ceiling melt away quickly: top them up before each order.)
    g.players[1]!.troops = 3_000_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(22, 12), ratio: 0.2 })]);
    for (let k = 0; k < 60; k++) g.step([]);
    g.players[1]!.troops = 3_000_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(30, 12), ratio: 0.9 })]);
    for (let k = 0; k < 400 && g.players[2]!.alive; k++) g.step([]);
    expect(g.players[2]!.alive).toBe(false);
    for (let k = 0; k < 10; k++) g.step([]);
    expect(g.phase).toBe('ended');
    expect(g.victory.winner).toBe(1);
  });
});

// OpenFront's troop-ratio combat: a 200 × 70 plains field (190 × 60 of land), player 1 in
// the west, the defender holding the eastern `width` columns (50 → 3,000 tiles).
const ARENA = Array.from({ length: 14 }, (_, y) =>
  y === 0 || y === 13 ? '~'.repeat(40) : '~' + '.'.repeat(38) + '~',
);

function arena(attack: number, defend: number, opts: { tribe?: boolean; width?: number } = {}) {
  const g = testGame(asciiMap(ARENA, 5), opts.tribe ? 1 : 2, { victoryThreshold: 101 });
  startWith(
    g,
    opts.tribe
      ? [[20, 30]]
      : [
          [20, 30],
          [180, 30],
        ],
  );
  let d = g.players[2]!;
  if (opts.tribe) {
    d = g.addPlayer({ fr: 'T', en: 'T' }, 'tribe');
    claimDisc(g, d, g.map.idx(180, 30));
    d.spawned = true;
    d.alive = true;
  }
  const x = 195 - (opts.width ?? 50);
  own(g, 1, 0, 0, x, 70);
  own(g, d.id, x, 0, 200, 70);
  const p = g.players[1]!;
  p.troops = attack;
  d.troops = defend;
  return { g, p, d, front: g.map.idx(x, 30), tiles: d.tiles };
}

/** Sends 100 % of player 1's troops at the defender for `ticks` ticks (or until it falls). */
function charge(
  attack: number,
  defend: number,
  ticks: number,
  opts: { tribe?: boolean; width?: number } = {},
) {
  const r = arena(attack, defend, opts);
  r.g.step([cmd(1, { t: 'attack', tile: r.front, ratio: 1 })]);
  const first = r.tiles - r.d.tiles;
  for (let k = 1; k < ticks && r.d.alive; k++) r.g.step([]);
  return { ...r, first, taken: r.tiles - r.d.tiles, lost: r.p.stats.troopsLost };
}

describe('troop-ratio combat (OpenFront)', () => {
  it('a crushing attack sweeps a weak country in seconds and costs a few percent', () => {
    // The reported case: 3,000,000 troops against a 100k nation of 3,000 tiles.
    const r = charge(3_000_000, 100_000, 100);
    expect(r.d.alive).toBe(false);
    expect(r.g.tick - r.g.startTick).toBeLessThan(100); // under 10 s of game time
    expect(r.lost).toBeLessThan(3_000_000 * 0.05);
    expect(invariants(r.g)).toEqual([]);
  });

  it('tick budget: a 60-tile front takes ~31 tiles a tick at 1:1, ~38 from 1.22:1 up, 4–5 at 1:10', () => {
    // Fraction per tile = clamp(r, 0.82, 7.5) × clamp(r / 20, 1, 50) / 8.55 × 16.5 / (60 + 0…4).
    const even = charge(100_000, 100_000, 10);
    const crush = charge(1_000_000, 100_000, 10);
    const hopeless = charge(20_000, 200_000, 10);
    expect(even.first).toBeGreaterThanOrEqual(32); // 60 / 1.93 → the 32nd tile spends the budget
    expect(even.first).toBeLessThanOrEqual(34);
    expect(crush.first).toBeGreaterThanOrEqual(38); // 60 / (0.82 × 1.93)
    expect(crush.first).toBeLessThanOrEqual(41);
    expect(hopeless.first).toBeGreaterThanOrEqual(4); // 60 / (7.5 × 1.93)
    expect(hopeless.first).toBeLessThanOrEqual(5);
    // About five rows of plains a second at parity.
    expect(even.taken / 60).toBeGreaterThan(4.5);
    expect(even.taken / 60).toBeLessThan(5.6);
    // Losses per tile: ×0.6 at 10:1, ×1 at parity, ×2 at 1:10.
    const perTile = (x: { lost: number; taken: number }) => x.lost / x.taken;
    expect(perTile(even)).toBeGreaterThan(perTile(crush) * 1.5);
    expect(perTile(hopeless)).toBeGreaterThan(perTile(even) * 1.5);
    // Run to the end: the 1:1 attack is spent having taken under half the country; 1:10 dies at the border.
    const evenEnd = charge(100_000, 100_000, 900);
    expect(evenEnd.g.attacks.length).toBe(0);
    expect(evenEnd.taken).toBeGreaterThan(evenEnd.tiles * 0.3);
    expect(evenEnd.taken).toBeLessThan(evenEnd.tiles * 0.5);
    const hopelessEnd = charge(20_000, 200_000, 900);
    expect(hopelessEnd.g.attacks.length).toBe(0);
    expect(hopelessEnd.taken).toBeLessThan(250);
  });

  it('attackLogic: OpenFront’s speed and loss curves against the defender’s whole army', () => {
    const { g, p, d, front } = arena(100_000, 100_000);
    const a = launchAttack(g, 1, 2, 100_000)!;
    p.troops = 0;
    const bA = largeTerritoryBonus(p.tiles, 0.7);
    const bAs = largeTerritoryBonus(p.tiles, 0.73);
    const bD = largeTerritoryBonus(d.tiles, 0.3);
    const at = (r: number) => {
      d.troops = a.troops * r;
      return attackLogic(g, a, front, 60);
    };
    const speed = (r: number) => (at(r).tickFraction * 60) / (16.5 * bAs * bD);
    expect(speed(1)).toBeCloseTo(1 / 8.55, 6);
    expect(speed(0.5)).toBeCloseTo(0.82 / 8.55, 6); // floor: overwhelming stacks land ~18 % faster
    expect(speed(4)).toBeCloseTo(4 / 8.55, 6);
    expect(speed(15)).toBeCloseTo(7.5 / 8.55, 6); // saturated
    expect(speed(40)).toBeCloseTo((7.5 * 2) / 8.55, 6); // hopeless: second ramp past 20:1
    const loss = (r: number) => {
      const o = at(r);
      return o.attackerLoss / (80 * (0.463 * bA * bD + 0.0039 * o.defenderLoss));
    };
    expect(loss(1)).toBeCloseTo(1, 6);
    expect(loss(0.1)).toBeCloseTo(0.6, 6);
    expect(loss(1.5)).toBeCloseTo(1.5, 6);
    expect(loss(10)).toBeCloseTo(2, 6);
    // The defender loses its troops per tile (its whole army, not just the border).
    expect(at(2).defenderLoss).toBeCloseTo(d.troops / d.tiles, 6);
    // The border size divides the cost: twice the front, twice the tiles per tick.
    d.troops = a.troops;
    expect(attackLogic(g, a, front, 120).tickFraction).toBeCloseTo(at(1).tickFraction / 2, 9);
  });

  it('traitors and huge territories are cheaper and faster to attack', () => {
    const { g, d, front } = arena(100_000, 100_000);
    const a = launchAttack(g, 1, 2, 100_000)!;
    const base = attackLogic(g, a, front, 60);
    d.debuffUntil = g.tick + TRAITOR_DEBUFF_TICKS;
    const traitor = attackLogic(g, a, front, 60);
    expect(traitor.attackerLoss).toBeCloseTo(base.attackerLoss * 0.5, 6);
    expect(traitor.tickFraction).toBeCloseTo(base.tickFraction * 0.8, 6);
    // 1 − depth × sigmoid(ln tiles, 2.5, ln 300k): ~1 for small countries, 1 − depth for giants.
    expect(largeTerritoryBonus(3_000, 0.7)).toBeGreaterThan(0.999);
    expect(largeTerritoryBonus(300_000, 0.7)).toBeCloseTo(0.65, 6);
    expect(largeTerritoryBonus(30_000_000, 0.3)).toBeCloseTo(0.7, 4);
    expect(g.bigEmpireMalus(d)).toBe(0);
  });

  it('a tribe at its ceiling falls in seconds to 20 % of a mid-game army', () => {
    const r = arena(1_500_000, 0, { tribe: true, width: 45 });
    r.d.troops = maxTroops(r.g, r.d); // ~78k on 2,700 tiles
    r.g.step([cmd(1, { t: 'attack', tile: r.front, ratio: 0.2 })]);
    const sent = r.g.attacks[0]!.troops;
    for (let k = 0; k < 100 && r.d.alive; k++) r.g.step([]);
    expect(r.d.alive).toBe(false);
    expect(r.p.stats.troopsLost).toBeLessThan(sent * 0.25);
    // Tribes defend at ×0.7 against nations and humans (OpenFront's bot defender).
    const { g, d, front } = arena(300_000, 100_000, { tribe: true });
    const a = launchAttack(g, 1, d.id, 300_000)!;
    const vsTribe = attackLogic(g, a, front, 60);
    d.kind = 'nation';
    expect(vsTribe.attackerLoss).toBeCloseTo(attackLogic(g, a, front, 60).attackerLoss * 0.7, 6);
  });

  it('wilderness: mag / 5 per tile (tribes mag / 10), cost clamp(2,000 × 16.5 / troops, 5, 100) / (2 × border)', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[20, 20]]);
    const big = launchAttack(g, 1, 0, 50_000)!;
    const tile = big.heapTiles[0]!;
    expect(attackLogic(g, big, tile, 30).attackerLoss).toBeCloseTo(80 / 5, 6);
    expect(attackLogic(g, big, tile, 30).tickFraction).toBeCloseTo(5 / 60, 9); // full speed from 6,600 troops
    big.troops = 3_300; // 2,000 × 16.5 / 3,300 = 10 → half speed
    expect(attackLogic(g, big, tile, 30).tickFraction).toBeCloseTo(10 / 60, 9);
    big.troops = 100; // floor of the clamp: 100
    expect(attackLogic(g, big, tile, 30).tickFraction).toBeCloseTo(100 / 60, 9);
    g.players[1]!.kind = 'tribe';
    expect(attackLogic(g, big, tile, 30).attackerLoss).toBeCloseTo(80 / 10, 6);
  });
});

describe('economy', () => {
  it('flat gold: 100 per tick for humans and nations, 50 for tribes, whatever the land', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { difficulty: 'impossible' });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    const nation = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    claimDisc(g, nation, g.map.idx(80, 20));
    const tribe = g.addPlayer({ fr: 'T', en: 'T' }, 'tribe');
    claimDisc(g, tribe, g.map.idx(60, 35));
    own(g, 1, 6, 6, 50, 36); // land does not raise income
    const [g1, gn, gt] = [p.gold, nation.gold, tribe.gold];
    for (let k = 0; k < 10; k++) g.step([]);
    expect(p.gold - g1).toBe(1_000);
    expect(nation.gold - gn).toBe(1_000);
    expect(tribe.gold - gt).toBe(500);
    expect(p.income).toBe(100);
    expect(p.incomeBreakdown.base).toBe(1_000);
    expect(p.workers).toBe(0);
  });

  it('maxTroops = 2 × (tiles^0.6 × 800 + 25k) + 60k per completed city level', () => {
    const g = testGame(asciiMap(FIELD, 6), 1, { difficulty: 'easy' });
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    expect(maxTroops(g, p)).toBeCloseTo(humanMax(p.usefulTiles, 0), 6);
    p.gold = 5_000_000;
    g.step([cmd(1, { t: 'build', kind: B.City, tile: g.map.idx(30, 20) })]);
    const city = g.buildings.get(g.buildingAt[g.map.idx(30, 20)]!)!;
    expect(city.buildLeft).toBeGreaterThan(0);
    expect(maxTroops(g, p)).toBeCloseTo(humanMax(p.usefulTiles, 0), 6); // not built yet
    for (let k = 0; k < 25; k++) g.step([]);
    expect(maxTroops(g, p)).toBeCloseTo(humanMax(p.usefulTiles, 1), 6);
    g.step([cmd(1, { t: 'upgrade', id: city.id })]);
    // The new level is built in the city's construction time; until then, still level 1.
    expect(city.level).toBe(1);
    expect(city.upgradeLeft).toBeGreaterThan(0);
    g.step([]);
    expect(p.popCap).toBeCloseTo(humanMax(p.usefulTiles, 1), 6);
    for (let k = 0; k < 25; k++) g.step([]);
    expect(city.level).toBe(2);
    expect(p.popCap).toBeCloseTo(humanMax(p.usefulTiles, 2), 6);
    // Tribes hold a third, nations scale with the difficulty (easy: ×0.5).
    const tribe = g.addPlayer({ fr: 'T', en: 'T' }, 'tribe');
    claimDisc(g, tribe, g.map.idx(80, 20));
    expect(maxTroops(g, tribe)).toBeCloseTo(humanMax(tribe.usefulTiles, 0) / 3, 6);
    const nation = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    claimDisc(g, nation, g.map.idx(80, 34));
    expect(maxTroops(g, nation)).toBeCloseTo(humanMax(nation.usefulTiles, 0) * 0.5, 6);
  });

  it('troops regenerate by (10 + troops^0.73 / 5) × (1 − troops / max), capped at the ceiling', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[30, 20]]);
    const p = g.players[1]!;
    const max = maxTroops(g, p);
    p.troops = 50_000;
    g.step([]);
    expect(p.troops - 50_000).toBeCloseTo((10 + 50_000 ** 0.73 / 5) * (1 - 50_000 / max), 6);
    expect(p.lastGrowth).toBeCloseTo(p.troops - 50_000, 6);
    // Regeneration (whatever its bonuses) never overshoots the ceiling.
    p.troops = max - 1_000;
    g.features.growthMult = 1_000;
    g.step([]);
    expect(p.troops).toBeCloseTo(max, 6);
    g.features.growthMult = 1;
    // Above the ceiling (land lost) the army is cut back to it: min(troops + add, max).
    p.troops = max * 2;
    g.step([]);
    expect(p.troops).toBeCloseTo(max, 6);
    expect(p.lastGrowth).toBeCloseTo(-max, 6);
  });

  it('starting troops: humans 12.5k, nations 6.25k–15.6k by difficulty (half of OpenFront)', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    expect(g.players[1]!.troops).toBe(12_500);
    const map = asciiMap(FIELD, 6);
    map.meta.nations = [{ name: { fr: 'N', en: 'N' }, x: 60, y: 20, flagSeed: 1 }] as never;
    for (const [difficulty, troops] of [
      ['easy', 6_250],
      ['normal', 9_375],
      ['hard', 12_500],
      ['impossible', 15_625],
    ] as const) {
      const gn = testGame(map, 0, { difficulty, nations: 1 });
      expect(gn.players.find((q) => q?.kind === 'nation')!.troops).toBe(troops);
    }
  });

  it('conquest: the conqueror seizes a nation’s whole treasury, half of a human’s', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [20, 20],
      [60, 20],
    ]);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    const nation = g.addPlayer({ fr: 'N', en: 'N' }, 'nation');
    claimDisc(g, nation, g.map.idx(90, 20));
    nation.gold = 400_000;
    const gold = p1.gold;
    g.eliminate(nation, 1, g.map.idx(90, 20));
    expect(p1.gold - gold).toBe(400_000);
    expect(nation.gold).toBe(0);
    expect(g.events.some((e) => e.k === 'loot' && e.owner === 1 && e.amount === 400_000)).toBe(true);
    // A human loses everything; the conqueror only gets half.
    p2.gold = 1_000_001;
    const before = p1.gold;
    g.eliminate(p2, 1);
    expect(p1.gold - before).toBe(500_000);
    expect(p2.gold).toBe(0);
  });
});

describe('buildings', () => {
  /** One human owning the whole FIELD (×8), no discounts. */
  function bigField(humans = 1): Game {
    const g = testGame(asciiMap(FIELD, 8), humans);
    startWith(
      g,
      humans === 1
        ? [[40, 28]]
        : [
            [40, 28],
            [120, 28],
          ],
    );
    own(g, 1, 0, 0, humans === 1 ? 160 : 80, 56);
    for (const p of g.players) if (p) p.gold = 1e9;
    return g;
  }

  it('cities cost 125k, 250k, 500k, then 1M forever', () => {
    const g = bigField();
    const p = g.players[1]!;
    const prices: number[] = [];
    for (let k = 0; k < 6; k++) {
      prices.push(buildCost(g, p, B.City));
      expect(placeBuilding(g, p, B.City, g.map.idx(12 + 22 * k, 14))).not.toBeNull();
    }
    expect(prices).toEqual([125_000, 250_000, 500_000, 1_000_000, 1_000_000, 1_000_000]);
  });

  it('upgrades cost the build price and raise it; losing a city lowers it; capture never raises it', () => {
    const g = bigField(2);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    const city = placeBuilding(g, p1, B.City, g.map.idx(30, 20))!;
    expect(city.buildLeft).toBeGreaterThan(0);
    // Under construction it already counts.
    expect(buildCost(g, p1, B.City)).toBe(250_000);
    g.step([cmd(1, { t: 'upgrade', id: city.id })]); // still under construction: refused
    expect(city.level).toBe(1);
    for (let k = 0; k < 25; k++) g.step([]);
    expect(upgradeCost(g, p1, city)).toBe(250_000);
    const gold = p1.gold;
    // Building next to one's own city upgrades it (OpenFront: within 15 tiles).
    g.step([cmd(1, { t: 'build', kind: B.City, tile: g.map.idx(33, 22) })]);
    expect(gold - p1.gold).toBe(250_000 - 100); // one tick of income
    // The paid level raises the price at once; the city reaches it once built.
    expect(city.level).toBe(1);
    expect(buildCost(g, p1, B.City)).toBe(500_000);
    g.step([cmd(1, { t: 'upgrade', id: city.id })]); // one upgrade at a time
    expect(buildCost(g, p1, B.City)).toBe(500_000);
    for (let k = 0; k < 25; k++) g.step([]);
    expect(city.level).toBe(2);
    expect(upgradeCost(g, p1, city)).toBe(500_000);
    // Player 2 captures it: p1 is back to the first price, p2 has never built a city.
    g.setOwner(city.tile, 2);
    expect(city.owner).toBe(2);
    expect(buildCost(g, p1, B.City)).toBe(125_000);
    expect(buildCost(g, p2, B.City)).toBe(125_000);
    expect(p1.levelsBuilt[B.City]).toBe(2);
  });

  it('ports and factories share one ladder; SAMs, silos', () => {
    const g = bigField();
    const p = g.players[1]!;
    expect(buildCost(g, p, B.Factory)).toBe(125_000);
    placeBuilding(g, p, B.Factory, g.map.idx(40, 28));
    expect(buildCost(g, p, B.Port)).toBe(250_000);
    expect(buildCost(g, p, B.Factory)).toBe(250_000);
    expect(placeBuilding(g, p, B.Port, g.map.idx(8, 28))).not.toBeNull();
    expect(buildCost(g, p, B.Factory)).toBe(500_000);
    expect(buildCost(g, p, B.City)).toBe(125_000);
    // SAMs: 1.5M then 3M; an upgrade costs the next price.
    expect(buildCost(g, p, B.Sam)).toBe(1_500_000);
    const sam = placeBuilding(g, p, B.Sam, g.map.idx(80, 14), true)!;
    expect(buildCost(g, p, B.Sam)).toBe(3_000_000);
    placeBuilding(g, p, B.Sam, g.map.idx(110, 14));
    expect(buildCost(g, p, B.Sam)).toBe(3_000_000);
    expect(upgradeCost(g, p, sam)).toBe(3_000_000);
    // Silos stay at 1M.
    placeBuilding(g, p, B.Silo, g.map.idx(140, 14), true);
    expect(buildCost(g, p, B.Silo)).toBe(1_000_000);
    expect(buildCost(g, p, B.Radar)).toBe(300_000);
    expect(buildCost(g, p, B.Airfield)).toBe(800_000);
  });

  it('warships: 250k more each, capped at 1M; sinking one lowers the price', () => {
    const g = bigField();
    const p = g.players[1]!;
    placeBuilding(g, p, B.Port, g.map.idx(8, 28), true);
    const prices: number[] = [];
    for (let k = 0; k < 5; k++) {
      prices.push(warshipCost(g, p));
      expect(buildWarship(g, p, g.map.idx(3, 20 + k))).toBe(true);
    }
    expect(prices).toEqual([250_000, 500_000, 750_000, 1_000_000, 1_000_000]);
    for (const u of g.units) if (u.type === U.Warship && u.id % 2 === 0) u.alive = false;
    const afloat = g.units.filter((u) => u.alive && u.type === U.Warship).length;
    expect(warshipCost(g, p)).toBe(Math.min(1_000_000, 250_000 * (afloat + 1)));
  });

  it('validates placement and refunds 25 % on demolition', () => {
    const g = testGame(asciiMap(FIELD, 8), 1);
    startWith(g, [[40, 28]]);
    const p = g.players[1]!;
    expect(checkPlacement(g, p, B.City, g.map.idx(40, 28))).toBe('gold');
    p.gold = 1_000_000;
    expect(checkPlacement(g, p, B.City, g.map.idx(5, 5))).toBe('notOwned');
    expect(checkPlacement(g, p, B.Port, g.map.idx(40, 28))).toBe('notCoastal');
    g.step([cmd(1, { t: 'build', kind: B.City, tile: g.map.idx(40, 28) })]);
    const city = [...g.buildings.values()][0]!;
    // Structures stand at least 15 tiles apart (Euclidean).
    own(g, 1, 0, 0, 160, 56);
    expect(checkPlacement(g, p, B.Factory, g.map.idx(41, 28))).toBe('tooClose');
    expect(checkPlacement(g, p, B.Factory, g.map.idx(51, 37))).toBe('tooClose'); // √202
    expect(checkPlacement(g, p, B.Factory, g.map.idx(52, 37))).toBe('ok'); // √225 = 15
    expect(checkPlacement(g, p, B.Factory, g.map.idx(51, 39))).toBe('ok'); // √242
    g.step([cmd(1, { t: 'demolish', id: city.id })]);
    // Timed since 1.16 (demolition.test.ts: countdown, 25 % refund at the end, cancel).
    expect(city.demolishTotal).toBe(50);
    expect(inService(city)).toBe(false);
  });

  it('snaps a build order to the nearest free spot 15 tiles away from other structures', () => {
    const g = testGame(asciiMap(FIELD, 8), 1);
    startWith(g, [[40, 28]]);
    own(g, 1, 0, 0, 160, 56);
    const p = g.players[1]!;
    p.gold = 10_000_000;
    g.step([cmd(1, { t: 'build', kind: B.City, tile: g.map.idx(40, 28) })]);
    g.step([cmd(1, { t: 'build', kind: B.Factory, tile: g.map.idx(45, 28) })]);
    const factory = [...g.buildings.values()].find((b) => b.type === B.Factory)!;
    expect(factory).toBeDefined();
    expect((factory.x - 40) ** 2 + (factory.y - 28) ** 2).toBeGreaterThanOrEqual(15 * 15);
  });

  it('an upgraded SAM keeps working at level 1 until level 2 is built (saved and restored mid-way)', () => {
    const g = bigField(2); // two players: the game goes on (one alone wins at once)
    const p = g.players[1]!;
    p.gold = 50_000_000;
    const sam = placeBuilding(g, p, B.Sam, g.map.idx(40, 20), true)!;
    expect(sam.level).toBe(1);
    g.step([cmd(1, { t: 'upgrade', id: sam.id })]);
    expect(sam.buildLeft).toBe(0); // still operational
    expect(sam.level).toBe(1);
    expect(sam.upgradeLeft).toBe(BUILD_TICKS[B.Sam] - 1);
    for (let k = 0; k < 40; k++) g.step([]);
    const r = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(hashGame(r)).toBe(hashGame(g));
    const sam2 = r.buildings.get(sam.id)!;
    expect(sam2.level).toBe(1);
    for (let k = 0; k < BUILD_TICKS[B.Sam]; k++) {
      g.step([]);
      r.step([]);
    }
    expect(sam.level).toBe(2);
    expect(sam.upgradeLeft).toBe(0);
    expect(sam2.level).toBe(2);
    expect(hashGame(r)).toBe(hashGame(g));
  });

  it('upgrades by building on the same tile and transfers/destroys on capture', () => {
    const g = testGame(asciiMap(FIELD, 6), 2);
    startWith(g, [
      [25, 20],
      [40, 20],
    ]);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p2.gold = 10_000_000;
    const t = g.map.idx(40, 20);
    g.step([cmd(2, { t: 'build', kind: B.City, tile: t })]);
    for (let k = 0; k < 25; k++) g.step([]);
    g.step([cmd(2, { t: 'build', kind: B.City, tile: t })]);
    const city = g.buildings.get(g.buildingAt[t]!)!;
    expect(p2.cityLevels).toBe(2); // the level under way counts
    for (let k = 0; k < 25; k++) g.step([]);
    expect(city.level).toBe(2);
    expect(p2.cityLevels).toBe(2);
    const post = placeBuilding(g, p2, B.Radar, g.map.idx(40, 16), true)!; // (never handed over)
    g.setOwner(t, 1);
    expect(city.owner).toBe(1);
    // Looted on capture (GAME_DESIGN.md §6.4): half its levels, rounded down, are lost.
    expect(city.level).toBe(1);
    expect(p1.cityLevels).toBe(1);
    expect(p2.cityLevels).toBe(0);
    g.setOwner(post.tile, 1);
    expect(g.buildings.has(post.id)).toBe(false);
  });
});

// Two islands separated by a strait.
const ISLANDS = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~......~~~~~~~~~~~~~~~~~......~',
  '~......~~~~~~~~~~~~~~~~~......~',
  '~......~~~~~~~~~~~~~~~~~......~',
  '~......~~~~~~~~~~~~~~~~~......~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];

describe('trade', () => {
  it('cargo value: 37.5k / (1 + e^(−0.03 (d − 300))) + 25 d (half of OpenFront)', () => {
    expect(Math.floor(tradeGold(100))).toBe(2_592);
    expect(Math.floor(tradeGold(300))).toBe(26_250);
    expect(Math.floor(tradeGold(500))).toBe(49_907);
  });

  function ports() {
    const g = testGame(asciiMap(ISLANDS, 6), 2);
    startWith(g, [
      [20, 18],
      [160, 18],
    ]);
    own(g, 1, 0, 0, 90, 36);
    own(g, 2, 90, 0, 186, 36);
    const a = placeBuilding(g, g.players[1]!, B.Port, g.map.idx(41, 18), true)!;
    const b = placeBuilding(g, g.players[2]!, B.Port, g.map.idx(144, 18), true)!;
    return { g, a, b };
  }

  it('both ports earn the full cargo value', () => {
    const { g, a } = ports();
    a.rejections = 1_000; // pity timer maxed out: the next roll launches a merchant
    const pays: { owner: number; amount: number }[] = [];
    for (let k = 0; k < 400 && pays.length === 0; k++) {
      g.step([]);
      for (const e of g.events) if (e.k === 'tradePay') pays.push({ owner: e.owner, amount: e.amount });
    }
    expect(pays.map((x) => x.owner).sort()).toEqual([1, 2]);
    expect(pays[0]!.amount).toBe(pays[1]!.amount);
    // ~100 tiles sailed.
    expect(pays[0]!.amount).toBeGreaterThan(Math.floor(tradeGold(80)));
    expect(pays[0]!.amount).toBeLessThan(Math.floor(tradeGold(140)));
    expect(g.players[1]!.stats.tradeGold).toBe(g.players[2]!.stats.tradeGold);
  });

  it('trade capacity: P port levels trade like P × 4 / (P + 3), never more than 4 (1.11)', () => {
    expect(tradeCapacity(0)).toBe(1);
    expect(tradeCapacity(1)).toBe(1);
    expect(tradeCapacity(5)).toBeCloseTo(0.5);
    expect(tradeCapacity(13)).toBeCloseTo(0.25);
    const effective = (p: number) => p * tradeCapacity(p);
    expect(effective(3)).toBeCloseTo(2);
    expect(effective(10)).toBeCloseTo(40 / 13);
    expect(effective(200)).toBeLessThan(4);
    // Each further port is worth less: the 20th adds under a twentieth of the first.
    expect(effective(20) - effective(19)).toBeLessThan(0.05);
  });

  it('a port spammer launches merchants like a few ports, not like all of them', () => {
    // Player 1 holds one port, then six; player 2 one port across the sea (their destination).
    const launches = (spots: [number, number][]) => {
      const g = testGame(asciiMap(ISLANDS, 6), 2, { victoryThreshold: 101 });
      startWith(g, [
        [20, 18],
        [160, 18],
      ]);
      own(g, 1, 0, 0, 90, 36);
      own(g, 2, 90, 0, 186, 36);
      for (const [x, y] of spots)
        expect(placeBuilding(g, g.players[1]!, B.Port, g.map.idx(x, y), true)).toBeTruthy();
      placeBuilding(g, g.players[2]!, B.Port, g.map.idx(144, 18), true);
      const seen = new Set<number>();
      for (let k = 0; k < 6_000; k++) {
        g.step([]);
        for (const u of g.units) if (u.type === U.Merchant && u.owner === 1) seen.add(u.id);
      }
      return seen.size;
    };
    const one = launches([[41, 18]]);
    const six = launches([
      [41, 9],
      [41, 25],
      [12, 6],
      [28, 6],
      [12, 29],
      [28, 29],
    ]);
    expect(one).toBeGreaterThan(20);
    // Six ports trade like 6 × 4 / 9 ≈ 2.7 of them (OpenFront: 6).
    expect(six / one).toBeGreaterThan(1.8);
    expect(six / one).toBeLessThan(3.8);
  });

  it('an embargo declared mid-voyage scraps the merchant', () => {
    const { g, a } = ports();
    a.rejections = 1_000;
    for (let k = 0; k < 20 && !g.units.some((u) => u.type === U.Merchant); k++) g.step([]);
    expect(g.units.some((u) => u.type === U.Merchant)).toBe(true);
    g.step([cmd(2, { t: 'embargo', target: 1, on: true })]);
    g.step([]);
    expect(g.units.some((u) => u.type === U.Merchant)).toBe(false);
    for (let k = 0; k < 300; k++) g.step([]);
    expect(g.players[1]!.stats.tradeGold).toBe(0);
  });
});

describe('trains', () => {
  it('a factory reaches 55 tiles (half of 1.10’s 110), rails at most 55 × √2', () => {
    expect(RAIL_CONNECT_RANGE).toBe(55);
    expect(RAIL_MAX_SEGMENT).toBe(Math.round(55 * Math.SQRT2));
    const g = testGame(asciiMap(FIELD, 8), 1, { victoryThreshold: 101 });
    startWith(g, [[60, 28]]);
    own(g, 1, 0, 0, 160, 56);
    const p = g.players[1]!;
    const f = placeBuilding(g, p, B.Factory, g.map.idx(60, 28), true)!;
    const near = placeBuilding(g, p, B.City, g.map.idx(110, 28), true)!; // 50 tiles
    const far = placeBuilding(g, p, B.City, g.map.idx(10, 28), true)!; // 50 tiles
    const tooFar = placeBuilding(g, p, B.City, g.map.idx(60 + 60, 40), true)!; // ~61 tiles
    const linked = (b: { id: number }) => g.rails.some((r) => r.alive && r.a === f.id && r.b === b.id);
    expect(linked(near)).toBe(true);
    expect(linked(far)).toBe(true);
    expect(linked(tooFar)).toBe(false);
  });

  it('stop pay: 5k own, 12.5k other, 17.5k ally, −2.5k per stop after the 10th, floor 2.5k', () => {
    expect(trainStopGold(5_000, 0)).toBe(5_000);
    expect(trainStopGold(12_500, 9)).toBe(12_500);
    expect(trainStopGold(12_500, 10)).toBe(10_000);
    expect(trainStopGold(17_500, 13)).toBe(7_500);
    expect(trainStopGold(5_000, 30)).toBe(2_500);
  });

  it('a station pays a given train once: no farming a short line by bouncing (1.11)', () => {
    const g = testGame(asciiMap(FIELD, 8), 1, { victoryThreshold: 101 });
    startWith(g, [[40, 28]]);
    own(g, 1, 0, 0, 160, 56);
    const p = g.players[1]!;
    placeBuilding(g, p, B.Factory, g.map.idx(60, 28), true);
    placeBuilding(g, p, B.City, g.map.idx(100, 28), true);
    // The only line: factory → city → factory → city… for 16 stops; the city pays each train once
    // (before 1.11: 8 times).
    let pays = 0;
    const trains = new Set<number>();
    for (let k = 0; k < 3000; k++) {
      g.step([]);
      for (const u of g.units) if (u.type === U.Train) trains.add(u.id);
      for (const e of g.events) if (e.k === 'trainPay') pays++;
    }
    expect(trains.size).toBeGreaterThan(2);
    expect(pays).toBeGreaterThan(0);
    expect(pays).toBeLessThanOrEqual(trains.size);
    expect(p.stats.trainGold).toBe(pays * 5_000);
  });

  it('a foreign station pays its owner as much as the train owner', () => {
    const g = testGame(asciiMap(FIELD, 8), 2, { victoryThreshold: 101 });
    startWith(g, [
      [40, 28],
      [120, 28],
    ]);
    own(g, 1, 0, 0, 80, 56);
    own(g, 2, 80, 0, 160, 56);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    placeBuilding(g, p1, B.Factory, g.map.idx(60, 28), true);
    placeBuilding(g, p2, B.City, g.map.idx(100, 28), true);
    expect(g.rails.some((r) => r.alive)).toBe(true);
    let paid: { owner: number; amount: number }[] = [];
    for (let k = 0; k < 3000 && paid.length === 0; k++) {
      g.step([]);
      paid = g.events.flatMap((e) => (e.k === 'trainPay' ? [{ owner: e.owner, amount: e.amount }] : []));
    }
    expect(paid).toEqual([
      { owner: 1, amount: 12_500 },
      { owner: 2, amount: 12_500 },
    ]);
    expect(p1.stats.trainGold).toBe(12_500);
    expect(p2.stats.trainGold).toBe(12_500);
  });
});

describe('front shape', () => {
  it('grows round territories on open plains (no Manhattan diamonds)', () => {
    const map = asciiMap(
      Array.from({ length: 30 }, () => '.'.repeat(30)),
      8,
    );
    const g = testGame(map, 1, { victoryThreshold: 101 });
    startWith(g, [[120, 120]]);
    for (let t = 1; g.players[1]!.tiles < 12000 && t < 20000; t++) {
      g.step(t % 10 === 0 ? [cmd(1, { t: 'attack', tile: map.idx(239, 239), ratio: 0.15 })] : []);
    }
    const own = (x: number, y: number) => g.owner[map.idx(x, y)] === 1;
    const ext = (dx: number, dy: number) => {
      let r = 0;
      while (r < 118 && own(120 + Math.round(dx * (r + 1)), 120 + Math.round(dy * (r + 1)))) r++;
      return r;
    };
    const s = Math.SQRT1_2;
    const axis = ext(1, 0) + ext(-1, 0) + ext(0, 1) + ext(0, -1);
    const diag = ext(s, s) + ext(-s, s) + ext(s, -s) + ext(-s, -s);
    // A diamond gives 0.71, a disc 1.0.
    expect(diag / axis).toBeGreaterThan(0.88);
  });
});

describe('tribes', () => {
  it('hoard gold that is looted tile by tile, and shrink back to their (third of a) ceiling', () => {
    const g = testGame(asciiMap(FIELD, 6), 1);
    startWith(g, [[20, 20]]);
    const tribe = g.addPlayer({ fr: 'Tribu', en: 'Tribe' }, 'tribe');
    claimDisc(g, tribe, g.map.idx(28, 20)); // x 24..31: touches the player's 16..23
    expect(tribe.tiles).toBe(52);
    tribe.spawned = true;
    tribe.alive = true;
    tribe.troops = 2_000;
    tribe.gold = 100_000;
    const p = g.players[1]!;
    p.troops = 400_000;
    const gold0 = p.gold;
    let looted = 0;
    // (The first tiles fall on the very tick of the order.)
    for (let k = 0; k < 400 && tribe.alive; k++) {
      g.step(k === 0 ? [cmd(1, { t: 'attack', tile: g.map.idx(28, 20), ratio: 0.5 })] : []);
      for (const e of g.events) if (e.k === 'loot' && e.owner === 1) looted += e.amount;
    }
    expect(tribe.alive).toBe(false);
    // The whole treasury (and its income) went to the conqueror, once.
    expect(looted).toBeGreaterThan(100_000);
    expect(looted).toBeLessThan(110_000);
    expect(p.gold - gold0).toBeGreaterThan(100_000);
    // Ceiling: a tribe holds at most a third of the player ceiling.
    const t2 = g.addPlayer({ fr: 'T2', en: 'T2' }, 'tribe');
    claimDisc(g, t2, g.map.idx(10, 35));
    t2.spawned = true;
    t2.alive = true;
    const cap = maxTroops(g, t2);
    expect(cap).toBeCloseTo(humanMax(t2.usefulTiles, 0) / 3, 6);
    t2.troops = cap * 1.5;
    for (let k = 0; k < 20; k++) g.step([]);
    expect(t2.troops).toBeLessThanOrEqual(cap + 1e-6);
  });
});
