// The hover card of a ship, plane or train: whose it is (and what they are to us), what it
// is, its troops or hull, and where it heads (src/ui/game/unitHover.ts), from the
// destination the worker packs in the unit buffer (src/engine/unitDest.ts).
import { describe, expect, it } from 'vitest';
import { asciiMap, testGame, startWith, cmd } from '../helpers';
import { U, makeUnit } from '../../src/core/units/unit';
import { unitDestTile } from '../../src/engine/unitDest';
import { unitHover, type UnitHoverState } from '../../src/ui/game/unitHover';
import { UNIT_STRIDE, type PlayerView } from '../../src/engine/protocol';
import type { Building } from '../../src/core/buildings/building';

const W = 10;
const H = 10;

function player(id: number, extra: Partial<PlayerView> = {}): PlayerView {
  return { id, team: 0, allies: [], ...extra } as unknown as PlayerView;
}

/** A client mirror with the given units: [id, type, owner, kind, hp, troops, dest, tx, ty, level]. */
function mirror(
  units: [number, U, number, number, number, number, number, number, number, number][],
  viewer = 1,
  players: PlayerView[] = [player(1, { allies: [3] }), player(2), player(3, { allies: [1] }), player(4)],
): UnitHoverState {
  const buf = new Float32Array(units.length * UNIT_STRIDE);
  units.forEach(([id, type, owner, kind, hp, troops, dest, tx, ty, level], k) => {
    const o = k * UNIT_STRIDE;
    buf[o] = id;
    buf[o + 1] = type;
    buf[o + 2] = owner;
    buf[o + 3] = 1;
    buf[o + 4] = 1;
    buf[o + 5] = hp;
    buf[o + 6] = kind;
    buf[o + 7] = level;
    buf[o + 10] = tx;
    buf[o + 11] = ty;
    buf[o + 14] = troops;
    buf[o + 15] = dest;
  });
  // Columns 0–4 belong to player 1 (us), 5–9 to player 2.
  const owner = new Uint16Array(W * H);
  for (let i = 0; i < owner.length; i++) owner[i] = i % W < 5 ? 1 : 2;
  return {
    units: buf,
    unitCount: units.length,
    players: new Map(players.map((p) => [p.id, p])),
    owner,
    width: W,
    height: H,
    viewer,
  };
}

describe('unit hover card: data', () => {
  it('a transport: its owner, troops aboard and the country it sails to', () => {
    const s = mirror([[7, U.Transport, 2, 0, 1, 12_345, 3, 0, 0, 0]]);
    const d = unitHover(s, [], 7)!;
    expect(d.key).toBe('transport');
    expect(d.owner).toBe(2);
    expect(d.troops).toBe(12_345);
    expect(d.hp).toBeNull();
    // Landing on our land (tile 3: column 3): an enemy whatever the papers say.
    expect(d.dest).toBe(1);
    expect(d.relation).toBe('enemy');
    // Turned back: no destination, it sails home.
    const back = unitHover(mirror([[7, U.Transport, 4, 1, 1, 500, 3, 0, 0, 0]]), [], 7)!;
    expect(back.status).toBe('turnedBack');
    expect(back.dest).toBeNull();
    expect(back.relation).toBe('neutral');
  });

  it('a warship: hull, veterancy and what it is doing; relations from the viewer', () => {
    const s = mirror([
      [1, U.Warship, 1, 0, 0.75, 0, -1, 0, 0, 2],
      [2, U.Warship, 3, 2, 0.4, 0, -1, 0, 0, 0],
      [3, U.Warship, 2, 1, 0.3, 0, -1, 0, 0, 0],
      [4, U.Warship, 4, 0, 1, 0, -1, 0, 0, 0],
    ]);
    const mine = unitHover(s, [2], 1)!;
    expect(mine).toMatchObject({
      key: 'warship',
      relation: 'you',
      hp: 0.75,
      veteran: 2,
      status: 'patrolling',
    });
    expect(mine.troops).toBeNull();
    expect(unitHover(s, [2], 2)).toMatchObject({ relation: 'ally', status: 'docked' });
    expect(unitHover(s, [2], 3)).toMatchObject({ relation: 'enemy', status: 'repairing' });
    expect(unitHover(s, [2], 4)).toMatchObject({ relation: 'neutral' });
    // A teammate reads as one; a spectator has no relation at all.
    const team = mirror([[5, U.Warship, 2, 0, 1, 0, -1, 0, 0, 0]], 1, [
      player(1, { team: 1 }),
      player(2, { team: 1 }),
    ]);
    expect(unitHover(team, [], 5)!.relation).toBe('teammate');
    expect(unitHover(mirror([[5, U.Warship, 2, 0, 1, 0, -1, 0, 0, 0]], 0), [], 5)!.relation).toBeNull();
  });

  it('merchants and trains name the country they head to (a train at home says nothing)', () => {
    const s = mirror([
      [1, U.Merchant, 1, 0, 1, 0, 8, 0, 0, 0],
      [2, U.Train, 1, 0, 1, 1, 4, 0, 0, 0],
      [3, U.Train, 1, 0, 1, 1, 9, 0, 0, 0],
      [4, U.Merchant, 2, 1, 1, 0, 2, 0, 0, 0],
    ]);
    expect(unitHover(s, [], 1)).toMatchObject({ key: 'merchant', dest: 2, relation: 'you' });
    expect(unitHover(s, [], 2)!.dest).toBeNull();
    expect(unitHover(s, [], 3)).toMatchObject({ key: 'train', dest: 2 });
    expect(unitHover(s, [], 4)).toMatchObject({ status: 'pirated', dest: 1 });
  });

  it('planes: their target country until they turn for home', () => {
    const s = mirror([
      [1, U.Bomber, 2, 0, 0.5, 0, -1, 2.5, 4.5, 0],
      [2, U.Bomber, 2, 1, 0.5, 0, -1, 2.5, 4.5, 0],
      [3, U.Recon, 1, 1, 1, 0, -1, 7.5, 1.5, 0],
      [4, U.Fighter, 1, 2, 1, 0, -1, 7.5, 1.5, 0],
    ]);
    expect(unitHover(s, [], 1)).toMatchObject({ key: 'bomber', hp: 0.5, dest: 1, relation: 'enemy' });
    expect(unitHover(s, [], 2)).toMatchObject({ status: 'returning', dest: null, relation: 'neutral' });
    expect(unitHover(s, [], 3)).toMatchObject({ key: 'recon', status: 'orbiting', dest: 2 });
    expect(unitHover(s, [], 4)).toMatchObject({ key: 'fighter', status: 'intercepting', dest: null });
  });

  it('nothing for a unit gone, a missile or a shell', () => {
    const s = mirror([
      [1, U.Nuke, 2, 0, 1, 0, 3, 0, 0, 0],
      [2, U.Shell, 2, 0, 1, 0, -1, 0, 0, 0],
    ]);
    expect(unitHover(s, [], 1)).toBeNull();
    expect(unitHover(s, [], 2)).toBeNull();
    expect(unitHover(s, [], 99)).toBeNull();
  });
});

describe('unit hover card: destinations packed by the worker', () => {
  it("a transport heads for its landing tile, a merchant for its port's, a train for its next station", () => {
    const g = testGame(
      asciiMap(
        [
          '~~~~~~~~~~~~~~~~~~~~~~~~',
          '~......~~~~~~~~~......~~',
          '~......~~~~~~~~~......~~',
          '~......~~~~~~~~~......~~',
          '~~~~~~~~~~~~~~~~~~~~~~~~',
        ],
        6,
      ),
      2,
    );
    startWith(g, [
      [20, 15],
      [110, 15],
    ]);
    const [p1, p2] = [g.players[1]!, g.players[2]!];
    p1.troops = 100_000;
    p2.troops = 60_000;
    g.step([
      cmd(1, { t: 'attack', tile: g.map.idx(30, 10), ratio: 0.3 }),
      cmd(2, { t: 'attack', tile: g.map.idx(100, 10), ratio: 0.5 }),
    ]);
    for (let k = 0; k < 200; k++) g.step([]);
    g.step([cmd(1, { t: 'boat', tile: g.map.idx(110, 15), ratio: 0.5 })]);
    const boat = g.units.find((u) => u.type === U.Transport)!;
    expect(boat).toBeDefined();
    const dest = unitDestTile(g, boat);
    expect(dest).toBe(boat.target);
    expect(g.owner[dest]).toBe(2);

    // A port and a station of each side (only their tiles matter here).
    const at = (id: number, owner: number, x: number, y: number) =>
      ({ id, owner, x, y, tile: g.map.idx(x, y) }) as unknown as Building;
    g.buildings.set(9001, at(9001, 2, 100, 10));
    g.buildings.set(9002, at(9002, 1, 30, 10));
    const m = makeUnit(g.nextId(), U.Merchant, 1, 50.5, 3.5);
    m.dest = 9001;
    expect(unitDestTile(g, m)).toBe(g.map.idx(100, 10));
    g.rails.push({ id: 77, a: 9002, b: 9001, owner: 1, tiles: [], alive: true });
    const tr = makeUnit(g.nextId(), U.Train, 1, 30.5, 10.5);
    tr.rail = 77;
    tr.dir = 1;
    expect(unitDestTile(g, tr)).toBe(g.map.idx(100, 10));
    tr.dir = -1;
    expect(unitDestTile(g, tr, new Map(g.rails.map((r) => [r.id, r])))).toBe(g.map.idx(30, 10));
    // Warships patrol: no destination to name.
    expect(unitDestTile(g, makeUnit(g.nextId(), U.Warship, 1, 50.5, 3.5))).toBe(-1);
  });
});
