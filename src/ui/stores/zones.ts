// The HUD's zones (1.9.0): where every piece of the in-game interface may stand, so that
// nothing overlaps on any screen. Pure functions (the reactive part: layout.svelte.ts).
//
//   ┌──────┬────────────┬──────────── top strip ────────────┬──────────────┐
//   │ dock │ news       │  top bar, spawn countdown,        │ leaderboard  │
//   │ rail │ column     │  captions                         │              │
//   │      │ (council,  ├───────────────────────────────────┤ right column │
//   │      │ nuclear    │                                   │ (launch      │
//   │      │ alerts,    │            the stage              │ panel,       │
//   │      │ capital,   │   (the map; windows open here)    │ alliance     │
//   │      │ flash,     │                                   │ offers)      │
//   │      │ alliances) ├───────────────────────────────────┤              │
//   ├──────┴──────┬─────┘ bottom strip: research reminder,  │              │
//   │ resources   │       mission dock, build / replay bar  │   minimap    │
//   └─────────────┴───────────────────────────────────────────┴──────────────┘
//
// The stage is what the zones leave. Windows open in it and never cover a zone. When a
// column lacks height, its pieces give way by priority (allocate): the least important
// first go compact (one line), then become chips; urgent pieces stay whole.
// Reading mode (a big window: the technology planche, the journal, any window the player
// maximises): the window takes the screen, the columns fold into a slim strip at the top
// (gold, troops, time, urgent chips) and the dock rail stays at the left edge.
// The player's folds (1.10.0): every panel over the map can be folded by hand, and stays
// so from one game to the next (folds.svelte.ts). A folded piece of a column is printed at
// its fold level at most (the room it leaves goes to the others); the right column, its
// leaderboard and minimap both folded and nothing else in it, shrinks to a slim strip of
// tabs and the stage takes the width it leaves; the build bar and the resources panel fold
// to a strip, and the zones read their new heights.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin from the screen's edges, and between zones (CSS pixels). */
export const MARGIN = 12;
export const GAP = 10;
/** Between the pieces of a column. */
export const ITEM_GAP = 8;
/** A line of chips at the foot of a column. */
export const CHIP_ROW = 28;

/**
 * The three layouts, by the width left in CSS pixels once the interface scale (page zoom)
 * is applied: wide from 1920 (roomy columns, windows side by side), compact up to 1440
 * (narrower columns, the dock's icons only), standard between.
 */
export type LayoutClass = 'wide' | 'standard' | 'compact';
export function layoutClass(w: number): LayoutClass {
  return w >= 1920 ? 'wide' : w <= 1440 ? 'compact' : 'standard';
}

export interface ClassSizes {
  /** Width of the news column's cards. */
  card: number;
  /** Width of the right column (leaderboard, dispatches, offers, minimap). */
  right: number;
  /** Width of the resources panel. */
  res: number;
  /** The dock shows its sections' names (otherwise icons only, names in tooltips). */
  railLabels: boolean;
}
export function classSizes(cls: LayoutClass, w: number): ClassSizes {
  if (cls === 'wide') return { card: 330, right: 340, res: 300, railLabels: true };
  if (cls === 'compact') return { card: 268, right: 272, res: 262, railLabels: false };
  return { card: 300, right: 310, res: w > 1600 ? 290 : 262, railLabels: true };
}

/** What the zones are computed from: the window and the measured pieces (0: not shown). */
export interface ZoneInput {
  /** The window in CSS pixels. */
  w: number;
  h: number;
  /** Outer width of the dock rail (0: no rail). */
  railW: number;
  /** Height of the top bar from the window's top (its status line included). */
  topH: number;
  /** Resources panel (bottom left): its height (0: not shown). */
  resH: number;
  /** The build bar or the replay bar (bottom centre): its height (0: none). */
  barH: number;
  /** Room kept over the bar for the research reminder (0: none). */
  nudgeH: number;
  /** Band kept free at the bottom by the mission dock, from the window's bottom edge (0: none). */
  bottomReserve: number;
  /** Reading mode: a big window is open. */
  reading: boolean;
  /** The right column folded to a strip of tabs this wide (0 or absent: at its full width). */
  rightSlim?: number;
  /** Height of the reading strip (reading mode). */
  stripH: number;
}

export interface Zones {
  cls: LayoutClass;
  sizes: ClassSizes;
  reading: boolean;
  /** The dock rail's column (it is centred in it). */
  rail: Rect;
  /** The news column (left, beside the rail; empty in reading mode). */
  left: Rect;
  /** The right column, whole: the leaderboard at its head, the minimap at its foot. */
  right: Rect;
  /** The top strip (top bar, captions), across the centre band. */
  top: Rect;
  /** The bottom strip over the centre band (research reminder, mission dock, bars). */
  bottom: Rect;
  /** Where the build bar may stretch (left and right edges). */
  bar: { x: number; w: number };
  /** The centre band, between the columns. */
  band: { x: number; w: number };
  /** The map's stage: windows open in it. In reading mode, the whole room under the strip. */
  stage: Rect;
  /** The reading strip (reading mode), else an empty rect. */
  strip: Rect;
}

const EMPTY: Rect = { x: 0, y: 0, w: 0, h: 0 };
const nonNeg = (v: number) => Math.max(0, Math.round(v));

/** The zones of the HUD for a window and the sizes of its pieces. */
export function computeZones(i: ZoneInput): Zones {
  const cls = layoutClass(i.w);
  const sizes = classSizes(cls, i.w);
  const railRight = i.railW > 0 ? MARGIN + i.railW : 2;
  if (i.reading) {
    const strip = { x: MARGIN, y: MARGIN, w: nonNeg(i.w - 2 * MARGIN), h: nonNeg(i.stripH) };
    const top = strip.y + strip.h + GAP;
    // (The mission dock stays readable under the window.)
    const foot = i.h - (i.bottomReserve > 0 ? i.bottomReserve + GAP : MARGIN);
    const rail = { x: MARGIN, y: top, w: nonNeg(i.railW), h: nonNeg(i.h - MARGIN - top) };
    const x = railRight + GAP;
    const stage = { x, y: top, w: nonNeg(i.w - MARGIN - x), h: nonNeg(foot - top) };
    return {
      cls,
      sizes,
      reading: true,
      rail,
      left: { ...EMPTY },
      right: { ...EMPTY },
      top: { ...EMPTY },
      bottom: { ...EMPTY },
      bar: { x: 0, w: 0 },
      band: { x: stage.x, w: stage.w },
      stage,
      strip,
    };
  }
  // The columns: the rail and the news column above the resources panel, the right one
  // from top to bottom.
  const leftFoot = i.resH > 0 ? i.h - MARGIN - i.resH - GAP : i.h - MARGIN;
  const leftX = railRight + GAP;
  // The build bar may stretch under the news column (from the resources panel's edge): with
  // the panel folded to its strip, the column stops above the bar.
  const barUnder = i.resH > 0 && i.barH > 0 && MARGIN + sizes.res + GAP < leftX + sizes.card;
  const cardFoot = barUnder ? Math.min(leftFoot, i.h - MARGIN - i.barH - GAP) : leftFoot;
  const rail = { x: MARGIN, y: MARGIN, w: nonNeg(i.railW), h: nonNeg(leftFoot - MARGIN) };
  const left = { x: leftX, y: MARGIN, w: sizes.card, h: nonNeg(cardFoot - MARGIN) };
  const rightW = i.rightSlim && i.rightSlim > 0 ? Math.min(i.rightSlim, sizes.right) : sizes.right;
  const right = {
    x: nonNeg(i.w - MARGIN - rightW),
    y: MARGIN,
    w: rightW,
    h: nonNeg(i.h - 2 * MARGIN),
  };
  const bandX = left.x + left.w + GAP;
  const band = { x: bandX, w: nonNeg(right.x - GAP - bandX) };
  // The strips over the centre band.
  const top = { x: band.x, y: 0, w: band.w, h: nonNeg(i.topH) };
  const barRoom = i.barH > 0 ? MARGIN + i.barH + (i.nudgeH > 0 ? i.nudgeH : 0) : MARGIN;
  const foot = Math.max(barRoom, i.bottomReserve);
  const bottom = { x: band.x, y: nonNeg(i.h - foot), w: band.w, h: nonNeg(foot) };
  const barX = i.resH > 0 ? MARGIN + sizes.res + GAP : band.x;
  const bar = { x: barX, w: nonNeg(right.x - GAP - barX) };
  const y = top.y + top.h + GAP;
  const stage = { x: band.x, y, w: band.w, h: nonNeg(bottom.y - GAP - y) };
  return {
    cls,
    sizes,
    reading: false,
    rail,
    left,
    right,
    top,
    bottom,
    bar,
    band,
    stage,
    strip: { ...EMPTY },
  };
}

/**
 * Where the dock rail stands (its top, and the room under it down to its column's foot), in
 * the normal layout and in reading mode. Normally centred in its column; in reading mode it
 * stays exactly where it was (opening the technologies or the journal used to centre it
 * anew in the taller column under the reading strip: the whole dock slid down ~150 px), and
 * only moves when it must, to clear the reading strip or the screen's foot.
 * `railH`: the rail's measured height (0: not measured yet: centred).
 */
export function railPlacement(
  normal: Rect,
  reading: Rect,
  railH: number,
): { normal: { y: number; h: number }; reading: { y: number; h: number } } {
  const h = Math.max(0, railH);
  const centred = (z: Rect) => (h > 0 && h < z.h ? z.y + (z.h - h) / 2 : z.y);
  const ny = Math.round(centred(normal));
  // Same top as in the normal layout, nudged into the reading column if it does not fit.
  const lo = reading.y;
  const hi = Math.max(lo, reading.y + reading.h - h);
  const ry = h > 0 ? Math.round(Math.min(hi, Math.max(lo, ny))) : Math.round(centred(reading));
  return {
    normal: { y: ny, h: nonNeg(normal.y + normal.h - ny) },
    reading: { y: ry, h: nonNeg(reading.y + reading.h - ry) },
  };
}

// ------------------------------------------------------------------ the columns' pieces

/** How whole a piece of a column is printed: whole, on one line, or as a chip (a badge). */
export type Level = 'full' | 'compact' | 'chip';
export type ColumnId = 'left' | 'right';

export interface PieceDef {
  zone: ColumnId;
  /** Higher stays whole longer. */
  priority: number;
  /** Urgent pieces always stay whole. */
  urgent?: boolean;
  /** The levels the piece can be printed at, whole first. */
  levels: readonly Level[];
  /** Its chip joins the column's line of chips (else the chip is the piece, folded in place). */
  rowChip?: boolean;
  /** Heights assumed before the piece has been measured at that level. */
  guess: Partial<Record<Level, number>>;
  /** Room kept around it in the column beyond the gap between pieces (leaderboard, minimap). */
  extra?: number;
  /** The level the player's fold prints it at (at most); absent: the player cannot fold it. */
  fold?: Level;
}

/**
 * The pieces of the columns and their priorities (higher stays whole longer):
 *
 * News column (left): nuclear alerts 100 (urgent) › lost capital 90 (never a chip: it
 * asks for a decision) › council ballot 80 › special edition 60 › news flash 40 ›
 * alliances in progress 30.
 * Right column: alliance offers 100 (urgent) › nuclear launch panel 95 (urgent, while
 * aiming) › minimap 70 › leaderboard 50. (The dispatches tray is gone from 1.10.0: the
 * notifications go to the journal, whose dock button counts the unread ones.)
 *
 * Short of height, a column first prints its least important pieces on one line, from
 * the bottom of the ranking up, then turns them into chips the same way.
 */
export const PIECES = {
  nukeAlerts: { zone: 'left', priority: 100, urgent: true, levels: ['full'], guess: { full: 56 } },
  capital: { zone: 'left', priority: 90, levels: ['full', 'compact'], guess: { full: 210, compact: 40 } },
  council: {
    zone: 'left',
    priority: 80,
    levels: ['full', 'compact', 'chip'],
    rowChip: true,
    guess: { full: 300, compact: 120 },
  },
  breaking: {
    zone: 'left',
    priority: 60,
    levels: ['full', 'compact', 'chip'],
    rowChip: true,
    guess: { full: 170, compact: 40 },
    fold: 'compact',
  },
  flash: {
    zone: 'left',
    priority: 40,
    levels: ['full', 'compact', 'chip'],
    rowChip: true,
    guess: { full: 320, compact: 40 },
    fold: 'compact',
  },
  alliances: {
    zone: 'left',
    priority: 30,
    levels: ['full', 'compact', 'chip'],
    rowChip: true,
    guess: { full: 150, compact: 36 },
    fold: 'compact',
  },
  offers: { zone: 'right', priority: 100, urgent: true, levels: ['full'], guess: { full: 124 } },
  launch: { zone: 'right', priority: 95, urgent: true, levels: ['full'], guess: { full: 220 } },
  minimap: {
    zone: 'right',
    priority: 70,
    levels: ['full', 'chip'],
    guess: { full: 200, chip: 64 },
    extra: GAP - ITEM_GAP,
    fold: 'chip',
  },
  leaderboard: {
    zone: 'right',
    priority: 50,
    levels: ['full', 'compact', 'chip'],
    guess: { full: 300, compact: 190, chip: 64 },
    extra: GAP - ITEM_GAP,
    fold: 'chip',
  },
} satisfies Record<string, PieceDef>;
export type PieceId = keyof typeof PIECES;

// ------------------------------------------------------------------ the player's folds

/**
 * The panels the player can fold (persisted, folds.svelte.ts): the minimap, the leaderboard,
 * the build bar, the resources panel, the news cards of the left column (news flash, special
 * edition) and the alliances in progress.
 */
export const FOLD_IDS = ['minimap', 'leaderboard', 'bar', 'res', 'news', 'alliances'] as const;
export type FoldId = (typeof FOLD_IDS)[number];
export type Folds = Record<FoldId, boolean>;

/** Which fold each piece of the columns obeys. */
export const FOLD_OF: Partial<Record<PieceId, FoldId>> = {
  minimap: 'minimap',
  leaderboard: 'leaderboard',
  flash: 'news',
  breaking: 'news',
  alliances: 'alliances',
};

/** Width of the right column folded to its tabs (the minimap's and the leaderboard's). */
export const FOLD_TAB_W = 64;

/** Everything unfolded (the default). */
export function noFolds(): Folds {
  return Object.fromEntries(FOLD_IDS.map((id) => [id, false])) as Folds;
}

/** Folds read back from storage: unknown or malformed entries are unfolded. */
export function parseFolds(raw: unknown): Folds {
  const out = noFolds();
  if (raw && typeof raw === 'object')
    for (const id of FOLD_IDS) if ((raw as Record<string, unknown>)[id] === true) out[id] = true;
  return out;
}

/** The minimal interface (everything folded) toggled: all unfold if all were folded, else all fold. */
export function toggleAll(f: Folds): Folds {
  const all = FOLD_IDS.every((id) => f[id]);
  return Object.fromEntries(FOLD_IDS.map((id) => [id, !all])) as Folds;
}

export interface PieceState {
  id: string;
  def: PieceDef;
  /** Measured heights at each level (when it has been printed so). */
  heights: Partial<Record<Level, number>>;
  /** The player asked for it whole (clicked its chip): it ranks first. */
  pinned?: boolean;
  /** The player folded it: printed at its fold level at most (PieceDef.fold). */
  folded?: boolean;
}

function heightAt(p: PieceState, level: Level): number {
  return p.heights[level] ?? p.def.guess[level] ?? (level === 'compact' ? 40 : level === 'chip' ? 30 : 120);
}

/** Height of a column printed at these levels (pieces, gaps, the line of chips). */
export function columnHeight(
  pieces: readonly PieceState[],
  levels: Record<string, Level>,
  chipsPerRow = 3,
): number {
  let h = 0;
  let n = 0;
  let chips = 0;
  for (const p of pieces) {
    const lv = levels[p.id] ?? 'full';
    if (lv === 'chip' && p.def.rowChip) {
      chips++;
      continue;
    }
    h += heightAt(p, lv) + (p.def.extra ?? 0);
    n++;
  }
  const rows = Math.ceil(chips / Math.max(1, chipsPerRow));
  h += rows * CHIP_ROW;
  n += rows;
  return h + Math.max(0, n - 1) * ITEM_GAP;
}

/**
 * The level of each piece of a column with `room` pixels of height: everything whole if
 * it fits; otherwise the least important pieces go compact one after the other, then
 * become chips, until it fits. Urgent pieces stay whole (if they alone do not fit, the
 * column scrolls as a last resort). A pinned piece ranks above the others.
 */
export function allocate(
  pieces: readonly PieceState[],
  room: number,
  chipsPerRow = 3,
): Record<string, Level> {
  const levels: Record<string, Level> = {};
  /** The most whole a piece may be printed: its fold level when the player folded it. */
  const top = (p: PieceState) =>
    p.folded && p.def.fold && !p.def.urgent ? Math.max(0, p.def.levels.indexOf(p.def.fold)) : 0;
  for (const p of pieces) levels[p.id] = p.def.levels[top(p)] ?? 'full';
  const fits = () => columnHeight(pieces, levels, chipsPerRow) <= room;
  /** Prints a piece at `lv`, only ever less whole than it is. */
  const lower = (p: PieceState, lv: Level) => {
    const k = p.def.levels.indexOf(lv);
    if (k > p.def.levels.indexOf(levels[p.id]!)) levels[p.id] = lv;
  };
  const order = [...pieces].filter((p) => !p.def.urgent).sort((a, b) => a.def.priority - b.def.priority);
  // The pieces the player asked for give way only once every other one is a chip.
  demote: for (const group of [order.filter((p) => !p.pinned), order.filter((p) => p.pinned)])
    for (const step of ['compact', 'chip'] as const)
      for (const p of group) {
        if (fits()) break demote;
        if (p.def.levels.includes(step)) lower(p, step);
        else if (step === 'chip' && p.def.levels.includes('compact')) lower(p, 'compact');
      }
  // Room left over: the most important folded pieces unfold again, a step at a time
  // (the leaderboard back on its top 5 once the minimap has folded, say) — never past the
  // player's own fold.
  for (const p of [...order].reverse()) {
    const lv = p.def.levels;
    for (let k = lv.indexOf(levels[p.id]!) - 1; k >= top(p); k--) {
      const was = levels[p.id]!;
      levels[p.id] = lv[k]!;
      if (!fits()) {
        levels[p.id] = was;
        break;
      }
    }
  }
  return levels;
}

// ------------------------------------------------------------------ windows in the stage

/** Keeps a rectangle inside another one, no larger than it (and at least min × min when it can). */
export function clampInto(r: Rect, room: Rect, minW = 0, minH = 0): Rect {
  const w = Math.round(Math.max(Math.min(minW, room.w), Math.min(r.w, room.w)));
  const h = Math.round(Math.max(Math.min(minH, room.h), Math.min(r.h, room.h)));
  const x = Math.round(Math.min(Math.max(room.x, r.x), room.x + room.w - w));
  const y = Math.round(Math.min(Math.max(room.y, r.y), room.y + room.h - h));
  return { x, y, w, h };
}

export const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where a window of `size` opens in the stage: at its left edge, or to the right of the
 * windows already open (tiled side by side); when the stage is full, where it hides the
 * least of them (against the right edge, or cascaded over them). Always inside the stage.
 */
export function placeInStage(stage: Rect, size: { w: number; h: number }, others: readonly Rect[]): Rect {
  const w = Math.min(size.w, stage.w);
  const h = Math.min(size.h, stage.h);
  const sorted = [...others].sort((a, b) => a.x - b.x);
  const spots = [{ x: stage.x, y: stage.y }, ...sorted.map((o) => ({ x: o.x + o.w + GAP, y: stage.y }))];
  for (const p of spots) {
    const r = { ...p, w, h };
    if (r.x + r.w <= stage.x + stage.w && !sorted.some((o) => overlaps(r, o))) return r;
  }
  const k = sorted.length;
  const tries = [
    ...spots,
    { x: stage.x + stage.w - w, y: stage.y },
    { x: stage.x + 28 * k, y: stage.y + 28 * k },
  ].map((p) => clampInto({ ...p, w, h }, stage));
  const hidden = (r: Rect) => sorted.reduce((sum, o) => sum + overlapArea(r, o), 0);
  return tries.reduce((best, r) => (hidden(r) < hidden(best) ? r : best));
}

/** A maximised window in reading mode: the whole stage, at most `maxW` wide (centred). */
export function readingRect(stage: Rect, maxW: number): Rect {
  const w = Math.min(stage.w, maxW);
  return { x: Math.round(stage.x + (stage.w - w) / 2), y: stage.y, w, h: stage.h };
}

// ------------------------------------------------------------------ the overlap check

export interface Box extends Rect {
  id: string;
  /** Pieces of the same group may overlap one another (windows stack). */
  group?: string;
  /** Pieces inside another one (by id) are not compared with it. */
  inside?: string;
}

/**
 * The QA check (.cache/qa/layout/qa-layout.mjs does the same in the page): which pieces
 * overlap (by more than `tol` pixels each way), and which run off the `w` × `h` screen.
 */
export function findOverlaps(
  boxes: readonly Box[],
  w: number,
  h: number,
  tol = 2,
): { overlaps: [string, string][]; offscreen: string[] } {
  const out: [string, string][] = [];
  const live = boxes.filter((b) => b.w > 0 && b.h > 0);
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!;
      const b = live[j]!;
      if (a.group && a.group === b.group) continue;
      if (a.inside === b.id || b.inside === a.id) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > tol && iy > tol) out.push([a.id, b.id]);
    }
  const offscreen = live
    .filter((r) => r.x < -1 || r.y < -1 || r.x + r.w > w + 1 || r.y + r.h > h + 1)
    .map((r) => r.id);
  return { overlaps: out, offscreen };
}
