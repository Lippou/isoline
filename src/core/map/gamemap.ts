// The static map: terrain, altitude, deposits and derived topology
// (water bodies / landmasses, coast distance, coarse naval graph).
import { IS_LAND, IS_WATER, T } from './terrain';
import { NavGrid } from './nav';

export type MapCategory = 'continents' | 'regions' | 'fictional' | 'arcade' | 'procedural' | 'custom';

export interface LocalizedName {
  fr: string;
  en: string;
}

export interface NationSpawn {
  name: LocalizedName;
  x: number;
  y: number;
  flagSeed: number;
  /** ISO 3166-1 alpha-2 code (lower case) for real countries: real flag and map colour. */
  iso?: string;
  /** Importance (population / area); the lobby keeps the N most important. */
  weight: number;
}

export interface DepositSpec {
  x: number;
  y: number;
  type: number; // Resource
}

export interface MapMeta {
  id: string;
  name: LocalizedName;
  category: MapCategory;
  width: number;
  height: number;
  nations: NationSpawn[];
  spawnPoints: [number, number][];
  deposits: DepositSpec[];
  /** Optional geographic extent (for documentation / day-night longitude). */
  bounds?: { lonMin: number; lonMax: number; latMin: number; latMax: number; projection: string };
  author?: string;
  version?: number;
}

export class GameMap {
  readonly width: number;
  readonly height: number;
  readonly size: number;
  readonly terrain: Uint8Array;
  readonly elevation: Uint8Array;
  /** Deposit type per tile (Resource enum), 0 = none. */
  readonly resource: Uint8Array;
  /** Connected-component id: water bodies and landmasses share one id space (0 = impassable). */
  readonly component: Int32Array;
  /** Size of each component in tiles. */
  readonly componentSize: number[] = [0];
  /** Distance (tiles, capped 255) to the nearest land/water boundary. */
  readonly coastDist: Uint8Array;
  /** Number of passable land tiles (victory denominator before fallout). */
  landCount = 0;
  nav!: NavGrid;
  meta: MapMeta;

  constructor(meta: MapMeta, terrain: Uint8Array, elevation: Uint8Array, resource?: Uint8Array) {
    this.meta = meta;
    this.width = meta.width;
    this.height = meta.height;
    this.size = this.width * this.height;
    if (terrain.length !== this.size || elevation.length !== this.size) throw new Error('map size mismatch');
    this.terrain = terrain;
    this.elevation = elevation;
    this.resource = resource ?? new Uint8Array(this.size);
    if (!resource) {
      for (const d of meta.deposits) this.stampDeposit(d);
    }
    this.component = new Int32Array(this.size);
    this.coastDist = new Uint8Array(this.size);
    this.computeDerived();
  }

  private stampDeposit(d: DepositSpec): void {
    // A deposit is a small diamond of ~13 tiles centred on (x, y), land only.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 2) continue;
        const x = d.x + dx;
        const y = d.y + dy;
        if (!this.inBounds(x, y)) continue;
        const i = y * this.width + x;
        if (IS_LAND[this.terrain[i]!]) this.resource[i] = d.type;
      }
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  idx(x: number, y: number): number {
    return y * this.width + x;
  }

  x(i: number): number {
    return i % this.width;
  }

  y(i: number): number {
    return (i / this.width) | 0;
  }

  isLand(i: number): boolean {
    return IS_LAND[this.terrain[i]!] === 1;
  }

  isWater(i: number): boolean {
    return IS_WATER[this.terrain[i]!] === 1;
  }

  /** Writes the 4-neighbours of i into out; returns the count. */
  neighbors4(i: number, out: Int32Array): number {
    const w = this.width;
    const x = i % w;
    let n = 0;
    if (x > 0) out[n++] = i - 1;
    if (x < w - 1) out[n++] = i + 1;
    if (i >= w) out[n++] = i - w;
    if (i < this.size - w) out[n++] = i + w;
    return n;
  }

  /** True if a land tile touches water (ports, landings). */
  isCoastalLand(i: number): boolean {
    if (!this.isLand(i)) return false;
    const w = this.width;
    const x = i % w;
    const t = this.terrain;
    return (
      (x > 0 && IS_WATER[t[i - 1]!] === 1) ||
      (x < w - 1 && IS_WATER[t[i + 1]!] === 1) ||
      (i >= w && IS_WATER[t[i - w]!] === 1) ||
      (i < this.size - w && IS_WATER[t[i + w]!] === 1)
    );
  }

  /** A water tile next to land tile i, preferring the largest water body (or -1). */
  adjacentWater(i: number): number {
    const w = this.width;
    const x = i % w;
    let best = -1;
    let bestSize = -1;
    const consider = (j: number) => {
      if (IS_WATER[this.terrain[j]!] !== 1) return;
      const s = this.componentSize[this.component[j]!] ?? 0;
      if (s > bestSize) {
        bestSize = s;
        best = j;
      }
    };
    if (x > 0) consider(i - 1);
    if (x < w - 1) consider(i + 1);
    if (i >= w) consider(i - w);
    if (i < this.size - w) consider(i + w);
    return best;
  }

  private computeDerived(): void {
    const { size, width: w, terrain } = this;
    const comp = this.component;
    comp.fill(-1);
    const stack = new Int32Array(size);
    let nextId = 1;
    for (let s = 0; s < size; s++) {
      if (comp[s] !== -1) continue;
      const tt = terrain[s]!;
      if (tt === T.Impassable) {
        comp[s] = 0;
        continue;
      }
      const water = IS_WATER[tt]!;
      const id = nextId++;
      let sp = 0;
      stack[sp++] = s;
      comp[s] = id;
      let count = 0;
      while (sp > 0) {
        const i = stack[--sp]!;
        count++;
        const x = i % w;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (i >= w) push(i - w);
        if (i < size - w) push(i + w);
      }
      this.componentSize[id] = count;
      if (!water) this.landCount += count;

      function push(j: number): void {
        if (comp[j] !== -1) return;
        const tj = terrain[j]!;
        if (tj === T.Impassable || IS_WATER[tj] !== water) return;
        comp[j] = id;
        stack[sp++] = j;
      }
    }

    // Multi-source BFS from every land/water boundary tile.
    const dist = this.coastDist;
    dist.fill(255);
    let qh = 0;
    let qt = 0;
    const q = stack; // reuse buffer
    for (let i = 0; i < size; i++) {
      const wi = IS_WATER[terrain[i]!];
      const x = i % w;
      const boundary =
        (x > 0 && IS_WATER[terrain[i - 1]!] !== wi) ||
        (x < w - 1 && IS_WATER[terrain[i + 1]!] !== wi) ||
        (i >= w && IS_WATER[terrain[i - w]!] !== wi) ||
        (i < size - w && IS_WATER[terrain[i + w]!] !== wi);
      if (boundary) {
        dist[i] = 0;
        q[qt++] = i;
      }
    }
    while (qh < qt) {
      const i = q[qh++]!;
      const d = dist[i]! + 1;
      if (d >= 255) continue;
      const x = i % w;
      if (x > 0 && dist[i - 1]! > d) {
        dist[i - 1] = d;
        q[qt++] = i - 1;
      }
      if (x < w - 1 && dist[i + 1]! > d) {
        dist[i + 1] = d;
        q[qt++] = i + 1;
      }
      if (i >= w && dist[i - w]! > d) {
        dist[i - w] = d;
        q[qt++] = i - w;
      }
      if (i < size - w && dist[i + w]! > d) {
        dist[i + w] = d;
        q[qt++] = i + w;
      }
    }

    this.nav = new NavGrid(this);
  }
}
