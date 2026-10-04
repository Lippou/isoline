// Coarse naval navigation graph. The navigable grid (water, plus the rivers that flow
// into it) is split in C×C cells; each piece of it connected inside its cell is a node,
// whose representative is its tile closest to the cell centre. A* runs on nodes
// (8-connected, no corner cutting); legs that leave the water (a river winding through
// a cell, a cape) are retraced tile by tile, and the result is string-pulled with
// fine-grid line-of-sight checks.
//
// Nodes used to be one per (cell, naval body): the two sides of a thin island, a spit or
// an isthmus crossing a cell were one node, so the search stepped "through" the land and
// the leg was retraced around it by the local search — round the whole island, or, past
// that search's reach, straight across the land.
import type { GameMap } from './gamemap';
import { T } from './terrain';

/** A* cost factor of a river cell: ships keep to open water when they have the choice. */
export const RIVER_PATH_COST = 1.6;

const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Growable list of directed int pairs. */
class Pairs {
  a = new Int32Array(1024);
  b = new Int32Array(1024);
  n = 0;
  push(x: number, y: number): void {
    if (this.n >= this.a.length) {
      const a = new Int32Array(this.a.length * 2);
      a.set(this.a);
      this.a = a;
      const b = new Int32Array(this.b.length * 2);
      b.set(this.b);
      this.b = b;
    }
    this.a[this.n] = x;
    this.b[this.n++] = y;
  }
}

/** Adjacency lists (node → neighbours, in insertion order) from directed pairs. */
function adjacency(nodes: number, pairs: Pairs): { start: Int32Array; to: Int32Array } {
  const start = new Int32Array(nodes + 1);
  for (let k = 0; k < pairs.n; k++) start[pairs.a[k]! + 1]!++;
  for (let n = 0; n < nodes; n++) start[n + 1]! += start[n]!;
  const fill = start.slice(0, nodes);
  const to = new Int32Array(pairs.n);
  for (let k = 0; k < pairs.n; k++) to[fill[pairs.a[k]!]!++] = pairs.b[k]!;
  return { start, to };
}

export class NavGrid {
  readonly cell: number;
  readonly cw: number;
  readonly ch: number;
  private readonly map: GameMap;
  /** First node of each cell (-1 none); nodes in a cell are chained through nodeNext. */
  private readonly cellFirst: Int32Array;
  private nodeCell: Int32Array;
  private nodeRep: Int32Array;
  private nodeNext: Int32Array;
  /** Tiles of the node within its cell: bit (y − y0) × C + (x − x0), over two words (C ≤ 6). */
  private nodeLo: Int32Array;
  private nodeHi: Int32Array;
  /** Neighbours of node n: edgeTo[edgeStart[n] .. edgeStart[n + 1]), at A* cost edgeCost. */
  private edgeStart: Int32Array = new Int32Array(1);
  private edgeTo: Int32Array = new Int32Array(0);
  private edgeCost: Float64Array = new Float64Array(0);
  nodeCount = 0;

  // A* scratch buffers (generation-stamped, reused between searches).
  private gScore: Float64Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private goal: Uint32Array;
  private gen = 0;
  private heapNodes: Int32Array;
  private heapF: Float64Array;

  constructor(map: GameMap) {
    this.map = map;
    this.cell = map.size > 2_600_000 ? 6 : map.size > 400_000 ? 4 : 3;
    this.cw = Math.ceil(map.width / this.cell);
    this.ch = Math.ceil(map.height / this.cell);
    this.cellFirst = new Int32Array(this.cw * this.ch).fill(-1);
    const cap = this.cw * this.ch + 1024;
    this.nodeCell = new Int32Array(cap);
    this.nodeRep = new Int32Array(cap);
    this.nodeNext = new Int32Array(cap);
    this.nodeLo = new Int32Array(cap);
    this.nodeHi = new Int32Array(cap);
    this.build();
    const n = this.nodeCount;
    this.gScore = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.goal = new Uint32Array(n);
    this.heapNodes = new Int32Array(n * 8 + 16);
    this.heapF = new Float64Array(n * 8 + 16);
  }

  private grow(): void {
    const cap = this.nodeCell.length * 2;
    const g = (a: Int32Array) => {
      const b = new Int32Array(cap);
      b.set(a);
      return b;
    };
    this.nodeCell = g(this.nodeCell);
    this.nodeRep = g(this.nodeRep);
    this.nodeNext = g(this.nodeNext);
    this.nodeLo = g(this.nodeLo);
    this.nodeHi = g(this.nodeHi);
  }

  private build(): void {
    const { map, cell: C, cw, ch } = this;
    const W = map.width;
    const nav = map.navBody;
    // 1. Nodes: the 4-connected pieces of navigable water inside each cell. A cell all of
    // water (most of the sea) is one node: no flood fill.
    const label = new Int32Array(C * C);
    const stack = new Int32Array(C * C);
    let fullLo = 0;
    let fullHi = 0;
    for (let l = 0; l < C * C; l++) {
      if (l < 32) fullLo |= 1 << l;
      else fullHi |= 1 << (l - 32);
    }
    const centre = ((C - 1) >> 1) * (C + 1); // nearest the centre of a full cell, first in reading order
    const addNode = (c: number, rep: number, lo: number, hi: number) => {
      if (this.nodeCount >= this.nodeCell.length) this.grow();
      const n = this.nodeCount++;
      this.nodeCell[n] = c;
      this.nodeRep[n] = rep;
      this.nodeLo[n] = lo;
      this.nodeHi[n] = hi;
      this.nodeNext[n] = this.cellFirst[c]!;
      this.cellFirst[c] = n;
      return n;
    };
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const x0 = cx * C;
        const y0 = cy * C;
        const bw = Math.min(map.width, x0 + C) - x0;
        const bh = Math.min(map.height, y0 + C) - y0;
        const c = cy * cw + cx;
        let count = 0;
        for (let ly = 0; ly < bh; ly++) {
          const row = (y0 + ly) * W + x0;
          for (let lx = 0; lx < bw; lx++) if (nav[row + lx]! > 0) count++;
        }
        if (count === 0) continue;
        if (count === C * C) {
          addNode(c, (y0 + ((centre / C) | 0)) * W + x0 + (centre % C), fullLo, fullHi);
          continue;
        }
        const mx = x0 + (bw - 1) / 2;
        const my = y0 + (bh - 1) / 2;
        label.fill(-1);
        for (let ly = 0; ly < bh; ly++) {
          for (let lx = 0; lx < bw; lx++) {
            const l0 = ly * C + lx;
            if (label[l0]! >= 0 || nav[(y0 + ly) * W + x0 + lx]! <= 0) continue;
            const n = this.nodeCount;
            let lo = 0;
            let hi = 0;
            let rep = -1;
            let repD = Infinity;
            let repL = Infinity;
            let sp = 0;
            stack[sp++] = l0;
            label[l0] = n;
            while (sp > 0) {
              const l = stack[--sp]!;
              const px = l % C;
              const py = (l / C) | 0;
              if (l < 32) lo |= 1 << l;
              else hi |= 1 << (l - 32);
              // Representative: the tile nearest the cell centre (first in reading order on a tie).
              const d = (x0 + px - mx) ** 2 + (y0 + py - my) ** 2;
              if (d < repD || (d === repD && l < repL)) {
                rep = (y0 + py) * W + x0 + px;
                repD = d;
                repL = l;
              }
              const t = (y0 + py) * W + x0 + px;
              if (px > 0 && label[l - 1]! < 0 && nav[t - 1]! > 0) {
                label[l - 1] = n;
                stack[sp++] = l - 1;
              }
              if (px < bw - 1 && label[l + 1]! < 0 && nav[t + 1]! > 0) {
                label[l + 1] = n;
                stack[sp++] = l + 1;
              }
              if (py > 0 && label[l - C]! < 0 && nav[t - W]! > 0) {
                label[l - C] = n;
                stack[sp++] = l - C;
              }
              if (py < bh - 1 && label[l + C]! < 0 && nav[t + W]! > 0) {
                label[l + C] = n;
                stack[sp++] = l + C;
              }
            }
            addNode(c, rep, lo, hi);
          }
        }
      }
    }
    // 2. Orthogonal edges: two pieces touching across their cells' shared side.
    const ortho = new Pairs();
    const seen: number[] = [];
    const single = (c: number) => this.nodeNext[this.cellFirst[c]!] === -1;
    /** Node of navigable tile t in cell c (most cells hold one). */
    const nodeIn = (t: number, c: number) => (single(c) ? this.cellFirst[c]! : this.nodeOfTile(t));
    const link = (a: number, ca: number, b: number, cb: number) => {
      const na = nodeIn(a, ca);
      const nb = nodeIn(b, cb);
      for (let k = 0; k < seen.length; k += 2) if (seen[k] === na && seen[k + 1] === nb) return;
      seen.push(na, nb);
      ortho.push(na, nb);
      ortho.push(nb, na);
    };
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const c = cy * cw + cx;
        if (this.cellFirst[c] === -1) continue;
        if (cx + 1 < cw && this.cellFirst[c + 1] !== -1) {
          seen.length = 0;
          const xa = cx * C + C - 1;
          for (let y = cy * C; y < Math.min(map.height, cy * C + C); y++) {
            const a = y * W + xa;
            if (nav[a]! > 0 && nav[a + 1]! > 0) {
              link(a, c, a + 1, c + 1);
              if (single(c) && single(c + 1)) break;
            }
          }
        }
        if (cy + 1 < ch && this.cellFirst[c + cw] !== -1) {
          seen.length = 0;
          const ya = cy * C + C - 1;
          for (let x = cx * C; x < Math.min(map.width, cx * C + C); x++) {
            const a = ya * W + x;
            if (nav[a]! > 0 && nav[a + W]! > 0) {
              link(a, c, a + W, c + cw);
              if (single(c) && single(c + cw)) break;
            }
          }
        }
      }
    }
    const o = adjacency(this.nodeCount, ortho);
    const linked = (a: number, b: number) => {
      for (let k = o.start[a]!; k < o.start[a + 1]!; k++) if (o.to[k] === b) return true;
      return false;
    };
    // 3. Diagonal edges only when both orthogonal detours exist (no corner cutting): n
    // reaches t through a piece of the cell beside it and through one of the cell below.
    const diag = new Pairs();
    for (let n = 0; n < this.nodeCount; n++) {
      const c = this.nodeCell[n]!;
      const first = diag.n;
      for (let i = o.start[n]!; i < o.start[n + 1]!; i++) {
        const a = o.to[i]!;
        const dx = this.nodeCell[a]! - c;
        if (dx !== 1 && dx !== -1) continue;
        for (let j = o.start[n]!; j < o.start[n + 1]!; j++) {
          const b = o.to[j]!;
          const dy = this.nodeCell[b]! - c;
          if (dy !== cw && dy !== -cw) continue;
          for (let k = o.start[a]!; k < o.start[a + 1]!; k++) {
            const t = o.to[k]!;
            if (this.nodeCell[t] !== c + dx + dy || !linked(b, t)) continue;
            let dup = false;
            for (let m = first; m < diag.n; m++) if (diag.b[m] === t) dup = true;
            if (!dup) diag.push(n, t);
          }
        }
      }
    }
    // 4. One list per node: its orthogonal neighbours, then its diagonal ones.
    const all = new Pairs();
    for (let k = 0; k < ortho.n; k++) all.push(ortho.a[k]!, ortho.b[k]! * 2);
    for (let k = 0; k < diag.n; k++) all.push(diag.a[k]!, diag.b[k]! * 2 + 1);
    const e = adjacency(this.nodeCount, all);
    this.edgeStart = e.start;
    this.edgeTo = new Int32Array(e.to.length);
    this.edgeCost = new Float64Array(e.to.length);
    for (let k = 0; k < e.to.length; k++) {
      const m = e.to[k]! >> 1;
      this.edgeTo[k] = m;
      // Mild penalty near coasts keeps ships in open water; rivers are slow going.
      const rep = this.nodeRep[m]!;
      const river = map.terrain[rep] === T.River;
      const coastPenalty = !river && map.coastDist[rep]! < 2 ? 0.35 : 0;
      this.edgeCost[k] = (e.to[k]! & 1 ? 1.41421356 : 1) * (river ? RIVER_PATH_COST : 1) + coastPenalty;
    }
  }

  /** Node of a navigable tile (-1 when it is not navigable). */
  nodeOfTile(tile: number): number {
    if (!(this.map.navBody[tile]! > 0)) return -1;
    const W = this.map.width;
    const C = this.cell;
    const x = tile % W;
    const y = (tile / W) | 0;
    const cx = (x / C) | 0;
    const cy = (y / C) | 0;
    const l = (y - cy * C) * C + (x - cx * C);
    for (let n = this.cellFirst[cy * this.cw + cx]!; n !== -1; n = this.nodeNext[n]!) {
      if (l < 32 ? this.nodeLo[n]! & (1 << l) : this.nodeHi[n]! & (1 << (l - 32))) return n;
    }
    return -1;
  }

  /**
   * Naval path from tile `from` to tile `to` (both navigable, same naval body).
   * Returns a list of waypoint tiles (including both ends) or null when unreachable.
   * `maxExpand` bounds the search effort.
   */
  findPath(from: number, to: number, maxExpand = 400_000): number[] | null {
    return this.route([from], [to], maxExpand);
  }

  /**
   * Shortest naval path from any of `sources` to any of `targets` (navigable tiles; only
   * those on the naval body of the first target count) — OpenFront's multi-source water
   * search, which lets a transport leave from the shore nearest its landing by sea. The
   * path starts at the source it leaves from and ends at the target it reaches; targets
   * should lie close together (they steer the search). Null when unreachable.
   */
  route(sources: readonly number[], targets: readonly number[], maxExpand = 400_000): number[] | null {
    const map = this.map;
    const W = map.width;
    const cw = this.cw;
    const body = targets.length > 0 ? map.navBody[targets[0]!]! : 0;
    if (!(body > 0)) return null;
    const gen = ++this.gen;
    // Goal nodes, and the cells the heuristic aims at.
    const goalCells: number[] = [];
    for (const t of targets) {
      if (map.navBody[t] !== body) continue;
      const n = this.nodeOfTile(t);
      if (this.goal[n] === gen) continue;
      this.goal[n] = gen;
      goalCells.push(this.nodeCell[n]!);
    }
    const gx = goalCells.map((gc) => gc % cw);
    const gy = goalCells.map((gc) => (gc / cw) | 0);
    const octile = (dx: number, dy: number) => (dx > dy ? dx + 0.41421356 * dy : dy + 0.41421356 * dx);
    const h = (n: number) => {
      const c = this.nodeCell[n]!;
      const x = c % cw;
      const y = (c / cw) | 0;
      let best = octile(Math.abs(x - gx[0]!), Math.abs(y - gy[0]!));
      for (let k = 1; k < gx.length; k++)
        best = Math.min(best, octile(Math.abs(x - gx[k]!), Math.abs(y - gy[k]!)));
      return best;
    };
    let heapLen = 0;
    const push = (n: number, f: number) => {
      if (heapLen >= this.heapNodes.length) {
        const nn = new Int32Array(this.heapNodes.length * 2);
        nn.set(this.heapNodes);
        this.heapNodes = nn;
        const nf = new Float64Array(this.heapF.length * 2);
        nf.set(this.heapF);
        this.heapF = nf;
      }
      let k = heapLen++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (this.heapF[p]! <= f) break;
        this.heapNodes[k] = this.heapNodes[p]!;
        this.heapF[k] = this.heapF[p]!;
        k = p;
      }
      this.heapNodes[k] = n;
      this.heapF[k] = f;
    };
    const pop = (): number => {
      const top = this.heapNodes[0]!;
      const lastN = this.heapNodes[--heapLen]!;
      const lastF = this.heapF[heapLen]!;
      let k = 0;
      while (true) {
        let c = 2 * k + 1;
        if (c >= heapLen) break;
        if (c + 1 < heapLen && this.heapF[c + 1]! < this.heapF[c]!) c++;
        if (this.heapF[c]! >= lastF) break;
        this.heapNodes[k] = this.heapNodes[c]!;
        this.heapF[k] = this.heapF[c]!;
        k = c;
      }
      this.heapNodes[k] = lastN;
      this.heapF[k] = lastF;
      return top;
    };

    for (const s of sources) {
      if (map.navBody[s] !== body) continue;
      const n = this.nodeOfTile(s);
      if (this.stamp[n] === gen) continue;
      this.stamp[n] = gen;
      this.gScore[n] = 0;
      this.parent[n] = -1;
      push(n, h(n));
    }
    let expanded = 0;
    let found = -1;
    while (heapLen > 0) {
      const n = pop();
      if (this.closed[n] === gen) continue;
      this.closed[n] = gen;
      if (this.goal[n] === gen) {
        found = n;
        break;
      }
      if (++expanded > maxExpand) break;
      const gn = this.gScore[n]!;
      for (let k = this.edgeStart[n]!; k < this.edgeStart[n + 1]!; k++) {
        const m = this.edgeTo[k]!;
        if (this.closed[m] === gen) continue;
        const cost = gn + this.edgeCost[k]!;
        if (this.stamp[m] !== gen || cost < this.gScore[m]!) {
          this.stamp[m] = gen;
          this.gScore[m] = cost;
          this.parent[m] = n;
          push(m, cost + h(m));
        }
      }
    }
    if (found < 0) return null;
    const nodes: number[] = [];
    for (let n = found; n !== -1; n = this.parent[n]!) nodes.push(n);
    nodes.reverse();
    // In the end nodes, the source and the target nearest the rest of the route.
    const nearest = (tiles: readonly number[], node: number, toward: number) => {
      const tx = toward % W;
      const ty = (toward / W) | 0;
      let best = -1;
      let bestD = Infinity;
      for (const t of tiles) {
        if (map.navBody[t] !== body || this.nodeOfTile(t) !== node) continue;
        const d = ((t % W) - tx) ** 2 + (((t / W) | 0) - ty) ** 2;
        if (d < bestD) {
          best = t;
          bestD = d;
        }
      }
      return best;
    };
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const to = nearest(targets, last, this.nodeRep[nodes.length > 1 ? nodes[nodes.length - 2]! : last]!);
    const from = nearest(sources, first, nodes.length > 1 ? this.nodeRep[nodes[1]!]! : to);
    const raw: number[] = [from];
    for (let k = 1; k < nodes.length - 1; k++) raw.push(this.nodeRep[nodes[k]!]!);
    raw.push(to);
    return this.smooth(this.refine(raw));
  }

  /**
   * Legs between consecutive waypoints that would cross land (a river meandering through
   * its cells, a headland) are replaced by the tile route found by a small BFS around them.
   */
  private refine(path: number[]): number[] {
    const out: number[] = [path[0]!];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!;
      const b = path[k]!;
      if (!this.lineOfWater(a, b)) {
        const leg = this.localRoute(a, b, this.cell * 2) ?? this.localRoute(a, b, this.cell * 8);
        if (leg) for (let j = 1; j < leg.length - 1; j++) out.push(leg[j]!);
      }
      out.push(b);
    }
    return out;
  }

  // Local BFS scratch (generation-stamped).
  private bfsSeen = new Uint32Array(0);
  private bfsPrev = new Int32Array(0);
  private bfsQueue = new Int32Array(0);
  private bfsGen = 0;

  /** 4-connected route over the naval body between a and b inside their bounding box ± margin. */
  private localRoute(a: number, b: number, margin: number): number[] | null {
    const map = this.map;
    const W = map.width;
    const ax = a % W;
    const ay = (a / W) | 0;
    const bx = b % W;
    const by = (b / W) | 0;
    const x0 = Math.max(0, Math.min(ax, bx) - margin);
    const y0 = Math.max(0, Math.min(ay, by) - margin);
    const x1 = Math.min(W - 1, Math.max(ax, bx) + margin);
    const y1 = Math.min(map.height - 1, Math.max(ay, by) + margin);
    const bw = x1 - x0 + 1;
    const n = bw * (y1 - y0 + 1);
    if (this.bfsSeen.length < n) {
      this.bfsSeen = new Uint32Array(n);
      this.bfsPrev = new Int32Array(n);
      this.bfsQueue = new Int32Array(n);
      this.bfsGen = 0;
    }
    const gen = ++this.bfsGen;
    const seen = this.bfsSeen;
    const prev = this.bfsPrev;
    const q = this.bfsQueue;
    const body = map.navBody[a]!;
    const local = (t: number) => (((t / W) | 0) - y0) * bw + ((t % W) - x0);
    let qh = 0;
    let qt = 0;
    seen[local(a)] = gen;
    prev[local(a)] = -1;
    q[qt++] = a;
    let found = false;
    while (qh < qt) {
      const t = q[qh++]!;
      if (t === b) {
        found = true;
        break;
      }
      const x = t % W;
      const y = (t / W) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d]![0];
        const ny = y + DIRS[d]![1];
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const j = ny * W + nx;
        const lj = (ny - y0) * bw + (nx - x0);
        if (seen[lj] === gen || map.navBody[j] !== body) continue;
        seen[lj] = gen;
        prev[lj] = t;
        q[qt++] = j;
      }
    }
    if (!found) return null;
    const route: number[] = [];
    for (let t = b; t !== -1; t = prev[local(t)]!) route.push(t);
    return route.reverse();
  }

  /** Greedy string pulling with water line-of-sight (bounded look-ahead). */
  private smooth(path: number[]): number[] {
    if (path.length <= 2) return path;
    const out: number[] = [path[0]!];
    let i = 0;
    while (i < path.length - 1) {
      let j = Math.min(path.length - 1, i + 48);
      while (j > i + 1 && !this.lineOfWater(path[i]!, path[j]!)) j--;
      out.push(path[j]!);
      i = j;
    }
    return out;
  }

  /**
   * Bresenham walk: true if every tile between a and b belongs to a's naval body. Any
   * navigable tile was accepted before: the walk's diagonal steps slip between two land
   * corners, so a leg could cross a lake or river of another body and leave a ship
   * stranded there (no route from that body back to its patrol).
   */
  lineOfWater(a: number, b: number): boolean {
    const W = this.map.width;
    let x0 = a % W;
    let y0 = (a / W) | 0;
    const x1 = b % W;
    const y1 = (b / W) | 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const nav = this.map.navBody;
    const body = nav[a]!;
    if (body <= 0) return false;
    while (true) {
      if (nav[y0 * W + x0] !== body) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
}

/** Length of a waypoint polyline in tiles. */
export function pathLength(path: readonly number[], width: number): number {
  let len = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]!;
    const b = path[k]!;
    len += Math.hypot((a % width) - (b % width), ((a / width) | 0) - ((b / width) | 0));
  }
  return len;
}
