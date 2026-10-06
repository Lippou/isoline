// Front lines (1.17, rules/lines.ts): drawn on your own land, paid in troops, facing one side.
// A defensive line (laid in 3 s) slows what attacks it head-on, its troops stand in the clash
// and (1.18) nothing gets through it head-on while it holds troops; an offensive one, dug in
// after 30 s, cuts the losses of the attacks pushing out from it.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import {
  CAPITAL_DISORG_TICKS,
  CAPITAL_MOVE_COOLDOWN,
  CAPITAL_MOVE_COST,
  LINE_DEFENSE_SETUP,
  LINE_DEFENSE_SPEED,
  LINE_HOLD_TRADE,
  LINE_MAX_PER_PLAYER,
  LINE_OFFENSE_LOSS,
  LINE_OFFENSE_SETUP,
  LINE_REACH,
} from '../../src/core/game/constants';
import { attackLogic, launchAttack } from '../../src/core/rules/combat';
import {
  LineKind,
  lineDefense,
  lineHolds,
  lineStrength,
  locate,
  placeLine,
  sideOf,
  type FrontLine,
} from '../../src/core/rules/lines';
import { maxTroops } from '../../src/core/game/economy';
import { moveCapital } from '../../src/core/rules/capital';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';
import { hashGame } from '../../src/core/net/hash';
import type { Game } from '../../src/core/game/state';

const ARENA = Array.from({ length: 14 }, (_, y) =>
  y === 0 || y === 13 ? '~'.repeat(40) : '~' + '.'.repeat(38) + '~',
);

/** Player 1 holds x < 145, player 2 the rest (a 200 × 70 field); 2's border faces west. */
function arena(): Game {
  const g = testGame(asciiMap(ARENA, 5), 2, { victoryThreshold: 101 });
  startWith(g, [
    [20, 30],
    [180, 30],
  ]);
  for (let y = 0; y < 70; y++)
    for (let x = 0; x < 200; x++) {
      const t = g.map.idx(x, y);
      if (g.map.isLand(t)) g.setOwner(t, x < 145 ? 1 : 2);
    }
  g.players[1]!.troops = 100_000;
  g.players[2]!.troops = 100_000;
  return g;
}

/** A straight north–south line at x (tile centres), facing west (−x) or east. */
function wall(g: Game, owner: number, kind: LineKind, x: number, faceWest: boolean, ratio = 0.2): FrontLine {
  const pts = [x + 0.5, 22.5, x + 0.5, 38.5];
  const side = sideOf(pts, faceWest ? x - 5 : x + 5, 30);
  const l = placeLine(g, g.players[owner]!, kind, pts, side, ratio);
  expect(typeof l).toBe('object');
  // (A defensive line is laid in 3 s: these tests start with it in place.)
  if (kind === LineKind.Defensive) (l as FrontLine).readyTick = g.tick;
  return l as FrontLine;
}

describe('front lines', () => {
  it('locate: signed distance, its side, and the ends of the line', () => {
    const pts = [10, 0, 10, 20];
    expect(Math.abs(locate(pts, 4, 10).sd)).toBeCloseTo(6);
    expect(sideOf(pts, 4, 10)).toBe(-sideOf(pts, 16, 10));
    expect(locate(pts, 4, 10).inside).toBe(true);
    expect(locate(pts, 10, 25).inside).toBe(false); // past the end
  });

  it('a defensive line slows a head-on attack ×3 at full strength, its troops in the clash', () => {
    const g = arena();
    const d = g.players[2]!;
    const a = launchAttack(g, 1, 2, 50_000)!;
    const front = g.map.idx(145, 30);
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    expect(d.troops).toBeCloseTo(80_000);
    expect(lineStrength(g, l)).toBe(1);
    const on = attackLogic(g, a, front, 60);
    // The same state with the line not yet in force: the slowdown, and the line's 20k back in the clash.
    l.readyTick = g.tick + 1;
    const off = attackLogic(g, a, front, 60);
    expect(lineDefense(g, front, 2, 1)).toBeNull();
    l.readyTick = g.tick;
    expect(lineDefense(g, front, 2, 1)).toEqual({ speed: LINE_DEFENSE_SPEED, troops: 20_000 });
    expect(on.tickFraction).toBeGreaterThan(off.tickFraction * LINE_DEFENSE_SPEED);
    expect(on.attackerLoss).toBeGreaterThan(off.attackerLoss);
  });

  it('its back is bare, its reach LINE_REACH tiles, its ends square', () => {
    const g = arena();
    wall(g, 2, LineKind.Defensive, 150, true);
    // From behind (east): no effect.
    const behind = g.map.idx(160, 30);
    for (let x = 161; x < 170; x++) g.setOwner(g.map.idx(x, 30), 1);
    expect(lineDefense(g, behind, 2, 1)).toBeNull();
    // Head-on, beyond its reach: none either; within it, the slowdown.
    for (let x = 145; x < 150 - LINE_REACH + 1; x++) g.setOwner(g.map.idx(x, 26), 1);
    for (let x = 0; x < 145; x++) g.setOwner(g.map.idx(x, 26), 1);
    expect(lineDefense(g, g.map.idx(150 - LINE_REACH - 2, 30), 2, 1)).toBeNull();
    expect(lineDefense(g, g.map.idx(150 - LINE_REACH + 1, 26), 2, 1)).not.toBeNull();
    // Past its southern end (y 38.5): open ground.
    g.setOwner(g.map.idx(144, 44), 1);
    expect(lineDefense(g, g.map.idx(145, 44), 2, 1)).toBeNull();
  });

  it('an offensive line digs in for 30 s, then halves the losses of attacks pushing out from it', () => {
    const g = arena();
    const a = launchAttack(g, 1, 2, 50_000)!;
    const front = g.map.idx(145, 30);
    const before = attackLogic(g, a, front, 60).attackerLoss;
    const l = wall(g, 1, LineKind.Offensive, 140, false, 0.1);
    expect(l.readyTick).toBe(g.tick + LINE_OFFENSE_SETUP);
    expect(attackLogic(g, a, front, 60).attackerLoss).toBeCloseTo(before);
    l.readyTick = g.tick;
    expect(lineStrength(g, l)).toBe(1);
    expect(attackLogic(g, a, front, 60).attackerLoss).toBeCloseTo(before * (1 - LINE_OFFENSE_LOSS));
  });

  it('paid in troops: off the army and off the ceiling while it stands, back when taken down', () => {
    const g = arena();
    const p = g.players[2]!;
    const cap = maxTroops(g, p);
    g.step([cmd(2, { t: 'line', kind: 0, pts: [150.5, 22.5, 150.5, 38.5], side: 1, ratio: 0.25 })]);
    const l = g.lines[0]!;
    expect(l.troops).toBeCloseTo(25_000, -2);
    expect(p.lineTroops).toBeCloseTo(l.troops);
    expect(maxTroops(g, p)).toBeCloseTo(cap - l.troops);
    const troops = p.troops;
    g.step([cmd(2, { t: 'lineRemove', id: l.id })]);
    expect(g.lines.length).toBe(0);
    expect(p.lineTroops).toBe(0);
    expect(p.troops - p.lastGrowth).toBeCloseTo(troops + l.troops, 0);
    // Someone else's line cannot be taken down.
    const m = wall(g, 2, LineKind.Defensive, 150, true);
    g.step([cmd(1, { t: 'lineRemove', id: m.id })]);
    expect(g.lines.length).toBe(1);
  });

  it('only on your own land, LINE_MAX_PER_PLAYER at most', () => {
    const g = arena();
    const p = g.players[1]!;
    expect(placeLine(g, p, LineKind.Defensive, [160.5, 22.5, 160.5, 38.5], 1, 0.1)).toBe('short');
    for (let k = 0; k < LINE_MAX_PER_PLAYER; k++)
      expect(
        typeof placeLine(g, p, LineKind.Defensive, [10.5 + 4 * k, 22.5, 10.5 + 4 * k, 38.5], 1, 0.05),
      ).toBe('object');
    expect(placeLine(g, p, LineKind.Defensive, [100.5, 22.5, 100.5, 38.5], 1, 0.05)).toBe('max');
  });

  it('a tile of it taken loses its share of the troops and opens a breach; all taken, it is gone', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    const [n, troops] = [l.tiles.length, l.troops];
    // Breach the middle (y 28–32).
    for (let y = 28; y <= 32; y++) g.setOwner(g.map.idx(150, y), 1);
    expect(l.tiles.length).toBe(n - 5);
    expect(l.troops).toBeCloseTo((troops * (n - 5)) / n);
    expect(g.players[2]!.lineTroops).toBeCloseTo(l.troops);
    g.setOwner(g.map.idx(144, 30), 1);
    expect(lineDefense(g, g.map.idx(145, 30), 2, 1)).toBeNull(); // in front of the breach
    g.setOwner(g.map.idx(144, 24), 1);
    expect(lineDefense(g, g.map.idx(145, 24), 2, 1)).not.toBeNull(); // still held there
    for (const t of [...l.tiles]) g.setOwner(t, 1);
    expect(g.lines.length).toBe(0);
    expect(g.players[2]!.lineTroops).toBe(0);
  });

  it('survives a save: same lines, same index, same hash', () => {
    const g = arena();
    wall(g, 2, LineKind.Defensive, 150, true);
    wall(g, 1, LineKind.Offensive, 140, false);
    const back = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(back.lines).toEqual(g.lines);
    expect([...back.lineAt]).toEqual([...g.lineAt]);
    expect(hashGame(back)).toBe(hashGame(g));
  });

  it('a defensive line is laid in 3 s', () => {
    const g = arena();
    g.step([cmd(2, { t: 'line', kind: 0, pts: [150.5, 22.5, 150.5, 38.5], side: 1, ratio: 0.2 })]);
    expect(g.lines[0]!.readyTick).toBe(g.tick - 1 + LINE_DEFENSE_SETUP);
  });

  it('lets nothing through head-on while it holds troops; emptied, it stays and gives way', () => {
    const g = arena();
    const w = g.map.width;
    // A line across the whole field: no way round it.
    const pts = [150.5, 0.5, 150.5, 69.5];
    const l = placeLine(g, g.players[2]!, LineKind.Defensive, pts, sideOf(pts, 140, 30), 0.3) as FrontLine;
    l.readyTick = g.tick;
    const before = l.troops;
    g.players[1]!.troops = 400_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(145, 30), ratio: 0.5 })]);
    const beyond = () => {
      let n = 0;
      for (let y = 0; y < 70; y++) for (let x = 150; x < 200; x++) if (g.owner[y * w + x] === 1) n++;
      return n;
    };
    let emptied = false;
    for (let k = 0; k < 3000 && g.attacks.length > 0 && !emptied; k++) {
      g.step([]);
      if (l.troops >= 1) expect(beyond()).toBe(0);
      else emptied = true;
    }
    // 200k against 30k dug in (about 20 s at 3 to 1): the line bled out, still there (to be refilled or taken
    // down), its owner told; no longer a wall, the attack goes through.
    expect(l.troops).toBeLessThan(before);
    expect(emptied).toBe(true);
    expect(g.lines).toContain(l);
    expect(g.events.some((e) => e.k === 'notify' && e.key === 'notify.lineEmpty' && e.to === 2)).toBe(true);
    for (let k = 0; k < 600 && g.attacks.length > 0; k++) g.step([]);
    expect(beyond()).toBeGreaterThan(0);
  });

  it('only head-on: along the line or from behind, its tiles fall like any other', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    const t = g.map.idx(150, 30);
    expect(g.lineAt.get(t)).toBe(l.id);
    g.setOwner(g.map.idx(149, 30), 1); // in front of it
    expect(lineHolds(g, t, 2, 1)).toBe(l);
    g.setOwner(g.map.idx(149, 30), 2);
    g.setOwner(g.map.idx(150, 29), 1); // along it (a breach next door)
    expect(lineHolds(g, t, 2, 1)).toBeNull();
    g.setOwner(g.map.idx(150, 29), 2);
    g.setOwner(g.map.idx(151, 30), 1); // behind it
    expect(lineHolds(g, t, 2, 1)).toBeNull();
    // An empty line holds nothing.
    g.setOwner(g.map.idx(151, 30), 2);
    g.setOwner(g.map.idx(149, 30), 1);
    g.step([cmd(2, { t: 'lineTroops', id: l.id, troops: 0 })]);
    expect(l.troops).toBe(0);
    expect(lineHolds(g, t, 2, 1)).toBeNull();
  });

  it('a push it stands costs the attacker its losses and the line 1 / LINE_HOLD_TRADE of them', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    const p2 = g.players[2]!;
    const [troops, onLines] = [l.troops, p2.lineTroops];
    for (let x = 145; x < 150; x++) g.setOwner(g.map.idx(x, 30), 1);
    g.players[1]!.troops = 200_000;
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(150, 30), ratio: 0.5 })]);
    for (let k = 0; k < 20; k++) g.step([]);
    const lost = troops - l.troops;
    expect(lost).toBeGreaterThan(0);
    expect(p2.lineTroops).toBeCloseTo(onLines - lost);
    expect(g.owner[g.map.idx(150, 30)]).toBe(2);
    expect(LINE_HOLD_TRADE).toBe(3);
  });

  it('its troops can be changed: more from the army (as many as it has), fewer back to it', () => {
    const g = arena();
    const p = g.players[2]!;
    const l = wall(g, 2, LineKind.Defensive, 150, true, 0.1);
    const army = p.troops;
    g.step([cmd(2, { t: 'lineTroops', id: l.id, troops: 40_000 })]);
    expect(l.troops).toBeCloseTo(40_000);
    expect(p.lineTroops).toBeCloseTo(40_000);
    expect(p.troops - p.lastGrowth).toBeCloseTo(army - 30_000, 0);
    g.step([cmd(2, { t: 'lineTroops', id: l.id, troops: 5_000 })]);
    expect(l.troops).toBeCloseTo(5_000);
    expect(p.lineTroops).toBeCloseTo(5_000);
    // Asking for more than the army has: all it has.
    p.troops = 1_000;
    g.step([cmd(2, { t: 'lineTroops', id: l.id, troops: 1e9 })]);
    expect(l.troops).toBeLessThan(5_000 + 1_000 + 50);
    // Someone else's line cannot be changed.
    g.step([cmd(1, { t: 'lineTroops', id: l.id, troops: 0 })]);
    expect(l.troops).toBeGreaterThan(5_000);
  });

  it('the troops on lines are locked out of the total: army + lines never pass the old ceiling', () => {
    const g = arena();
    const p = g.players[2]!;
    for (let k = 0; k < 600; k++) g.step([]);
    const cap = maxTroops(g, p);
    p.troops = cap;
    g.step([cmd(2, { t: 'line', kind: 0, pts: [150.5, 22.5, 150.5, 38.5], side: 1, ratio: 0.5 })]);
    expect(p.lineTroops).toBeGreaterThan(cap * 0.45);
    for (let k = 0; k < 3000; k++) {
      g.step([]);
      expect(p.troops + p.lineTroops).toBeLessThanOrEqual(cap * 1.0001);
    }
    expect(p.popCap).toBeCloseTo(cap - p.lineTroops, -1);
  });
});

describe('moving the capital (1.18)', () => {
  it('costs 1 M gold and the disorganisation of a fall; re-establishing a lost one is free', () => {
    const g = arena();
    const p = g.players[2]!;
    g.tick += CAPITAL_MOVE_COOLDOWN + 1;
    const spot = g.map.idx(185, 50);
    p.gold = CAPITAL_MOVE_COST / 2;
    expect(moveCapital(g, p, spot)).toBe('gold');
    p.gold = CAPITAL_MOVE_COST * 2;
    expect(moveCapital(g, p, spot)).toBe('ok');
    expect(p.gold).toBe(CAPITAL_MOVE_COST);
    expect(p.disorgUntil).toBe(g.tick + CAPITAL_DISORG_TICKS);
    // Lost: re-established for nothing.
    p.capital = -1;
    p.gold = 0;
    expect(moveCapital(g, p, g.map.idx(185, 40))).toBe('ok');
  });
});
