// Map editor model: terrain/altitude painting, markers, import/export.
import { GameMap, type MapMeta, type NationSpawn } from '../../core/map/gamemap';
import { T, TERRAIN, IS_LAND, terrainFromRgb } from '../../core/map/terrain';
import { exportIsoMap, parseIsoMap, loadMap, decodeTerrainPng, decodeGreyPng } from '../../core/map/format';
import { generateDeposits, generateSpawnPoints } from '../../core/map/synth';
import { Rng, hashString } from '../../core/rng';
import { inventNationName } from '../../core/names';
import { decode } from 'fast-png';

export type Brush = 'terrain' | 'raise' | 'lower' | 'smooth' | 'spawn' | 'nation' | 'deposit' | 'erase';

export class EditorModel {
  meta: MapMeta;
  terrain: Uint8Array;
  elevation: Uint8Array;
  dirty = true;

  constructor(meta: MapMeta, terrain: Uint8Array, elevation: Uint8Array) {
    this.meta = meta;
    this.terrain = terrain;
    this.elevation = elevation;
  }

  static blank(width: number, height: number, name: string): EditorModel {
    const terrain = new Uint8Array(width * height).fill(T.DeepOcean);
    const elevation = new Uint8Array(width * height);
    // A starter continent so the map is immediately playable.
    const cx = width / 2;
    const cy = height / 2;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const d = Math.hypot((x - cx) / (width * 0.3), (y - cy) / (height * 0.3));
        if (d < 1) {
          terrain[y * width + x] = T.Plains;
          elevation[y * width + x] = Math.round(30 + (1 - d) * 60);
        }
      }
    const meta: MapMeta = {
      id: `custom-${hashString(name + Date.now()).toString(36)}`,
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
    return new EditorModel(meta, terrain, elevation);
  }

  static fromIsoMap(text: string): EditorModel {
    const m = parseIsoMap(text);
    const map = loadMap(m.meta, m.terrainPng, m.elevPng);
    return new EditorModel({ ...m.meta, category: 'custom' }, map.terrain, map.elevation);
  }

  static fromPngs(meta: MapMeta, terrainPng: Uint8Array, elevPng: Uint8Array): EditorModel {
    return new EditorModel(
      { ...meta, category: 'custom', id: `custom-${meta.id}` },
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
    const e = EditorModel.blank(1, 1, name);
    return new EditorModel({ ...e.meta, width, height }, terrain, elevation);
  }

  paint(cx: number, cy: number, radius: number, brush: Brush, terrainType: number): void {
    const { width: w, height: h } = this.meta;
    const r2 = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(h - 1, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(w - 1, Math.ceil(cx + radius)); x++) {
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (d2 > r2) continue;
        const i = y * w + x;
        const fall = 1 - Math.sqrt(d2) / Math.max(1, radius);
        if (brush === 'terrain') {
          this.terrain[i] = terrainType;
          if (TERRAIN[terrainType]!.water) this.elevation[i] = 0;
          else if (this.elevation[i] === 0)
            this.elevation[i] =
              terrainType === T.Peaks
                ? 245
                : terrainType === T.Mountain
                  ? 200
                  : terrainType === T.Hills
                    ? 140
                    : terrainType === T.Glacier
                      ? 120
                      : 50;
        } else if (brush === 'raise' || brush === 'lower') {
          if (!IS_LAND[this.terrain[i]!]) continue;
          const v = this.elevation[i]! + (brush === 'raise' ? 6 : -6) * fall;
          this.elevation[i] = Math.max(6, Math.min(255, Math.round(v)));
        } else if (brush === 'smooth') {
          let s = 0;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              s += this.elevation[yy * w + xx]!;
              n++;
            }
          if (IS_LAND[this.terrain[i]!]) this.elevation[i] = Math.round(s / n);
        }
      }
    }
    this.dirty = true;
  }

  addMarker(x: number, y: number, brush: Brush, depositType: number, nationName: string): void {
    const m = this.meta;
    if (brush === 'spawn') m.spawnPoints.push([x, y]);
    else if (brush === 'deposit') m.deposits.push({ x, y, type: depositType });
    else if (brush === 'nation') {
      const n: NationSpawn = {
        name: { fr: nationName, en: nationName },
        x,
        y,
        flagSeed: hashString(nationName + x + y),
        weight: 1000 - m.nations.length,
      };
      m.nations.push(n);
    } else if (brush === 'erase') {
      const near = (px: number, py: number) => (px - x) ** 2 + (py - y) ** 2 < 64;
      m.spawnPoints = m.spawnPoints.filter(([px, py]) => !near(px, py));
      m.deposits = m.deposits.filter((d) => !near(d.x, d.y));
      m.nations = m.nations.filter((d) => !near(d.x, d.y));
    }
    this.dirty = true;
  }

  autoMarkers(): void {
    const { width: w, height: h } = this.meta;
    const seed = hashString(this.meta.id);
    this.meta.spawnPoints = generateSpawnPoints(w, h, this.terrain, seed, 200);
    this.meta.deposits = generateDeposits(w, h, this.terrain, seed);
    const rng = new Rng(seed);
    this.meta.nations = this.meta.spawnPoints
      .slice(0, 24)
      .map(([x, y], k) => ({ name: inventNationName(rng), x, y, flagSeed: rng.nextU32(), weight: 100 - k }));
    this.dirty = true;
  }

  /** Validation: enough land, spawn points on land. */
  validate(): string[] {
    const errs: string[] = [];
    let land = 0;
    for (const t of this.terrain) if (IS_LAND[t]) land++;
    if (land < 2000) errs.push('editor.err.land');
    if (this.meta.spawnPoints.length < 4) errs.push('editor.err.spawns');
    return errs;
  }

  toIsoMap(): string {
    const map = new GameMap(
      { ...this.meta, deposits: [...this.meta.deposits] },
      this.terrain,
      this.elevation,
    );
    return exportIsoMap(map);
  }
}

/** Preview colours (night-atlas palette) for the editor canvas. */
export const EDITOR_COLORS: [number, number, number][] = [
  [14, 28, 48],
  [26, 52, 78],
  [34, 66, 96],
  [70, 140, 170],
  [88, 120, 84],
  [120, 118, 84],
  [150, 140, 128],
  [176, 156, 106],
  [52, 92, 64],
  [190, 200, 205],
  [70, 62, 72],
  [200, 212, 222],
  [168, 162, 160],
];
