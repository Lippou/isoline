<script lang="ts">
  // The Courier's masthead. In full on the first page of the paper (ears, title,
  // dateline); as a running head on the inside pages (title, page, date on one line).
  import { t } from '../i18n/i18n.svelte';

  let {
    full = true,
    ear,
    date,
    dateline = null,
  }: {
    full?: boolean;
    /** Left ear (full) or the page's name (running head), printed in the spot ink. */
    ear: string;
    date: string;
    /** Full masthead: the three cells of the dateline (place, middle, right). */
    dateline?: [string, string, string] | null;
  } = $props();
</script>

{#if full}
  <header class="mast">
    <p class="ears"><span>{ear}</span><span>{date}</span></p>
    <p class="title">{t('news.masthead')}</p>
    {#if dateline}
      <p class="dateline">
        <span>{dateline[0]}</span><span class="mid">{dateline[1]}</span><span class="end">{dateline[2]}</span>
      </p>
    {/if}
  </header>
{:else}
  <header class="running">
    <span class="title">{t('news.masthead')}</span>
    <span class="page">{ear}</span>
    <span class="date">{date}</span>
  </header>
{/if}

<style>
  .mast {
    text-align: center;
  }
  .ears {
    display: flex;
    justify-content: space-between;
    margin: 0 30px 4px 0;
    font-family: var(--text);
    font-size: 0.78em;
    color: var(--np-ink-2);
  }
  .ears span:first-child {
    font-weight: 600;
    color: var(--np-spot);
  }
  .mast .title {
    margin: 0;
    padding-bottom: 8px;
    border-bottom: 3px solid var(--np-ink);
    font-family: var(--title);
    font-weight: 700;
    font-size: 2.7em;
    line-height: 1;
    letter-spacing: -0.016em;
    color: var(--np-ink);
  }
  .dateline {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 10px;
    margin: 2px 0 0;
    padding: 5px 0 4px;
    border-top: 1px solid var(--np-ink);
    border-bottom: 1px solid var(--np-ink);
    font-family: var(--text);
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
  }
  .dateline span:first-child {
    text-align: left;
  }
  .dateline .mid {
    font-weight: 600;
    color: var(--np-ink);
  }
  .dateline .end {
    text-align: right;
  }

  /* Running head of an inside page. */
  .running {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: baseline;
    gap: 12px;
    margin-right: 30px;
    padding-bottom: 6px;
    border-bottom: 3px double var(--np-ink);
    font-family: var(--text);
    font-size: 0.8em;
    color: var(--np-ink-2);
  }
  .running .title {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.55em;
    letter-spacing: -0.01em;
    color: var(--np-ink);
  }
  .running .page {
    font-weight: 600;
    color: var(--np-spot);
  }
  .running .date {
    text-align: right;
  }
</style>
