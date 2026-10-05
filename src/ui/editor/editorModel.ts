// Map editor model: terrain and altitude painting (brush strokes, lines, shapes, flood
// fill), markers (nations, spawn points, deposits), undo / redo as diffs, validation and
// .isomap import / export. No DOM: the view (EditorCanvas.svelte) reads `takeDirty()` to
// redraw only the tiles that changed.
import type { MapMeta, NationSpawn } from '../../core/map/gamemap';
import { T, TERRAIN, IS_LAND, IS_WATER, HABITABLE, terrainFromRgb } from '../../core/map/terrain';
import { exportIsoMapData, parseIsoMap, decodeTerrainPng, decodeGreyPng } from '../../core/map/format';
import { generateDeposits, generateSpawnPoints } from '../../core/map/synth';
import { generateMapData, type GenParams } from '../../core/map/generator';
import { settleNations } from '../../core/map/nationPick';
import { Rng, hashString } from '../../core/rng';
import { inventNationName } from '../../core/names';
import { decode } from 'fast-png';
import { History, cloneMarkers, sameMarkers, type Box, type Markers, type Step } from './history';
import { discOffsets, floodRegion, forEllipse, rectBounds, strokeStamps, type FillTolerance } from './raster';

/** What a brush stamp does to the tiles under it. */
export type PaintOp =
  { kind: 'terrain'; t: number } | { kind: 'raise' | 'lower' | 'smooth'; strength?: number };

export type MarkerKind = 'nation' | 'spawn' | 'deposit';
export interface MarkerRef {
  kind: MarkerKind;
  index: number;
}

export type BlankFill = 'ocean' | 'island' | 'land';

/** A validation finding: an error blocks the play-test, a warning only informs. */
export interface Issue {
  level: 'error' | 'warn';
  code: string;
  params?: Record<string, string | number>;
  /** Tile to show (a misplaced marker). */
  at?: [number, number];
  marker?: MarkerRef;
  /** One-click correction (EditorModel.applyFix). */
  fix?: Fix;
}
export type Fix = 'spawns' | 'nations' | 'dropBadSpawns' | 'snapNations' | 'dropWaterDeposits';

/** Fewest land tiles of a playable map; a nation or a spawn needs an island of this many. */
export const MIN_LAND = 2000;
export const MIN_SPAWNS = 4;
export const MIN_ISLAND = 30;
/** Two nations closer than this (tiles) overlap at the start (spawn discs). */
export const NATION_GAP = 8;
export const MIN_SIZE = 64;
export const MAX_SIZE = 4096;

/**
 * Altitude a tile takes when painted with terrain `t`: kept when it already fits the
 * terrain's band, else brought into it (water lies at 0; peaks stand high).
 */
export function altitudeFor(t: number, current: number): number {
  if (TERRAIN[t]?.water) return 0;
  const [lo, hi, def] =
    t === T.Peaks
      ? [230, 255, 245]
      : t === T.Mountain
        ? [170, 229, 200]
        : t === T.Hills
          ? [110, 169, 140]
          : t === T.Glacier
            ? [40, 230, 120]
            : t === T.Impassable
              ? [8, 255, 120]
              : [8, 109, 45];
  if (current === 0) return def;
  return Math.max(lo, Math.min(hi, current));
}

export class EditorModel {
  meta: MapMeta;
  terrain: Uint8Array;
  elevation: Uint8Array;
  readonly history = new History();
  /** Bumped on every change (tiles or markers): the view redraws, the validation reruns. */
  version = 0;
  /** File name in the custom maps once saved. */
  fileName = '';
  /** History head when last saved (or created): unsaved changes when they differ. */
  savedHead = 0;
  /** Changes outside the history (name, properties) since the last save. */
  metaEdited = false;

  private dirtyBox: Box | null = null;
  // Open painting step: first-touch marks and the tiles' values before it.
  private mark: Uint8Array | null = null;
  private oldT: Uint8Array | null = null;
  private oldE: Uint8Array | null = null;
  private edit: { box: Box; count: number; label: string } | null = null;
  private markerStart: Markers | null = null;

  constructor(meta: MapMeta, terrain: Uint8Array, elevation: Uint8Array) {
    if (terrain.length !== meta.width * meta.height || elevation.length !== terrain.length)
      throw new Error('map size mismatch');
    this.meta = meta;
    this.terrain = terrain;
    this.elevation = elevation;
    this.dirtyBox = { x0: 0, y0: 0, x1: meta.width - 1, y1: meta.height - 1 };
  }

  get width(): number {
    return this.meta.width;
  }
  get height(): number {
    return this.meta.height;
  }
  get unsaved(): boolean {
    return this.metaEdited || this.history.head !== this.savedHead;
  }
  markSaved(): void {
    this.savedHead = this.history.head;
    this.metaEdited = false;
  }

  // ------------------------------------------------------------------ creation

  static newMeta(name: string, width: number, height: number): MapMeta {
    return {
      id: `custom-${hashString(name + Date.now() + Math.random()).toString(36)}`,
      name: { fr: name, en: name },
      category: 'custom',
      width,
      height,
      nations: [],
      spawnPoints: [],
      deposits: [],
      author: 'Isoline editor',
      version: 1,
    };
  }

  /** A new map: open ocean, a starter continent, or all plains. */
  static blank(width: number, height: number, name: string, fill: BlankFill = 'island'): EditorModel {
    width = clampSize(width);
    height = clampSize(height);
    const terrain = new Uint8Array(width * height).fill(fill === 'land' ? T.Plains : T.DeepOcean);
    const elevation = new Uint8Array(width * height).fill(fill === 'land' ? 45 : 0);
    if (fill === 'island') {
      const cx = width / 2;
      const cy = height / 2;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const d = Math.hypot((x - cx) / (width * 0.3), (y - cy) / (height * 0.3));
          if (d < 1) {
            terrain[y * width + x] = T.Plains;
            elevation[y * width + x] = Math.round(30 + (1 - d) * 60);
          } else if (d < 1.12) terrain[y * width + x] = T.Shallow;
        }
    }
    const m = new EditorModel(EditorModel.newMeta(name, width, height), terrain, elevation);
    return m;
  }

  /** A procedural map (the lobby's generator) to start from. */
  static procedural(p: GenParams, name: string): EditorModel {
    const g = generateMapData(p);
    const meta = { ...EditorModel.newMeta(name, g.meta.width, g.meta.height), nations: g.meta.nations };
    meta.spawnPoints = g.meta.spawnPoints;
    meta.deposits = g.meta.deposits;
    return new EditorModel(meta, g.terrain, g.elevation);
  }

  static fromIsoMap(text: string): EditorModel {
    const m = parseIsoMap(text);
    const meta: MapMeta = { ...m.meta, category: 'custom' };
    return new EditorModel(
      meta,
      decodeTerrainPng(m.terrainPng, meta.width, meta.height),
      decodeGreyPng(m.elevPng, meta.width, meta.height),
    );
  }

  /** A shipped map (its PNGs and metadata), as a new custom map. */
  static fromPngs(meta: MapMeta, terrainPng: Uint8Array, elevPng: Uint8Array, name?: string): EditorModel {
    const n = name ?? meta.name.fr;
    return new EditorModel(
      {
        ...meta,
        nations: meta.nations.map((x) => ({ ...x, name: { ...x.name } })),
        spawnPoints: meta.spawnPoints.map(([x, y]) => [x, y] as [number, number]),
        deposits: meta.deposits.map((d) => ({ ...d })),
        name: { fr: n, en: n },
        category: 'custom',
        id: `custom-${meta.id}-${hashString(String(Date.now())).toString(36)}`,
        author: 'Isoline editor',
      },
      decodeTerrainPng(terrainPng, meta.width, meta.height),
      decodeGreyPng(elevPng, meta.width, meta.height),
    );
  }

  /** Import any PNG: colours are mapped to the nearest terrain; brightness drives altitude. */
  static fromImage(png: Uint8Array, name: string): EditorModel {
    const img = decode(png);
    const { width, height, channels } = img;
    const terrain = new Uint8Array(width * height);
    const elevation = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < width * height; i++, p += channels) {
      const r = img.data[p]! & 255;
      const g = channels >= 3 ? img.data[p + 1]! & 255 : r;
      const b = channels >= 3 ? img.data[p + 2]! & 255 : r;
      const t = terrainFromRgb(r, g, b);
      terrain[i] = t;
      elevation[i] = IS_LAND[t] ? Math.max(8, Math.round((r + g + b) / 3)) : 0;
    }
    return new EditorModel(EditorModel.newMeta(name, width, height), terrain, elevation);
  }

  /**
   * The same map on a canvas of another size, centred (cropped or padded with ocean);
   * markers follow, those falling outside are dropped. A new model: the history restarts.
   */
  resized(width: number, height: number): EditorModel {
    width = clampSize(width);
    height = clampSize(height);
    const { width: w, height: h } = this.meta;
    const ox = Math.floor((width - w) / 2);
    const oy = Math.floor((height - h) / 2);
    const terrain = new Uint8Array(width * height).fill(T.DeepOcean);
    const elevation = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const sy = y - oy;
      if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < width; x++) {
        const sx = x - ox;
        if (sx < 0 || sx >= w) continue;
        terrain[y * width + x] = this.terrain[sy * w + sx]!;
        elevation[y * width + x] = this.elevation[sy * w + sx]!;
      }
    }
    const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
    const meta: MapMeta = {
      ...this.meta,
      width,
      height,
      nations: this.meta.nations
        .map((n) => ({ ...n, x: n.x + ox, y: n.y + oy }))
        .filter((n) => inside(n.x, n.y)),
      spawnPoints: this.meta.spawnPoints
        .map(([x, y]) => [x + ox, y + oy] as [number, number])
        .filter(([x, y]) => inside(x, y)),
      deposits: this.meta.deposits
        .map((d) => ({ ...d, x: d.x + ox, y: d.y + oy }))
        .filter((d) => inside(d.x, d.y)),
    };
    const m = new EditorModel(meta, terrain, elevation);
    m.fileName = this.fileName;
    m.metaEdited = true;
    return m;
  }

  // ------------------------------------------------------------------ redraw hooks

  /** The tiles changed since the last call (the view repaints only them), or null. */
  takeDirty(): Box | null {
    const b = this.dirtyBox;
    this.dirtyBox = null;
    return b;
  }
  private touchBox(x0: number, y0: number, x1: number, y1: number): void {
    const b = this.dirtyBox;
    if (!b) this.dirtyBox = { x0, y0, x1, y1 };
    else {
      b.x0 = Math.min(b.x0, x0);
      b.y0 = Math.min(b.y0, y0);
      b.x1 = Math.max(b.x1, x1);
      b.y1 = Math.max(b.y1, y1);
    }
  }

  terrainAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return -1;
    return this.terrain[y * this.width + x]!;
  }

  // ------------------------------------------------------------------ painting steps

  /** Opens a painting step: every tile it changes is undone together. */
  begin(label: string): void {
    if (this.edit) this.end();
    const n = this.width * this.height;
    if (!this.mark || this.mark.length !== n) {
      this.mark = new Uint8Array(n);
      this.oldT = new Uint8Array(n);
      this.oldE = new Uint8Array(n);
    }
    this.edit = { box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, count: 0, label };
  }

  get painting(): boolean {
    return this.edit !== null;
  }

  /** Before writing tile i inside a step: remembers its values once. */
  private touch(i: number, x: number, y: number): void {
    const e = this.edit!;
    if (this.mark![i]) return;
    this.mark![i] = 1;
    this.oldT![i] = this.terrain[i]!;
    this.oldE![i] = this.elevation[i]!;
    e.count++;
    const b = e.box;
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }

  /** Closes the step: records the changed tiles (runs and values) as one undoable diff. */
  end(): Step | null {
    const e = this.edit;
    this.edit = null;
    if (!e || e.count === 0) return null;
    const { x0, y0, x1, y1 } = e.box;
    const w = this.width;
    const mark = this.mark!;
    const oT = this.oldT!;
    const oE = this.oldE!;
    const bT = new Uint8Array(e.count);
    const bE = new Uint8Array(e.count);
    const aT = new Uint8Array(e.count);
    const aE = new Uint8Array(e.count);
    let runs = new Int32Array(64);
    let nr = 0;
    let n = 0;
    let prev = -2;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0, i = y * w + x0; x <= x1; x++, i++) {
        if (!mark[i]) continue;
        mark[i] = 0;
        if (oT[i] === this.terrain[i] && oE[i] === this.elevation[i]) continue;
        bT[n] = oT[i]!;
        bE[n] = oE[i]!;
        aT[n] = this.terrain[i]!;
        aE[n] = this.elevation[i]!;
        n++;
        if (i === prev + 1) runs[nr - 1]!++;
        else {
          if (nr + 2 > runs.length) {
            const r2 = new Int32Array(runs.length * 2);
            r2.set(runs);
            runs = r2;
          }
          runs[nr++] = i;
          runs[nr++] = 1;
        }
        prev = i;
      }
    }
    if (n === 0) return null;
    return this.history.push(
      {
        kind: 'tiles',
        runs: runs.slice(0, nr),
        beforeT: bT.slice(0, n),
        beforeE: bE.slice(0, n),
        afterT: aT.slice(0, n),
        afterE: aE.slice(0, n),
        box: { x0, y0, x1, y1 },
      },
      e.label,
    );
  }

  /** Runs `f` inside a step of its own unless one is already open. */
  private step<R>(label: string, f: () => R): R {
    if (this.edit) return f();
    this.begin(label);
    try {
      return f();
    } finally {
      this.end();
    }
  }

  private setTile(i: number, x: number, y: number, op: PaintOp): void {
    if (op.kind === 'terrain') {
      const t = op.t;
      const alt = altitudeFor(t, this.elevation[i]!);
      if (this.terrain[i] === t && this.elevation[i] === alt) return;
      this.touch(i, x, y);
      this.terrain[i] = t;
      this.elevation[i] = alt;
    }
  }

  /** One brush stamp of `size` tiles centred on tile (cx, cy). */
  stamp(cx: number, cy: number, size: number, op: PaintOp): void {
    this.step('paint', () => {
      const w = this.width;
      const h = this.height;
      cx = Math.floor(cx);
      cy = Math.floor(cy);
      const d = discOffsets(size);
      if (op.kind === 'terrain') {
        for (let k = 0; k < d.length; k += 2) {
          const x = cx + d[k]!;
          const y = cy + d[k + 1]!;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          this.setTile(y * w + x, x, y, op);
        }
      } else this.relief(cx, cy, size, op);
      const r = Math.ceil(size / 2) + 1;
      this.touchBox(
        Math.max(0, cx - r),
        Math.max(0, cy - r),
        Math.min(w - 1, cx + r),
        Math.min(h - 1, cy + r),
      );
      this.version++;
    });
  }

  private relief(cx: number, cy: number, size: number, op: PaintOp): void {
    const w = this.width;
    const h = this.height;
    const r = Math.max(0.5, size / 2);
    const R = Math.ceil(r);
    const strength = op.kind === 'terrain' ? 0 : (op.strength ?? 6);
    for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++)
      for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r * r + 0.01) continue;
        const i = y * w + x;
        if (!IS_LAND[this.terrain[i]!]) continue;
        const fall = 1 - Math.sqrt(d2) / (r + 1);
        let v = this.elevation[i]!;
        if (op.kind === 'raise' || op.kind === 'lower')
          v += (op.kind === 'raise' ? strength : -strength) * fall;
        else {
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const j = yy * w + xx;
              if (!IS_LAND[this.terrain[j]!]) continue;
              s += this.elevation[j]!;
              n++;
            }
          if (n) v = v + (s / n - v) * Math.min(1, 0.25 + strength / 12);
        }
        const nv = Math.max(6, Math.min(255, Math.round(v)));
        if (nv === this.elevation[i]) continue;
        this.touch(i, x, y);
        this.elevation[i] = nv;
      }
  }

  /**
   * A brush stroke from tile (x0, y0) to (x1, y1): stamps every few tiles along the
   * segment (at most half the brush's radius apart), so a fast drag draws a continuous
   * line instead of scattered dots. The start is not stamped (the previous segment did).
   */
  stroke(x0: number, y0: number, x1: number, y1: number, size: number, op: PaintOp): void {
    this.step('paint', () => {
      for (const [x, y] of strokeStamps(x0, y0, x1, y1, size)) this.stamp(x, y, size, op);
    });
  }

  /** A straight line of brush width `size` (the line tool). */
  line(x0: number, y0: number, x1: number, y1: number, size: number, op: PaintOp): void {
    this.step('line', () => {
      this.stamp(x0, y0, size, op);
      this.stroke(x0, y0, x1, y1, size, op);
    });
  }

  /** Fills the rectangle between two corner tiles. */
  fillRect(ax: number, ay: number, bx: number, by: number, t: number): void {
    const r = rectBounds(ax, ay, bx, by, this.width, this.height);
    if (!r) return;
    this.step('rect', () => {
      const op: PaintOp = { kind: 'terrain', t };
      for (let y = r.y0; y <= r.y1; y++)
        for (let x = r.x0; x <= r.x1; x++) this.setTile(y * this.width + x, x, y, op);
      this.touchBox(r.x0, r.y0, r.x1, r.y1);
      this.version++;
    });
  }

  /** Fills the ellipse inscribed in the box between two corner tiles. */
  fillEllipse(ax: number, ay: number, bx: number, by: number, t: number): void {
    this.step('ellipse', () => {
      const op: PaintOp = { kind: 'terrain', t };
      forEllipse(ax, ay, bx, by, this.width, this.height, (x, y) =>
        this.setTile(y * this.width + x, x, y, op),
      );
      const r = rectBounds(ax, ay, bx, by, this.width, this.height);
      if (r) this.touchBox(r.x0, r.y0, r.x1, r.y1);
      this.version++;
    });
  }

  /** Flood fill from (x, y) with terrain t: the connected region of matching terrain. */
  floodFill(x: number, y: number, t: number, tol: FillTolerance): number {
    const w = this.width;
    return this.step('fill', () => {
      const op: PaintOp = { kind: 'terrain', t };
      let bx0 = Infinity;
      let by0 = Infinity;
      let bx1 = -1;
      let by1 = -1;
      const n = floodRegion(this.terrain, w, this.height, x, y, tol, (i) => {
        const tx = i % w;
        const ty = (i / w) | 0;
        if (tx < bx0) bx0 = tx;
        if (tx > bx1) bx1 = tx;
        if (ty < by0) by0 = ty;
        if (ty > by1) by1 = ty;
        // (Painting as the fill goes is safe: the fill tests only tiles it has not visited.)
        this.setTile(i, tx, ty, op);
      });
      if (n) this.touchBox(bx0, by0, bx1, by1);
      this.version++;
      return n;
    });
  }

  // ------------------------------------------------------------------ undo / redo

  undo(): boolean {
    if (this.edit) this.end();
    const s = this.history.undo();
    if (!s) return false;
    this.applyStep(s, false);
    return true;
  }

  redo(): boolean {
    if (this.edit) this.end();
    const s = this.history.redo();
    if (!s) return false;
    this.applyStep(s, true);
    return true;
  }

  private applyStep(s: Step, forward: boolean): void {
    if (s.kind === 'tiles') {
      const T0 = forward ? s.afterT : s.beforeT;
      const E0 = forward ? s.afterE : s.beforeE;
      let j = 0;
      for (let r = 0; r < s.runs.length; r += 2) {
        const start = s.runs[r]!;
        const len = s.runs[r + 1]!;
        this.terrain.set(T0.subarray(j, j + len), start);
        this.elevation.set(E0.subarray(j, j + len), start);
        j += len;
      }
      this.touchBox(s.box.x0, s.box.y0, s.box.x1, s.box.y1);
    } else {
      const m = cloneMarkers(forward ? s.after : s.before);
      this.meta.nations = m.nations;
      this.meta.spawnPoints = m.spawnPoints;
      this.meta.deposits = m.deposits;
    }
    this.version++;
  }

  // ------------------------------------------------------------------ markers

  markers(): Markers {
    return cloneMarkers(this.meta);
  }

  /** Opens a marker step (a click, a drag): `commitMarkers` records it if anything changed. */
  beginMarkers(): void {
    this.markerStart = this.markers();
  }

  commitMarkers(label = 'markers'): boolean {
    const before = this.markerStart;
    this.markerStart = null;
    if (!before) return false;
    const after = this.markers();
    if (sameMarkers(before, after)) return false;
    this.history.push({ kind: 'markers', before, after }, label);
    return true;
  }

  private markerStep(label: string, f: () => void): void {
    if (this.markerStart) {
      f();
      this.version++;
      return;
    }
    this.beginMarkers();
    f();
    this.version++;
    this.commitMarkers(label);
  }

  addNation(x: number, y: number, name: string): MarkerRef {
    const m = this.meta;
    this.markerStep('nation', () => {
      const n: NationSpawn = {
        name: { fr: name, en: name },
        x,
        y,
        flagSeed: hashString(name + x + ',' + y),
        weight: Math.max(1, 1000 - m.nations.length),
      };
      m.nations.push(n);
    });
    return { kind: 'nation', index: m.nations.length - 1 };
  }

  addSpawn(x: number, y: number): MarkerRef {
    this.markerStep('spawn', () => this.meta.spawnPoints.push([x, y]));
    return { kind: 'spawn', index: this.meta.spawnPoints.length - 1 };
  }

  addDeposit(x: number, y: number, type: number): MarkerRef {
    this.markerStep('deposit', () => this.meta.deposits.push({ x, y, type }));
    return { kind: 'deposit', index: this.meta.deposits.length - 1 };
  }

  markerPos(ref: MarkerRef): [number, number] | null {
    if (ref.kind === 'nation') {
      const n = this.meta.nations[ref.index];
      return n ? [n.x, n.y] : null;
    }
    if (ref.kind === 'spawn') return this.meta.spawnPoints[ref.index] ?? null;
    const d = this.meta.deposits[ref.index];
    return d ? [d.x, d.y] : null;
  }

  /** The marker nearest (x, y) within `r` tiles (nations first: they are what one aims at). */
  markerAt(x: number, y: number, r: number): MarkerRef | null {
    let best: MarkerRef | null = null;
    let bd = r * r;
    const consider = (kind: MarkerKind, index: number, px: number, py: number, bias: number) => {
      const d = ((px - x) ** 2 + (py - y) ** 2) * bias;
      if (d <= bd) {
        bd = d;
        best = { kind, index };
      }
    };
    this.meta.deposits.forEach((d, k) => consider('deposit', k, d.x, d.y, 1.2));
    this.meta.spawnPoints.forEach(([px, py], k) => consider('spawn', k, px, py, 1.1));
    this.meta.nations.forEach((n, k) => consider('nation', k, n.x, n.y, 0.8));
    return best;
  }

  /** Moves a marker (inside an open marker step: a drag records one step). */
  moveMarker(ref: MarkerRef, x: number, y: number): void {
    x = Math.max(0, Math.min(this.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(this.height - 1, Math.round(y)));
    this.markerStep('move', () => {
      if (ref.kind === 'nation') {
        const n = this.meta.nations[ref.index];
        if (n) {
          n.x = x;
          n.y = y;
        }
      } else if (ref.kind === 'spawn') {
        if (this.meta.spawnPoints[ref.index]) this.meta.spawnPoints[ref.index] = [x, y];
      } else {
        const d = this.meta.deposits[ref.index];
        if (d) {
          d.x = x;
          d.y = y;
        }
      }
    });
  }

  removeMarker(ref: MarkerRef): void {
    this.markerStep('remove', () => {
      if (ref.kind === 'nation') this.meta.nations.splice(ref.index, 1);
      else if (ref.kind === 'spawn') this.meta.spawnPoints.splice(ref.index, 1);
      else this.meta.deposits.splice(ref.index, 1);
    });
  }

  renameNation(index: number, name: string): void {
    const n = this.meta.nations[index];
    if (!n || n.name.fr === name) return;
    this.markerStep('rename', () => (n.name = { fr: name, en: name }));
  }

  clearMarkers(kind: MarkerKind): void {
    this.markerStep('clear', () => {
      if (kind === 'nation') this.meta.nations = [];
      else if (kind === 'spawn') this.meta.spawnPoints = [];
      else this.meta.deposits = [];
    });
  }

  /** Whether a nation or a spawn point may stand on tile (x, y): habitable land, on an island big enough. */
  spawnable(x: number, y: number): 'ok' | 'water' | 'harsh' | 'islet' | 'outside' {
    const w = this.width;
    if (x < 0 || y < 0 || x >= w || y >= this.height) return 'outside';
    const t = this.terrain[y * w + x]!;
    if (IS_WATER[t] || t === T.Impassable) return 'water';
    if (!HABITABLE[t]) return 'harsh';
    return this.islandAtLeast(y * w + x, MIN_ISLAND) ? 'ok' : 'islet';
  }

  /** Whether the landmass of tile i holds at least n tiles (a bounded search). */
  private islandAtLeast(i: number, n: number): boolean {
    const w = this.width;
    const h = this.height;
    const seen = new Set<number>([i]);
    const queue = [i];
    while (queue.length && seen.size < n) {
      const j = queue.shift()!;
      const x = j % w;
      const y = (j / w) | 0;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
      for (const k of nb) {
        if (k < 0 || seen.has(k) || !IS_LAND[this.terrain[k]!]) continue;
        seen.add(k);
        queue.push(k);
      }
    }
    return seen.size >= n;
  }

  /** Nearest tile (spiral search) where a nation may stand, or null. */
  nearestSpawnable(x: number, y: number, maxR = 80): [number, number] | null {
    for (let r = 0; r <= maxR; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (this.spawnable(x + dx, y + dy) === 'ok') return [x + dx, y + dy];
        }
    return null;
  }

  /** Spawn points, deposits and named nations placed automatically on the land. */
  autoMarkers(): void {
    this.markerStep('auto', () => {
      this.autoSpawns();
      this.meta.deposits = generateDeposits(this.width, this.height, this.terrain, this.seed());
      this.autoNations();
    });
  }

  private seed(): number {
    return hashString(this.meta.id + this.history.head);
  }
  private autoSpawns(): void {
    this.meta.spawnPoints = generateSpawnPoints(this.width, this.height, this.terrain, this.seed(), 200);
  }
  private autoNations(): void {
    const rng = new Rng(this.seed() ^ 0x9e3779b9);
    const pts = this.meta.spawnPoints.length
      ? this.meta.spawnPoints
      : generateSpawnPoints(this.width, this.height, this.terrain, this.seed(), 200);
    // As many nations as the land holds (one per ~6 000 tiles, 4 to 24), spread out:
    // each next one on the spawn point farthest from those already placed.
    const count = Math.min(pts.length, Math.max(4, Math.min(24, Math.round(this.landTiles() / 6000))));
    const picked: [number, number][] = [];
    const dist = pts.map(() => Infinity);
    let next = rng.int(0, Math.max(0, pts.length - 1));
    while (picked.length < count && pts.length) {
      const p = pts[next]!;
      picked.push(p);
      let best = -1;
      for (let k = 0; k < pts.length; k++) {
        dist[k] = Math.min(dist[k]!, (pts[k]![0] - p[0]) ** 2 + (pts[k]![1] - p[1]) ** 2);
        if (best < 0 || dist[k]! > dist[best]!) best = k;
      }
      if (best < 0 || dist[best] === 0) break;
      next = best;
    }
    this.meta.nations = picked.map(([x, y], k) => ({
      name: inventNationName(rng),
      x,
      y,
      flagSeed: rng.nextU32(),
      weight: 100 - k,
    }));
  }

  applyFix(fix: Fix): void {
    this.markerStep('fix', () => {
      if (fix === 'spawns') this.autoSpawns();
      else if (fix === 'nations') this.autoNations();
      else if (fix === 'dropBadSpawns')
        this.meta.spawnPoints = this.meta.spawnPoints.filter(([x, y]) => this.spawnable(x, y) === 'ok');
      else if (fix === 'dropWaterDeposits')
        this.meta.deposits = this.meta.deposits.filter((d) => HABITABLE[this.terrainAt(d.x, d.y)] === 1);
      else if (fix === 'snapNations') {
        const out: NationSpawn[] = [];
        for (const n of this.meta.nations) {
          if (this.spawnable(n.x, n.y) === 'ok') out.push(n);
          else {
            const p = this.nearestSpawnable(n.x, n.y);
            if (p) out.push({ ...n, x: p[0], y: p[1] });
          }
        }
        this.meta.nations = out;
      }
    });
  }

  // ------------------------------------------------------------------ validation

  landTiles(): number {
    let land = 0;
    for (let i = 0; i < this.terrain.length; i++) land += IS_LAND[this.terrain[i]!]!;
    return land;
  }

  /** What stands between this map and a good game: errors first. */
  validate(): Issue[] {
    const out: Issue[] = [];
    const m = this.meta;
    if (!(m.name.fr || m.name.en).trim()) out.push({ level: 'error', code: 'name' });
    const land = this.landTiles();
    if (land < MIN_LAND) out.push({ level: 'error', code: 'land', params: { n: land, min: MIN_LAND } });
    if (m.spawnPoints.length < MIN_SPAWNS)
      out.push({
        level: 'error',
        code: 'spawns',
        params: { n: m.spawnPoints.length, min: MIN_SPAWNS },
        fix: 'spawns',
      });
    const badSpawns = m.spawnPoints.filter(([x, y]) => this.spawnable(x, y) !== 'ok');
    if (badSpawns.length)
      out.push({
        level: 'error',
        code: 'spawnWater',
        params: { n: badSpawns.length },
        at: badSpawns[0],
        marker: { kind: 'spawn', index: m.spawnPoints.indexOf(badSpawns[0]!) },
        fix: 'dropBadSpawns',
      });
    const names = new Map<string, number>();
    m.nations.forEach((n, k) => {
      const label = n.name.fr || n.name.en;
      const where = this.spawnable(n.x, n.y);
      if (where !== 'ok')
        out.push({
          level: where === 'islet' ? 'warn' : 'error',
          code: `nation.${where}`,
          params: { name: label || '?' },
          at: [n.x, n.y],
          marker: { kind: 'nation', index: k },
          fix: 'snapNations',
        });
      if (!label.trim())
        out.push({ level: 'warn', code: 'nationName', at: [n.x, n.y], marker: { kind: 'nation', index: k } });
      else {
        const key = label.trim().toLowerCase();
        if (names.has(key))
          out.push({
            level: 'warn',
            code: 'nationDup',
            params: { name: label },
            at: [n.x, n.y],
            marker: { kind: 'nation', index: k },
          });
        else names.set(key, k);
      }
      for (let j = 0; j < k; j++) {
        const o = m.nations[j]!;
        if ((o.x - n.x) ** 2 + (o.y - n.y) ** 2 < NATION_GAP * NATION_GAP) {
          out.push({
            level: 'warn',
            code: 'nationClose',
            params: { a: o.name.fr || '?', b: label || '?' },
            at: [n.x, n.y],
            marker: { kind: 'nation', index: k },
          });
          break;
        }
      }
    });
    if (!m.nations.length) out.push({ level: 'warn', code: 'noNations', fix: 'nations' });
    const wetDeposits = m.deposits.filter((d) => HABITABLE[this.terrainAt(d.x, d.y)] !== 1);
    if (wetDeposits.length)
      out.push({
        level: 'warn',
        code: 'depositWater',
        params: { n: wetDeposits.length },
        at: [wetDeposits[0]!.x, wetDeposits[0]!.y],
        fix: 'dropWaterDeposits',
      });
    return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
  }

  // ------------------------------------------------------------------ files

  /** The map as an .isomap document (nations' rooms and default count settled, as every map builder does). */
  toIsoMap(): string {
    const meta: MapMeta = {
      ...this.meta,
      category: 'custom',
      nations: this.meta.nations.map((n) => ({ ...n, name: { ...n.name } })),
      spawnPoints: this.meta.spawnPoints.map(([x, y]) => [x, y] as [number, number]),
      deposits: this.meta.deposits.map((d) => ({ ...d })),
    };
    settleNations(meta, this.terrain);
    return exportIsoMapData(meta, this.terrain, this.elevation);
  }
}

function clampSize(v: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(v) || MIN_SIZE));
}

/**
 * Preview colours of the editor's plate, one per terrain: an atlas on paper, every family
 * a distinct lightness (water dark, lowlands mid, relief light) so the map reads even
 * without hue. The palette pairs each with a glyph and a name, the map with motifs.
 */
export const EDITOR_COLORS: [number, number, number][] = [
  [22, 44, 72], // deep ocean
  [46, 96, 134], // shallow
  [78, 148, 176], // lake
  [96, 168, 204], // river
  [150, 178, 104], // plains
  [176, 150, 88], // hills
  [128, 104, 86], // mountain
  [226, 202, 138], // desert
  [56, 108, 62], // forest
  [214, 222, 222], // tundra
  [52, 44, 50], // impassable
  [236, 244, 250], // glacier
  [92, 78, 84], // peaks
];
