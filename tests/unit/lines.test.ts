// Front lines (1.17, rules/lines.ts): drawn on your own land, paid in troops, facing one side.
// A defensive line (laid in 3 s) slows what attacks it head-on; its tiles stand by the balance
// of forces (1.19) and it shatters once turned; an offensive one, dug in after 30 s, spares
// and speeds up the attacks pushing out from it.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, startWith, testGame } from '../helpers';
import {
  CAPITAL_DISORG_TICKS,
  CAPITAL_MOVE_COOLDOWN,
  CAPITAL_MOVE_COST,
  LINE_BREAK_RATIO,
  LINE_CLASH,
  LINE_DEFENSE_SETUP,
  LINE_DEFENSE_SPEED,
  LINE_MAX_PER_PLAYER,
  LINE_MIN_DENSITY,
  LINE_OFFENSE_SPEED,
  LINE_OFFENSE_LOSS,
  LINE_OFFENSE_SETUP,
  LINE_REACH,
} from '../../src/core/game/constants';
import { attackLogic, launchAttack } from '../../src/core/rules/combat';
import {
  LineKind,
  lineClash,
  lineDefense,
  lineFront,
  lineGarrison,
  lineMaxTiles,
  lineTarget,
  lineStrength,
  lineTurned,
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

  it('a defensive line slows a head-on attack ×3 at full strength (its troops stay on the line)', () => {
    const g = arena();
    const d = g.players[2]!;
    const a = launchAttack(g, 1, 2, 50_000)!;
    const front = g.map.idx(145, 30);
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    expect(d.troops).toBeCloseTo(80_000);
    expect(lineStrength(g, l)).toBe(1);
    const on = attackLogic(g, a, front, 60);
    // The same state with the line not yet in force: only the slowdown differs.
    l.readyTick = g.tick + 1;
    const off = attackLogic(g, a, front, 60);
    expect(lineDefense(g, front, 2, 1)).toBeNull();
    l.readyTick = g.tick;
    expect(lineDefense(g, front, 2, 1)).toEqual({ speed: LINE_DEFENSE_SPEED });
    expect(on.tickFraction).toBeCloseTo(off.tickFraction * LINE_DEFENSE_SPEED);
    expect(on.attackerLoss).toBeCloseTo(off.attackerLoss);
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

  it('an offensive line: its troops wait 30 s, then go over the top straight ahead, fewer losses and faster', () => {
    const g = arena();
    const p1 = g.players[1]!;
    const l = wall(g, 1, LineKind.Offensive, 140, false, 0.1); // facing east, at player 2
    expect(l.readyTick).toBe(g.tick + LINE_OFFENSE_SETUP);
    expect(lineTarget(g, l)?.target).toBe(2);
    // Not ready yet: refused, the line stays.
    g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
    expect(g.lines).toContain(l);
    expect(g.attacks.length).toBe(0);
    // Ready: the line empties into an attack on player 2 carrying its preparation.
    l.readyTick = g.tick;
    const troops = l.troops;
    const strength = lineStrength(g, l);
    g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
    expect(g.lines).not.toContain(l);
    expect(p1.lineTroops).toBe(0);
    const a = g.attacks.find((x) => x.attacker === 1 && x.target === 2)!;
    expect(a).toBeTruthy();
    expect(a.prepared).toBeCloseTo(strength);
    expect(a.troops).toBeGreaterThan(troops * 0.9);
    // The prepared troops lose LINE_OFFENSE_LOSS fewer and advance LINE_OFFENSE_SPEED faster.
    const front = [...a.border][0]!;
    const out = attackLogic(g, a, front, 60);
    a.prepared = 0;
    const plain = attackLogic(g, a, front, 60);
    expect(out.attackerLoss).toBeCloseTo(plain.attackerLoss * (1 - LINE_OFFENSE_LOSS * strength));
    expect(out.tickFraction).toBeCloseTo(plain.tickFraction / (1 + (LINE_OFFENSE_SPEED - 1) * strength));
    // Mixed into an attack already under way, the preparation is weighted by the troops.
    const b = launchAttack(g, 1, 2, troops, undefined, 0)!;
    expect(b).toBe(a);
  });

  it('an assault aimed at a sector of the border: its own attack, starting there only, even on a country already attacked', () => {
    const g = arena();
    const l = wall(g, 1, LineKind.Offensive, 140, false, 0.1);
    l.readyTick = g.tick;
    // An attack already under way on player 2 along the whole border.
    g.step([cmd(1, { t: 'attack', tile: g.map.idx(145, 30), ratio: 0.2 })]);
    const whole = g.attacks.find((a) => a.attacker === 1 && a.target === 2)!;
    // The sector: player 2's border tiles from y 40 to 44.
    const sector = [40, 41, 42, 43, 44].map((y) => g.map.idx(145, y));
    g.step([cmd(1, { t: 'lineLaunch', id: l.id, tiles: sector })]);
    const mine = g.attacks.filter((a) => a.attacker === 1 && a.target === 2);
    expect(mine.length).toBe(2);
    const focused = mine.find((a) => a !== whole)!;
    expect(focused.focused).toBe(true);
    expect(focused.prepared).toBeGreaterThan(0);
    // Its front: only round the sector.
    for (const t of focused.border) {
      const y = Math.floor(t / g.map.width);
      expect(y).toBeGreaterThanOrEqual(38);
      expect(y).toBeLessThanOrEqual(46);
    }
    // A left click aims at a country's whole border instead.
    const m = wall(g, 1, LineKind.Offensive, 130, false, 0.05);
    m.readyTick = g.tick;
    g.step([cmd(1, { t: 'lineLaunch', id: m.id, target: 2 })]);
    expect(g.lines).not.toContain(m);
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

  it('a defensive line is in place at once', () => {
    const g = arena();
    g.step([cmd(2, { t: 'line', kind: 0, pts: [150.5, 22.5, 150.5, 38.5], side: 1, ratio: 0.2 })]);
    expect(LINE_DEFENSE_SETUP).toBe(0);
    expect(g.lines[0]!.readyTick).toBe(g.tick - 1);
  });

  it('balance of forces head-on: 3 to 1 against the attacker at even forces, 1 to 1 at 3 to 1, falls past it', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    const garrison = lineGarrison(l);
    const p2 = g.players[2]!;
    // Even forces: thrown back; the line loses LINE_CLASH × the push, the attacker 3 times that.
    let [troops, onLines] = [l.troops, p2.lineTroops];
    let c = lineClash(g, l, garrison);
    expect(c.holds).toBe(true);
    expect(troops - l.troops).toBeCloseTo(LINE_CLASH * garrison);
    expect(c.attackerLoss).toBeCloseTo(3 * LINE_CLASH * garrison);
    expect(p2.lineTroops).toBeCloseTo(onLines - (troops - l.troops));
    // Just under 3 to 1: still thrown back, about one for one.
    troops = l.troops;
    const g2 = lineGarrison(l);
    c = lineClash(g, l, 2.9 * g2);
    expect(c.holds).toBe(true);
    expect(c.attackerLoss / (troops - l.troops)).toBeCloseTo(LINE_BREAK_RATIO / 2.9);
    // 3 to 1 and over: the tile falls.
    onLines = p2.lineTroops;
    expect(lineClash(g, l, LINE_BREAK_RATIO * lineGarrison(l)).holds).toBe(false);
    expect(p2.lineTroops).toBe(onLines);
  });

  it('in a real attack its counter goes down; a big enough push breaks through', () => {
    const run = (army: number, ratio: number) => {
      const g = arena();
      const w = g.map.width;
      // A line across the whole field: no way round it.
      const pts = [150.5, 0.5, 150.5, 69.5];
      const l = placeLine(g, g.players[2]!, LineKind.Defensive, pts, sideOf(pts, 140, 30), 0.3) as FrontLine;
      l.readyTick = g.tick;
      const before = l.troops;
      g.players[1]!.troops = army;
      g.step([cmd(1, { t: 'attack', tile: g.map.idx(145, 30), ratio })]);
      for (let k = 0; k < 400; k++) g.step([]);
      let beyond = 0;
      for (let y = 0; y < 70; y++) for (let x = 151; x < 200; x++) if (g.owner[y * w + x] === 1) beyond++;
      return { lost: before - l.troops, beyond, line: l, g };
    };
    // 30k on 60 tiles (500 a tile) against 75k (worn down crossing the slowed ground first):
    // thrown back, the line's counter goes down by thousands, nothing beyond.
    const weak = run(150_000, 0.5);
    expect(weak.lost).toBeGreaterThan(5_000);
    expect(weak.beyond).toBe(0);
    // Against 150k: past 3 to 1 at the front, the attack goes through.
    const strong = run(300_000, 0.5);
    expect(strong.beyond).toBeGreaterThan(0);
  });

  it('only head-on: along the line or from behind, its tiles fall like any other', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    const t = g.map.idx(150, 30);
    expect(g.lineAt.get(t)).toBe(l.id);
    g.setOwner(g.map.idx(149, 30), 1); // in front of it
    expect(lineFront(g, t, 2, 1)).toBe(l);
    g.setOwner(g.map.idx(149, 30), 2);
    g.setOwner(g.map.idx(150, 29), 1); // along it (a breach next door)
    expect(lineFront(g, t, 2, 1)).toBeNull();
    g.setOwner(g.map.idx(150, 29), 2);
    g.setOwner(g.map.idx(151, 30), 1); // behind it
    expect(lineFront(g, t, 2, 1)).toBeNull();
    // An empty line holds nothing.
    g.setOwner(g.map.idx(151, 30), 2);
    g.setOwner(g.map.idx(149, 30), 1);
    g.step([cmd(2, { t: 'lineTroops', id: l.id, troops: 0 })]);
    expect(l.troops).toBe(0);
    expect(lineFront(g, t, 2, 1)).toBeNull();
  });

  it('turned, it shatters and its troops are lost; a narrow pass on one end is not enough', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true); // y 22–38, facing west, its back east
    const p2 = g.players[2]!;
    // The enemy 3 tiles behind its two southern tiles: under a quarter, it holds.
    for (const y of [37, 38]) for (let x = 151; x <= 154; x++) g.setOwner(g.map.idx(x, y), 1);
    for (let k = 0; k < 20; k++) g.step([]);
    expect(lineTurned(g, l)).toBe(false);
    expect(g.lines).toContain(l);
    // Behind a third of it: it shatters.
    for (let y = 29; y <= 38; y++) for (let x = 151; x <= 154; x++) g.setOwner(g.map.idx(x, y), 1);
    let told = false;
    for (let k = 0; k < 20; k++) {
      g.step([]);
      told ||= g.events.some((e) => e.k === 'notify' && e.key === 'notify.lineShattered' && e.to === 2);
    }
    expect(g.lines).not.toContain(l);
    expect(p2.lineTroops).toBe(0);
    expect(told).toBe(true);
  });

  it("no longer than its troops allow: LINE_MIN_DENSITY × the country's density on each tile", () => {
    const g = arena();
    const p = g.players[2]!;
    const max = lineMaxTiles(p.troops * 0.01, p.troops, p.tiles);
    const pts = [150.5, 0.5, 150.5, 69.5];
    const l = placeLine(g, p, LineKind.Defensive, pts, sideOf(pts, 140, 30), 0.01) as FrontLine;
    expect(typeof l).toBe('object');
    expect(l.tiles.length).toBe(max);
    expect(lineGarrison(l)).toBeGreaterThanOrEqual((LINE_MIN_DENSITY * 100_000) / p.tiles - 1);
    // Too few troops for three tiles: refused.
    p.troops = 100;
    expect(placeLine(g, p, LineKind.Defensive, [160.5, 22.5, 160.5, 38.5], sideOf(pts, 140, 30), 0.01)).toBe(
      'troops',
    );
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
