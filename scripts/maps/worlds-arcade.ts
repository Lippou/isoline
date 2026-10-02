// Arcade maps (1.5): symmetric, readable boards for competitive games. Each shape is
// drawn in canonical coordinates, and the finished terrain is copied from the canonical
// tile (worlds.ts `symmetry`), so every player starts on exactly the same ground.
import { T, IS_LAND, Resource } from '../../src/core/map/terrain';
import type { LocalizedName } from '../../src/core/map/gamemap';
import {
  SYM,
  angDist,
  dihedralImages,
  each,
  smoothstep,
  type Ctx,
  type Retouch,
  type Spot,
  type WorldDef,
  type WorldShape,
} from './worlds';

/** Polar coordinates reduced to the canonical wedge [0, π/k] of a dihedral symmetry. */
function canon(X: number, Y: number, k: number): [number, number] {
  const wedge = Math.PI / k;
  let a = Math.atan2(Y, X);
  a = ((a % (2 * wedge)) + 2 * wedge) % (2 * wedge);
  if (a > wedge) a = 2 * wedge - a;
  return [Math.hypot(X, Y), a];
}

const masks = (n: number) => ({
  land: new Uint8Array(n),
  lake: new Uint8Array(n),
  mountains: new Uint8Array(n),
  hills: new Uint8Array(n),
  relief: new Float32Array(n),
  stamp: new Uint8Array(n),
});

const spotsOf = (h: number, w: number, pts: [number, number][]): Spot[] =>
  pts.map(([X, Y]) => ({ x: (w - 1) / 2 + X * h, y: (h - 1) / 2 + Y * h }));

// ------------------------------------------------------------ hexagonal arena
/** A hexagon cut into six sectors by ridges with two passes each, around a moated central plateau. */
function hexArena(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  each(c, (i, X, Y) => {
    const [r, a] = canon(X, Y, 6);
    const u = r * Math.cos(a);
    const v = r * Math.sin(a);
    const nz = c.noise.fbm(u * 9 + 3, v * 9 - 2, 4);
    const R = 0.45 + 0.012 * nz;
    let land = r * Math.cos(Math.PI / 6 - a) < R * Math.cos(Math.PI / 6);
    // Islets off the middle of each coast.
    const ix = 0.44 * Math.cos(Math.PI / 6);
    const iy = 0.44 * Math.sin(Math.PI / 6);
    if (Math.hypot(u - ix, v - iy) < 0.026 + 0.005 * nz) land = true;
    // Moat around the plateau, crossed by six bridges facing the sectors.
    const moat = r > 0.15 && r < 0.176 + 0.003 * nz;
    const bridge = r * (Math.PI / 6 - a) < 0.016;
    if (moat && !bridge) {
      land = false;
      m.lake[i] = 1;
    }
    m.land[i] = land ? 1 : 0;
    // Radial ridges towards the six corners, two passes each.
    const d = r * Math.sin(a);
    const pass = Math.abs(r - 0.265) < 0.022 || Math.abs(r - 0.36) < 0.022;
    if (r > 0.195 && r < 0.43 && !pass) {
      if (d < 0.011) m.mountains[i] = 1;
      if (d < 0.0085 + 0.002 * nz) m.stamp[i] = T.Mountain + 1;
      m.relief[i] = 0.22 * Math.exp(-((d / 0.016) ** 2)) * smoothstep(0.19, 0.22, r);
    }
    // The central plateau: high ground.
    if (r < 0.15) {
      m.relief[i] = 0.16 * smoothstep(0.15, 0.06, r);
      if (r > 0.045) m.hills[i] = 1;
    }
  });
  return m;
}

// ------------------------------------------------------------------ checkerboard
const CB = { cols: 7, rows: 5, cell: 170, gap: 16, margin: 60 };
const cbW = 2 * CB.margin + CB.cols * CB.cell + (CB.cols - 1) * CB.gap;
const cbH = 2 * CB.margin + CB.rows * CB.cell + (CB.rows - 1) * CB.gap;
/** Cell (cx, cy) and local coordinates of a tile, or null in the margins. */
function cbCell(x: number, y: number): [number, number, number, number] {
  const p = CB.cell + CB.gap;
  const cx = Math.floor((x - CB.margin) / p);
  const cy = Math.floor((y - CB.margin) / p);
  return [cx, cy, x - CB.margin - cx * p, y - CB.margin - cy * p];
}

function checkerboard(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const { cols, rows, cell } = CB;
  const half = cell / 2;
  const bridge = 13;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const [cx, cy, lx, ly] = cbCell(x, y);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      let land = false;
      if (lx < cell && ly < cell) {
        // Square island with rounded corners.
        const qx = Math.max(0, Math.abs(lx - half + 0.5) - (half - 16));
        const qy = Math.max(0, Math.abs(ly - half + 0.5) - (half - 16));
        land = Math.hypot(qx, qy) < 16;
      } else if (lx >= cell && ly < cell && cx < cols - 1) land = Math.abs(ly - half + 0.5) < bridge;
      else if (ly >= cell && lx < cell && cy < rows - 1) land = Math.abs(lx - half + 0.5) < bridge;
      if (land) m.land[y * c.w + x] = 1;
    }
  return m;
}

function checkerRetouch({ w, h, terrain, elevation, noise }: Retouch): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!IS_LAND[terrain[i]!]) continue;
      const [cx, cy, lx, ly] = cbCell(x, y);
      const inCell = lx < CB.cell && ly < CB.cell;
      const centre = cx === 3 && cy === 2;
      let t: number = (cx + cy) % 2 === 0 ? T.Desert : T.Forest;
      if (!inCell) t = T.Plains;
      else if (centre) t = noise.get(x * 0.05, y * 0.05) > 0.25 ? T.Mountain : T.Hills;
      terrain[i] = t;
      elevation[i] = Math.max(
        20,
        Math.min(230, (t === T.Mountain ? 190 : t === T.Hills ? 120 : 50) + (elevation[i]! >> 3)),
      );
    }
}

function checkerSpots(): Spot[] {
  const order: [number, number][] = [
    [0, 0],
    [2, 1],
    [1, 0],
    [0, 1],
    [2, 0],
    [1, 1],
    [3, 0],
    [1, 2],
    [3, 1],
    [0, 2],
    [2, 2],
  ];
  const out: Spot[] = [];
  const p = CB.cell + CB.gap;
  for (const [cx, cy] of order) {
    const imgs = new Set<string>();
    for (const [ix, iy] of [
      [cx, cy],
      [CB.cols - 1 - cx, cy],
      [cx, CB.rows - 1 - cy],
      [CB.cols - 1 - cx, CB.rows - 1 - cy],
    ] as const) {
      const key = `${ix},${iy}`;
      if (imgs.has(key)) continue;
      imgs.add(key);
      out.push({ x: CB.margin + ix * p + CB.cell / 2, y: CB.margin + iy * p + CB.cell / 2 });
    }
  }
  return out;
}

// ------------------------------------------------------------------ spiral
const SP = { r0: 0.075, turns: 1.5, rOut: 0.44, hw: 0.04 };
const spTh = SP.turns * 2 * Math.PI;
const spB = (SP.rOut - SP.r0) / spTh;
/** Distance to the nearest of the two arms, and the arm parameter there. */
function spiralDist(X: number, Y: number): number {
  const r = Math.hypot(X, Y);
  const phi = Math.atan2(Y, X);
  let best = Infinity;
  for (let k = 0; k < 2; k++) {
    let base = phi - k * Math.PI;
    base = ((base % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (let mm = 0; mm < 3; mm++) {
      const th = base + 2 * Math.PI * mm;
      if (th > spTh) break;
      best = Math.min(best, Math.abs(r - (SP.r0 + spB * th)));
    }
    // Rounded tip.
    const tip = SP.r0 + spB * spTh;
    const ta = spTh + k * Math.PI;
    best = Math.min(best, Math.hypot(X - tip * Math.cos(ta), Y - tip * Math.sin(ta)));
  }
  return best;
}

function spiral(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  each(c, (i, X, Y) => {
    const [u, v] = Y < 0 || (Y === 0 && X < 0) ? [X, Y] : [-X, -Y];
    const nz = c.noise.fbm(u * 8 + 11, v * 8 - 4, 4);
    const d = spiralDist(X, Y);
    const r = Math.hypot(X, Y);
    const land = d < SP.hw + 0.008 * nz || r < 0.11 + 0.01 * nz;
    m.land[i] = land ? 1 : 0;
    m.relief[i] = 0.12 * Math.exp(-((d / 0.016) ** 2)) + 0.22 * smoothstep(0.08, 0.0, r);
    if (r < 0.045) m.mountains[i] = 1;
  });
  return m;
}

function spiralSpots(c: Ctx): Spot[] {
  // Evenly spaced along arm 0 by arc length, from the hub to the tip; arm 1 is the half-turn image.
  const th0 = 1.4;
  const th1 = spTh - 0.12;
  const steps = 4000;
  const arc: number[] = [0];
  for (let s = 1; s <= steps; s++) {
    const t = th0 + ((th1 - th0) * s) / steps;
    arc.push(arc[s - 1]! + (SP.r0 + spB * t) * ((th1 - th0) / steps));
  }
  const total = arc[steps]!;
  const per = 12;
  const pts: [number, number][] = [];
  for (let j = 0; j < per; j++) {
    const target = (total * (j + 0.5)) / per;
    let s = 0;
    while (s < steps && arc[s]! < target) s++;
    const t = th0 + ((th1 - th0) * s) / steps;
    const r = SP.r0 + spB * t;
    pts.push([r * Math.cos(t), r * Math.sin(t)]);
  }
  const order = [11, 5, 8, 2, 10, 4, 7, 1, 9, 3, 6, 0];
  const out: [number, number][] = [];
  for (const j of order) out.push(pts[j]!, [-pts[j]![0], -pts[j]![1]]);
  return spotsOf(c.h, c.w, out);
}

// ------------------------------------------------------------------ four kingdoms
function fourKingdoms(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  each(c, (i, X, Y) => {
    const u = -Math.abs(X);
    const v = -Math.abs(Y);
    const r = Math.hypot(u, v);
    const nz = c.noise.fbm(u * 7 + 5, v * 7 + 9, 5);
    const se = Math.pow(u ** 4 + v ** 4, 0.25);
    let land = se < 0.43 + 0.025 * nz;
    // Sea channels between the kingdoms, widening towards the open sea.
    const cw = 0.016 + 0.012 * smoothstep(0.2, 0.44, r) + 0.003 * c.noiseB.get(r * 30, 3.3);
    // …crossed by one causeway each, near the coast.
    const causeway = Math.abs(Math.max(-u, -v) - 0.33) < 0.016;
    if (r > 0.13 && (-u < cw || -v < cw) && !causeway) land = false;
    // Lakes in the heart of each kingdom.
    const core = Math.hypot(u + 0.27, v + 0.27);
    if (core < 0.11 && c.noiseC.fbm(u * 14, v * 14, 3) > 0.42) {
      land = false;
      m.lake[i] = 1;
    }
    m.land[i] = land ? 1 : 0;
    // The central plateau: a mountain crown with one pass towards each kingdom.
    const a = Math.atan2(v, u);
    const pass = angDist(a, (-3 * Math.PI) / 4) < 0.2;
    if (r < 0.13) m.relief[i] = 0.1;
    if (r > 0.092 && r < 0.13 && !pass) {
      m.mountains[i] = 1;
      m.relief[i] = 0.3 * Math.exp(-(((r - 0.111) / 0.014) ** 2));
    }
    // Coastal hills along the outer shores.
    if (se > 0.36) m.hills[i] = c.noiseB.fbm(u * 10, v * 10, 3) > 0.1 ? 1 : 0;
  });
  return m;
}

function fourSpots(c: Ctx): Spot[] {
  const quad: [number, number][] = [
    [-0.34, -0.34],
    [-0.24, -0.16],
    [-0.38, -0.06],
    [-0.16, -0.24],
    [-0.06, -0.38],
    [-0.38, -0.2],
  ];
  const out: [number, number][] = [];
  for (const [u, v] of quad) out.push([u, v], [-u, -v], [-u, v], [u, -v]);
  return spotsOf(c.h, c.w, out);
}

// ------------------------------------------------------------------ duel
function duel(c: Ctx): WorldShape {
  const m = masks(c.w * c.h);
  const halfW = (c.w - 1) / 2 / c.h;
  each(c, (i, X, Y) => {
    const u = -Math.abs(X);
    const nz = c.noise.fbm(u * 6 + 2, Y * 6 - 7, 5);
    const ex = Math.abs(u) / (halfW - 0.05);
    const ey = Math.abs(Y) / 0.44;
    let land = Math.pow(ex ** 6 + ey ** 6, 1 / 6) < 0.97 + 0.06 * nz;
    // Bays along the outer coast.
    if (ex > 0.7 && c.noiseC.fbm(u * 10, Y * 10, 3) > 0.35) land = false;
    // The strait, crossed by two causeways and a fortress island in the middle.
    const strait = Math.abs(u) < 0.024 + 0.006 * c.noiseB.get(Y * 9, 1.7);
    const causeway = Math.abs(Math.abs(Y) - 0.29) < 0.026;
    const fort = Math.hypot(u, Y) < 0.075 + 0.006 * nz;
    if (strait && !causeway && !fort) land = false;
    m.land[i] = land ? 1 : 0;
    // A range parallel to the strait in each half, three passes.
    const rx = -0.42 + 0.03 * Math.sin(Y * 9);
    const dx = Math.abs(u - rx);
    const pass = [-0.27, 0.0, 0.25].some((p) => Math.abs(Y - p) < 0.035);
    if (Math.abs(Y) < 0.38 && !pass) {
      if (dx < 0.011) m.mountains[i] = 1;
      m.relief[i] = 0.25 * Math.exp(-((dx / 0.018) ** 2));
    }
    // The fortress: a ring of heights around a flat keep.
    const rf = Math.hypot(u, Y);
    if (rf < 0.075) m.relief[i] = Math.max(m.relief[i]!, 0.2 * smoothstep(0.02, 0.06, rf));
    if (rf > 0.04 && rf < 0.065) m.hills[i] = 1;
    // Lakes in the hinterland.
    if (Math.hypot(u + 0.66, Y - 0.12) < 0.07 && c.noiseC.fbm(u * 16, Y * 16, 3) > 0.25) {
      m.land[i] = 0;
      m.lake[i] = 1;
    }
  });
  return m;
}

function duelSpots(c: Ctx): Spot[] {
  const half: [number, number][] = [
    [-0.72, -0.3],
    [-0.22, 0.02],
    [-0.66, 0.33],
    [-0.24, -0.32],
    [-0.5, -0.12],
    [-0.24, 0.29],
    [-0.74, 0.04],
    [-0.5, 0.2],
  ];
  const out: [number, number][] = [];
  for (const [u, v] of half) out.push([u, v], [-u, v]);
  return spotsOf(c.h, c.w, out);
}

// ------------------------------------------------------------------ circular arena
function arena(c: Ctx): WorldShape {
  const m = { ...masks(c.w * c.h), rivers: new Uint8Array(c.w * c.h) };
  const edge = Math.PI / 8;
  each(c, (i, X, Y) => {
    const [r, a] = canon(X, Y, 8);
    const u = r * Math.cos(a);
    const v = r * Math.sin(a);
    const nz = c.noise.fbm(u * 9 - 3, v * 9 + 6, 4);
    m.land[i] = r < 0.455 + 0.01 * nz ? 1 : 0;
    // The crown: a ring of mountains around the heart, eight passes.
    const pass = r * (edge - a) < 0.022;
    if (r > 0.15 && r < 0.19 && !pass) {
      m.mountains[i] = 1;
      m.relief[i] = 0.3 * Math.exp(-(((r - 0.17) / 0.016) ** 2));
    }
    if (r < 0.15) m.relief[i] = 0.12;
    // Eight rivers from the passes to the sea.
    if (r > 0.19 && r < 0.47 && r * (edge - a) < 0.0028 + 0.0012 * smoothstep(0.2, 0.45, r)) m.rivers[i] = 1;
    // Middle ring of hills.
    if (r > 0.24 && r < 0.3 && c.noiseB.fbm(u * 12, v * 12, 3) > 0.05) m.hills[i] = 1;
  });
  return m;
}

function arenaRetouch({ w, h, terrain, noise }: Retouch): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = terrain[i]!;
      if (!IS_LAND[t] || t === T.River || t === T.Mountain) continue;
      const r = Math.hypot(x - (w - 1) / 2, y - (h - 1) / 2) / h;
      if (r < 0.15) terrain[i] = T.Plains;
      else if (r > 0.2 && r < 0.33 && t !== T.Hills)
        terrain[i] = noise.fbm(x * 0.02, y * 0.02, 3) > -0.15 ? T.Forest : T.Plains;
      else if (r >= 0.33 && t !== T.Hills) terrain[i] = T.Plains;
    }
}

// ------------------------------------------------------------------ 8-bit world
const PX = 16;
function pixelWorld(c: Ctx): { terrain: Uint8Array; elevation: Uint8Array } {
  const { w, h, rng, noise, noiseB, noiseC } = c;
  const bw = Math.ceil(w / PX);
  const bh = Math.ceil(h / PX);
  const nb = bw * bh;
  const field = new Float32Array(nb);
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const X = (bx + 0.5) / bw - 0.5;
      const Y = (by + 0.5) / bh - 0.5;
      const edge = Math.max(Math.abs(X) * 2, Math.abs(Y) * 2);
      field[by * bw + bx] =
        noise.fbm(bx * 0.055 + 3, by * 0.055 - 8, 4) + 0.35 - 1.1 * Math.max(0, edge - 0.72) - 0.15 * edge;
    }
  // About 45 % land.
  const sorted = Array.from(field).sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.55)]!;
  const bt = new Uint8Array(nb);
  const be = new Uint8Array(nb);
  const landB = (k: number) => field[k]! > thr;
  // Inland distance in blocks.
  const dist = new Int32Array(nb).fill(99);
  const q: number[] = [];
  for (let k = 0; k < nb; k++)
    if (!landB(k)) {
      dist[k] = 0;
      q.push(k);
    }
  for (let qi = 0; qi < q.length; qi++) {
    const k = q[qi]!;
    const bx = k % bw;
    for (const j of [bx > 0 ? k - 1 : -1, bx < bw - 1 ? k + 1 : -1, k - bw, k + bw]) {
      if (j < 0 || j >= nb || dist[j]! <= dist[k]! + 1) continue;
      dist[j] = dist[k]! + 1;
      q.push(j);
    }
  }
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      const k = by * bw + bx;
      if (!landB(k)) {
        bt[k] = dist[k]! === 0 && field[k]! > thr - 0.12 ? T.Shallow : T.DeepOcean;
        continue;
      }
      const ridge = noiseB.ridged(bx * 0.09, by * 0.09, 3);
      const moist = noiseC.fbm(bx * 0.07 + 40, by * 0.07, 3);
      const lat = Math.abs(by / (bh - 1) - 0.5) * 2;
      const inland = dist[k]!;
      let t: number;
      if (inland >= 3 && ridge > 0.82) t = T.Mountain;
      else if (inland >= 2 && ridge > 0.7) t = T.Hills;
      else if (lat > 0.84) t = T.Tundra;
      else if (inland >= 3 && noiseC.get(bx * 0.25, by * 0.25 + 9) > 0.55) t = T.Lake;
      else if (moist < -0.2 && lat < 0.6) t = T.Desert;
      else if (moist > 0.12) t = T.Forest;
      else t = T.Plains;
      bt[k] = t;
      be[k] =
        t === T.Lake
          ? 0
          : Math.min(250, 40 + 24 * Math.min(inland, 4) + (t === T.Mountain ? 110 : t === T.Hills ? 50 : 0));
    }
  // Rivers: from a few mountain blocks, steepest descent block by block to the sea.
  const river = new Uint8Array(nb);
  const riverDir: number[][] = Array.from({ length: nb }, () => []);
  const sources = [];
  for (let k = 0; k < nb; k++) if (bt[k] === T.Mountain) sources.push(k);
  rng.shuffle(sources);
  for (const s of sources.slice(0, 9)) {
    let k = s;
    for (let steps = 0; steps < 60; steps++) {
      const bx = k % bw;
      let next = -1;
      let best = dist[k]!;
      for (const j of [bx > 0 ? k - 1 : -1, bx < bw - 1 ? k + 1 : -1, k - bw, k + bw]) {
        if (j < 0 || j >= nb) continue;
        if (dist[j]! < best) {
          best = dist[j]!;
          next = j;
        }
      }
      if (next < 0) break;
      riverDir[k]!.push(next);
      riverDir[next]!.push(k);
      if (bt[k] !== T.Mountain) river[k] = 1;
      if (!landB(next) || bt[next] === T.Lake) break;
      k = next;
    }
  }
  const terrain = new Uint8Array(w * h);
  const elevation = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const bx = Math.floor(x / PX);
      const by = Math.floor(y / PX);
      const k = by * bw + bx;
      let t = bt[k]!;
      const lx = x - bx * PX;
      const ly = y - by * PX;
      // River segments: 4-tile wide strokes from block centre to block centre.
      if (IS_LAND[t] && t !== T.Mountain) {
        for (const j of riverDir[k]!) {
          const dx = (j % bw) - bx;
          const dy = Math.floor(j / bw) - by;
          const inX = dx !== 0 && Math.abs(ly - 7.5) < 2 && (dx > 0 ? lx >= 6 : lx <= 9);
          const inY = dy !== 0 && Math.abs(lx - 7.5) < 2 && (dy > 0 ? ly >= 6 : ly <= 9);
          if (river[k] && (inX || inY)) t = T.River;
        }
      }
      terrain[y * w + x] = t;
      elevation[y * w + x] = IS_LAND[t] ? Math.max(8, be[k]!) : 0;
    }
  return { terrain, elevation };
}

// ------------------------------------------------------------------ names
const N = (fr: string, en = fr): LocalizedName => ({ fr, en });
const PIXEL_NAMES: LocalizedName[] = [
  N('Royaume Pixel', 'Pixel Kingdom'),
  N('Octetie', 'Bytonia'),
  N('Val des Sprites', 'Sprite Vale'),
  N('Mont Checksum'),
  N('Île Bonus', 'Bonus Isle'),
  N('Niveau secret', 'Secret Level'),
  N('Donjon 8', 'Dungeon 8'),
  N('Marais Glitch', 'Glitch Marsh'),
  N('Cartouche', 'Cartridge'),
  N('Chiptune'),
  N('Haut Score', 'High Score'),
  N('Pays Palette', 'Paletteland'),
  N('Baie du Curseur', 'Cursor Bay'),
  N('Désert Scanline', 'Scanline Desert'),
  N('Forêt Bitmap', 'Bitmap Forest'),
  N('Port Joystick', 'Joystick Harbour'),
  N('Citadelle 16 couleurs', '16-Colour Citadel'),
  N('Toundra Tilemap', 'Tilemap Tundra'),
  N('Comté Continue', 'Continue County'),
  N('Plaines Pause', 'Pause Plains'),
  N('Château Boss', 'Boss Castle'),
  N('Crique Combo', 'Combo Cove'),
  N('Rive Respawn', 'Respawn Shore'),
  N('Marche Vie-Extra', 'Extra-Life March'),
  N('Plateau Power-up', 'Power-up Plateau'),
  N('Vallée Vecteur', 'Vector Valley'),
  N('Île Sauvegarde', 'Save Point Isle'),
  N('Terres Arcade', 'Arcade Lands'),
];

export const ARCADE: WorldDef[] = [
  {
    id: 'hex-arena',
    name: { fr: 'Arène hexagonale', en: 'Hex Arena' },
    desc: {
      fr: 'Six secteurs identiques séparés par des crêtes à cols, autour d’un plateau entouré de douves.',
      en: 'Six identical sectors split by ridges with passes, around a moated central plateau.',
    },
    category: 'arcade',
    seed: 6101,
    width: 1200,
    height: 1200,
    mountains: 0,
    rivers: 0.25,
    latTop: 42,
    latBottom: 30,
    moistureBias: 0.15,
    shape: hexArena,
    symmetry: SYM.dihedral(1200, 1200, 6),
    nations: 24,
    spots: (r) => {
      const out: [number, number][] = [];
      for (const [rad, a] of [
        [0.25, 0.33],
        [0.36, 0.2],
      ] as const)
        out.push(
          ...dihedralImages(r.w, r.h, 6, rad * Math.cos(a), rad * Math.sin(a)).map(
            ([x, y]) => [(x - (r.w - 1) / 2) / r.h, (y - (r.h - 1) / 2) / r.h] as [number, number],
          ),
        );
      return spotsOf(r.h, r.w, out);
    },
    deposits: (r) => {
      const c = (r.w - 1) / 2;
      return [Resource.Oil, Resource.Uranium, Resource.RareMetals].map((type, k) => ({
        x: Math.round(c + 30 * Math.cos((k * 2 * Math.PI) / 3)),
        y: Math.round(c + 30 * Math.sin((k * 2 * Math.PI) / 3)),
        type,
      }));
    },
  },
  {
    id: 'checkerboard',
    name: { fr: 'Damier', en: 'Checkerboard' },
    desc: {
      fr: 'Trente-cinq cases de sable et de forêt reliées par des chaussées, un donjon au centre.',
      en: 'Thirty-five squares of sand and forest linked by causeways, a keep in the middle.',
    },
    category: 'arcade',
    seed: 6202,
    width: cbW,
    height: cbH,
    mountains: 0,
    rivers: 0,
    latTop: 35,
    latBottom: 30,
    shape: checkerboard,
    retouch: checkerRetouch,
    symmetry: SYM.mirrorXY(cbW, cbH),
    nations: 34,
    spots: checkerSpots,
  },
  {
    id: 'spiral',
    name: { fr: 'Spirale', en: 'Spiral' },
    desc: {
      fr: 'Deux bras de terre enroulés autour d’un moyeu : le centre est à tout le monde.',
      en: 'Two arms of land coiled around a hub: the centre belongs to everyone.',
    },
    category: 'arcade',
    seed: 6303,
    width: 1300,
    height: 1300,
    mountains: 0.15,
    rivers: 0.3,
    latTop: 40,
    latBottom: 26,
    shape: spiral,
    symmetry: SYM.rot2(1300, 1300),
    nations: 24,
    spots: spiralSpots,
  },
  {
    id: 'four-kingdoms',
    name: { fr: 'Quatre royaumes', en: 'Four Kingdoms' },
    desc: {
      fr: 'Quatre royaumes jumeaux séparés par des bras de mer et des chaussées, un plateau central riche et disputé.',
      en: 'Four twin kingdoms parted by sea channels and causeways, with a rich, contested central plateau.',
    },
    category: 'arcade',
    seed: 6404,
    width: 1300,
    height: 1300,
    mountains: 0.3,
    rivers: 0.55,
    latTop: 48,
    latBottom: 32,
    shape: fourKingdoms,
    symmetry: SYM.mirrorXY(1300, 1300),
    nations: 24,
    spots: fourSpots,
    deposits: (r) => {
      const c = (r.w - 1) / 2;
      const types = [Resource.Oil, Resource.Uranium, Resource.RareMetals, Resource.Fertile];
      return types.map((type, k) => ({
        x: Math.round(c + 50 * Math.cos(((2 * k + 1) * Math.PI) / 4)),
        y: Math.round(c + 50 * Math.sin(((2 * k + 1) * Math.PI) / 4)),
        type,
      }));
    },
  },
  {
    id: 'duel',
    name: { fr: 'Duel', en: 'Duel' },
    desc: {
      fr: 'Deux moitiés en miroir, un détroit, deux chaussées et un fort au milieu : idéal à 2–4 joueurs.',
      en: 'Two mirrored halves, a strait, two causeways and a fort in the middle: ideal for 2–4 players.',
    },
    category: 'arcade',
    seed: 6505,
    width: 1600,
    height: 900,
    mountains: 0.2,
    rivers: 0.5,
    latTop: 46,
    latBottom: 34,
    shape: duel,
    symmetry: SYM.mirrorX(1600),
    nations: 16,
    spots: duelSpots,
  },
  {
    id: 'arena',
    name: { fr: 'Arène circulaire', en: 'Circular Arena' },
    desc: {
      fr: 'Un disque symétrique fait pour la bataille royale : forêts, rivières et une couronne de montagnes.',
      en: 'A symmetric disc built for battle royale: forests, rivers and a crown of mountains.',
    },
    category: 'arcade',
    seed: 6606,
    width: 1200,
    height: 1200,
    mountains: 0,
    rivers: 0,
    latTop: 40,
    latBottom: 30,
    shape: arena,
    retouch: arenaRetouch,
    symmetry: SYM.dihedral(1200, 1200, 8),
    nations: 24,
    spots: (r) => {
      const out: [number, number][] = [];
      for (const [rad, a] of [
        [0.39, Math.PI / 16],
        [0.26, 0],
      ] as const)
        out.push(
          ...dihedralImages(r.w, r.h, 8, rad * Math.cos(a), rad * Math.sin(a)).map(
            ([x, y]) => [(x - (r.w - 1) / 2) / r.h, (y - (r.h - 1) / 2) / r.h] as [number, number],
          ),
        );
      return spotsOf(r.h, r.w, out);
    },
  },
  {
    id: 'pixel-world',
    name: { fr: 'Monde 8 bits', en: '8-Bit World' },
    desc: {
      fr: 'Un monde en gros pixels, couleurs de console d’antan, côtes en escalier.',
      en: 'A world of big pixels in vintage console colours, with staircase coasts.',
    },
    category: 'arcade',
    palette: 'pixel',
    seed: 6808,
    width: 1536,
    height: 1024,
    mountains: 0,
    rivers: 0,
    latTop: 60,
    latBottom: -60,
    direct: pixelWorld,
    nations: 28,
    names: PIXEL_NAMES,
  },
];
