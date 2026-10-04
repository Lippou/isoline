// The HUD pieces the zones are laid out around (zones.ts, layout.svelte.ts): the resources
// panel (bottom left), the build bar (bottom centre), the minimap (bottom right), the
// leaderboard (top right), the top bar, the dock rail, the replay bar and the reading strip
// change size with the game (lists of attacks, a bar folded on two rows, a folded ranking,
// a status line). Their sizes are published here and, for the oldest users, as CSS
// variables on the document (--hud-res-h, --hud-bar-h, --hud-mini-h, --hud-mini-w, --hud-lb-h).
// A piece hidden for a while (reading mode) keeps its last size: the zones of the normal
// layout stay as they were, ready for when it comes back.
export type HudBoxKey = 'res' | 'bar' | 'mini' | 'lb' | 'top' | 'rail' | 'replay' | 'strip';

export const hudBox = $state({
  res: 0,
  bar: 0,
  mini: 0,
  miniW: 0,
  lb: 0,
  top: 0,
  rail: 0,
  railW: 0,
  replay: 0,
  strip: 0,
});

const CSS_KEYS: ReadonlySet<HudBoxKey> = new Set(['res', 'bar', 'mini', 'lb']);

function publish(key: HudBoxKey, node: HTMLElement): void {
  // Hidden (display: none, as the columns in reading mode): keep the last size.
  if (!node.offsetParent && node.offsetHeight === 0) return;
  const h = Math.round(node.offsetHeight);
  if (hudBox[key] !== h) hudBox[key] = h;
  const root = document.documentElement.style;
  if (CSS_KEYS.has(key)) root.setProperty(`--hud-${key}-h`, `${h}px`);
  if (key === 'mini') {
    hudBox.miniW = Math.round(node.offsetWidth);
    root.setProperty('--hud-mini-w', `${hudBox.miniW}px`);
  }
  if (key === 'rail') hudBox.railW = Math.round(node.offsetWidth);
}

/** Svelte action: `use:hudSize={'res'}` keeps the panel's size published while it is shown. */
export function hudSize(node: HTMLElement, key: HudBoxKey) {
  const ro = new ResizeObserver(() => publish(key, node));
  ro.observe(node);
  publish(key, node);
  return {
    destroy() {
      ro.disconnect();
      hudBox[key] = 0;
      const root = document.documentElement.style;
      if (CSS_KEYS.has(key)) root.removeProperty(`--hud-${key}-h`);
      if (key === 'mini') {
        hudBox.miniW = 0;
        root.removeProperty('--hud-mini-w');
      }
      if (key === 'rail') hudBox.railW = 0;
    },
  };
}
