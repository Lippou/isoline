<script lang="ts">
  // Beside the pointer while a front line is drawn (input.ts, core/rules/lines.ts): what the
  // next click does — start, add a point or end, then pick the side it faces — and the
  // troops it will take (the attack ratio). The same slip as the build cursor's
  // (PlacementTip.svelte); red-edged with a blocked mark when there are no troops to spare.
  import { hud } from '../stores/game.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  const tip = $derived(hud.lineTip && !hud.radial && !hud.photo ? hud.lineTip : null);
  const icon = $derived<IconName>(
    hud.tool.k === 'line' && hud.tool.kind === 1 ? 'lineOffense' : 'lineDefense',
  );
</script>

{#if tip}
  {@const low = tip.sy < 64}
  <div
    class="tip"
    class:bad={!tip.ok}
    class:low
    style:left="{tip.sx}px"
    style:top="{tip.sy}px"
    role="status"
    data-testid="line-tip"
  >
    <Icon name={tip.ok ? icon : 'blocked'} size={13} />
    <span>{tip.text}</span>
  </div>
{/if}

<style>
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
    white-space: normal;
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
