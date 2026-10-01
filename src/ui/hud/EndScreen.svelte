<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n, num, short, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagDataUrl } from '../../render/flags';
  import { app, go } from '../stores/app.svelte';
  import { bridge } from '../bridge';
  import type { GameController } from '../game/controller';
  import Chart from './Chart.svelte';
  import { exportStatsCsv } from '../game/csv';

  let { ctl }: { ctl: GameController } = $props();
  const end = $derived(hud.end!);
  const ranking = $derived(
    end.stats.players
      .slice()
      .sort(
        (a, b) =>
          (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.tiles - a.tiles || b.eliminatedTick - a.eliminatedTick,
      )
      .slice(0, 12),
  );
  const me = $derived(end.stats.players.find((p) => p.id === ctl.session.viewer));
  const mission = $derived(
    end.stats.reason.startsWith('mission:') ? Number(end.stats.reason.split(':')[1]) : -1,
  );
  const top = $derived(ranking.slice(0, 5));
  const spectator = ctl.session.viewer <= 0;

  function again(): void {
    const req = app.launch;
    if (!req) return;
    app.launch = {
      ...req,
      config: { ...req.config, seed: (Math.random() * 2 ** 31) >>> 0 },
      snapshot: undefined,
      priorTurns: undefined,
    } as typeof req;
    go('lobby');
    setTimeout(() => go('game'), 0);
  }
  async function csv(): Promise<void> {
    await bridge.storage.exportFile(
      `isoline-stats-${Date.now()}.csv`,
      exportStatsCsv(end.stats, i18n.lang),
      'CSV',
      'csv',
    );
  }
  function replay(): void {
    go('replays');
  }
</script>

<div class="end fade-in" data-testid="end-screen">
  <div class="card glass rise-in">
    <h1 class:won={end.won || spectator}>
      {mission >= 0
        ? mission > 0
          ? t('end.missionComplete')
          : t('end.missionFailed')
        : spectator
          ? t('end.winnerIs', { name: ctl.session.state.name(end.stats.winner, i18n.lang) })
          : end.won
            ? t('end.victory')
            : t('end.defeat')}
    </h1>
    {#if mission > 0}<div class="stars">{'★'.repeat(mission)}{'☆'.repeat(3 - mission)}</div>{/if}
    <p class="sub">
      {t(`end.reason.${end.stats.reason.startsWith('mission') ? 'mission' : end.stats.reason || 'none'}`)} · {t(
        'end.duration',
      )} <b class="mono">{clock(end.stats.tick - end.stats.startTick)}</b>
    </p>
    <div class="cols">
      <section>
        <h3>{t('end.ranking')}</h3>
        <ol>
          {#each ranking as p, k (p.id)}
            <li class:me={p.id === ctl.session.viewer}>
              <span class="mono rank">{k + 1}</span>
              <img src={flagDataUrl(p.flagSeed, 24)} alt="" />
              <span class="name" style="color:{inkHex(p.color, settings.access.vision)}"
                >{p.name[i18n.lang] || p.name.en}</span
              >
              <span class="mono">{short(p.tiles)}</span>
              {#if !p.alive}<span class="dead">✝</span>{/if}
            </li>
          {/each}
        </ol>
      </section>
      <section>
        <h3>{t('end.graphs')}</h3>
        <Chart
          series={top.map((p) => ({
            label: p.name[i18n.lang] || p.name.en,
            color: inkHex(p.color, settings.access.vision),
            values: p.history.map((h) => h.tiles),
          }))}
          height={110}
        />
        {#if me}
          <Chart
            series={[
              { label: t('hud.gold'), color: '#F2B84B', values: me.history.map((h) => h.gold) },
              { label: t('hud.troops'), color: '#FF5A5F', values: me.history.map((h) => h.troops) },
            ]}
            height={80}
          />
        {/if}
      </section>
      {#if me}
        <section class="stats">
          <h3>{t('end.yourStats')}</h3>
          <dl>
            <dt>{t('stats.conquered')}</dt>
            <dd class="mono">{num(me.stats.tilesConquered)}</dd>
            <dt>{t('stats.maxTiles')}</dt>
            <dd class="mono">{num(me.stats.maxTiles)}</dd>
            <dt>{t('stats.buildings')}</dt>
            <dd class="mono">{num(me.stats.buildingsBuilt)}</dd>
            <dt>{t('stats.shipsSunk')}</dt>
            <dd class="mono">{num(me.stats.shipsSunk)}</dd>
            <dt>{t('stats.nukes')}</dt>
            <dd class="mono">{num(me.stats.nukesLaunched)}</dd>
            <dt>{t('stats.intercepts')}</dt>
            <dd class="mono">{num(me.stats.nukesIntercepted)}</dd>
            <dt>{t('stats.goldEarned')}</dt>
            <dd class="mono">{short(me.stats.goldEarned)}</dd>
            <dt>{t('stats.killed')}</dt>
            <dd class="mono">{short(me.stats.enemiesKilled)}</dd>
          </dl>
        </section>
      {/if}
    </div>
    <footer>
      {#if end.replaySaved}<span class="chip">💾 {t('end.replaySaved')}</span>{/if}
      <button class="btn" onclick={csv}>{t('end.exportCsv')}</button>
      <button class="btn" onclick={replay}>{t('end.watchReplay')}</button>
      <button class="btn" onclick={() => (hud.end = null)} data-testid="end-spectate"
        >{t('end.keepWatching')}</button
      >
      {#if mission < 0 && ctl.session.kind === 'solo'}<button class="btn" onclick={again}
          >{t('end.playAgain')}</button
        >{/if}
      <button
        class="btn primary"
        onclick={() => go(mission >= 0 ? 'campaign' : 'title')}
        data-testid="end-menu">{t('end.backToMenu')}</button
      >
    </footer>
  </div>
</div>

<style>
  .end {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(5, 9, 18, 0.62);
    z-index: 60;
  }
  .card {
    width: min(1100px, 94vw);
    max-height: 92vh;
    overflow: auto;
    padding: 1.6rem 1.8rem;
  }
  h1 {
    font-size: 2.6em;
    text-align: center;
    color: var(--signal);
  }
  h1.won {
    color: var(--brass);
    text-shadow: 0 0 30px rgba(242, 184, 75, 0.4);
  }
  .stars {
    text-align: center;
    font-size: 2em;
    color: var(--brass);
  }
  .sub {
    text-align: center;
    color: var(--muted);
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1.3fr 1fr;
    gap: 1.2rem;
    margin-top: 1rem;
  }
  h3 {
    font-size: 1.05em;
    margin-bottom: 0.5rem;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 3px;
  }
  li {
    display: grid;
    grid-template-columns: 1.5em 20px 1fr auto auto;
    gap: 0.4rem;
    align-items: center;
    padding: 0.2rem 0.3rem;
    border-radius: 6px;
  }
  li.me {
    background: rgba(242, 184, 75, 0.12);
  }
  li img {
    width: 20px;
    height: 13px;
  }
  .rank {
    color: var(--faint);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dead {
    color: var(--faint);
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 0.8rem;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
  }
  footer {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-top: 1.2rem;
    align-items: center;
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
