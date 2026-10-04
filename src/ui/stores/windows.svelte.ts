// Floating HUD windows (diplomacy, trade, technologies, statistics, journal, messages):
// several can be open at once, dragged by their title bar, resized by their corner,
// stacked by focus. They stand in the map's stage (zones.ts): never over the columns, the
// top bar or the bars at the foot; side by side, then cascaded, when there are several.
// A big window (the technology planche, the journal, any window the player maximises)
// takes the whole room in reading mode: the columns fold into the reading strip.
// Positions the player chose, and whether a window opens maximised, are remembered
// (localStorage, per window). Which window is open stays in `hud.panels`.
import { hud } from './game.svelte';
import { layout } from './layout.svelte';
import { clampInto, placeInStage, readingRect, overlaps, type Rect } from './zones';

export type { Rect } from './zones';
export type WinId = 'diplomacy' | 'trade' | 'tech' | 'stats' | 'log' | 'chat';
export const WIN_IDS: readonly WinId[] = ['diplomacy', 'trade', 'tech', 'stats', 'log', 'chat'];

/**
 * Width of each window (CSS pixels; the page zoom scales them) — the journal is a newspaper
 * column; the technology tree a planche across the screen (a narrower window shows it as a ladder).
 */
const BASE_W: Record<WinId, number> = {
  diplomacy: 400,
  trade: 400,
  tech: 1440,
  stats: 400,
  log: 468,
  chat: 400,
};
/** Tallest default height of each window (the tech tree takes the stage's height). */
const BASE_H: Record<WinId, number> = {
  diplomacy: 820,
  trade: 820,
  tech: 940,
  stats: 820,
  log: 820,
  chat: 820,
};
/** Widest a window grows in reading mode (centred in the room beyond): the planche, a broadsheet. */
const READ_W: Record<WinId, number> = {
  diplomacy: 1280,
  trade: 1280,
  tech: 1920,
  stats: 1280,
  log: 1120,
  chat: 1120,
};
/** Windows that open maximised (reading mode) until the player says otherwise. */
const MAX_BY_DEFAULT: ReadonlySet<WinId> = new Set(['tech', 'log']);
export const MIN_W = 300;
export const MIN_H = 220;
const LS_KEY = 'isoline.windows.v1';
const LS_MAX = 'isoline.windows.max.v1';

function load(): Partial<Record<WinId, Rect>> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, Partial<Rect>>;
    const out: Partial<Record<WinId, Rect>> = {};
    for (const id of WIN_IDS) {
      const r = raw[id];
      if (r && [r.x, r.y, r.w, r.h].every((v) => typeof v === 'number' && Number.isFinite(v)))
        out[id] = { x: r.x!, y: r.y!, w: r.w!, h: r.h! };
    }
    return out;
  } catch {
    return {};
  }
}
function loadMax(): Partial<Record<WinId, boolean>> {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_MAX) ?? '{}') as Record<string, unknown>;
    const out: Partial<Record<WinId, boolean>> = {};
    for (const id of WIN_IDS) if (typeof raw[id] === 'boolean') out[id] = raw[id] as boolean;
    return out;
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify($state.snapshot(wm.saved)));
    localStorage.setItem(LS_MAX, JSON.stringify($state.snapshot(wm.maxPref)));
  } catch {
    // Storage unavailable: positions last for the session only.
  }
}

export const wm = $state({
  /** Open windows, back to front: the last one is on top (and Escape closes it). */
  order: [] as WinId[],
  /** Where each open window stands in the normal layout (CSS pixels). */
  rects: {} as Partial<Record<WinId, Rect>>,
  /** Positions and sizes the player chose (dragged or resized), remembered between games. */
  saved: load(),
  /** Open windows maximised now (reading mode). */
  maxed: {} as Partial<Record<WinId, boolean>>,
  /** Whether each window opens maximised, as the player last chose (else MAX_BY_DEFAULT). */
  maxPref: loadMax(),
  /**
   * Height kept free at the bottom by something that must stay readable (the campaign's
   * objectives and guide, Dialogue.svelte), in CSS pixels; 0: none. Windows open above it.
   */
  bottomReserve: 0,
});

/** The stage of the normal layout: where windows that are not maximised stand. */
const stage = (): Rect => layout.normal.stage;

/** Keeps a window in the stage and no larger than it. */
export function clampRect(r: Rect): Rect {
  return clampInto(r, stage(), MIN_W, MIN_H);
}

/** The default size of a window: its width, and the stage's height (up to a limit). */
function defaultSize(id: WinId): { w: number; h: number } {
  const s = stage();
  return { w: Math.min(BASE_W[id], s.w), h: Math.min(BASE_H[id], s.h) };
}

/**
 * Where a window opens: where the player left it (kept in the stage), otherwise at the
 * stage's left edge or to the right of the windows already open (side by side); when the
 * stage is full, where it hides the least of them.
 */
export function placeWindow(id: WinId, useSaved = true): Rect {
  const saved = useSaved ? wm.saved[id] : undefined;
  if (saved) return clampRect(saved);
  const others = wm.order
    .filter((o) => o !== id)
    .map((o) => wm.rects[o])
    .filter((r): r is Rect => !!r);
  return placeInStage(stage(), defaultSize(id), others);
}

/** Whether a window is maximised (reading mode) now. */
export function isMax(id: WinId): boolean {
  return !!wm.maxed[id];
}

/** Reading mode: a maximised window is open. */
export function isReading(): boolean {
  return wm.order.some((id) => wm.maxed[id]);
}

/** Where a window stands now: its place in the stage, or the reading room when maximised. */
export function windowRect(id: WinId): Rect | undefined {
  if (wm.maxed[id] && wm.rects[id]) return readingRect(layout.readingZones.stage, READ_W[id]);
  return wm.rects[id];
}

/** The window's maximise button: it toggles, and the window will open so from now on. */
export function toggleMax(id: WinId): void {
  const on = !wm.maxed[id];
  wm.maxed[id] = on;
  wm.maxPref[id] = on;
  persist();
  if (on) focusWindow(id);
}

/**
 * Back to the map (the reading strip's button, or one of its chips): the maximised windows
 * stand in the stage again for now; they will open maximised next time all the same.
 */
export function restoreColumns(): void {
  for (const id of wm.order) if (wm.maxed[id]) wm.maxed[id] = false;
}

/** Brings a window to the front. */
export function focusWindow(id: WinId): void {
  if (wm.order.at(-1) === id) return;
  wm.order = [...wm.order.filter((o) => o !== id), id];
}

/** A window appears: it takes its place and comes to the front. */
export function mountWindow(id: WinId): void {
  wm.rects[id] = placeWindow(id);
  wm.maxed[id] = wm.maxPref[id] ?? MAX_BY_DEFAULT.has(id);
  focusWindow(id);
}

export function unmountWindow(id: WinId): void {
  wm.order = wm.order.filter((o) => o !== id);
  delete wm.rects[id];
  delete wm.maxed[id];
}

/** Moves or resizes a window (while dragging); `remember` once the gesture ends. */
export function setRect(id: WinId, r: Rect, remember = false): void {
  wm.rects[id] = clampRect(r);
  if (remember) {
    wm.saved[id] = { ...wm.rects[id] };
    persist();
  }
}

/**
 * Forgets where the player put a window (or all of them) and puts it back in its place;
 * all of them: whether they open maximised too.
 */
export function resetWindows(id?: WinId): void {
  for (const k of id ? [id] : WIN_IDS) delete wm.saved[k];
  if (!id) {
    wm.maxPref = {};
    for (const k of wm.order) wm.maxed[k] = MAX_BY_DEFAULT.has(k);
  }
  persist();
  if (id) {
    if (wm.rects[id]) wm.rects[id] = placeWindow(id, false);
    return;
  }
  // Placed again one after another, in their stacking order (back to front).
  const order = [...wm.order];
  for (const k of order) delete wm.rects[k];
  wm.order = [];
  for (const k of order) {
    wm.rects[k] = placeWindow(k, false);
    wm.order = [...wm.order, k];
  }
}

/**
 * Keeps the bottom `px` free (0: releases it): the stage ends above it, and the open
 * windows follow (relayout).
 */
export function reserveBottom(px: number): void {
  if (px !== wm.bottomReserve) wm.bottomReserve = px;
}

/**
 * The stage changed (the screen, the interface scale, a piece of the HUD grew): every open
 * window stays in it. One the player placed keeps its place as far as it can; the others
 * take their default size and keep their place unless another window stands there, in
 * which case they are laid out again beside the others.
 */
export function relayout(): void {
  const placed: Rect[] = [];
  for (const id of wm.order) {
    const r = wm.rects[id];
    if (!r) continue;
    let next: Rect;
    if (wm.saved[id]) next = clampRect(r);
    else {
      next = clampRect({ ...r, ...defaultSize(id) });
      if (placed.some((o) => overlaps(o, next))) next = placeInStage(stage(), defaultSize(id), placed);
    }
    placed.push(next);
    const cur = wm.rects[id];
    if (!cur || cur.x !== next.x || cur.y !== next.y || cur.w !== next.w || cur.h !== next.h)
      wm.rects[id] = next;
  }
}

/** The window on top, if any. */
export function topWindow(): WinId | null {
  return wm.order.at(-1) ?? null;
}

/** Escape: closes the window on top. False when none is open. */
export function closeTopWindow(): boolean {
  const id = topWindow();
  if (!id) return false;
  hud.panels[id] = false;
  return true;
}
