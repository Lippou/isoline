// The HUD panels the others lay out around: the resources panel (bottom left), the build
// bar (bottom centre) and the minimap (bottom right) change height with the game (lists
// of attacks, a bar folded on two rows, a tall map). Their sizes are published here and
// as CSS variables on the document (--hud-res-h, --hud-bar-h, --hud-mini-h, --hud-mini-w),
// so the dock, the column of cards, the windows and the banners keep clear of them.
export type HudBoxKey = 'res' | 'bar' | 'mini';

export const hudBox = $state({ res: 0, bar: 0, mini: 0, miniW: 0 });

function publish(key: HudBoxKey, node: HTMLElement): void {
  const h = Math.round(node.offsetHeight);
  hudBox[key] = h;
  const root = document.documentElement.style;
  root.setProperty(`--hud-${key}-h`, `${h}px`);
  if (key === 'mini') {
    hudBox.miniW = Math.round(node.offsetWidth);
    root.setProperty('--hud-mini-w', `${hudBox.miniW}px`);
  }
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
      root.removeProperty(`--hud-${key}-h`);
      if (key === 'mini') {
        hudBox.miniW = 0;
        root.removeProperty('--hud-mini-w');
      }
    },
  };
}
