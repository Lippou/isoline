// The player's folds (1.10.0): every panel over the map — the minimap, the leaderboard, the
// build bar, the resources panel, the news cards of the left column and the alliances in
// progress — folds to a slim tab or strip that keeps its essentials, to give the map room.
// Remembered from one game to the next (localStorage, as the windows' places); everything
// unfolded by default. The zones read them (layout.svelte.ts, zones.ts): a folded piece's
// room goes to the others, and to the map's stage.
import { FOLD_IDS, parseFolds, toggleAll, type FoldId, type Folds } from './zones';
import { tactile } from '../tactile';

export { FOLD_IDS, type FoldId } from './zones';

const LS_KEY = 'isoline.folds.v1';

/**
 * Nothing chosen yet: everything unfolded — but on a phone (touch web version, tactile.ts) the
 * resources panel starts folded to its strip: the dock and the map need the screen's height.
 */
function defaults(): Folds {
  const f = parseFolds(null);
  if (tactile && Math.min(screen.width, screen.height) < 500) f.res = true;
  return f;
}

function load(): Folds {
  try {
    const saved = localStorage.getItem(LS_KEY);
    return saved === null ? defaults() : parseFolds(JSON.parse(saved));
  } catch {
    return defaults();
  }
}

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify($state.snapshot(folds)));
  } catch {
    // Storage unavailable: the folds last for the session only.
  }
}

export const folds = $state<Folds>(load());

/** Folds (`on`) or unfolds a panel, and remembers it. */
export function setFold(id: FoldId, on: boolean): void {
  if (folds[id] === on) return;
  folds[id] = on;
  persist();
}

export function toggleFold(id: FoldId): void {
  setFold(id, !folds[id]);
}

/** Every panel folded: the minimal interface, the map in full view. */
export function allFolded(): boolean {
  return FOLD_IDS.every((id) => folds[id]);
}

/** The minimal interface on or off (everything folds, or everything unfolds); true when folded. */
export function toggleAllFolds(): boolean {
  Object.assign(folds, toggleAll(folds));
  persist();
  return allFolded();
}
