<script lang="ts">
  // The masthead of a menu page, as the Courier's: the page's name over a heavy rule, then
  // the dateline between fine rules (what the page is for, and the day's date). The way
  // back sits in the left margin, the page's own tools in the right one.
  import type { Snippet } from 'svelte';
  import { go, type Screen } from './stores/app.svelte';
  import { t, i18n } from './i18n/i18n.svelte';
  import Icon from './icons/Icon.svelte';

  let {
    title,
    subtitle = '',
    back = 'title',
    onback,
    actions,
    dateline,
    wide = false,
  }: {
    title: string;
    /** Spans the whole page instead of the centred 1200 px column. */
    wide?: boolean;
    subtitle?: string;
    back?: Screen;
    onback?: () => void;
    actions?: Snippet;
    /** Replaces the dateline's content (the subtitle and the date), e.g. with tools. */
    dateline?: Snippet;
  } = $props();

  const today = $derived(
    new Date().toLocaleDateString(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );
</script>

<header class="ph" class:wide>
  <div class="head">
    <button class="back" onclick={() => (onback ? onback() : go(back))}
      ><Icon name="back" size={15} /><span>{t('common.back')}</span></button
    >
    <h1>{title}</h1>
    <div class="acts">
      {#if actions}{@render actions()}{/if}
    </div>
  </div>
  <div class="dateline">
    {#if dateline}{@render dateline()}{:else}
      <span class="sub">{subtitle}</span>
      <span class="day">{today}</span>
    {/if}
  </div>
</header>

<style>
  .ph {
    width: min(100%, 1200px);
    justify-self: center;
    display: grid;
  }
  .ph.wide {
    width: 100%;
  }
  .head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: end;
    gap: 16px;
    padding-bottom: 8px;
    border-bottom: 3px solid var(--np-ink, var(--parchment));
  }
  h1 {
    font-family: var(--title);
    font-weight: 700;
    font-size: 2.3em;
    line-height: 1;
    letter-spacing: -0.015em;
    text-align: center;
    color: var(--np-ink, var(--parchment));
    text-wrap: balance;
  }
  .back {
    justify-self: start;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px 5px 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    font-family: var(--text);
    font-size: 0.9em;
    font-weight: 500;
    color: var(--np-ink-2, var(--muted));
    cursor: var(--cursor-pointer, pointer);
    transition:
      border-color 0.14s,
      color 0.14s;
  }
  .back:hover,
  .back:focus-visible {
    border-color: var(--np-rule, var(--line));
    color: var(--np-ink, var(--parchment));
  }
  .acts {
    justify-self: end;
    align-self: center;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .acts :global(.btn) {
    padding: 0.35em 0.8em;
    font-size: 0.9em;
  }
  /* Touch web version (tactile.ts) on a phone: the title on its own line under « Back », smaller;
     on a short screen (a phone in landscape) the header tightens to leave room to the page. */
  @media (max-width: 599px) {
    :global(html.tactile) .head {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'back acts' 'title title';
      row-gap: 6px;
    }
    :global(html.tactile) .back {
      grid-area: back;
    }
    :global(html.tactile) .acts {
      grid-area: acts;
    }
    :global(html.tactile) h1 {
      grid-area: title;
      font-size: 1.9em;
    }
  }
  @media (max-height: 500px) {
    :global(html.tactile) h1 {
      font-size: 1.6em;
    }
    :global(html.tactile) .head {
      padding-bottom: 4px;
    }
    :global(html.tactile) .dateline {
      padding: 2px 0;
    }
  }
  /* The dateline: a fine rule under the heavy one, as a newspaper's. */
  .dateline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 2px 18px;
    margin: 2px 0 0;
    padding: 5px 0 5px;
    border-top: 1px solid var(--np-ink, var(--parchment));
    border-bottom: 1px solid var(--np-ink, var(--parchment));
    font-size: 0.86em;
    line-height: 1.4;
    color: var(--np-ink-2, var(--muted));
  }
  .sub {
    font-family: var(--np-serif, var(--text));
    font-style: italic;
    min-width: 0;
    text-wrap: pretty;
  }
  .day {
    display: inline-block;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .day::first-letter {
    text-transform: uppercase;
  }
  .day:empty {
    display: none;
  }
</style>
