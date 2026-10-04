<script lang="ts">
  // The fold control of every panel over the map (1.10.0): a small square of paper, ruled
  // in ink, with a double chevron pointing where the panel folds to (and back once folded).
  // Its explanation names the panel and the key that folds the whole interface. Nothing
  // moves on hover: only the inks change. As a glyph only (`glyph`), it marks a folded tab
  // that is itself the button.
  import { t } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';

  let {
    folded,
    name,
    dir = 'down',
    tip = 'above',
    glyph = false,
    onclick,
    testid,
  }: {
    folded: boolean;
    /** The panel's name (for the explanation and screen readers). */
    name: string;
    /** Where the panel folds to. */
    dir?: 'down' | 'up' | 'right' | 'left';
    /** Where the explanation opens (away from the screen's edge). */
    tip?: 'above' | 'above-start' | 'below' | 'left' | 'right';
    glyph?: boolean;
    onclick?: (e: MouseEvent) => void;
    testid?: string;
  } = $props();

  const ROT = { down: 0, left: 90, up: 180, right: 270 };
  const turn = $derived((ROT[dir] + (folded ? 180 : 0)) % 360);
  const label = $derived(folded ? t('fold.unfold', { name }) : t('fold.fold', { name }));
  const hint = $derived(`${label} · ${t('fold.allKey', { key: keyLabel(settings.keys.hudFold ?? '') })}`);
</script>

{#snippet chevrons()}
  <svg
    class="g"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    style:transform="rotate({turn}deg)"
    ><polyline points="6 5.5 12 11.5 18 5.5" /><polyline points="6 12.5 12 18.5 18 12.5" /></svg
  >
{/snippet}

{#if glyph}
  <span class="fold glyph" aria-hidden="true">{@render chevrons()}</span>
{:else}
  <button
    type="button"
    class="fold tip-{tip}"
    aria-expanded={!folded}
    aria-label={label}
    data-tip={hint}
    data-testid={testid}
    {onclick}>{@render chevrons()}</button
  >
{/if}

<style>
  .fold {
    flex: none;
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--np-rule-2);
    border-radius: 2px;
    background: var(--np-paper);
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
    transition:
      color 0.12s,
      border-color 0.12s,
      background 0.12s;
  }
  button.fold:hover,
  button.fold:focus-visible {
    color: var(--np-ink);
    border-color: var(--np-ink);
    background: var(--np-card);
  }
  .glyph {
    cursor: inherit;
  }
  .g {
    display: block;
    transition: transform 0.16s ease-out;
  }
  :global(.reduced-motion) .g {
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .g {
      transition: none;
    }
  }
  /* The explanation away from the screen's edges (narrow enough for the news column). */
  button.fold:hover::after {
    max-width: 230px;
  }
  .fold.tip-below:hover::after {
    left: auto;
    right: -4px;
    bottom: auto;
    top: calc(100% + 6px);
    transform: none;
  }
  .fold.tip-left:hover::after {
    left: auto;
    right: calc(100% + 6px);
    bottom: auto;
    top: 50%;
    transform: translateY(-50%);
  }
  .fold.tip-right:hover::after {
    left: calc(100% + 6px);
    bottom: auto;
    top: 50%;
    transform: translateY(-50%);
  }
  .fold.tip-above:hover::after {
    left: auto;
    right: -4px;
    transform: none;
  }
  .fold.tip-above-start:hover::after {
    left: -4px;
    transform: none;
  }
</style>
