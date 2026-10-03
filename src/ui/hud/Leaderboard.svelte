<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagUrl } from '../../render/flags';
  import type { GameController } from '../game/controller';
  import Icon from '../icons/Icon.svelte';
  import { hudSize } from '../stores/hudBox.svelte';

  let { ctl }: { ctl: GameController } = $props();
  let open = $state(true);
  let all = $state(false);
  /** Short windows show the top 5 (and us): this unfolds the top 10. */
  let more = $state(false);
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
</script>

<aside class="lb panel" class:closed={!open} class:more data-testid="leaderboard" use:hudSize={'lb'}>
  <header>
    <button class="title" onclick={() => (open = !open)}
      ><Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />{t('hud.leaderboard')}</button
    >
    {#if open}
      <span class="tools">
        {#if rows.length > 5}<button
            class="more-btn"
            aria-pressed={more}
            onclick={() => (more = !more)}
            data-testid="leaderboard-more"
            ><Icon name={more ? 'chevronDown' : 'chevronRight'} size={12} />{t('hud.lbTop', {
              n: more ? 5 : 10,
            })}</button
          >{/if}
        <label class="all"><input type="checkbox" bind:checked={all} /> {t('hud.showTribes')}</label>
      </span>
    {/if}
  </header>
  {#if open}
    <div class="cols">
      <span>#</span><span>{t('hud.colCountry')}</span><span class="r">{t('hud.colLand')}</span><span class="r"
        >{t('hud.colTroops')}</span
      >
    </div>
    <ol>
      {#each rows as r (r.p.id)}
        <li class:me={r.p.id === hud.viewer} class:extra={r.rank > 5}>
          <button onclick={() => ctl.focusPlayer(r.p.id)} title={t('hud.centerOn')}>
            <span class="rank mono">{r.rank}</span>
            <span class="who">
              <span class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></span>
              <img src={flagUrl(r.p, 24)} alt="" />
              <span class="name">{r.p.name[i18n.lang] || r.p.name.en}</span>
              {#if r.p.traitor}<span class="st bad" title={t('hud.traitorMark')}
                  ><Icon name="traitor" size={13} /></span
                >{/if}
              {#if r.p.inactive}<span class="st" title={t('hud.inactive')}
                  ><Icon name="hourglass" size={13} /></span
                >{/if}
            </span>
            <span class="mono pct">{r.share.toFixed(1)} %</span>
            <span class="mono troops">{short(r.p.troops)}</span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</aside>

<style>
  /* Top right: the standings, as the journal prints a table. */
  .lb {
    position: absolute;
    right: 12px;
    top: 12px;
    width: 310px;
    padding: 0;
    z-index: 6;
    font-size: 0.86em;
  }
  @media (max-width: 1400px) {
    .lb {
      width: 270px;
    }
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* Short windows: the top 5 (and our row), the top 10 on demand. */
  .more-btn {
    display: none;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    border: 1px solid var(--np-rule-2);
    border-radius: 2px;
    background: none;
    color: var(--np-ink-2);
    font-size: 0.85em;
    cursor: var(--cursor-pointer, pointer);
  }
  .more-btn:hover {
    color: var(--np-ink);
    border-color: var(--np-ink);
  }
  @media (max-height: 940px) {
    .more-btn {
      display: inline-flex;
    }
    .lb:not(.more) li.extra:not(.me) {
      display: none;
    }
  }
  .lb.closed {
    width: auto;
  }
  /* The title over a heavy rule. */
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0 10px;
    padding: 6px 0 5px;
    border-bottom: 2px solid var(--np-ink);
  }
  .lb.closed header {
    border-bottom: 0;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: 0;
    color: var(--np-ink);
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.12em;
    cursor: var(--cursor-pointer, pointer);
    padding: 0;
  }
  .all {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.85em;
    color: var(--np-ink-2);
  }
  .cols,
  li button {
    display: grid;
    grid-template-columns: 22px 1fr 58px 52px;
    gap: 6px;
    align-items: center;
  }
  .cols {
    margin: 0 10px;
    padding: 4px 0 3px;
    border-bottom: 1px solid var(--np-rule);
    font-family: var(--title);
    font-style: italic;
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .cols > :first-child {
    padding-left: 0;
  }
  .r {
    text-align: right;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 2px 4px 6px;
  }
  li button {
    width: 100%;
    padding: 3px 6px;
    background: none;
    border: 0;
    border-radius: 1px;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    text-align: left;
  }
  li button:hover {
    background: var(--np-card);
  }
  li + li button {
    box-shadow: 0 -1px 0 color-mix(in srgb, var(--np-rule) 55%, transparent);
  }
  /* Our own line: brass in the margin, on the darker paper. */
  li.me button {
    background: var(--np-paper-2);
    box-shadow: inset 3px 0 0 var(--np-gold);
    font-weight: 600;
  }
  .rank {
    color: var(--np-ink-3);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .ink {
    width: 3px;
    height: 14px;
    flex-shrink: 0;
  }
  img {
    width: 22px;
    height: 15px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
    flex-shrink: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .st {
    color: var(--np-ink-3);
    display: inline-flex;
  }
  .st.bad {
    color: var(--np-spot);
  }
  .pct {
    text-align: right;
    color: var(--np-ink-2);
  }
  .troops {
    text-align: right;
    color: var(--np-ink-2);
  }
</style>
