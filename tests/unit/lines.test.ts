// Front lines (1.17, rules/lines.ts): drawn on your own land, paid in troops, facing one side.
// A defensive line slows what attacks it head-on and its troops stand in the clash; an
// offensive one, dug in after 30 s, cuts the losses of the attacks pushing out from it.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import {
  LINE_DEFENSE_SPEED,
  LINE_MAX_PER_PLAYER,
  LINE_OFFENSE_LOSS,
  LINE_OFFENSE_SETUP,
  LINE_REACH,
} from '../../src/core/game/constants';
import { attackLogic, launchAttack } from '../../src/core/rules/combat';
import {
  LineKind,
  lineDefense,
  lineStrength,
  locate,
  placeLine,
  sideOf,
  type FrontLine,
} from '../../src/core/rules/lines';
import { maxTroops } from '../../src/core/game/economy';
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
});
