<script lang="ts">
  import { onMount } from 'svelte';
  import { go } from '../stores/app.svelte';
  import { t, date, i18n, clock } from '../i18n/i18n.svelte';
  import { listSaves, deleteSave, type SaveInfo } from '../game/saves';
  import { startFromSave } from './launch';

  let saves: SaveInfo[] = $state([]);
  onMount(async () => (saves = await listSaves()));
  async function del(slot: number): Promise<void> {
    await deleteSave(slot);
    saves = await listSaves();
  }
</script>

<div class="load" data-testid="load-game">
  <header>
    <button class="btn ghost" onclick={() => go('play')}>← {t('common.back')}</button>
    <h1>{t('title.load')}</h1>
  </header>
  <ul>
    {#each saves as s (s.slot)}
      <li class="glass">
        <b>{s.slot === 0 ? t('menu.autosave') : t('menu.slot', { slot: s.slot })}</b>
        <span>{s.mapName[i18n.lang] || s.mapName.en}</span>
        <span class="mono">{clock(s.tick)}</span>
        <span class="muted">{date(Date.parse(s.date))}</span>
        <button class="btn primary" onclick={() => startFromSave(s.slot)} data-testid="load-{s.slot}"
          >{t('menu.load')}</button
        >
        <button class="btn danger" onclick={() => del(s.slot)}>🗑</button>
      </li>
    {:else}
      <li class="muted">{t('menu.noSaves')}</li>
    {/each}
  </ul>
</div>

<style>
  .load {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    background: radial-gradient(ellipse at 50% 0%, #172947, var(--abyss) 60%);
    overflow-y: auto;
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0.6rem;
    max-width: 900px;
  }
  li {
    display: grid;
    grid-template-columns: 9em 1fr 5em 12em auto auto;
    gap: 0.8rem;
    align-items: center;
    padding: 0.7rem 0.9rem;
  }
  .muted {
    color: var(--faint);
  }
</style>
