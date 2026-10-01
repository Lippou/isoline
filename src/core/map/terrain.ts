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
  Impassable = 10,
}

export const TERRAIN_COUNT = 11;

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
  /** Canonical colour used in map source PNGs (and by the editor importer). */
  readonly rgb: readonly [number, number, number];
}

export const TERRAIN: readonly TerrainInfo[] = [
  { key: 'deepOcean', mag: 0, speed: 0, vision: 0, water: true, passable: false, rgb: [20, 50, 90] },
  { key: 'shallow', mag: 0, speed: 0, vision: 0, water: true, passable: false, rgb: [40, 100, 150] },
  { key: 'lake', mag: 0, speed: 0, vision: 0, water: true, passable: false, rgb: [60, 140, 190] },
  { key: 'river', mag: 95, speed: 21, vision: 0, water: false, passable: true, rgb: [90, 170, 220] },
  { key: 'plains', mag: 80, speed: 16.5, vision: 0, water: false, passable: true, rgb: [140, 190, 100] },
  { key: 'hills', mag: 100, speed: 20, vision: 1, water: false, passable: true, rgb: [170, 160, 90] },
  { key: 'mountain', mag: 120, speed: 25, vision: 2, water: false, passable: true, rgb: [140, 120, 100] },
  { key: 'desert', mag: 80, speed: 16.5, vision: 0, water: false, passable: true, rgb: [230, 210, 140] },
  { key: 'forest', mag: 90, speed: 18, vision: -1, water: false, passable: true, rgb: [50, 120, 60] },
  { key: 'tundra', mag: 95, speed: 22, vision: 0, water: false, passable: true, rgb: [220, 230, 235] },
  { key: 'impassable', mag: 0, speed: 0, vision: 0, water: false, passable: false, rgb: [60, 50, 50] },
];

/** Precomputed lookup tables (fast paths in hot loops). */
export const IS_WATER = new Uint8Array(TERRAIN.map((t) => (t.water ? 1 : 0)));
export const IS_LAND = new Uint8Array(TERRAIN.map((t) => (t.passable ? 1 : 0)));
export const MAG = new Float32Array(TERRAIN.map((t) => t.mag));
export const SPEED = new Float32Array(TERRAIN.map((t) => t.speed));

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
