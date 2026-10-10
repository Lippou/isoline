<script lang="ts">
  // Beside the build cursor, before the click: what the order would do — build here, on the
  // free spot beside (buildings must stand apart: the map draws a lead to it), upgrade the
  // building there — or why it cannot, the ghost and its radius in red (game/placement.ts).
  // A slip of the Courier's paper above and right of the cursor (the hover card sits below
  // it); it follows the hovered tile, never the raw pointer, and keeps its corner, so it
  // does not jitter. Near the top of the screen it goes to the cursor's left instead.
  import { hud } from '../stores/game.svelte';
  import { t, short } from '../i18n/i18n.svelte';
  import { placementText } from '../game/placement';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS } from '../icons/icons';

  const tip = $derived.by(() => {
    const p = hud.placement;
    if (!p || hud.radial || hud.photo) return null;
    return { ...placementText(p, t, short), p };
  });
</script>

{#if tip}
  {@const low = tip.p.sy < 64}
  <div
    class="tip"
    class:bad={!tip.ok}
    class:low
    style:left="{tip.p.sx}px"
    style:top="{tip.p.sy}px"
    role="status"
    data-testid="placement-tip"
    data-error={tip.p.error}
  >
    <Icon name={tip.ok ? (BUILDING_ICONS[tip.p.kind] ?? 'city') : 'blocked'} size={13} />
    <span>{tip.text}</span>
  </div>
{/if}

<style>
  /* Touch web version: placed in the map's pixels, which start at the screen's edge (GameScreen). */
  :global(html.tactile) .tip {
    translate: calc(-1 * var(--safe-l, 0px)) calc(-1 * var(--safe-t, 0px));
  }
  .tip {
    position: absolute;
    z-index: 26;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 300px;
    padding: 3px 8px 3px 7px;
    transform: translate(16px, calc(-100% - 12px));
    background: var(--np-card);
    color: var(--np-ink);
    border: 1px solid var(--np-edge, rgba(23, 42, 60, 0.42));
    border-left: 3px solid var(--np-good);
    box-shadow: 0 1px 0 rgba(23, 42, 60, 0.12);
    font-size: 0.76em;
    font-weight: 600;
    line-height: 1.25;
    white-space: nowrap;
  }
  .tip span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tip :global(svg) {
    flex: none;
    color: var(--np-good);
  }
  .tip.bad {
    border-left-color: var(--np-spot);
  }
  .tip.bad :global(svg) {
    color: var(--np-spot);
  }
  /* Near the top: to the left of the cursor, at its height (the hover card is to the right). */
  .tip.low {
    transform: translate(calc(-100% - 14px), 6px);
  }
</style>
