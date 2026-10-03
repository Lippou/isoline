// Photo mode: the HUD hidden, a small bar sets up the shot (PhotoBar.svelte). Not saved:
// each session starts from the default picture (everything shown, the game's own clock).
export const photo = $state({
  labels: true,
  borders: true,
  /** Fog of war drawn (only spectators and replays may lift it, as with the fog view). */
  fog: true,
  weather: true,
  routes: true,
  /** Solo and replays: the world holds still while the shot is set up. */
  freeze: true,
  /** The game's own day and night; otherwise `night` (0 day … 1 deep night). */
  autoTime: true,
  night: 0.5,
  /** The bar steps aside while the window is captured. */
  capturing: false,
  /** Where the last picture was saved ('' none yet), or a failure. */
  saved: '',
  failed: false,
});
