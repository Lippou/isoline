// The HUD's layout, live (1.9.0): the zones of zones.ts computed from the window and the
// measured pieces, the level each piece of the columns is printed at, and the CSS
// variables the pieces are placed with (set on the game screen). One place decides where
// everything stands; the pieces only read it.
import { untrack } from 'svelte';
import { innerWidth, innerHeight } from 'svelte/reactivity/window';
import { hudBox } from './hudBox.svelte';
import { wm, isReading } from './windows.svelte';
import { folds } from './folds.svelte';
import {
  computeZones,
  allocate,
  PIECES,
  FOLD_OF,
  FOLD_TAB_W,
  type Level,
  type PieceId,
  type PieceState,
  type Zones,
  type ZoneInput,
} from './zones';

/** Room kept over the build bar for the "research stopped" reminder (ResearchReminder.svelte). */
export const NUDGE_ROOM = 44;

interface Piece {
  pinned: boolean;
  /** How much it holds (slips, rows, alerts): heights measured with another count are scaled. */
  n: number;
}
/** A height measured at a level, with the count the piece held then. */
interface Measure {
  h: number;
  n: number;
}

/** How many elements show each piece now (see Layout.show). */
const shown = new Map<PieceId, number>();
/** Pieces asked for while not shown (from the reading strip): pinned when they show. */
const pending = new Set<PieceId>();
/** Pins that lapse by themselves (see Layout.pin). */
const unpinTimers = new Map<PieceId, ReturnType<typeof setTimeout>>();

class Layout {
  /** The pieces of the columns shown now. */
  pieces = $state<Partial<Record<PieceId, Piece>>>({});
  /** Their measured heights, per layout class and level ("council:standard" → {full: {h: 280, n: 1}}). */
  heights = $state<Record<string, Partial<Record<Level, Measure>>>>({});
  /** Room kept over the bar for the research reminder (0: none: no research, spectating). */
  nudge = $state(0);

  /**
   * The right column folded to its tabs: the leaderboard and the minimap both folded by the
   * player, and nothing else in it (an alliance offer or the launch panel widens it again).
   */
  rightSlim = $derived(
    folds.minimap &&
      folds.leaderboard &&
      !(Object.keys(this.pieces) as PieceId[]).some(
        (id) => PIECES[id].zone === 'right' && id !== 'minimap' && id !== 'leaderboard',
      ),
  );

  /** What the zones are computed from. */
  input = $derived.by((): Omit<ZoneInput, 'reading'> => ({
    w: innerWidth.current ?? 1600,
    h: innerHeight.current ?? 900,
    railW: hudBox.railW,
    topH: hudBox.top ? 10 + hudBox.top : 0,
    resH: hudBox.res,
    barH: hudBox.bar || hudBox.replay,
    nudgeH: hudBox.bar ? this.nudge : 0,
    bottomReserve: wm.bottomReserve,
    stripH: hudBox.strip || 44,
    rightSlim: this.rightSlim ? FOLD_TAB_W : 0,
  }));
  /** The zones of the normal layout (windows that are not maximised stand in its stage). */
  normal = $derived(computeZones({ ...this.input, reading: false }));
  /** The zones of reading mode (a maximised window takes its stage). */
  readingZones = $derived(computeZones({ ...this.input, reading: true }));
  /** A big window is open: the columns are folded into the reading strip. */
  reading = $derived(isReading());
  zones: Zones = $derived(this.reading ? this.readingZones : this.normal);

  /** The level each piece of the columns is printed at. */
  levels = $derived.by(() => {
    const z = this.normal;
    const cls = z.cls;
    const out: Partial<Record<PieceId, Level>> = {};
    for (const zone of ['left', 'right'] as const) {
      const list: PieceState[] = [];
      for (const [id, p] of Object.entries(this.pieces) as [PieceId, Piece][]) {
        const def = PIECES[id];
        if (def.zone !== zone) continue;
        // A list measured with 5 slips and holding 2 now: its height scaled to 2.
        const m = this.heights[`${id}:${cls}`] ?? {};
        const heights: Partial<Record<Level, number>> = {};
        for (const [lv, v] of Object.entries(m) as [Level, Measure][])
          heights[lv] = v.n === p.n || v.n <= 0 ? v.h : Math.round((v.h * p.n) / v.n);
        const fold = FOLD_OF[id];
        list.push({ id, def, heights, pinned: p.pinned, folded: !!fold && folds[fold] });
      }
      const room = zone === 'left' ? z.left.h : z.right.h;
      const perRow = cls === 'compact' ? 2 : 3;
      Object.assign(out, allocate(list, room, perRow));
    }
    return out;
  });

  /** The CSS variables the pieces are placed with (on the game screen's root). */
  vars = $derived.by(() => {
    const z = this.normal;
    const R = this.readingZones;
    const { w, h } = this.input;
    const px = (v: number) => `${Math.round(v)}px`;
    const v: Record<string, string> = {
      '--card-w': px(z.sizes.card),
      '--right-w': px(z.sizes.right),
      '--zone-right-w': px(z.right.w),
      '--res-w': px(z.sizes.res),
      '--mini-w': px(z.sizes.right - 10),
      '--zone-left-x': px(z.left.x),
      '--zone-left-y': px(z.left.y),
      '--zone-left-h': px(z.left.h),
      '--zone-right-x': px(z.right.x),
      '--zone-rail-y': px(z.rail.y),
      '--zone-rail-h': px(z.rail.h),
      '--zone-band-x': px(z.band.x),
      '--zone-band-w': px(z.band.w),
      '--zone-band-c': px(z.band.x + z.band.w / 2),
      '--zone-top-h': px(z.top.h),
      '--zone-bar-l': px(z.bar.x),
      '--zone-bar-r': px(w - z.bar.x - z.bar.w),
      '--zone-stage-x': px(z.stage.x),
      '--zone-stage-y': px(z.stage.y),
      '--zone-stage-w': px(z.stage.w),
      '--zone-stage-h': px(z.stage.h),
      '--zone-stage-b': px(h - z.stage.y - z.stage.h),
      '--zone-read-rail-y': px(R.rail.y),
      '--zone-read-rail-h': px(R.rail.h),
    };
    return Object.entries(v)
      .map(([k, val]) => `${k}: ${val}`)
      .join('; ');
  });

  /** The level of a piece of the columns ('full' while it is not laid out yet). */
  levelOf(id: PieceId): Level {
    return this.levels[id] ?? 'full';
  }

  /**
   * The player asked for a folded piece whole (clicked its chip): the others give way. Asked
   * from the reading strip, the piece is not in its column yet: it will be, pinned, when the
   * columns come back.
   */
  pin(id: PieceId, on = true, ms = 0): void {
    clearTimeout(unpinTimers.get(id));
    const p = this.pieces[id];
    if (p && p.pinned !== on) p.pinned = on;
    if (on && !p) pending.add(id);
    else pending.delete(id);
    // For a while only (the dispatches come and go: the column settles back after).
    if (on && ms > 0)
      unpinTimers.set(
        id,
        setTimeout(() => this.pin(id, false), ms),
      );
  }

  /**
   * A piece shows (`on`) or goes. Counted: a piece printed anew at another level (its chip
   * replacing its card) stays laid out, pinned or not; it goes once nothing shows it.
   */
  show(id: PieceId, on: boolean, count = 1): void {
    const n = (shown.get(id) ?? 0) + (on ? 1 : -1);
    shown.set(id, Math.max(0, n));
    if (on && !this.pieces[id]) {
      this.pieces[id] = { pinned: pending.has(id), n: count };
      pending.delete(id);
    }
    if (!on && n <= 0)
      queueMicrotask(() => {
        if ((shown.get(id) ?? 0) <= 0 && this.pieces[id]) delete this.pieces[id];
      });
  }

  /** How much a piece holds now (see Piece.n). */
  count(id: PieceId, n: number): void {
    const p = this.pieces[id];
    if (p && p.n !== n) p.n = n;
  }

  /** A piece's height as printed at `level` holding `n` (what its component rendered). */
  report(id: PieceId, level: Level, h: number, n = 1): void {
    if (!this.pieces[id]) return;
    const key = `${id}:${this.normal.cls}`;
    const cur = this.heights[key];
    const was = cur?.[level];
    if (was && was.n === n && Math.abs(was.h - h) <= 1) return;
    this.heights[key] = { ...cur, [level]: { h, n } };
  }
}

export const layout = new Layout();

/** What a piece of a column tells the layout: which, shown or not, at what level, holding how much. */
export interface PieceArg {
  id: PieceId;
  on?: boolean;
  level?: Level;
  n?: number;
}

/**
 * Svelte action: `use:zonePiece={{ id: 'council', on: !!council, level }}` lays a piece out
 * in its column while `on`; its height is measured at the level it is printed at (once the
 * page has laid it out: never inside the update that changed it).
 */
export function zonePiece(node: HTMLElement, arg: PieceArg) {
  let { id, on = true, level = 'full', n = 1 } = arg;
  let raf = 0;
  const measure = () => {
    raf = 0;
    if (!on || (!node.offsetParent && node.offsetHeight === 0)) return;
    layout.report(id, level, Math.round(node.offsetHeight), n);
  };
  const later = () => {
    if (!raf) raf = requestAnimationFrame(measure);
  };
  const ro = new ResizeObserver(later);
  ro.observe(node);
  if (on) untrack(() => layout.show(id, true, n));
  later();
  return {
    update(next: PieceArg) {
      const nextOn = next.on ?? true;
      const nextN = next.n ?? 1;
      untrack(() => {
        if (on && (next.id !== id || !nextOn)) layout.show(id, false);
        if (nextOn && (next.id !== id || !on)) layout.show(next.id, true, nextN);
        if (nextOn) layout.count(next.id, nextN);
      });
      id = next.id;
      on = nextOn;
      level = next.level ?? 'full';
      n = nextN;
      later();
    },
    destroy() {
      ro.disconnect();
      cancelAnimationFrame(raf);
      if (on) untrack(() => layout.show(id, false));
    },
  };
}
