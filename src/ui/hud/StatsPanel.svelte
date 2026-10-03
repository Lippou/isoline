<script lang="ts">
  // Statistics, printed on the journal's paper: the masthead dates the reading and ranks
  // us; then the figures of the game as box scores (land, economy, war), the deposits we
  // hold, and the curves of territory, troops and gold.
  import './paper.css';
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, short, num, clock, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import type { GameController } from '../game/controller';
  import { RESOURCE_KEYS } from '../../core/map/terrain';
  import Chart from './Chart.svelte';
  import PaperMast from './PaperMast.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  const me = $derived(hud.players.find((p) => p.id === hud.viewer));
  const start = $derived(hud.world?.startTick ?? 0);
  const mapName = $derived.by(() => {
    const n = ctl.session.state.meta.name;
    return n ? n[i18n.lang] || n.en : '';
  });
  /** Our place among the countries still standing, by land. */
  const standing = $derived(hud.players.filter((p) => p.alive && p.spawned && p.kind !== 'tribe'));
  const rank = $derived(me ? 1 + standing.filter((p) => p.id !== me.id && p.tiles > me.tiles).length : 0);
  const since = (tick: number) => clock(Math.max(0, tick - start));
  const span = $derived.by((): [string, string] | null => {
    const a = hud.history[0];
    const b = hud.history.at(-1);
    return a && b && b.tick > a.tick ? [since(a.tick), since(b.tick)] : null;
  });

  /** The box scores: three short columns of figures. */
  const groups = $derived.by(() => {
    if (!L || !me) return [];
    const st = L.stats;
    return [
      {
        key: 'land',
        rows: [
          ['stats.tiles', num(me.tiles)],
          ['stats.conquered', num(st.tilesConquered)],
          ['stats.lost', num(st.tilesLost)],
        ],
      },
      {
        key: 'economy',
        rows: [
          ['stats.goldEarned', short(st.goldEarned)],
          ['stats.trade', short(st.tradeGold)],
          ['stats.trains', short(st.trainGold)],
          ['stats.buildings', num(st.buildingsBuilt)],
        ],
      },
      {
        key: 'war',
        rows: [
          ['stats.killed', short(st.enemiesKilled)],
          ['stats.troopsLost', short(st.troopsLost)],
          ['stats.shipsSunk', num(st.shipsSunk)],
          ['stats.nukes', num(st.nukesLaunched)],
          ['stats.intercepts', num(st.nukesIntercepted)],
        ],
      },
    ] as { key: string; rows: [string, string][] }[];
  });
  const DEPOSIT_ICONS = ['gold', 'oil', 'uranium', 'fertile', 'metals'] as const;
  // Curves in the paper's inks: our land in our country's ink, troops in navy, gold in brass.
  const TROOPS_INK = '#172a3c';
  const GOLD_INK = '#b8862a';
</script>

<div class="paper newsprint np-window stats">
  <PaperMast title={t('panel.stats')} onclose={() => (hud.panels.stats = false)}>
    <p class="np-dateline">
      <span>{mapName}</span>
      <b>{t('stats.asOf', { clock: since(hud.tick) })}</b>
      {#if rank}<span>{t('stats.rank', { n: rank, total: standing.length })}</span>{/if}
    </p>
  </PaperMast>

  <div class="np-body scroll">
    {#if L && me}
      <div class="scores">
        {#each groups as g (g.key)}
          <section>
            <h3 class="np-kicker">{t(`stats.group.${g.key}`)}</h3>
            <dl class="np-figures">
              {#each g.rows as [label, value] (label)}
                <dt>{t(label)}</dt>
                <dd>{value}</dd>
              {/each}
            </dl>
          </section>
        {/each}
      </div>

      <h3 class="np-mark">{t('stats.resources')}</h3>
      <ul class="deposits">
        {#each [1, 2, 3, 4] as r (r)}
          <li class:none={!L.resources[r - 1]}>
            <Icon name={DEPOSIT_ICONS[r] ?? 'gold'} size={13} />{t(`resource.${RESOURCE_KEYS[r]}`)}
            <b>×{L.resources[r - 1]}</b>
          </li>
        {/each}
      </ul>

      <h3 class="np-mark">{t('stats.timeline')}</h3>
      <Chart
        {span}
        series={[
          {
            label: t('stats.tiles'),
            color: inkHex(me.color, settings.access.vision),
            values: hud.history.map((h) => h.tiles),
          },
        ]}
      />
      <Chart
        {span}
        series={[
          { label: t('hud.army'), color: TROOPS_INK, values: hud.history.map((h) => h.troops) },
          { label: t('hud.gold'), color: GOLD_INK, values: hud.history.map((h) => h.gold) },
        ]}
      />
    {/if}
  </div>
</div>

<style>
  /* Box scores: columns of figures as the sports pages print them, a rule between them;
     as many columns as the window holds, balanced. */
  .scores {
    columns: 150px;
    column-gap: 24px;
    column-rule: 1px solid var(--np-rule);
    padding-top: 10px;
  }
  .scores section {
    display: grid;
    gap: 4px;
    padding-bottom: 10px;
    break-inside: avoid;
  }
  .scores h3 {
    margin-bottom: 1px;
  }
  .deposits {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.82em;
    color: var(--np-ink);
  }
  .deposits li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .deposits b {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .deposits li.none {
    color: var(--np-ink-3);
  }
  .deposits li.none b {
    font-weight: 400;
  }
</style>
