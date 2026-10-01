<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagDataUrl } from '../../render/flags';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  let open = $state(true);
  let all = $state(false);
  const rows = $derived.by(() => {
    const list = hud.players
      .filter((p) => p.alive && p.tiles > 0 && (all || p.kind !== 'tribe'))
      .sort((a, b) => b.tiles - a.tiles);
    const total = Math.max(1, hud.world?.usefulLand ?? 1);
    const top = list.slice(0, 10).map((p, k) => ({ p, rank: k + 1, share: (p.usefulTiles / total) * 100 }));
    const meIdx = list.findIndex((p) => p.id === hud.viewer);
    if (meIdx >= 10)
      top.push({ p: list[meIdx]!, rank: meIdx + 1, share: (list[meIdx]!.usefulTiles / total) * 100 });
    return top;
  });

  function focus(id: number): void {
    const p = ctl.session.state.players.get(id);
    if (p)
      ctl.renderer.camera.goTo(
        p.label[0],
        p.label[1],
        Math.max(1.2, Math.min(6, 400 / Math.max(10, p.label[2] * 4))),
      );
  }
</script>

<aside class="lb glass" class:closed={!open} data-testid="leaderboard">
  <header>
    <button class="title" onclick={() => (open = !open)}>{open ? '▾' : '▸'} {t('hud.leaderboard')}</button>
    {#if open}<label class="all"><input type="checkbox" bind:checked={all} /> {t('hud.showTribes')}</label
      >{/if}
  </header>
  {#if open}
    <ol>
      {#each rows as r (r.p.id)}
        <li class:me={r.p.id === hud.viewer}>
          <button onclick={() => focus(r.p.id)} title={t('hud.centerOn')}>
            <span class="rank mono">{r.rank}</span>
            <span class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></span>
            <img src={flagDataUrl(r.p.flagSeed, 24)} alt="" />
            <span class="name"
              >{r.p.name[i18n.lang] || r.p.name.en}{#if r.p.traitor}
                <span title={t('hud.traitorMark')}>💔</span>{/if}{#if r.p.inactive}
                <span class="zzz">Zzz</span>{/if}</span
            >
            <span class="mono pct">{r.share.toFixed(1)}%</span>
            <span class="mono troops">{short(r.p.troops)}</span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</aside>

<style>
  .lb {
    position: absolute;
    right: 12px;
    top: 12px;
    width: calc(290px * var(--ui-scale));
    padding: 0.5rem 0.55rem;
    z-index: 6;
    font-size: calc(0.86em * var(--ui-scale));
  }
  .lb.closed {
    width: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .title {
    background: none;
    border: 0;
    cursor: pointer;
    font-family: var(--title);
    font-size: 1.02em;
    color: var(--parchment);
  }
  .all {
    font-size: 0.82em;
    color: var(--faint);
    display: flex;
    gap: 0.3em;
    align-items: center;
  }
  ol {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  li button {
    width: 100%;
    display: grid;
    grid-template-columns: 1.4em 6px 18px 1fr auto auto;
    gap: 0.4rem;
    align-items: center;
    background: none;
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 0.2rem 0.35rem;
    cursor: pointer;
    text-align: left;
  }
  li button:hover {
    background: rgba(79, 227, 193, 0.08);
    border-color: var(--line);
  }
  li.me button {
    background: rgba(242, 184, 75, 0.1);
    border-color: rgba(242, 184, 75, 0.35);
  }
  .rank {
    color: var(--faint);
  }
  .ink {
    width: 6px;
    height: 16px;
    border-radius: 3px;
  }
  img {
    width: 18px;
    height: 12px;
    border-radius: 2px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pct {
    color: var(--aurora);
  }
  .troops {
    color: var(--muted);
    min-width: 3.4em;
    text-align: right;
  }
  .zzz {
    color: var(--faint);
    font-size: 0.8em;
  }
</style>
