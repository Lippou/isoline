// Phone only (html.phone): a line touched on the map opens its own small card (LineCard.svelte)
// instead of the Front window; the window still lists every line.
import { hud, openPanel } from '../../stores/game.svelte';
import { phone } from '../../tactile';

export const lineCard = $state({ open: false });

/** Shows one of my lines: its card on a phone, its place in the Front window elsewhere. */
export function showLine(id: number): void {
  hud.frontSel = id;
  if (phone) lineCard.open = true;
  else openPanel('front');
}
