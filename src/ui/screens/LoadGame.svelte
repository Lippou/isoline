<script lang="ts">
  import { onMount } from 'svelte';
  import { t, date, i18n, clock } from '../i18n/i18n.svelte';
  import { listSaves, deleteSave, type SaveInfo } from '../game/saves';
  import { startFromSave } from './launch';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';

  let saves: SaveInfo[] = $state([]);
  onMount(async () => (saves = await listSaves()));
  async function del(slot: number): Promise<void> {
    await deleteSave(slot);
    saves = await listSaves();
  }
</script>

<div class="load" data-testid="load-game">
  <PageHeader title={t('title.load')} subtitle={t('menu.loadSubtitle')} back="play" />
  <section class="panel table">
    <div class="thead">
      <span>{t('menu.colSlot')}</span><span>{t('replay.colMap')}</span><span>{t('replay.colDuration')}</span
      ><span>{t('replay.colDate')}</span><span></span>
    </div>
    <ul class="scroll">
      {#each saves as s (s.slot)}
        <li>
          <b>{s.slot === 0 ? t('menu.autosave') : t('menu.slot', { slot: s.slot })}</b>
          <span>{s.mapName[i18n.lang] || s.mapName.en}</span>
          <span class="mono">{clock(s.tick)}</span>
          <span class="muted">{date(Date.parse(s.date))}</span>
          <span class="acts">
            <button
              class="btn primary small"
              onclick={() => startFromSave(s.slot)}
              data-testid="load-{s.slot}"><Icon name="play" size={13} />{t('menu.load')}</button
            >
            <button
              class="btn small danger"
              onclick={() => del(s.slot)}
              aria-label={t('common.delete')}
              data-tip={t('common.delete')}><Icon name="trash" size={14} /></button
            >
          </span>
        </li>
      {:else}
        <li class="empty muted">{t('menu.noSaves')}</li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .load {
    position: fixed;
    inset: 0;
    padding: 18px 22px;
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--abyss);
  }
  .table {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    max-width: 1000px;
    width: 100%;
    justify-self: center;
    align-self: start;
  }
  .thead,
  li {
    display: grid;
    grid-template-columns: 10em 1fr 6em 12em auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
  }
  .thead {
    font-size: 0.74em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faint);
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  .empty {
    display: block;
    padding: 30px;
    text-align: center;
  }
  .muted {
    color: var(--faint);
  }
  .acts {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
</style>
