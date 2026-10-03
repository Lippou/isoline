<script lang="ts">
  import { onMount } from 'svelte';
  import { t, date, i18n, clock } from '../i18n/i18n.svelte';
  import { listSaves, deleteSave, type SaveInfo } from '../game/saves';
  import { startFromSave } from './launch';
  import { app, go } from '../stores/app.svelte';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import Isolines from '../components/Isolines.svelte';

  let saves: SaveInfo[] = $state([]);
  let loading = $state(true);
  onMount(async () => {
    saves = await listSaves();
    loading = false;
  });
  async function del(slot: number): Promise<void> {
    await deleteSave(slot);
    saves = await listSaves();
  }
  function newGame(): void {
    app.lobby.lan = false;
    go('lobby');
  }
</script>

<div class="page-shell" data-testid="load-game">
  <PageHeader title={t('title.load')} subtitle={t('menu.loadSubtitle')} back="play" />
  <section class="page-body table">
    {#if saves.length}
      <div class="thead" aria-hidden="true">
        <span>{t('menu.colSlot')}</span><span>{t('replay.colMap')}</span><span class="num"
          >{t('replay.colDuration')}</span
        ><span>{t('replay.colDate')}</span><span></span>
      </div>
      <ul class="scroll">
        {#each saves as s, k (s.slot)}
          <li style="--k:{Math.min(k, 12)}">
            <span class="slot"
              >{#if s.slot === 0}<Icon name="refresh" size={14} />{:else}<Icon
                  name="save"
                  size={14}
                />{/if}{s.slot === 0 ? t('menu.autosave') : t('menu.slot', { slot: s.slot })}</span
            >
            <span class="map">{s.mapName[i18n.lang] || s.mapName.en}</span>
            <span class="mono num">{clock(s.tick)}</span>
            <span class="muted">{date(Date.parse(s.date))}</span>
            <span class="racts">
              <button
                class="btn primary small"
                onclick={() => startFromSave(s.slot)}
                data-testid="load-{s.slot}"><Icon name="play" size={13} />{t('menu.load')}</button
              >
              <button
                class="btn small ghost del"
                onclick={() => del(s.slot)}
                aria-label={t('common.delete')}
                data-tip={t('common.delete')}><Icon name="trash" size={14} /></button
              >
            </span>
          </li>
        {/each}
      </ul>
    {:else if loading}
      <div class="wait">
        <Isolines mode="ripple" count={4} r0={14} step={12} duration={2.2} stagger={0.55} />
      </div>
    {:else}
      <div class="empty-state">
        <div class="motif">
          <Isolines mode="static" cx={0.46} cy={0.46} count={5} r0={8} step={7} seed={33} indexEvery={5} />
        </div>
        <h3>{t('menu.noSavesTitle')}</h3>
        <p>{t('menu.noSavesHint')}</p>
        <div class="acts">
          <button class="btn primary" onclick={newGame}
            ><Icon name="play" size={15} />{t('profile.playFirst')}</button
          >
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  /* The saves, printed as a newspaper's table: an ink rule over the heads, a fine rule
     between the rows. */
  .table {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    align-content: start;
    align-self: start;
    max-height: 100%;
    overflow: hidden;
  }
  .thead,
  li {
    display: grid;
    grid-template-columns: 13em minmax(0, 1fr) 6em 13em 9em;
    gap: 16px;
    align-items: center;
    padding: 8px 6px;
  }
  .thead {
    padding-top: 4px;
    padding-bottom: 5px;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.9em;
    color: var(--np-ink-2);
    border-bottom: 1px solid var(--np-ink);
  }
  .num {
    text-align: right;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    min-height: 0;
  }
  li {
    border-bottom: 1px solid var(--np-rule);
    animation: row-in 0.3s calc(var(--k) * 30ms) ease-out both;
    transition: background 0.14s;
  }
  @keyframes row-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  li:hover {
    background: var(--np-card);
  }
  .slot {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    font-weight: 600;
  }
  .slot :global(svg) {
    color: var(--np-ink-2);
  }
  .map {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.08em;
  }
  .muted {
    color: var(--np-ink-2);
    font-variant-numeric: tabular-nums;
  }
  .racts {
    display: flex;
    gap: 2px;
    justify-content: flex-end;
  }
  .del:hover,
  .del:focus-visible {
    color: var(--np-spot);
  }
  .wait {
    position: relative;
    height: 220px;
    color: var(--np-sea);
  }
  .motif {
    position: relative;
    width: 120px;
    height: 120px;
    color: var(--np-sea);
    margin-bottom: 4px;
  }
</style>
