<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, short, num } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { RESOURCE_KEYS } from '../../core/map/terrain';
  import Chart from './Chart.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  const me = $derived(hud.players.find((p) => p.id === hud.viewer));
  void ctl;
</script>

{#if L && me}
  <div class="grid">
    <div><span class="label">{t('stats.tiles')}</span><b class="mono">{num(me.tiles)}</b></div>
    <div>
      <span class="label">{t('stats.conquered')}</span><b class="mono">{num(L.stats.tilesConquered)}</b>
    </div>
    <div><span class="label">{t('stats.lost')}</span><b class="mono">{num(L.stats.tilesLost)}</b></div>
    <div>
      <span class="label">{t('stats.buildings')}</span><b class="mono">{num(L.stats.buildingsBuilt)}</b>
    </div>
    <div><span class="label">{t('stats.shipsSunk')}</span><b class="mono">{num(L.stats.shipsSunk)}</b></div>
    <div><span class="label">{t('stats.nukes')}</span><b class="mono">{num(L.stats.nukesLaunched)}</b></div>
    <div>
      <span class="label">{t('stats.intercepts')}</span><b class="mono">{num(L.stats.nukesIntercepted)}</b>
    </div>
    <div>
      <span class="label">{t('stats.goldEarned')}</span><b class="mono">{short(L.stats.goldEarned)}</b>
    </div>
    <div><span class="label">{t('stats.trade')}</span><b class="mono">{short(L.stats.tradeGold)}</b></div>
    <div><span class="label">{t('stats.trains')}</span><b class="mono">{short(L.stats.trainGold)}</b></div>
    <div>
      <span class="label">{t('stats.killed')}</span><b class="mono">{short(L.stats.enemiesKilled)}</b>
    </div>
    <div>
      <span class="label">{t('stats.troopsLost')}</span><b class="mono">{short(L.stats.troopsLost)}</b>
    </div>
  </div>
  <h4>{t('stats.resources')}</h4>
  <div class="res">
    {#each [1, 2, 3, 4] as r (r)}
      <span class="chip"
        ><Icon name={(['gold', 'oil', 'uranium', 'fertile', 'metals'] as const)[r] ?? 'gold'} size={13} />{t(
          `resource.${RESOURCE_KEYS[r]}`,
        )} ×{L.resources[r - 1]}</span
      >
    {/each}
  </div>
  <h4>{t('stats.timeline')}</h4>
  <Chart series={[{ label: t('stats.tiles'), color: '#6FB3D8', values: hud.history.map((h) => h.tiles) }]} />
  <Chart
    series={[
      { label: t('hud.troops'), color: '#EEF3F2', values: hud.history.map((h) => h.troops) },
      { label: t('hud.gold'), color: '#D6A53F', values: hud.history.map((h) => h.gold) },
    ]}
  />
{/if}

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }
  .grid div {
    display: grid;
    padding: 0.35rem 0.45rem;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .grid b {
    font-size: 1.05em;
  }
  h4 {
    margin: 0.8rem 0 0.3rem;
    font-family: var(--title);
  }
  .res {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
</style>
