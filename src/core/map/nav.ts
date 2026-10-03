// Coarse naval navigation graph. The navigable grid (water, plus the rivers that flow
// into it) is split in C×C cells; each (cell, naval body) pair is a node whose
// representative is the navigable tile closest to the cell centre. A* runs on nodes
// (8-connected, no corner cutting); legs that leave the water (a river winding through
// a cell, a cape) are retraced tile by tile, and the result is string-pulled with
// fine-grid line-of-sight checks.
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

export class NavGrid {
  readonly cell: number;
  readonly cw: number;
  readonly ch: number;
  private readonly map: GameMap;
  /** First node of each cell (-1 none); nodes in a cell are chained through nodeNext. */
  private readonly cellFirst: Int32Array;
  private nodeCell: Int32Array;
  private nodeBody: Int32Array;
  private nodeRep: Int32Array;
  private nodeNext: Int32Array;
  private nodeEdges: Uint8Array;
  nodeCount = 0;

  // A* scratch buffers (generation-stamped, reused between searches).
  private gScore: Float64Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
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
    this.nodeBody = new Int32Array(cap);
    this.nodeRep = new Int32Array(cap);
    this.nodeNext = new Int32Array(cap);
    this.nodeEdges = new Uint8Array(cap);
    this.build();
    const n = this.nodeCount;
    this.gScore = new Float64Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
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
    this.nodeBody = g(this.nodeBody);
    this.nodeRep = g(this.nodeRep);
    this.nodeNext = g(this.nodeNext);
    const e = new Uint8Array(cap);
    e.set(this.nodeEdges);
    this.nodeEdges = e;
  }

  private build(): void {
    const { map, cell: C, cw, ch } = this;
    const W = map.width;
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const x0 = cx * C;
        const y0 = cy * C;
        const x1 = Math.min(map.width, x0 + C);
        const y1 = Math.min(map.height, y0 + C);
        const mx = (x0 + x1 - 1) / 2;
        const my = (y0 + y1 - 1) / 2;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = y * W + x;
            const body = map.navBody[i]!;
            if (body <= 0) continue;
            const c = cy * cw + cx;
            let n = this.cellFirst[c]!;
            while (n !== -1 && this.nodeBody[n] !== body) n = this.nodeNext[n]!;
            const d = (x - mx) ** 2 + (y - my) ** 2;
            if (n === -1) {
              if (this.nodeCount >= this.nodeCell.length) this.grow();
              n = this.nodeCount++;
              this.nodeCell[n] = c;
              this.nodeBody[n] = body;
              this.nodeRep[n] = i;
              this.nodeNext[n] = this.cellFirst[c]!;
              this.cellFirst[c] = n;
            } else {
              const r = this.nodeRep[n]!;
              const rd = ((r % W) - mx) ** 2 + (((r / W) | 0) - my) ** 2;
              if (d < rd) this.nodeRep[n] = i;
            }
          }
        }
      }
    }
    // Orthogonal edges: some water tile of the body touches the shared cell boundary.
    for (let n = 0; n < this.nodeCount; n++) {
      const c = this.nodeCell[n]!;
      const cx = c % cw;
      const cy = (c / cw) | 0;
      let mask = 0;
      for (let d = 0; d < 4; d++) {
        const [dx, dy] = DIRS[d]!;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        if (this.orthoConnected(cx, cy, dx, dy, this.nodeBody[n]!)) mask |= 1 << d;
      }
      this.nodeEdges[n] = mask;
    }
    // Diagonal edges only when both orthogonal detours exist (no corner cutting).
    for (let n = 0; n < this.nodeCount; n++) {
      const c = this.nodeCell[n]!;
      const cx = c % cw;
      const cy = (c / cw) | 0;
      const body = this.nodeBody[n]!;
      let mask = this.nodeEdges[n]!;
      for (let d = 4; d < 8; d++) {
        const [dx, dy] = DIRS[d]!;
        const hx = dx > 0 ? 0 : 1;
        const vy = dy > 0 ? 2 : 3;
        const hBit = 1 << hx;
        const vBit = 1 << vy;
        if (!(mask & hBit) || !(mask & vBit)) continue;
        const a = this.nodeAt(cx + dx, cy, body);
        const b = this.nodeAt(cx, cy + dy, body);
        const t = this.nodeAt(cx + dx, cy + dy, body);
        if (a === -1 || b === -1 || t === -1) continue;
        if (this.nodeEdges[a]! & vBit && this.nodeEdges[b]! & hBit) mask |= 1 << d;
      }
      this.nodeEdges[n] = mask;
    }
  }

  private orthoConnected(cx: number, cy: number, dx: number, dy: number, body: number): boolean {
    const { map, cell: C } = this;
    const W = map.width;
    if (dx !== 0) {
      const xa = dx > 0 ? Math.min(map.width - 1, cx * C + C - 1) : cx * C;
      const xb = xa + dx;
      if (xb < 0 || xb >= map.width) return false;
      for (let y = cy * C; y < Math.min(map.height, cy * C + C); y++) {
        const a = y * W + xa;
        const b = y * W + xb;
        if (map.navBody[a] === body && map.navBody[b] === body) return true;
      }
    } else {
      const ya = dy > 0 ? Math.min(map.height - 1, cy * C + C - 1) : cy * C;
      const yb = ya + dy;
      if (yb < 0 || yb >= map.height) return false;
      for (let x = cx * C; x < Math.min(map.width, cx * C + C); x++) {
        const a = ya * W + x;
        const b = yb * W + x;
        if (map.navBody[a] === body && map.navBody[b] === body) return true;
      }
    }
    return false;
  }

  nodeAt(cx: number, cy: number, body: number): number {
    if (cx < 0 || cy < 0 || cx >= this.cw || cy >= this.ch) return -1;
    let n = this.cellFirst[cy * this.cw + cx]!;
    while (n !== -1 && this.nodeBody[n] !== body) n = this.nodeNext[n]!;
    return n;
  }

  nodeOfTile(tile: number): number {
    const W = this.map.width;
    const body = this.map.navBody[tile]!;
    return this.nodeAt(((tile % W) / this.cell) | 0, (((tile / W) | 0) / this.cell) | 0, body);
  }

  /**
   * Naval path from tile `from` to tile `to` (both navigable, same naval body).
   * Returns a list of waypoint tiles (including both ends) or null when unreachable.
   * `maxExpand` bounds the search effort.
   */
  findPath(from: number, to: number, maxExpand = 400_000): number[] | null {
    const map = this.map;
    if (!map.isNavigable(from) || !map.isNavigable(to)) return null;
    if (map.navBody[from] !== map.navBody[to]) return null;
    const s = this.nodeOfTile(from);
    const g = this.nodeOfTile(to);
    if (s === -1 || g === -1) return null;
    if (s === g) return this.smooth(this.refine([from, to]));

    const gen = ++this.gen;
    const cw = this.cw;
    const gc = this.nodeCell[g]!;
    const gx = gc % cw;
    const gy = (gc / cw) | 0;
    const h = (n: number) => {
      const c = this.nodeCell[n]!;
      const dx = Math.abs((c % cw) - gx);
      const dy = Math.abs(((c / cw) | 0) - gy);
      return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
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

    this.stamp[s] = gen;
    this.gScore[s] = 0;
    this.parent[s] = -1;
    push(s, h(s));
    let expanded = 0;
    let found = false;
    while (heapLen > 0) {
      const n = pop();
      if (this.closed[n] === gen) continue;
      this.closed[n] = gen;
      if (n === g) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const c = this.nodeCell[n]!;
      const cx = c % cw;
      const cy = (c / cw) | 0;
      const body = this.nodeBody[n]!;
      const edges = this.nodeEdges[n]!;
      const gn = this.gScore[n]!;
      for (let d = 0; d < 8; d++) {
        if (!(edges & (1 << d))) continue;
        const [dx, dy] = DIRS[d]!;
        const m = this.nodeAt(cx + dx, cy + dy, body);
        if (m === -1 || this.closed[m] === gen) continue;
        // Mild penalty near coasts keeps ships in open water; rivers are slow going.
        const rep = this.nodeRep[m]!;
        const river = this.map.terrain[rep] === T.River;
        const coastPenalty = !river && this.map.coastDist[rep]! < 2 ? 0.35 : 0;
        const cost = gn + (d < 4 ? 1 : 1.41421356) * (river ? RIVER_PATH_COST : 1) + coastPenalty;
        if (this.stamp[m] !== gen || cost < this.gScore[m]!) {
          this.stamp[m] = gen;
          this.gScore[m] = cost;
          this.parent[m] = n;
          push(m, cost + h(m));
        }
      }
    }
    if (!found) return null;
    const nodes: number[] = [];
    for (let n = g; n !== -1; n = this.parent[n]!) nodes.push(n);
    nodes.reverse();
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
