// Terrain types and their gameplay modifiers (see GAME_DESIGN.md §Terrain).

export const enum T {
  DeepOcean = 0,
  Shallow = 1,
  Lake = 2,
  River = 3,
  Plains = 4,
  Hills = 5,
  Mountain = 6,
  Desert = 7,
  Forest = 8,
  Tundra = 9,
  /** Walls only (arcade mazes, a few legends): nothing crosses them. */
  Impassable = 10,
  /** Inland ice sheets (Greenland, Antarctica, polar caps): conquerable, very slowly. */
  Glacier = 11,
  /** Jagged high peaks above the mountains: conquerable, slowest of all. */
  Peaks = 12,
}

export const TERRAIN_COUNT = 13;

export interface TerrainInfo {
  readonly key: string;
  /** Attacker losses multiplier base ("mag"): 80 = plains reference. */
  readonly mag: number;
  /** Slowness ("speed"): 16.5 = plains reference. Higher = slower conquest. */
  readonly speed: number;
  /** Vision modifier in tiles (fog of war). */
  readonly vision: number;
  readonly water: boolean;
  readonly passable: boolean;
  /**
   * Harsh land (glaciers, high peaks): owned and conquered like any land, and counted in
   * the territory, but nobody spawns or builds there and no deposit lies there.
   */
  readonly harsh: boolean;
  /** Canonical colour used in map source PNGs (and by the editor importer). */
  readonly rgb: readonly [number, number, number];
}

// (A table: one terrain per line.)
// prettier-ignore
export const TERRAIN: readonly TerrainInfo[] = [
  { key: 'deepOcean', mag: 0, speed: 0, vision: 0, water: true, passable: false, harsh: false, rgb: [20, 50, 90] },
  { key: 'shallow', mag: 0, speed: 0, vision: 0, water: true, passable: false, harsh: false, rgb: [40, 100, 150] },
  { key: 'lake', mag: 0, speed: 0, vision: 0, water: true, passable: false, harsh: false, rgb: [60, 140, 190] },
  { key: 'river', mag: 95, speed: 21, vision: 0, water: false, passable: true, harsh: false, rgb: [90, 170, 220] },
  { key: 'plains', mag: 80, speed: 16.5, vision: 0, water: false, passable: true, harsh: false, rgb: [140, 190, 100] },
  { key: 'hills', mag: 100, speed: 20, vision: 1, water: false, passable: true, harsh: false, rgb: [170, 160, 90] },
  { key: 'mountain', mag: 120, speed: 25, vision: 2, water: false, passable: true, harsh: false, rgb: [140, 120, 100] },
  { key: 'desert', mag: 80, speed: 16.5, vision: 0, water: false, passable: true, harsh: false, rgb: [230, 210, 140] },
  { key: 'forest', mag: 90, speed: 18, vision: -1, water: false, passable: true, harsh: false, rgb: [50, 120, 60] },
  { key: 'tundra', mag: 95, speed: 22, vision: 0, water: false, passable: true, harsh: false, rgb: [220, 230, 235] },
  { key: 'impassable', mag: 0, speed: 0, vision: 0, water: false, passable: false, harsh: true, rgb: [60, 50, 50] },
  // Beyond OpenFront's scale (plains 80/16.5, highland 100/20, mountain 120/25): about
  // 1.9-2.1x the losses and time of plains, so a glacier or a massif is crossed, not raced.
  { key: 'glacier', mag: 150, speed: 32, vision: 0, water: false, passable: true, harsh: true, rgb: [196, 226, 246] },
  { key: 'peaks', mag: 165, speed: 36, vision: 3, water: false, passable: true, harsh: true, rgb: [104, 92, 96] },
];

/** Precomputed lookup tables (fast paths in hot loops). */
export const IS_WATER = new Uint8Array(TERRAIN.map((t) => (t.water ? 1 : 0)));
export const IS_LAND = new Uint8Array(TERRAIN.map((t) => (t.passable ? 1 : 0)));
export const MAG = new Float32Array(TERRAIN.map((t) => t.mag));
export const SPEED = new Float32Array(TERRAIN.map((t) => t.speed));
/** Land where one may spawn, build and find deposits: passable and not harsh. */
export const HABITABLE = new Uint8Array(TERRAIN.map((t) => (t.passable && !t.harsh ? 1 : 0)));
/** Harsh land (glacier, peaks) and walls: what map generation keeps people and rivers off. */
export const HARSH = new Uint8Array(TERRAIN.map((t) => (t.harsh ? 1 : 0)));

/** Map an arbitrary RGB colour to the closest terrain type (editor PNG import). */
export function terrainFromRgb(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < TERRAIN.length; i++) {
    const c = TERRAIN[i]!.rgb;
    const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export const enum Resource {
  None = 0,
  Oil = 1,
  Uranium = 2,
  Fertile = 3,
  RareMetals = 4,
}
export const RESOURCE_KEYS = ['none', 'oil', 'uranium', 'fertile', 'rareMetals'] as const;
