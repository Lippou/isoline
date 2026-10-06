// Front lines (1.17, GAME_DESIGN.md §6.6): the defence post gives way to lines a player
// draws on their own land (a drag from one point to another, or click after click) and
// garrisons with troops — the attack ratio of the army, never gold. A line faces one side,
// chosen after drawing; its back is bare.
// - Defensive: what attacks the land in front of it (LINE_REACH tiles) from the front is
//   slowed (tile cost up to ×LINE_DEFENSE_SPEED) and meets the line's troops too.
// - Offensive: once dug in (LINE_OFFENSE_SETUP), the owner's attacks pushing out from it
//   lose up to LINE_OFFENSE_LOSS fewer troops in front of it.
// Both act in full while the line holds LINE_FULL_DENSITY × the country's troops per tile,
// proportionally below. Its troops leave the army and lower the troop ceiling as long as it
// stands; taking it down brings them back. A tile of the line taken by anyone loses its
// share of them, and the stretch round it stops covering (a breach).
// 1.18: a defensive line is laid in 3 s and lets nothing through head-on while it holds
// troops (lineHolds: each push at it costs the attacker its losses and the line a third
// of them, the attacker's 3-to-1 against a dug-in position); the troops on a line can be changed (setLineTroops); an emptied line stays,
// holding nothing, until it is refilled or taken down.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import { IS_LAND } from '../map/terrain';
import {
  LINE_DEFENSE_SETUP,
  LINE_DEFENSE_SPEED,
  LINE_HOLD_TRADE,
  LINE_FULL_DENSITY,
  LINE_MAX_PER_PLAYER,
  LINE_MAX_POINTS,
  LINE_MAX_TILES,
  LINE_MIN_TILES,
  LINE_OFFENSE_LOSS,
  LINE_OFFENSE_SETUP,
  LINE_REACH,
} from '../game/constants';

export const enum LineKind {
  Defensive = 0,
  Offensive = 1,
}

export interface FrontLine {
  id: number;
  owner: number;
  kind: LineKind;
  /** Vertices as drawn, flat [x0, y0, x1, y1, …] in tiles (tile centres). */
  pts: number[];
  /** The side it faces: the sign of sideOf() on that side. */
  side: 1 | -1;
  troops: number;
  /** Tiles it stands on that its owner still holds. */
  tiles: number[];
  /** Tick it takes effect (an offensive line digs in first). */
  readyTick: number;
}

/** Derived (never saved): bounding boxes (with the reach) and the lines of each owner. */
interface Index {
  version: number;
  byOwner: Map<number, FrontLine[]>;
  box: Map<number, [number, number, number, number]>;
}
const indexes = new WeakMap<Game, Index>();

function index(game: Game): Index {
  const cur = indexes.get(game);
  if (cur && cur.version === game.linesVersion) return cur;
  const byOwner = new Map<number, FrontLine[]>();
  const box = new Map<number, [number, number, number, number]>();
  for (const l of game.lines) {
    let list = byOwner.get(l.owner);
    if (!list) byOwner.set(l.owner, (list = []));
    list.push(l);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < l.pts.length; i += 2) {
      x0 = Math.min(x0, l.pts[i]!);
      x1 = Math.max(x1, l.pts[i]!);
      y0 = Math.min(y0, l.pts[i + 1]!);
      y1 = Math.max(y1, l.pts[i + 1]!);
    }
    const m = LINE_REACH + 2;
    box.set(l.id, [x0 - m, y0 - m, x1 + m, y1 + m]);
  }
  const ix = { version: game.linesVersion, byOwner, box };
  indexes.set(game, ix);
  return ix;
}

export function linesOf(game: Game, owner: number): readonly FrontLine[] {
  return index(game).byOwner.get(owner) ?? [];
}

/**
 * Where (x, y) lies against the polyline `pts`: the signed distance to its nearest segment
 * (positive on its left as drawn, y pointing down the map), whether that segment's
 * perpendicular falls on it (not past either end of the whole line), and the nearest point.
 */
export function locate(
  pts: readonly number[],
  x: number,
  y: number,
): { sd: number; inside: boolean; px: number; py: number } {
  let best = Infinity;
  let out = { sd: 0, inside: false, px: pts[0]!, py: pts[1]! };
  const last = pts.length / 2 - 2;
  for (let i = 0; i <= last; i++) {
    const ax = pts[2 * i]!;
    const ay = pts[2 * i + 1]!;
    const dx = pts[2 * i + 2]! - ax;
    const dy = pts[2 * i + 3]! - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = ((x - ax) * dx + (y - ay) * dy) / len2;
    const tc = Math.min(1, Math.max(0, t));
    const px = ax + tc * dx;
    const py = ay + tc * dy;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d >= best) continue;
    best = d;
    out = {
      sd: ((x - ax) * dy - (y - ay) * dx) / Math.sqrt(len2),
      inside: !((i === 0 && t < 0) || (i === last && t > 1)),
      px,
      py,
    };
  }
  return out;
}

/** The side of the drawn line (x, y) is on: what the player picks after drawing. */
export function sideOf(pts: readonly number[], x: number, y: number): 1 | -1 {
  return locate(pts, x, y).sd >= 0 ? 1 : -1;
}

/** The tiles a drawing crosses (tile centres along every segment), in order, once each. */
export function traceTiles(w: number, h: number, pts: readonly number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [ax, ay, bx, by] = [pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(ax + ((bx - ax) * k) / n);
      const y = Math.floor(ay + ((by - ay) * k) / n);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const t = y * w + x;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Whether the line still stands at its point nearest to (px, py): a tile of it held there. */
function heldNear(game: Game, l: FrontLine, px: number, py: number): boolean {
  const w = game.map.width;
  const x = Math.floor(px);
  const y = Math.floor(py);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (x + dx < 0 || x + dx >= w) continue;
      if (game.lineAt.get((y + dy) * w + x + dx) === l.id) return true;
    }
  return false;
}

/** How fully a line acts (0–1): its troops per tile against LINE_FULL_DENSITY × its country's. */
export function lineStrength(game: Game, l: FrontLine): number {
  const p = game.players[l.owner];
  if (!p || l.tiles.length === 0 || l.troops <= 0) return 0;
  const country = (p.troops + p.lineTroops) / Math.max(1, p.tiles);
  return Math.min(1, l.troops / l.tiles.length / Math.max(1e-6, LINE_FULL_DENSITY * country));
}

/**
 * The line of `owner` of `kind` that covers `tile` for an attack by `attacker`, with where
 * the tile sits in front of it — or null. A tile is covered within LINE_REACH tiles in front
 * of a stretch of the line still held (a defensive line also covers its own tiles, sd −1).
 * `from`: the attacker comes from the front (defence: a neighbour of the attacker farther
 * out) or pushes out from behind (offence: a neighbour of the attacker nearer the line);
 * attacker −1: whoever comes.
 */
function cover(game: Game, owner: number, kind: LineKind, tile: number, attacker: number): FrontLine | null {
  const lines = linesOf(game, owner);
  if (lines.length === 0) return null;
  const w = game.map.width;
  const x = (tile % w) + 0.5;
  const y = ((tile / w) | 0) + 0.5;
  const boxes = index(game).box;
  for (const l of lines) {
    if (l.kind !== kind || l.readyTick > game.tick) continue;
    const [x0, y0, x1, y1] = boxes.get(l.id)!;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const at = locate(l.pts, x, y);
    const sd = at.sd * l.side;
    if (!at.inside || sd > LINE_REACH || sd < (kind === LineKind.Defensive ? -1 : 0)) continue;
    if (!heldNear(game, l, at.px, at.py)) continue;
    if (attacker < 0 || attackerSide(game, l, tile, attacker, sd)) return l;
  }
  return null;
}

/**
 * Whether the attacker reaches `tile` (at sd in front of l) from the side the line expects,
 * by at least `margin` tiles across it (a push along the line is not head-on).
 */
function attackerSide(
  game: Game,
  l: FrontLine,
  tile: number,
  attacker: number,
  sd: number,
  margin = 0,
): boolean {
  const map = game.map;
  const w = map.width;
  const n = map.neighbors4(tile, NB);
  for (let j = 0; j < n; j++) {
    const v = NB[j]!;
    if (game.owner[v] !== attacker) continue;
    const vsd = locate(l.pts, (v % w) + 0.5, ((v / w) | 0) + 0.5).sd * l.side;
    if (l.kind === LineKind.Defensive ? vsd > sd + margin : vsd < sd - margin) return true;
  }
  return false;
}
const NB = new Int32Array(4);

/**
 * A defensive line of `target` in the way of `attacker` taking `tile`: the slowdown on the
 * tile's cost and the line's troops (they stand in the clash), or null.
 */
export function lineDefense(
  game: Game,
  tile: number,
  target: number,
  attacker: number,
): { speed: number; troops: number } | null {
  if (target <= 0) return null;
  const l = cover(game, target, LineKind.Defensive, tile, attacker);
  if (!l) return null;
  const s = lineStrength(game, l);
  // The Rampart general doubles what its lines hold back for 30 s (rules/features.ts).
  const rampart = game.players[target]!.rampartUntil > game.tick ? 2 : 1;
  return { speed: 1 + (LINE_DEFENSE_SPEED - 1) * s * rampart, troops: l.troops };
}

/** The share of its usual losses `attacker` loses taking `tile` (owned by someone) out of its offensive lines. */
export function lineOffenseMult(game: Game, tile: number, attacker: number): number {
  const l = cover(game, attacker, LineKind.Offensive, tile, attacker);
  return l ? 1 - LINE_OFFENSE_LOSS * lineStrength(game, l) : 1;
}

/** Whether a defensive line of the tile's owner covers it (the tile's hover card). */
export function lineDefended(game: Game, tile: number): boolean {
  const owner = game.owner[tile]!;
  return owner > 0 && cover(game, owner, LineKind.Defensive, tile, -1) !== null;
}

/**
 * A straight line across the way of `enemy` at `contact` (a tile on the common border):
 * `back` tiles inside p's land, `half` tiles either side, square to where the enemy's land
 * lies round the contact, facing it — what the nations (npc/ai.ts) lay. Null when the
 * contact has no clear front.
 */
export function lineAcross(
  game: Game,
  p: Player,
  contact: number,
  enemy: number,
  back: number,
  half: number,
): { pts: number[]; side: 1 | -1 } | null {
  const map = game.map;
  const w = map.width;
  const x0 = contact % w;
  const y0 = (contact / w) | 0;
  const look = 8;
  let [ex, ey, ne, ox, oy, no] = [0, 0, 0, 0, 0, 0];
  for (let dy = -look; dy <= look; dy += 2)
    for (let dx = -look; dx <= look; dx += 2) {
      if (!map.inBounds(x0 + dx, y0 + dy)) continue;
      const o = game.owner[(y0 + dy) * w + x0 + dx];
      if (o === enemy) [ex, ey, ne] = [ex + dx, ey + dy, ne + 1];
      else if (o === p.id) [ox, oy, no] = [ox + dx, oy + dy, no + 1];
    }
  if (ne === 0 || no === 0) return null;
  let [dx, dy] = [ex / ne - ox / no, ey / ne - oy / no];
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return null;
  [dx, dy] = [dx / d, dy / d];
  const mx = x0 + 0.5 - dx * back;
  const my = y0 + 0.5 - dy * back;
  const cx = (v: number) => Math.min(w - 0.5, Math.max(0.5, Math.round(v * 2) / 2));
  const cy = (v: number) => Math.min(map.height - 0.5, Math.max(0.5, Math.round(v * 2) / 2));
  const pts = [cx(mx + dy * half), cy(my - dx * half), cx(mx - dy * half), cy(my + dx * half)];
  return { pts, side: sideOf(pts, mx + dx * 4, my + dy * 4) };
}

/**
 * A head-on push of `attacker` at `tile`, a tile of a defensive line of `target` that is laid
 * and holds troops: the line that stops it, or null (taken from the side, from behind, or
 * once the line is empty, the tile falls as any other). "Head-on": a neighbour of the
 * attacker LINE_HEAD_ON tiles or more out in front of it (a push within ~70° of square on).
 */
export function lineHolds(game: Game, tile: number, target: number, attacker: number): FrontLine | null {
  const id = game.lineAt.get(tile);
  if (id === undefined) return null;
  const l = game.lines.find((x) => x.id === id);
  if (!l || l.owner !== target || l.kind !== LineKind.Defensive || l.readyTick > game.tick || l.troops < 1)
    return null;
  const w = game.map.width;
  const sd = locate(l.pts, (tile % w) + 0.5, ((tile / w) | 0) + 0.5).sd * l.side;
  return attackerSide(game, l, tile, attacker, sd, LINE_HEAD_ON) ? l : null;
}
const LINE_HEAD_ON = 0.35;

/** The line stood a push that cost the attacker `loss`: it loses 1 / LINE_HOLD_TRADE of it. */
export function lineTakesHit(game: Game, l: FrontLine, loss: number): number {
  const hit = Math.min(l.troops, loss / LINE_HOLD_TRADE);
  l.troops -= hit;
  const p = game.players[l.owner];
  if (p) {
    p.lineTroops = Math.max(0, p.lineTroops - hit);
    p.stats.troopsLost += hit;
  }
  if (l.troops < 1) {
    if (p) p.lineTroops = Math.max(0, p.lineTroops - l.troops);
    l.troops = 0;
    game.notify(l.owner, 'notify.lineEmpty', 'warn', {}, l.tiles[l.tiles.length >> 1]);
  }
  game.linesVersion++;
  return hit;
}

/**
 * Sets the troops on one of p's lines (the command 'lineTroops'): more come from the army
 * (as many as it has), fewer go back to it. 0 leaves an empty line.
 */
export function setLineTroops(game: Game, p: Player, l: FrontLine, troops: number): void {
  const want = Math.max(0, troops);
  const delta = want > l.troops ? Math.min(want - l.troops, p.troops) : want - l.troops;
  if (Math.abs(delta) < 1e-9) return;
  l.troops += delta;
  p.troops -= delta;
  p.lineTroops = Math.max(0, p.lineTroops + delta);
  game.linesVersion++;
}

export type LineError = 'phase' | 'max' | 'short' | 'troops' | 'points';

/** Lays a line for p (the command 'line'); its troops: `ratio` of the army. */
export function placeLine(
  game: Game,
  p: Player,
  kind: LineKind,
  pts: readonly number[],
  side: 1 | -1,
  ratio: number,
): FrontLine | LineError {
  if (game.phase !== 'playing') return 'phase';
  if (pts.length < 4 || pts.length > 2 * LINE_MAX_POINTS || pts.length % 2) return 'points';
  if (linesOf(game, p.id).length >= LINE_MAX_PER_PLAYER) return 'max';
  const map = game.map;
  const tiles: number[] = [];
  for (const t of traceTiles(map.width, map.height, pts)) {
    if (game.owner[t] !== p.id || !IS_LAND[map.terrain[t]!] || game.lineAt.has(t)) continue;
    tiles.push(t);
    if (tiles.length >= LINE_MAX_TILES) break;
  }
  if (tiles.length < LINE_MIN_TILES) return 'short';
  const troops = p.troops * ratio;
  if (troops < tiles.length) return 'troops';
  p.troops -= troops;
  p.lineTroops += troops;
  const l: FrontLine = {
    id: game.nextId(),
    owner: p.id,
    kind,
    pts: pts.slice(),
    side,
    troops,
    tiles,
    readyTick: game.tick + (kind === LineKind.Offensive ? LINE_OFFENSE_SETUP : LINE_DEFENSE_SETUP),
  };
  game.lines.push(l);
  for (const t of tiles) game.lineAt.set(t, l.id);
  game.linesVersion++;
  return l;
}

/** Takes a line down: its troops come back to the army (`refund`) or are lost with it. */
export function removeLine(game: Game, l: FrontLine, refund: boolean): void {
  const i = game.lines.indexOf(l);
  if (i < 0) return;
  game.lines.splice(i, 1);
  for (const t of l.tiles) if (game.lineAt.get(t) === l.id) game.lineAt.delete(t);
  const p = game.players[l.owner];
  if (p) {
    p.lineTroops = Math.max(0, p.lineTroops - l.troops);
    if (refund && p.alive) p.troops += l.troops;
  }
  game.linesVersion++;
}

/** A tile of a line changed hands (Game.setOwner): its share of the troops is lost. */
export function lineTileLost(game: Game, tile: number): void {
  const id = game.lineAt.get(tile);
  game.lineAt.delete(tile);
  const l = game.lines.find((x) => x.id === id);
  if (!l) return;
  const k = l.tiles.indexOf(tile);
  if (k >= 0) l.tiles.splice(k, 1);
  const share = l.troops / (l.tiles.length + 1);
  l.troops -= share;
  const p = game.players[l.owner];
  if (p) p.lineTroops = Math.max(0, p.lineTroops - share);
  game.linesVersion++;
  if (l.tiles.length === 0) removeLine(game, l, false);
}

/** Every tick: an offensive line that has dug in tells its owner (a defensive one is laid in 3 s: no news). */
export function updateLines(game: Game): void {
  for (const l of game.lines)
    if (l.kind === LineKind.Offensive && l.readyTick === game.tick)
      game.notify(l.owner, 'notify.lineReady', 'good', {}, l.tiles[l.tiles.length >> 1]);
}

/** After a save is restored: the tile index of the lines. */
export function rebuildLineIndex(game: Game): void {
  game.lineAt.clear();
  for (const l of game.lines) for (const t of l.tiles) game.lineAt.set(t, l.id);
  game.linesVersion++;
}
