<script lang="ts">
  // The masthead of a window printed on the paper, as the journal's: the title over a
  // heavy rule, then what the window adds under it (its dateline, sections, tools).
  // It is the window's title bar: the window is dragged by it (Window.svelte).
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';

  let { title, onclose, children }: { title: string; onclose: () => void; children?: Snippet } = $props();
</script>

<header class="mast">
  <button class="x" onclick={onclose} aria-label={t('common.close')}><Icon name="close" size={16} /></button>
  <h2>{title}</h2>
  {@render children?.()}
</header>

<style>
  .mast {
    position: relative;
    padding: 11px 18px 0;
  }
  .x {
    position: absolute;
    top: 8px;
    right: 8px;
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
  .x:hover {
    background: var(--np-paper-2);
    color: var(--np-ink);
  }
  h2 {
    margin: 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.45em;
    line-height: 1;
    letter-spacing: -0.012em;
    text-align: center;
    padding: 0 26px 7px;
    border-bottom: 3px solid var(--np-ink);
    color: var(--np-ink);
  }
  /* The dateline: figures between two fine rules, under the heavy one. */
  .mast :global(.np-dateline) {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 1px 12px;
    margin: 2px 0 0;
    padding: 5px 0 4px;
    border-top: 1px solid var(--np-ink);
    border-bottom: 1px solid var(--np-ink);
    font-family: var(--text);
    font-size: 0.78em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
  }
  .mast :global(.np-dateline b) {
    color: var(--np-ink);
    font-weight: 600;
  }
  /* Sections, as the journal's: words over a rule, the chosen one underlined in ink. */
  .mast :global(.np-tabs) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0 16px;
    padding: 6px 0 0;
    border-bottom: 1px solid var(--np-rule);
  }
  .mast :global(.np-tabs > button) {
    appearance: none;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 2px 0 5px;
    background: none;
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 500;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .mast :global(.np-tabs > button:hover) {
    color: var(--np-ink);
  }
  .mast :global(.np-tabs > button.on) {
    color: var(--np-ink);
    border-bottom-color: var(--np-ink);
  }
</style>
