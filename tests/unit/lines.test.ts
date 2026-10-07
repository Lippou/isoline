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
  LINE_FRONT_LOSS,
  LINE_DEFENSE_PREP,
  LINE_DEFENSE_PREP_MULT,
  LINE_OFFENSE_SETUP,
  LINE_REACH,
} from '../../src/core/game/constants';
import { attackLogic, launchAttack } from '../../src/core/rules/combat';
import {
  LineKind,
  lineClash,
  lineDefense,
  lineDefended,
  linePrepared,
  isClosed,
  lineFront,
  lineGarrison,
  lineMaxTiles,
  lineStrength,
  lineTurned,
  locate,
  placeLine,
  placeOffensive,
  removeLine,
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
  const l = placeLine(g, g.players[owner]!, pts, side, ratio);
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

  it('an offensive line is laid on the border with a country: all of it, or the stretch swept, as long as its troops allow', () => {
    const g = arena();
    const p = g.players[1]!;
    const w = g.map.width;
    const l = placeOffensive(g, p, 2, g.map.idx(145, 30), null, 0.2) as FrontLine;
    expect(typeof l).toBe('object');
    expect(l.target).toBe(2);
    expect(l.readyTick).toBe(g.tick + LINE_OFFENSE_SETUP);
    // The whole border: our 60 tiles along x 144.
    expect(l.tiles.length).toBe(60);
    for (const t of l.tiles) expect(t % w).toBe(144);
    removeLine(g, l, true);
    // A stretch swept (player 2's tiles from y 40 to 44): only along it.
    const sector = [40, 41, 42, 43, 44].map((y) => g.map.idx(145, y));
    const m = placeOffensive(g, p, 2, sector[0]!, sector, 0.05) as FrontLine;
    expect(m.tiles.map((t) => Math.floor(t / w))).toEqual([40, 41, 42, 43, 44]);
    removeLine(g, m, true);
    // Too long for its troops: the stretch nearest the click.
    const max = lineMaxTiles(p.troops * 0.002, p.troops + p.lineTroops, p.tiles);
    const n = placeOffensive(g, p, 2, g.map.idx(145, 10), null, 0.002) as FrontLine;
    expect(n.tiles.length).toBe(max);
    for (const t of n.tiles) expect(Math.abs(Math.floor(t / w) - 10)).toBeLessThanOrEqual(Math.ceil(max / 2));
    // Never on ourselves, nor where we have no border with that country.
    expect(placeOffensive(g, p, 1, 0, null, 0.1)).toBe('target');
    expect(placeOffensive(g, p, 2, 0, [g.map.idx(190, 30)], 0.1)).toBe('border');
  });

  it('its arrow drawn, a click launches it: under the arrow −50 % losses and +50 % speed, −20 % losses along the rest (1.24)', () => {
    const g = arena();
    const p1 = g.players[1]!;
    const w = g.map.width;
    const sector = Array.from({ length: 21 }, (_, k) => g.map.idx(145, 20 + k));
    const l = placeOffensive(g, p1, 2, sector[0]!, sector, 0.1) as FrontLine;
    const troops = l.troops;
    const strength = lineStrength(g, l);
    // No arrow yet: a launch does nothing.
    g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
    expect(g.attacks.length).toBe(0);
    // The arrow drawn: still nothing until the click on it, even fully charged.
    const aim = g.map.idx(175, 30);
    g.step([cmd(1, { t: 'lineAim', id: l.id, aim })]);
    expect(l.aim).toBe(aim);
    l.laidTick = g.tick - LINE_OFFENSE_SETUP;
    l.readyTick = g.tick;
    g.step([]);
    expect(g.attacks.length).toBe(0);
    g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
    const a = g.attacks.find((x) => x.attacker === 1 && x.target === 2)!;
    expect(a).toBeTruthy();
    expect(a.focused).toBe(true);
    expect(a.aim).toBe(aim);
    expect(a.aimFrom).toBe(g.map.idx(144, 30));
    expect(a.prepared).toBeCloseTo(strength);
    expect(a.troops).toBeGreaterThan(troops * 0.9);
    expect(p1.lineTroops).toBe(0);
    expect(l.attack).toBe(a.id);
    // From the line only.
    for (const t of a.border) expect(Math.abs(Math.floor(t / w) - 30)).toBeLessThanOrEqual(13);
    const bonus = (tile: number) => {
      const out = attackLogic(g, a, tile, 60);
      const prepared = a.prepared;
      a.prepared = 0;
      const plain = attackLogic(g, a, tile, 60);
      a.prepared = prepared;
      return { loss: out.attackerLoss / plain.attackerLoss, speed: plain.tickFraction / out.tickFraction };
    };
    const under = bonus(g.map.idx(145, 30));
    expect(under.loss).toBeCloseTo(1 - LINE_OFFENSE_LOSS * strength);
    expect(under.speed).toBeCloseTo(1 + (LINE_OFFENSE_SPEED - 1) * strength);
    const aside = bonus(g.map.idx(145, 40));
    expect(aside.loss).toBeCloseTo(1 - LINE_FRONT_LOSS * strength);
    expect(aside.speed).toBeCloseTo(1);
    // The line is the attack's front: our tiles on it, its troops the attack's.
    for (let k = 0; k < 40; k++) g.step([]);
    expect(g.lines).toContain(l);
    expect(l.troops).toBeCloseTo(a.troops, 0);
    expect(l.tiles.some((t) => t % w >= 145)).toBe(true);
    for (const t of l.tiles) expect(g.owner[t]).toBe(1);
    // A launched line is neither refilled nor taken down: it goes with its attack.
    g.step([cmd(1, { t: 'lineRemove', id: l.id })]);
    expect(g.lines).toContain(l);
    a.troops = 0;
    for (let k = 0; k < 6; k++) g.step([]);
    expect(g.lines).not.toContain(l);
    expect(p1.lineTroops).toBe(0);
  });

  it('launched before it is charged, it carries that share of its bonuses (1.24)', () => {
    const g = arena();
    const l = placeOffensive(g, g.players[1]!, 2, g.map.idx(145, 30), null, 0.1) as FrontLine;
    const strength = lineStrength(g, l);
    g.step([cmd(1, { t: 'lineAim', id: l.id, aim: g.map.idx(175, 30) })]);
    l.laidTick = g.tick - LINE_OFFENSE_SETUP / 2;
    g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
    const a = g.attacks.find((x) => x.attacker === 1 && x.target === 2)!;
    expect(a.prepared).toBeCloseTo(strength * 0.5, 2);
  });

  it('a defensive line, organised on order, slows twice as much once its LINE_DEFENSE_PREP is done (1.24.1)', () => {
    const g = arena();
    const l = wall(g, 2, LineKind.Defensive, 150, true);
    for (let x = 0; x < 145; x++) g.setOwner(g.map.idx(x, 30), 1);
    const tile = g.map.idx(145, 30);
    const s = lineStrength(g, l);
    const base = 1 + (LINE_DEFENSE_SPEED - 1) * s;
    // Laid: in place at once, not organised — however long it stands.
    for (let k = 0; k < LINE_DEFENSE_PREP + 5; k++) g.step([]);
    expect(linePrepared(g, l)).toBe(false);
    expect(lineDefense(g, tile, 2, 1)!.speed).toBeCloseTo(base);
    // Organised: LINE_DEFENSE_PREP of work, then the bonus.
    g.step([cmd(2, { t: 'lineOrganize', id: l.id })]);
    expect(linePrepared(g, l)).toBe(false);
    for (let k = 0; k < LINE_DEFENSE_PREP; k++) g.step([]);
    expect(linePrepared(g, l)).toBe(true);
    expect(lineDefense(g, tile, 2, 1)!.speed).toBeCloseTo(
      1 + (LINE_DEFENSE_SPEED * LINE_DEFENSE_PREP_MULT - 1) * s,
    );
  });

  it("the breakthrough stops at the arrow's head: the assault ends there, its troops back home (1.24.1)", () => {
    const g = arena();
    const p1 = g.players[1]!;
    p1.troops = 400_000;
    const sector = [28, 29, 30, 31, 32].map((y) => g.map.idx(145, y));
    const l = placeOffensive(g, p1, 2, sector[2]!, sector, 0.5) as FrontLine;
    const aim = g.map.idx(151, 30);
    g.step([cmd(1, { t: 'lineAim', id: l.id, aim })]);
    l.laidTick = g.tick - LINE_OFFENSE_SETUP;
    g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
    const a = g.attacks.find((x) => x.attacker === 1 && x.target === 2)!;
    for (let k = 0; k < 400 && !a.done; k++) g.step([]);
    expect(a.done).toBe(true);
    // The head reached (it or a tile next to it taken), the troops back home.
    const near = [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => g.owner[aim + dy * g.map.width + dx] === 1));
    expect(near).toBe(true);
    expect(p1.troops).toBeGreaterThan(100_000);
    // It went no further than its head (a few tiles of front round it at most).
    let far = 0;
    for (let y = 0; y < 70; y++) for (let x = 156; x < 200; x++) if (g.owner[g.map.idx(x, y)] === 1) far++;
    expect(far).toBe(0);
    expect(g.lines).not.toContain(l);
  });

  it('the front heads for the arrow, at the same pace; a new arrow turns it', () => {
    const conquest = (aimY: number, turnY = -1) => {
      const g = arena();
      g.players[1]!.troops = 300_000;
      const w = g.map.width;
      const l = placeOffensive(g, g.players[1]!, 2, g.map.idx(145, 35), null, 0.3) as FrontLine;
      l.readyTick = g.tick;
      g.step([cmd(1, { t: 'lineAim', id: l.id, aim: g.map.idx(190, aimY) })]);
      g.step([cmd(1, { t: 'lineLaunch', id: l.id })]);
      for (let k = 0; k < 30; k++) g.step([]);
      if (turnY >= 0) g.step([cmd(1, { t: 'lineAim', id: l.id, aim: g.map.idx(190, turnY) })]);
      for (let k = 0; k < 30; k++) g.step([]);
      let [n, sy] = [0, 0];
      for (let y = 0; y < 70; y++)
        for (let x = 145; x < 200; x++) if (g.owner[y * w + x] === 1) [n, sy] = [n + 1, sy + y];
      return { n, y: sy / Math.max(1, n) };
    };
    const north = conquest(6);
    const south = conquest(63);
    expect(north.n).toBeGreaterThan(20);
    expect(south.y).toBeGreaterThan(north.y + 6);
    // Same pace either way.
    expect(Math.abs(north.n - south.n)).toBeLessThan(0.25 * north.n);
    // Turned south half way, it ends further south than kept north.
    expect(conquest(6, 63).y).toBeGreaterThan(north.y + 2);
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
    expect(placeLine(g, p, [160.5, 22.5, 160.5, 38.5], 1, 0.1)).toBe('short');
    for (let k = 0; k < LINE_MAX_PER_PLAYER; k++)
      expect(typeof placeLine(g, p, [10.5 + 4 * k, 22.5, 10.5 + 4 * k, 38.5], 1, 0.05)).toBe('object');
    expect(placeLine(g, p, [100.5, 22.5, 100.5, 38.5], 1, 0.05)).toBe('max');
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
    placeOffensive(g, g.players[1]!, 2, g.map.idx(145, 30), null, 0.1);
    const back = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(back.lines).toEqual(g.lines);
    expect([...back.lineAt]).toEqual([...g.lineAt]);
    expect(hashGame(back)).toBe(hashGame(g));
  });

  it('a position closed on itself holds its every corner, the one it started from too (1.23)', () => {
    const square = (close: boolean) => {
      const g = arena();
      const end = close ? [160.5, 25.5] : [160.5, 27.5];
      const pts = [160.5, 25.5, 180.5, 25.5, 180.5, 45.5, 160.5, 45.5, ...end];
      expect(isClosed(pts)).toBe(close);
      // Facing out.
      const l = placeLine(g, g.players[2]!, pts, sideOf(pts, 170.5, 15.5), 0.3) as FrontLine;
      expect(typeof l).toBe('object');
      return g;
    };
    // Just off the starting corner, outside.
    const corner = (g: Game) => lineDefended(g, g.map.idx(158, 23));
    expect(corner(square(true))).toBe(true);
    expect(corner(square(false))).toBe(false);
    // The far corners were held either way.
    const g = square(false);
    expect(lineDefended(g, g.map.idx(183, 23))).toBe(true);
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
      const l = placeLine(g, g.players[2]!, pts, sideOf(pts, 140, 30), 0.3) as FrontLine;
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
    const l = placeLine(g, p, pts, sideOf(pts, 140, 30), 0.01) as FrontLine;
    expect(typeof l).toBe('object');
    expect(l.tiles.length).toBe(max);
    expect(lineGarrison(l)).toBeGreaterThanOrEqual((LINE_MIN_DENSITY * 100_000) / p.tiles - 1);
    // Too few troops for three tiles: refused.
    p.troops = 100;
    expect(placeLine(g, p, [160.5, 22.5, 160.5, 38.5], sideOf(pts, 140, 30), 0.01)).toBe('troops');
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
