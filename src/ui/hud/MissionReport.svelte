<script lang="ts">
  // The final edition after a campaign mission, page 1: the mission communiqué. The
  // verdict (mission accomplished or failed), the stars, the advisor's debrief, the
  // objectives one by one and the figures of the mission; the results are page 2.
  // Its data is the MissionResult the campaign hands to `ctl.endMission` (missionResult.ts).
  import Icon from '../icons/Icon.svelte';
  import Masthead from './Masthead.svelte';
  import { hud, openPaper } from '../stores/game.svelte';
  import { t, i18n, short, num } from '../i18n/i18n.svelte';
  import { clockText } from './frontPage';
  import type { GameController } from '../game/controller';
  import type { MissionResult } from '../game/missionResult';

  let { ctl, result }: { ctl: GameController; result: MissionResult } = $props();

  const stats = hud.end!.stats;
  const me = stats.players.find((p) => p.id === ctl.session.viewer);
  // Texts in the reader's language (the result can write itself again).
  const r = $derived.by(() => {
    void i18n.lang;
    return result.localize?.() ?? result;
  });
  const max = $derived(r.maxStars ?? 3);
  const day = $derived(
    new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'full' }).format(new Date()),
  );
  const mapName = $derived.by(() => {
    const n = ctl.session.state.meta?.name;
    return n ? n[i18n.lang] || n.en : ctl.session.config.mapId;
  });
  const duration = clockText(stats.tick - stats.startTick);
  const figures = $derived.by(() => {
    void i18n.lang;
    const out: [string, string][] = [[t('end.results.duration'), duration]];
    if (me) {
      out.push([t('end.results.final'), short(me.tiles)]);
      out.push([t('stats.maxTiles'), short(me.stats.maxTiles)]);
      out.push([t('stats.conquered'), short(me.stats.tilesConquered)]);
      out.push([t('stats.buildings'), num(me.stats.buildingsBuilt)]);
      out.push([t('stats.goldEarned'), short(me.stats.goldEarned)]);
      out.push([t('stats.killed'), short(me.stats.enemiesKilled)]);
      if (me.stats.nukesLaunched) out.push([t('stats.nukes'), num(me.stats.nukesLaunched)]);
    }
    return out;
  });
</script>

<article class="page" class:failed={!r.success} aria-labelledby="mr-title">
  <Masthead
    ear={t('end.mission.ear')}
    date={day}
    dateline={[
      mapName,
      r.index && r.total ? t('end.mission.number', { n: r.index, of: r.total }) : t('mode.campaign'),
      t('end.mission.lasted', { clock: duration }),
    ]}
  />

  <section class="head">
    <p class="kicker">{t('end.mission.kicker', { title: r.title })}</p>
    <h2 id="mr-title">{r.success ? t('end.missionComplete') : t('end.missionFailed')}</h2>
    <p class="stars" role="img" aria-label={t('end.mission.starsLabel', { n: r.stars, max })}>
      {#each Array.from({ length: max }, (_, k) => k) as k (k)}
        <span class:got={k < r.stars}><Icon name="star" size={30} stroke={1.6} /></span>
      {/each}
      {#if r.best !== undefined && r.best > r.stars}
        <span class="best">{t('end.mission.best', { n: r.best, max })}</span>
      {/if}
    </p>
  </section>

  <div class="body">
    <div class="main">
      {#if r.debrief}
        <blockquote class="debrief">
          <p>{r.debrief}</p>
          {#if r.speaker}<footer>— {r.speaker}</footer>{/if}
        </blockquote>
      {/if}

      <section aria-labelledby="mr-objectives">
        <h3 class="np-rule" id="mr-objectives"><span>{t('end.mission.objectives')}</span></h3>
        <ul class="objectives">
          {#each r.objectives as o, k (k)}
            <li class:done={o.done}>
              <span class="mark" aria-hidden="true"
                ><Icon name={o.done ? 'check' : 'close'} size={15} stroke={2.4} /></span
              >
              <span class="what">
                {#if o.bonus}<span class="tag">{t('end.mission.bonus')}</span>{/if}
                {o.text}
                {#if o.detail}<span class="detail">{o.detail}</span>{/if}
              </span>
              <span class="state">
                {#if o.star}<Icon name="star" size={13} />{/if}
                {o.done ? t('end.mission.done') : t('end.mission.missed')}
              </span>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <aside class="np-box" aria-labelledby="mr-figures">
      <h3 id="mr-figures">{t('end.mission.figures')}</h3>
      <dl class="np-figures">
        {#each figures as [k, v] (k)}<dt>{k}</dt>
          <dd>{v}</dd>{/each}
      </dl>
      {#if r.success}
        <p class="next">
          {r.next ? t('end.mission.nextUp', { title: r.next.title }) : t('end.mission.last')}
        </p>
      {:else}
        <p class="next">{t('end.mission.again')}</p>
      {/if}
    </aside>
  </div>

  <p class="jump">
    <button class="np-btn quiet" onclick={() => openPaper('results')} data-testid="mission-jump"
      >{t('end.page.jumpMission')}<Icon name="next" size={14} /></button
    >
  </p>
</article>

<style>
  .head {
    padding: 16px 0 14px;
    border-bottom: 1px solid var(--np-ink);
    text-align: center;
  }
  .kicker {
    margin: 0 0 4px;
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 600;
    color: var(--np-ink-2);
  }
  h2 {
    margin: 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 3.2em;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--np-ink);
  }
  .failed h2 {
    color: var(--np-spot);
  }
  .stars {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 6px;
    margin: 10px 0 0;
    color: var(--np-rule);
  }
  .stars .got {
    color: var(--np-ink);
  }
  .stars .got :global(svg) {
    fill: currentColor;
  }
  .best {
    margin-left: 10px;
    font-family: var(--text);
    font-size: 0.8em;
    color: var(--np-ink-2);
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 0 28px;
    padding-top: 16px;
    align-items: start;
  }
  .main {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .debrief {
    margin: 0;
    padding: 0 0 0 18px;
    border-left: 3px solid var(--np-ink);
  }
  .debrief p {
    margin: 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.32em;
    line-height: 1.35;
    color: var(--np-ink);
    text-wrap: pretty;
  }
  .debrief footer {
    margin-top: 6px;
    font-family: var(--text);
    font-size: 0.84em;
    font-weight: 600;
    color: var(--np-ink-2);
  }
  .objectives {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .objectives li {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--np-rule);
    font-size: 1em;
    color: var(--np-ink);
  }
  .mark {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1.5px solid var(--np-spot);
    border-radius: 50%;
    color: var(--np-spot);
  }
  li.done .mark {
    border-color: var(--np-ink);
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .tag {
    margin-right: 6px;
    padding: 0 5px;
    border: 1px solid var(--np-ink-2);
    border-radius: 2px;
    font-family: var(--text);
    font-size: 0.72em;
    font-weight: 600;
    color: var(--np-ink-2);
    vertical-align: 1px;
  }
  .detail {
    margin-left: 6px;
    font-family: var(--text);
    font-size: 0.8em;
    color: var(--np-ink-3);
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 600;
    color: var(--np-spot);
  }
  li.done .state {
    color: var(--np-ink);
  }
  .next {
    margin: 10px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--np-rule);
    font-style: italic;
    font-size: 0.9em;
    color: var(--np-ink);
  }
  .jump {
    display: flex;
    justify-content: flex-end;
    margin: 14px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--np-ink);
  }
  .jump .np-btn {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.98em;
  }
  @media (max-width: 1100px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
      gap: 16px;
    }
  }
</style>
