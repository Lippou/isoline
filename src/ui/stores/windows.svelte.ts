// Floating HUD windows (diplomacy, trade, technologies, statistics, journal, messages):
// several can be open at once, dragged by their title bar, resized by their corner,
// stacked by focus. Positions the player chose are remembered (localStorage, per window).
// Which window is open stays in `hud.panels` (the rest of the HUD reads it).
import { innerWidth, innerHeight } from 'svelte/reactivity/window';
import { hud } from './game.svelte';
import { hudBox } from './hudBox.svelte';

export type WinId = 'diplomacy' | 'trade' | 'tech' | 'stats' | 'log' | 'chat';
export const WIN_IDS: readonly WinId[] = ['diplomacy', 'trade', 'tech', 'stats', 'log', 'chat'];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Width of each window (CSS pixels; the page zoom scales them) — the journal is a newspaper column, the tree is wide. */
const BASE_W: Record<WinId, number> = {
  diplomacy: 400,
  trade: 400,
  tech: 640,
  stats: 400,
  log: 468,
  chat: 400,
};
/** Top of the windows and of the left column of cards: under the top bar. */
export const HUD_TOP = 64;
/** Room kept free at the bottom by default: the resources panel and the minimap. */
const BOTTOM_ROOM = 280;
const GAP = 10;
const MARGIN = 8;
export const MIN_W = 300;
export const MIN_H = 220;
const LS_KEY = 'isoline.windows.v1';
/** Width of the leaderboard (Leaderboard.svelte). */
const LEADERBOARD_W = 310;

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

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify($state.snapshot(wm.saved)));
  } catch {
    // Storage unavailable: positions last for the session only.
  }
}

export const wm = $state({
  /** Open windows, back to front: the last one is on top (and Escape closes it). */
  order: [] as WinId[],
  /** Where each open window stands now (CSS pixels). */
  rects: {} as Partial<Record<WinId, Rect>>,
  /** Positions and sizes the player chose (dragged or resized), remembered between games. */
  saved: load(),
  /** Right edge of the dock rail: windows and the column of cards open beside it. */
  railRight: 84,
  /**
   * Height kept free at the bottom by something that must stay readable (the campaign's
   * objectives and guide, Dialogue.svelte), in CSS pixels; 0: none. Windows open above it.
   */
  bottomReserve: 0,
});

const vw = () => innerWidth.current ?? 1280;
const vh = () => innerHeight.current ?? 800;

/** Keeps a window on screen and no larger than it. */
export function clampRect(r: Rect): Rect {
  const W = vw();
  const H = vh();
  const w = Math.round(Math.max(Math.min(MIN_W, W), Math.min(r.w, W - 2 * MARGIN)));
  const h = Math.round(Math.max(Math.min(MIN_H, H), Math.min(r.h, H - 2 * MARGIN)));
  const x = Math.round(Math.min(Math.max(0, r.x), W - w));
  const y = Math.round(Math.min(Math.max(0, r.y), H - h));
  return { x, y, w, h };
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The default size of a window: its width, and the height above the resources panel. */
function defaultSize(id: WinId): { w: number; h: number } {
  const w = Math.min(BASE_W[id], vw() - wm.railRight - GAP - MARGIN);
  // The tech tree needs height more than the resources panel needs to stay visible
  // while one plans research: on short screens it goes down to the build bar's height.
  // (The panels' measured heights, when shown: hudBox.svelte.ts.)
  const resRoom = hudBox.res ? hudBox.res + 12 + GAP : BOTTOM_ROOM;
  const barRoom = (hudBox.bar || 112) + 12 + 26;
  const room = Math.max(id === 'tech' && vh() < 900 ? barRoom : resRoom, wm.bottomReserve);
  const h = Math.max(Math.min(320, vh() - HUD_TOP - MARGIN), vh() - HUD_TOP - room);
  return { w, h: Math.min(h, 820) };
}

/**
 * Where a window opens: where the player left it, otherwise beside the dock, or to the
 * right of the windows already open (Technologies then Journal side by side); when the
 * screen is full, where it hides the least of them.
 */
export function placeWindow(id: WinId, useSaved = true): Rect {
  const saved = useSaved ? wm.saved[id] : undefined;
  if (saved) return clampRect(saved);
  const { w, h } = defaultSize(id);
  const others = wm.order
    .filter((o) => o !== id)
    .map((o) => wm.rects[o])
    .filter((r): r is Rect => !!r)
    .sort((a, b) => a.x - b.x);
  const left = wm.railRight + GAP;
  const spots = [{ x: left, y: HUD_TOP }, ...others.map((o) => ({ x: o.x + o.w + GAP, y: HUD_TOP }))];
  for (const p of spots) {
    const r = { ...p, w, h };
    if (r.x + r.w <= vw() - MARGIN && r.y + r.h <= vh() && !others.some((o) => overlaps(r, o))) return r;
  }
  // The screen is full: wherever it hides the least of the others (against the right
  // edge, beside one of them, or cascaded over them).
  const k = others.length;
  const tries = [
    ...spots,
    { x: vw() - MARGIN - w, y: HUD_TOP },
    { x: left + 28 * k, y: HUD_TOP + 28 * k },
  ].map((p) => clampRect({ ...p, w, h }));
  const hidden = (r: Rect) => others.reduce((sum, o) => sum + overlapArea(r, o), 0);
  return tries.reduce((best, r) => (hidden(r) < hidden(best) ? r : best));
}

/** Brings a window to the front. */
export function focusWindow(id: WinId): void {
  if (wm.order.at(-1) === id) return;
  wm.order = [...wm.order.filter((o) => o !== id), id];
}

/** A window appears: it takes its place and comes to the front. */
export function mountWindow(id: WinId): void {
  wm.rects[id] = placeWindow(id);
  focusWindow(id);
}

export function unmountWindow(id: WinId): void {
  wm.order = wm.order.filter((o) => o !== id);
  delete wm.rects[id];
}

/** Moves or resizes a window (while dragging); `remember` once the gesture ends. */
export function setRect(id: WinId, r: Rect, remember = false): void {
  wm.rects[id] = clampRect(r);
  if (remember) {
    wm.saved[id] = { ...wm.rects[id] };
    persist();
  }
}

/** Forgets where the player put a window (or all of them) and puts it back in its place. */
export function resetWindows(id?: WinId): void {
  for (const k of id ? [id] : WIN_IDS) delete wm.saved[k];
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
 * Keeps the bottom `px` free (0: releases it): open windows standing where the player did
 * not put them get shorter so as not to reach into it.
 */
export function reserveBottom(px: number): void {
  if (px === wm.bottomReserve) return;
  wm.bottomReserve = px;
  if (px <= 0) return;
  const limit = vh() - px;
  for (const id of wm.order) {
    const r = wm.rects[id];
    if (!r || wm.saved[id] || r.y + r.h <= limit) continue;
    const h = Math.max(MIN_H, limit - r.y);
    if (h < r.h) wm.rects[id] = { ...r, h };
  }
}

/**
 * The screen changed size (or the interface scale): every open window stays on it, and
 * one the player did not place or resize takes its default size for the new screen.
 */
export function clampAll(): void {
  for (const id of wm.order) {
    const r = wm.rects[id];
    if (!r) continue;
    wm.rects[id] = clampRect(wm.saved[id] ? r : { ...r, ...defaultSize(id) });
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

/**
 * The left column of cards (nuclear alerts, council vote, flash info, alliances…):
 * beside the windows standing at the left edge so it stays readable, narrowed to the
 * room before the next window or the leaderboard. With no room left it stays in place,
 * under the windows.
 */
export function columnPlace(): { left: number; maxW: number; shifted: boolean; covered: boolean } {
  const natural = wm.railRight + GAP;
  const W = vw();
  const zone = vh() * 0.6;
  const rects = wm.order
    .map((o) => wm.rects[o])
    .filter((r): r is Rect => !!r && r.y < zone)
    .sort((a, b) => a.x - b.x);
  let left = natural;
  for (const r of rects) if (r.x <= left + 40 && r.x + r.w > left) left = r.x + r.w + GAP;
  const next = rects.find((r) => r.x > left - 40 && r.x + r.w > left);
  // Never over the leaderboard (top right) either.
  const edge = W - 12 - LEADERBOARD_W - GAP;
  const room = Math.min(next ? next.x - GAP : edge, edge) - left;
  if (left === natural) {
    const covered = rects.some((r) => r.x < natural + 300 && r.x + r.w > natural);
    return { left, maxW: 420, shifted: false, covered };
  }
  if (room < 260) return { left: natural, maxW: 420, shifted: false, covered: true };
  return { left, maxW: Math.min(420, room), shifted: true, covered: false };
}
