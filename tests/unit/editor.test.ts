// Map editor model (1.16): continuous strokes, shapes, flood fill, undo / redo as bounded
// diffs, markers and their validation, and the .isomap round trip.
import { describe, expect, it } from 'vitest';
import { EditorModel, altitudeFor, MIN_LAND } from '../../src/ui/editor/editorModel';
import { History } from '../../src/ui/editor/history';
import {
  discOffsets,
  floodRegion,
  lineTiles,
  stampSpacing,
  strokeStamps,
  fillMatches,
} from '../../src/ui/editor/raster';
import { T } from '../../src/core/map/terrain';
import { parseIsoMap } from '../../src/core/map/format';

const ocean = (w = 200, h = 120) => EditorModel.blank(w, h, 'Test', 'ocean');
const count = (m: EditorModel, t: number) => m.terrain.reduce((n, v) => n + (v === t ? 1 : 0), 0);

/** Whether the tiles of terrain t form one 8-connected piece. */
function connected(m: EditorModel, t: number): boolean {
  const { width: w, height: h } = m;
  const start = m.terrain.indexOf(t);
  if (start < 0) return false;
  const seen = new Uint8Array(w * h);
  const stack = [start];
  seen[start] = 1;
  let n = 0;
  while (stack.length) {
    const i = stack.pop()!;
    n++;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (seen[j] || m.terrain[j] !== t) continue;
        seen[j] = 1;
        stack.push(j);
      }
  }
  return n === count(m, t);
}

describe('line interpolation', () => {
  it('Bresenham lines are 8-connected and end where asked', () => {
    for (const [x0, y0, x1, y1] of [
      [0, 0, 37, 11],
      [50, 3, 2, 40],
      [5, 5, 5, 5],
      [10, 80, 90, 79],
    ] as const) {
      const pts = lineTiles(x0, y0, x1, y1);
      expect(pts[0]).toEqual([x0, y0]);
      expect(pts[pts.length - 1]).toEqual([x1, y1]);
      for (let k = 1; k < pts.length; k++) {
        expect(Math.abs(pts[k]![0] - pts[k - 1]![0])).toBeLessThanOrEqual(1);
        expect(Math.abs(pts[k]![1] - pts[k - 1]![1])).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stamps along a segment are never further apart than half the brush radius', () => {
    for (const size of [1, 2, 5, 12, 40]) {
      const stamps = strokeStamps(3, 4, 150, 61, size);
      let prev: [number, number] = [3, 4];
      for (const s of stamps) {
        expect(Math.max(Math.abs(s[0] - prev[0]), Math.abs(s[1] - prev[1]))).toBeLessThanOrEqual(
          Math.max(1, stampSpacing(size)),
        );
        expect(stampSpacing(size)).toBeLessThanOrEqual(Math.max(1, size / 4));
        prev = s;
      }
      expect(prev).toEqual([150, 61]);
    }
  });

  it('a fast drag (few pointer events far apart) paints one unbroken line, not dots', () => {
    for (const size of [1, 3, 9]) {
      const m = ocean();
      // Four pointer events across the map, as a quick flick of the mouse sends them.
      const pts = [
        [5, 5],
        [70, 40],
        [140, 20],
        [190, 110],
      ];
      m.begin('paint');
      m.stamp(pts[0]![0]!, pts[0]![1]!, size, { kind: 'terrain', t: T.Plains });
      for (let k = 1; k < pts.length; k++)
        m.stroke(pts[k - 1]![0]!, pts[k - 1]![1]!, pts[k]![0]!, pts[k]![1]!, size, {
          kind: 'terrain',
          t: T.Plains,
        });
      m.end();
      expect(connected(m, T.Plains)).toBe(true);
      // Every tile of the polyline itself is painted.
      for (let k = 1; k < pts.length; k++)
        for (const [x, y] of lineTiles(pts[k - 1]![0]!, pts[k - 1]![1]!, pts[k]![0]!, pts[k]![1]!))
          expect(m.terrainAt(x, y)).toBe(T.Plains);
      // One stroke = one undo step.
      expect(m.history.size).toBe(1);
    }
  });

  it('brush discs grow with the size', () => {
    expect(discOffsets(1).length / 2).toBe(1);
    expect(discOffsets(3).length / 2).toBe(9);
    expect(discOffsets(20).length / 2).toBeGreaterThan(300);
  });

  it('the line tool draws a continuous line of the brush width', () => {
    const m = ocean();
    m.line(10, 100, 180, 8, 4, { kind: 'terrain', t: T.Forest });
    expect(connected(m, T.Forest)).toBe(true);
    expect(m.terrainAt(10, 100)).toBe(T.Forest);
    expect(m.terrainAt(180, 8)).toBe(T.Forest);
  });
});

describe('shapes and flood fill', () => {
  it('rectangles and ellipses fill their box', () => {
    const m = ocean();
    m.fillRect(20, 10, 29, 19, T.Desert);
    expect(count(m, T.Desert)).toBe(100);
    m.fillEllipse(100, 20, 139, 59, T.Hills);
    const n = count(m, T.Hills);
    expect(n).toBeGreaterThan(Math.PI * 20 * 20 * 0.9);
    expect(n).toBeLessThan(Math.PI * 20 * 20 * 1.1);
    expect(m.terrainAt(100, 20)).not.toBe(T.Hills); // the box's corner lies outside
    expect(m.terrainAt(120, 40)).toBe(T.Hills);
  });

  it('fills the connected region only, with a tolerance on the terrain type', () => {
    const m = ocean(60, 40);
    // Two islands: a plains + forest one on the left, a plains one on the right.
    m.fillRect(5, 5, 20, 30, T.Plains);
    m.fillRect(12, 5, 20, 30, T.Forest);
    m.fillRect(40, 5, 55, 30, T.Plains);
    const island = 16 * 26;
    // Same terrain: the left island's plains only.
    m.floodFill(6, 6, T.Desert, 'same');
    expect(count(m, T.Desert)).toBe(7 * 26);
    expect(m.terrainAt(45, 10)).toBe(T.Plains);
    m.undo();
    // Same family (lowlands): plains and forest of the left island.
    m.floodFill(6, 6, T.Desert, 'family');
    expect(count(m, T.Desert)).toBe(island);
    m.undo();
    // Water: the sea around both, not the islands.
    const sea = count(m, T.DeepOcean);
    m.floodFill(0, 0, T.Shallow, 'medium');
    expect(count(m, T.Shallow)).toBe(sea);
    expect(count(m, T.DeepOcean)).toBe(0);
  });

  it('tolerance families', () => {
    expect(fillMatches(T.Plains, T.Forest, 'same')).toBe(false);
    expect(fillMatches(T.Plains, T.Forest, 'family')).toBe(true);
    expect(fillMatches(T.Plains, T.Mountain, 'family')).toBe(false);
    expect(fillMatches(T.Plains, T.Mountain, 'medium')).toBe(true);
    expect(fillMatches(T.DeepOcean, T.Lake, 'family')).toBe(true);
    expect(fillMatches(T.DeepOcean, T.Plains, 'medium')).toBe(false);
  });

  it('a scanline fill visits every tile of a winding region exactly once', () => {
    const w = 64;
    const h = 64;
    const t = new Uint8Array(w * h);
    // A maze-like comb: walls of 1 with gaps alternating sides.
    for (let x = 4; x < w; x += 4)
      for (let y = 0; y < h; y++) if (!((x / 4) % 2 ? y === h - 1 : y === 0)) t[y * w + x] = 1;
    const visits = new Uint8Array(w * h);
    const n = floodRegion(t, w, h, 0, 0, 'same', (i) => visits[i]!++);
    expect(n).toBe(t.reduce((s, v) => s + (v === 0 ? 1 : 0), 0));
    expect(Math.max(...visits)).toBe(1);
  });

  it('painting land brings the altitude into the terrain band', () => {
    expect(altitudeFor(T.DeepOcean, 120)).toBe(0);
    expect(altitudeFor(T.Plains, 0)).toBeGreaterThan(0);
    expect(altitudeFor(T.Mountain, 40)).toBeGreaterThanOrEqual(170);
    expect(altitudeFor(T.Peaks, 0)).toBeGreaterThan(altitudeFor(T.Mountain, 0));
  });
});

describe('undo / redo', () => {
  it('restores terrain and altitude exactly, both ways', () => {
    const m = ocean();
    const t0 = m.terrain.slice();
    const e0 = m.elevation.slice();
    m.fillRect(10, 10, 80, 60, T.Plains);
    m.stamp(40, 30, 15, { kind: 'raise', strength: 20 });
    const t1 = m.terrain.slice();
    const e1 = m.elevation.slice();
    m.floodFill(0, 0, T.Shallow, 'same');
    expect(m.undo()).toBe(true);
    expect(m.terrain).toEqual(t1);
    expect(m.elevation).toEqual(e1);
    expect(m.undo()).toBe(true);
    expect(m.undo()).toBe(true);
    expect(m.terrain).toEqual(t0);
    expect(m.elevation).toEqual(e0);
    expect(m.undo()).toBe(false);
    m.redo();
    m.redo();
    expect(m.terrain).toEqual(t1);
    expect(m.elevation).toEqual(e1);
    // A new edit drops the redo branch.
    m.stamp(5, 5, 3, { kind: 'terrain', t: T.Desert });
    expect(m.redo()).toBe(false);
  });

  it('stores diffs (the changed tiles), not copies of the map', () => {
    const m = EditorModel.blank(3200, 1612, 'Giant', 'ocean');
    m.stamp(100, 100, 9, { kind: 'terrain', t: T.Plains });
    // A 9-tile brush changes ~64 tiles: a few hundred bytes, not 2 × 5 MB.
    expect(m.history.byteSize).toBeLessThan(2000);
    // A long rectangle: its rows are stored as runs.
    m.fillRect(0, 0, 3199, 9, T.Plains);
    expect(m.history.byteSize).toBeLessThan(3200 * 10 * 4 + 2000 + 400);
  });

  it('the history is bounded in steps and bytes, keeping the newest', () => {
    const h = new History(5, 1e9);
    const step = () => ({
      kind: 'markers' as const,
      before: { nations: [], spawnPoints: [], deposits: [] },
      after: { nations: [], spawnPoints: [[1, 1]] as [number, number][], deposits: [] },
    });
    for (let k = 0; k < 12; k++) h.push(step(), `s${k}`);
    expect(h.size).toBe(5);
    const small = new History(100, 300);
    for (let k = 0; k < 12; k++) small.push(step(), `s${k}`);
    expect(small.byteSize).toBeLessThanOrEqual(300);
    expect(small.size).toBeGreaterThanOrEqual(1);
    const m = ocean(100, 100);
    for (let k = 0; k < 260; k++)
      m.stamp(k % 100, (k * 7) % 100, 1, { kind: 'terrain', t: k % 2 ? T.Plains : T.Forest });
    expect(m.history.size).toBeLessThanOrEqual(m.history.maxSteps);
  });

  it('markers undo and redo, a drag being one step', () => {
    const m = ocean();
    m.fillRect(10, 10, 120, 100, T.Plains);
    m.addNation(20, 20, 'Ardenne');
    m.beginMarkers();
    for (let k = 1; k <= 10; k++) m.moveMarker({ kind: 'nation', index: 0 }, 20 + k, 20 + k);
    m.commitMarkers();
    expect(m.meta.nations[0]).toMatchObject({ x: 30, y: 30 });
    m.undo();
    expect(m.meta.nations[0]).toMatchObject({ x: 20, y: 20 });
    m.undo();
    expect(m.meta.nations).toHaveLength(0);
    m.redo();
    m.redo();
    expect(m.meta.nations[0]).toMatchObject({ x: 30, y: 30, name: { fr: 'Ardenne' } });
  });

  it('knows when changes are unsaved', () => {
    const m = ocean();
    expect(m.unsaved).toBe(false);
    m.stamp(5, 5, 3, { kind: 'terrain', t: T.Plains });
    expect(m.unsaved).toBe(true);
    m.markSaved();
    expect(m.unsaved).toBe(false);
    m.undo();
    expect(m.unsaved).toBe(true);
    m.redo();
    expect(m.unsaved).toBe(false);
  });

  it('reports only the changed region for redraw', () => {
    const m = ocean(400, 300);
    m.takeDirty();
    m.stamp(200, 150, 5, { kind: 'terrain', t: T.Plains });
    const b = m.takeDirty()!;
    expect(b.x1 - b.x0).toBeLessThan(12);
    expect(b.y1 - b.y0).toBeLessThan(12);
    expect(m.takeDirty()).toBeNull();
  });
});

describe('markers and validation', () => {
  it('flags spawns and nations on water, harsh land or islets, and fixes them', () => {
    const m = ocean(200, 160);
    m.fillRect(20, 20, 160, 140, T.Plains);
    m.fillRect(150, 20, 160, 30, T.Glacier);
    m.stamp(190, 5, 2, { kind: 'terrain', t: T.Plains }); // an islet
    for (const [x, y] of [
      [30, 30],
      [60, 60],
      [90, 90],
      [120, 120],
    ])
      m.addSpawn(x!, y!);
    expect(m.validate().filter((i) => i.level === 'error')).toEqual([]);
    m.addSpawn(5, 5); // sea
    m.addNation(50, 50, 'Terra');
    m.addNation(8, 150, 'Atlantide'); // sea
    m.addNation(155, 25, 'Givre'); // glacier
    m.addNation(190, 5, 'Ilot'); // islet
    m.addNation(52, 52, 'Terra'); // too close and duplicate
    const issues = m.validate();
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('spawnWater');
    expect(codes).toContain('nation.water');
    expect(codes).toContain('nation.harsh');
    expect(codes).toContain('nation.islet');
    expect(codes).toContain('nationDup');
    expect(codes).toContain('nationClose');
    expect(issues.find((i) => i.code === 'nation.water')!.at).toEqual([8, 150]);
    // Errors come first.
    expect(issues[0]!.level).toBe('error');
    m.applyFix('dropBadSpawns');
    m.applyFix('snapNations');
    const after = m.validate().map((i) => i.code);
    expect(after).not.toContain('spawnWater');
    expect(after).not.toContain('nation.water');
    expect(after).not.toContain('nation.harsh');
    for (const n of m.meta.nations) expect(m.spawnable(n.x, n.y)).toBe('ok');
  });

  it('requires enough land and spawn points, and a name', () => {
    const m = ocean(100, 100);
    m.meta.name = { fr: ' ', en: ' ' };
    const codes = m.validate().map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['name', 'land', 'spawns', 'noNations']));
    m.fillRect(10, 10, 89, 89, T.Plains);
    expect(m.landTiles()).toBeGreaterThanOrEqual(MIN_LAND);
    m.applyFix('spawns');
    m.applyFix('nations');
    m.meta.name = { fr: 'Ok', en: 'Ok' };
    expect(m.validate().filter((i) => i.level === 'error')).toEqual([]);
  });

  it('finds, moves, renames and removes markers', () => {
    const m = ocean();
    m.fillRect(0, 0, 199, 119, T.Plains);
    m.addNation(50, 50, 'A');
    m.addSpawn(80, 50);
    m.addDeposit(110, 50, 2);
    expect(m.markerAt(51, 49, 4)).toEqual({ kind: 'nation', index: 0 });
    expect(m.markerAt(80, 52, 4)).toEqual({ kind: 'spawn', index: 0 });
    expect(m.markerAt(110, 50, 4)).toEqual({ kind: 'deposit', index: 0 });
    expect(m.markerAt(150, 100, 4)).toBeNull();
    m.renameNation(0, 'Bohême');
    expect(m.meta.nations[0]!.name.fr).toBe('Bohême');
    m.removeMarker({ kind: 'spawn', index: 0 });
    expect(m.meta.spawnPoints).toHaveLength(0);
    m.undo();
    expect(m.meta.spawnPoints).toHaveLength(1);
  });
});

describe('files', () => {
  it('save / load round trip keeps terrain, altitude and markers', () => {
    const m = ocean(160, 90);
    m.meta.name = { fr: 'Ma carte', en: 'Ma carte' };
    m.fillEllipse(10, 10, 150, 80, T.Plains);
    m.fillRect(40, 30, 60, 50, T.Mountain);
    m.stamp(100, 45, 9, { kind: 'terrain', t: T.Forest });
    m.stamp(100, 45, 9, { kind: 'raise', strength: 30 });
    m.addNation(50, 40, 'Nord');
    m.addSpawn(80, 40);
    m.addDeposit(90, 40, 3);
    const text = m.toIsoMap();
    const back = EditorModel.fromIsoMap(text);
    expect(back.terrain).toEqual(m.terrain);
    expect(back.elevation).toEqual(m.elevation);
    expect(back.meta.name.fr).toBe('Ma carte');
    expect(back.meta.width).toBe(160);
    expect(back.meta.nations[0]).toMatchObject({ name: { fr: 'Nord' }, x: 50, y: 40 });
    expect(back.meta.spawnPoints).toEqual([[80, 40]]);
    expect(back.meta.deposits).toEqual([{ x: 90, y: 40, type: 3 }]);
    expect(back.meta.category).toBe('custom');
    // The rooms are settled for the lobby's nation pick (as every map builder does).
    expect(parseIsoMap(text).meta.nations[0]!.room).toBeGreaterThan(0);
    // Saving does not count as an edit.
    expect(m.meta.nations[0]!.room).toBeUndefined();
  });

  it('a resized map keeps its content centred and its markers', () => {
    const m = ocean(100, 80);
    m.fillRect(40, 30, 59, 49, T.Plains);
    m.addNation(50, 40, 'C');
    const r = m.resized(140, 70);
    expect(r.width).toBe(140);
    expect(r.height).toBe(70);
    expect(r.terrainAt(70, 35)).toBe(T.Plains);
    expect(r.meta.nations[0]).toMatchObject({ x: 70, y: 35 });
    expect(r.unsaved).toBe(true);
  });

  it('a procedural start is a playable custom map', () => {
    const m = EditorModel.procedural(
      {
        seed: 7,
        width: 400,
        height: 260,
        landRatio: 0.45,
        islands: 0.3,
        mountains: 0.5,
        rivers: 0.4,
        nations: 12,
      },
      'Proc',
    );
    expect(m.meta.category).toBe('custom');
    expect(m.meta.nations.length).toBeGreaterThan(0);
    expect(m.validate().filter((i) => i.level === 'error')).toEqual([]);
  });
});
