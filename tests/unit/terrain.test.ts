// Glaciers and high peaks (1.11): land like any other, only slow and barren; walls stay walls.
import { describe, expect, it } from 'vitest';
import { asciiMap, cmd, invariants, mapFromDisk, startWith, testGame } from '../helpers';
import { HABITABLE, HARSH, IS_LAND, MAG, SPEED, T, TERRAIN } from '../../src/core/map/terrain';
import { Attack, attackLogic } from '../../src/core/rules/combat';
import { checkPlacement, snapBuildTile } from '../../src/core/buildings/buildings';
import { validSpawnTile } from '../../src/core/game/spawn';
import { B, ROYALE_CLOSE, ROYALE_SWEEP } from '../../src/core/game/constants';
import { hashGame } from '../../src/core/net/hash';
import { restoreSnapshot, snapshotFromJson, snapshotToJson, takeSnapshot } from '../../src/core/net/snapshot';

describe('terrain table', () => {
  it('glaciers and high peaks are passable land, dearer and slower than mountains', () => {
    for (const t of [T.Glacier, T.Peaks]) {
      expect(IS_LAND[t]).toBe(1);
      expect(HARSH[t]).toBe(1);
      expect(HABITABLE[t]).toBe(0);
      expect(MAG[t]!).toBeGreaterThan(MAG[T.Mountain]! * 1.2);
      expect(SPEED[t]!).toBeGreaterThan(SPEED[T.Mountain]! * 1.25);
    }
    expect(MAG[T.Peaks]!).toBeGreaterThan(MAG[T.Glacier]!);
    // Walls stay walls; ordinary land is habitable.
    expect(IS_LAND[T.Impassable]).toBe(0);
    for (const t of [T.Plains, T.Hills, T.Mountain, T.Desert, T.Forest, T.Tundra, T.River])
      expect(HABITABLE[t]).toBe(1);
    expect(TERRAIN.map((t) => t.key)).toContain('glacier');
  });
});

describe('shipped maps', () => {
  it('Greenland is one landmass with its ice sheet; only mazes and two legends keep walls', () => {
    const world = mapFromDisk('world');
    let glacier = 0;
    let walls = 0;
    const comps = new Map<number, number>();
    for (let i = 0; i < world.size; i++) {
      const t = world.terrain[i]!;
      if (t === T.Impassable) walls++;
      if (t !== T.Glacier) continue;
      glacier++;
      comps.set(world.component[i]!, (comps.get(world.component[i]!) ?? 0) + 1);
    }
    expect(walls).toBe(0);
    expect(glacier).toBeGreaterThan(20_000);
    // The ice sheets are no longer holes: the biggest one shares its landmass with
    // habitable coasts (more tiles in the component than ice in it).
    const [comp, ice] = [...comps].sort((a, b) => b[1] - a[1])[0]!;
    expect(world.componentSize[comp]!).toBeGreaterThan(ice);
    // Glacier tiles count in the land (and so in the victory share and the troop cap).
    let land = 0;
    for (let i = 0; i < world.size; i++) if (IS_LAND[world.terrain[i]!]) land++;
    expect(world.landCount).toBe(land);
    // No deposit was stamped on the ice or the peaks.
    for (let i = 0; i < world.size; i++) if (HARSH[world.terrain[i]!]) expect(world.resource[i]).toBe(0);

    const lab = mapFromDisk('labyrinth');
    expect(lab.terrain.some((t) => t === T.Impassable)).toBe(true);
    expect(lab.terrain.some((t) => t === T.Glacier || t === T.Peaks)).toBe(false);
  });
});

const PEN = [
  '..............',
  '..............',
  '...^^^^^^^^...',
  '...^......^...',
  '...^......^...',
  '...^......^...',
  '...^^^^^^^^...',
  '..............',
];

describe('rules on harsh land', () => {
  it('large armies settle glaciers and peaks about twice as slowly as plains (mountains: OpenFront)', () => {
    const g = testGame(asciiMap(['.Mg^'], 4), 1);
    startWith(g, [[1, 1]]);
    const a = new Attack(g.nextId(), 1, 0, 1_000_000, g.tick);
    const at = (x: number) => attackLogic(g, a, g.map.idx(x, 2), 4);
    const [plains, mountain, glacier, peaks] = [at(2), at(6), at(10), at(14)];
    expect(mountain.tickFraction).toBeCloseTo(plains.tickFraction, 9); // OpenFront's floor
    expect(glacier.tickFraction / plains.tickFraction).toBeCloseTo(SPEED[T.Glacier]! / 16.5, 5);
    expect(peaks.tickFraction / plains.tickFraction).toBeCloseTo(SPEED[T.Peaks]! / 16.5, 5);
    expect(glacier.attackerLoss).toBeGreaterThan(mountain.attackerLoss);
    expect(peaks.attackerLoss).toBeGreaterThan(glacier.attackerLoss);
  });

  it('a country walled in by high peaks climbs out of its valley', () => {
    const g = testGame(asciiMap(PEN, 4), 1, { victoryThreshold: 101 });
    startWith(g, [[28, 18]]);
    const p = g.players[1]!;
    p.troops = 200_000;
    const outside = g.map.idx(2, 2);
    for (let k = 0; k < 2400 && g.owner[outside] !== 1; k++)
      g.step(k % 40 === 0 ? [cmd(1, { t: 'attack', tile: g.map.idx(14, 10), ratio: 0.6 })] : []);
    expect(g.owner[outside]).toBe(1);
    expect(invariants(g)).toEqual([]);
  });

  it('nobody spawns or builds on a glacier or among the peaks; the build snaps to habitable land', () => {
    const g = testGame(asciiMap(['......gggg^^^^', '......gggg^^^^', '......gggg^^^^'], 4), 1);
    expect(validSpawnTile(g, g.map.idx(30, 4))).toBe(false);
    expect(validSpawnTile(g, g.map.idx(50, 4))).toBe(false);
    expect(validSpawnTile(g, g.map.idx(8, 4))).toBe(true);
    startWith(g, [[8, 4]]);
    const p = g.players[1]!;
    for (let i = 0; i < g.map.size; i++) if (IS_LAND[g.map.terrain[i]!]) g.setOwner(i, 1);
    p.gold = 1e9;
    const ice = g.map.idx(30, 6);
    const peak = g.map.idx(50, 6);
    expect(checkPlacement(g, p, B.City, ice)).toBe('notLand');
    expect(checkPlacement(g, p, B.City, peak)).toBe('notLand');
    expect(checkPlacement(g, p, B.City, g.map.idx(10, 6))).toBe('ok');
    const snapped = snapBuildTile(g, p, B.City, g.map.idx(24, 6)); // ice, a step from the plains
    expect(snapped).toBeGreaterThanOrEqual(0);
    expect(HABITABLE[g.map.terrain[snapped]!]).toBe(1);
    // Held glacier and peaks still count as land.
    expect(p.usefulTiles).toBe(g.usefulLand);
  });
});

describe('battle royale zones', () => {
  // Two islands: the countries live on the small western one; the eastern one, twice as
  // large, is empty and only boats reach it.
  const TWO = [
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    '~........~~~~................~',
    '~........~~~~................~',
    '~........~~~~................~',
    '~........~~~~................~',
    '~........~~~~................~',
    '~........~~~~................~',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  ];
  const zones = (seed: number) => {
    const g = testGame(asciiMap(TWO, 8), 2, { mode: 'battleRoyale', seed });
    startWith(g, [
      [20, 20],
      [50, 40],
    ]);
    g.step([]);
    g.victory.continued = true;
    const ring = g.victory.ring!;
    const out: [number, number, number][] = [];
    for (let k = 0; k < 8; k++) {
      out.push([ring.nx, ring.ny, ring.nr]);
      ring.closeAt = g.tick;
      for (let t = 0; t <= ROYALE_CLOSE + ROYALE_SWEEP; t++) g.step([]);
    }
    return { g, out };
  };

  it('close over the land the countries can walk to, not the larger empty island', () => {
    // The western island's land: tiles x 8–71, y 8–55 (8 × 8-tile cells).
    const reachesWest = ([x, y, r]: [number, number, number]) =>
      Math.hypot(Math.max(8 - x, 0, x - 72), Math.max(8 - y, 0, y - 56)) < r;
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const { out } = zones(seed);
      // Every zone keeps a part of the inhabited island: nobody is penned behind the sea.
      for (const z of out) expect(reachesWest(z), `seed ${seed}: ${z.join(', ')}`).toBe(true);
    }
  });

  it('stay deterministic across a snapshot', () => {
    const { g } = zones(11);
    const copy = restoreSnapshot(g.map, snapshotFromJson(snapshotToJson(takeSnapshot(g))));
    expect(hashGame(copy)).toBe(hashGame(g));
    const ring = g.victory.ring!;
    ring.closeAt = g.tick;
    copy.victory.ring!.closeAt = copy.tick;
    for (let t = 0; t <= ROYALE_CLOSE + ROYALE_SWEEP + 2; t++) {
      g.step([]);
      copy.step([]);
    }
    expect(copy.victory.ring).toEqual(g.victory.ring);
    expect(hashGame(copy)).toBe(hashGame(g));
  });
});
