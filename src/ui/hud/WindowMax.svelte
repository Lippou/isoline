<script lang="ts">
  // The maximise button of a HUD window's masthead (beside its close button): reading
  // mode, the window over the whole room and the columns folded into the reading strip
  // (zones.ts). Pressed again, the window goes back to its place in the stage. The window
  // remembers which way it opens. Outside a window (the game menu) there is none.
  import { getContext } from 'svelte';
  import { t } from '../i18n/i18n.svelte';
  import { isMax, toggleMax, type WinId } from '../stores/windows.svelte';
  import Icon from '../icons/Icon.svelte';

  const win = getContext<WinId | undefined>('iso-window');
  const max = $derived(win ? isMax(win) : false);
</script>

{#if win}
  <button
    class="max"
    onclick={() => toggleMax(win)}
    aria-pressed={max}
    aria-label={t(max ? 'window.restore' : 'window.maximize')}
    data-tip={t(max ? 'window.restoreTip' : 'window.maximizeTip')}
    data-testid="window-max"><Icon name={max ? 'collapse' : 'expand'} size={15} /></button
  >
{/if}

<style>
  .max {
    position: absolute;
    top: 8px;
    right: 38px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .max:hover,
  .max:focus-visible {
    background: var(--np-paper-2);
    color: var(--np-ink);
  }
  .max[aria-pressed='true'] {
    color: var(--np-ink);
  }
</style>
