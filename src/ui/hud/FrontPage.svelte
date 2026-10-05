<script lang="ts">
  // The final edition of the Courier, page 1: the front page that tells the game once it
  // is over. The masthead and its dateline, the headline about the winner, a lead
  // paragraph, the empire over time (maps and the share of the land), the turning
  // points (each one can be watched again in the replay) and the reader's fate. The
  // sheet, the page turns and the actions are the paper's (FinalEdition.svelte).
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';
  import EmpireMaps from './EmpireMaps.svelte';
  import ShareChart from './ShareChart.svelte';
  import Masthead from './Masthead.svelte';
  import PressPhoto from './PressPhoto.svelte';
  import { hasPressPhoto } from './pressPhotos';
  import { hud, openPaper } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex, inkRgb } from '../../render/colors';
  import { flagUrl } from '../../render/flags';
  import { canWatch as watchable, watchFrom, takeOverFrom, LEAD_TICKS } from './paperActions';
  import type { GameController } from '../game/controller';
  import type { EdPlayer } from '../game/chronicle';
  import {
    clockText,
    entityOf,
    entitySeries,
    fateOf,
    headline,
    leadInfo,
    leadParagraph,
    pctText,
    peakOf,
    ranking,
    render,
    shareSeries,
    teamMode,
    teamName,
    turningPoints,
    winnerEntity,
    type ChartSeries,
    type Line,
    type Tx,
    type TurningKind,
  } from './frontPage';

  let { ctl }: { ctl: GameController } = $props();
  // The edition never changes once printed (only its language can).
  // svelte-ignore state_referenced_locally
  const ed = ctl.edition!;
  const lead = leadInfo(ed);
  const head = headline(ed, lead);
  const leadLines = leadParagraph(ed, lead);
  const points = turningPoints(ed, lead);
  const fate = fateOf(ed);
  const teams = teamMode(ed);
  const winE = winnerEntity(ed);

  const tx: Tx = {
    t,
    name: (id) => ctl.session.state.name(id, i18n.lang),
    get lang() {
      return i18n.lang;
    },
  };
  const say = (l: Line) => render(ed, l, tx);
  const name = (id: number) => {
    const r = ed.roster.find((x) => x.id === id);
    return r ? r.name[i18n.lang] || r.name.en : ctl.session.state.name(id, i18n.lang);
  };
  const player = (id: number): EdPlayer | undefined => ed.roster.find((r) => r.id === id);

  // ---------------------------------------------------------------- inks
  const colors = $derived(ed.roster.map((r) => inkRgb(r.color, settings.access.vision)));
  const viewerE = $derived.by(() => {
    const me = player(ed.viewer);
    return me ? entityOf(ed, me) : 0;
  });
  const strong = $derived(
    new Set(ed.roster.flatMap((r, i) => (entityOf(ed, r) === winE || r.id === ed.viewer ? [i] : []))),
  );
  /** The reader's roster index (their land hatched on the maps); -1 for a spectator. */
  const readerIndex = $derived(ed.roster.findIndex((r) => r.id === ed.viewer));
  const youLabel = (id: number) => t('front.maps.you', { name: name(id) });
  const legend = $derived.by(() => {
    void i18n.lang;
    const out: { label: string; color: [number, number, number]; hatched?: boolean }[] = [];
    const win = ed.roster.findIndex((r) => entityOf(ed, r) === winE);
    if (win >= 0)
      out.push({
        label: teams && ed.winnerTeam > 0 ? teamName(ed, ed.winnerTeam, tx) : name(ed.roster[win]!.id),
        color: colors[win]!,
      });
    const me = ed.roster.findIndex((r) => r.id === ed.viewer);
    if (me >= 0 && entityOf(ed, ed.roster[me]!) !== winE)
      out.push({ label: youLabel(ed.viewer), color: colors[me]!, hatched: true });
    else if (me >= 0 && out[0]) {
      out[0].label = youLabel(ed.viewer);
      out[0].hatched = true;
    }
    return out;
  });

  /** The chart: the winner and the reader in their ink, the main rivals as faint lines. */
  const series = $derived.by((): ChartSeries[] => {
    void i18n.lang;
    if (teams) {
      const keys = [...new Set(ed.roster.map((r) => entityOf(ed, r)))];
      return keys.map((e) => {
        const first = ed.roster.find((r) => entityOf(ed, r) === e)!;
        return {
          key: e,
          label: e < 0 ? teamName(ed, -e, tx) : name(e),
          color: inkHex(first.color, settings.access.vision),
          values: entitySeries(ed, e),
          strong: e === winE || e === viewerE,
          dashed: e === viewerE && e !== winE,
        };
      });
    }
    const others = ed.roster
      .filter((r) => r.id !== ed.winner && r.id !== ed.viewer)
      .map((r) => ({ r, peak: peakOf(ed, r.id).share }))
      .sort((a, b) => b.peak - a.peak)
      .slice(0, 7)
      .map((x) => x.r);
    const strongOnes = ed.roster.filter((r) => r.id === ed.winner || r.id === ed.viewer);
    return [...others, ...strongOnes].map((r) => ({
      key: r.id,
      label: r.id === ed.viewer ? youLabel(r.id) : name(r.id),
      color: inkHex(r.color, settings.access.vision),
      values: shareSeries(ed, r.id),
      strong: r.id === ed.winner || r.id === ed.viewer,
      dashed: r.id === ed.viewer && r.id !== ed.winner,
    }));
  });
  const threshold = ed.threshold > 0 && ed.threshold <= 100 ? ed.threshold / 100 : null;
  const marks = points.map((p, k) => ({ n: k + 1, tick: p.tick }));
  let active = $state(-1);
  let focusMark = $state(-1);

  // ------------------------------------------------------------ dateline
  const mapName = $derived(ed.mapName[i18n.lang] || ed.mapName.en);
  const day = $derived(
    new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'full' }).format(
      new Date(ed.date),
    ),
  );
  const winnerFlag = $derived(!teams && ed.winner > 0 ? player(ed.winner) : undefined);

  // -------------------------------------------------------------- replay
  const canWatch = $derived(watchable(ctl));
  const watch = (tick: number, at?: [number, number]) => watchFrom(ctl, tick - LEAD_TICKS, at);
  /** « Reprendre d'ici »: play on from just before the turning point (solo games and replays). */
  const canTakeOver = $derived(canWatch && ctl.session.kind !== 'lan' && !hud.end?.mission);
  const takeOver = (tick: number, at?: [number, number]) => takeOverFrom(ctl, tick - LEAD_TICKS, at);
  const ICONS: Record<TurningKind, IconName> = {
    fall: 'eliminated',
    betrayal: 'betrayal',
    alliance: 'alliance',
    nuke: 'nuke',
    worldEvent: 'event',
    lead: 'crown',
    offensive: 'sword',
    end: 'trophy',
  };

  const podium = $derived(
    ranking(ed)
      .slice(0, 3)
      .map((r) => ({ r, share: shareSeries(ed, r.id).at(-1) ?? 0 })),
  );
</script>

<article class="page" data-testid="front-page" aria-labelledby="fp-title">
  <Masthead
    ear={t('front.edition')}
    date={day}
    dateline={[
      mapName,
      t('front.dateline.duration', {
        duration: t('news.min', { n: Math.max(1, Math.round((ed.endTick - ed.startTick) / 600)) }),
      }),
      t('front.dateline.nations', { n: ed.roster.length }),
    ]}
  />

  <section class="head">
    <p class="kicker">{say(head.kicker)}</p>
    <div class="hl" class:flagged={!!winnerFlag}>
      {#if winnerFlag}<img src={flagUrl(winnerFlag, 128)} alt="" />{/if}
      <h2 id="fp-title">{say(head.title)}</h2>
    </div>
    <p class="deck">{say(head.deck)}</p>
  </section>

  <div class="body">
    <div class="main">
      <div class="opening">
        <p class="lead">{leadLines.map(say).join(' ')}</p>
        {#if fate}
          <aside
            class="box fate"
            class:won={fate.won}
            class:standing={fate.status.key === 'front.fate.standing'}
            aria-labelledby="fp-fate"
          >
            <h3 id="fp-fate">{t('front.fate.title')}</h3>
            <p class="status">{say(fate.status)}</p>
            {#if fate.detail}<p class="detail">{say(fate.detail)}</p>{/if}
            <dl>
              {#each fate.rows as r (r.label)}
                <dt>{t(r.label)}</dt>
                <dd>
                  <span>{say(r.value)}</span>
                  {#if canWatch && r.tick !== undefined}
                    <button
                      class="mini"
                      onclick={() => watch(r.tick!, r.at)}
                      aria-label={t('front.replayAt', { clock: clockText(r.tick - ed.startTick) })}
                      data-tip={t('front.replay')}><Icon name="rewind" size={12} /></button
                    >
                  {/if}
                </dd>
              {/each}
            </dl>
          </aside>
        {:else}
          <aside class="box" aria-labelledby="fp-podium">
            <h3 id="fp-podium">{t('front.fate.podium')}</h3>
            <ol class="podium">
              {#each podium as p, k (p.r.id)}
                <li>
                  <span class="rank">{k + 1}</span>
                  <img src={flagUrl(p.r, 48)} alt="" />
                  <span class="pn">{name(p.r.id)}</span>
                  <span class="num">{t('front.chart.pct', { share: pctText(p.share, i18n.lang) })}</span>
                </li>
              {/each}
            </ol>
          </aside>
        {/if}
      </div>

      <section class="figure" aria-labelledby="fp-maps">
        <h3 class="rule" id="fp-maps"><span>{t('front.maps.title')}</span></h3>
        <EmpireMaps
          {ed}
          {colors}
          {strong}
          {legend}
          reader={readerIndex}
          {active}
          onwatch={canWatch ? (tick) => watch(tick + 80) : null}
        />
      </section>

      <section class="figure" aria-labelledby="fp-chart">
        <h3 class="rule" id="fp-chart"><span>{t('front.chart.title')}</span></h3>
        <ShareChart {ed} {series} {marks} {threshold} {focusMark} oncursor={(tick) => (active = tick)} />
      </section>
    </div>

    <aside class="points" aria-labelledby="fp-points">
      <h3 class="rule" id="fp-points"><span>{t('front.points.title')}</span></h3>
      {#if points.length <= 1}<p class="empty">{t('front.points.empty')}</p>{/if}
      <ol>
        {#each points as p, k (k)}
          {@const pictured = p.flags.map(player).find(Boolean)}
          <li
            class={p.kind}
            onmouseenter={() => (focusMark = k + 1)}
            onmouseleave={() => (focusMark = -1)}
            onfocusin={() => (focusMark = k + 1)}
            onfocusout={() => (focusMark = -1)}
          >
            <span class="no" aria-hidden="true">{k + 1}</span>
            <div class="copy">
              <p class="when">
                <Icon name={ICONS[p.kind]} size={12} />
                <time>{clockText(p.tick - ed.startTick)}</time>
              </p>
              <h4>
                {#if pictured}<img src={flagUrl(pictured, 32)} alt="" />{/if}{say(p.title)}
              </h4>
              <p class="deck">{say(p.deck)}</p>
              {#if p.photo && hasPressPhoto(p.photo)}
                <PressPhoto id={p.photo} size="banner" caption={false} />
              {/if}
              {#if canWatch}
                <button
                  class="go"
                  onclick={() => watch(p.kind === 'end' ? p.tick - 70 : p.tick, p.at)}
                  aria-label={`${say(p.title)}. ${t('front.replayAt', { clock: clockText(p.tick - ed.startTick) })}`}
                  ><Icon name="rewind" size={12} />{t('front.replay')}</button
                >
                {#if canTakeOver && p.kind !== 'end'}
                  <button
                    class="go"
                    onclick={() => takeOver(p.tick, p.at)}
                    aria-label={`${say(p.title)}. ${t('takeover.fromHere', { clock: clockText(p.tick - LEAD_TICKS - ed.startTick) })}`}
                    data-testid="front-takeover"
                    ><Icon name="takeover" size={12} />{t('takeover.short')}</button
                  >
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ol>
    </aside>
  </div>

  {#if hud.end}
    <p class="jump">
      <button class="np-btn quiet" onclick={() => openPaper('results')} data-testid="front-jump"
        >{t('end.page.jump')}<Icon name="next" size={14} /></button
      >
    </p>
  {/if}
</article>

<style>
  .page {
    display: block;
  }
  /* Headline */
  .head {
    padding: 14px 0 14px;
    border-bottom: 1px solid var(--np-ink);
  }
  .kicker {
    margin: 0 0 4px;
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 600;
    color: var(--np-spot);
  }
  .hl {
    display: grid;
    align-items: center;
  }
  .hl.flagged {
    grid-template-columns: auto 1fr;
    gap: 18px;
  }
  .hl img {
    width: 96px;
    height: 64px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.4);
    mix-blend-mode: multiply;
  }
  h2 {
    margin: 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 3.1em;
    line-height: 1.02;
    letter-spacing: -0.02em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  .head .deck {
    margin: 8px 0 0;
    max-width: 62em;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.22em;
    line-height: 1.32;
    color: var(--np-ink);
    text-wrap: pretty;
  }

  /* Body: the story and its figures, the turning points in the side column. */
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 0 28px;
    padding-top: 14px;
  }
  .main {
    display: grid;
    gap: 16px;
    align-content: start;
    min-width: 0;
  }
  .opening {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(220px, 1fr);
    gap: 22px;
    align-items: start;
  }
  .lead {
    margin: 0;
    font-size: 0.98em;
    line-height: 1.58;
    color: var(--np-ink);
    text-wrap: pretty;
    hyphens: auto;
  }
  .lead::first-letter {
    float: left;
    margin: 4px 8px 0 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 3.6em;
    line-height: 0.82;
    color: var(--np-ink);
  }

  /* The reader's fate: a boxed item, as papers print them. */
  .box {
    padding: 10px 14px 12px;
    border: 1px solid var(--np-ink);
    box-shadow: 3px 3px 0 var(--np-paper-2);
  }
  .box h3 {
    margin: 0;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1em;
    color: var(--np-ink-2);
  }
  .status {
    margin: 2px 0 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.55em;
    line-height: 1.1;
    color: var(--np-spot);
  }
  .fate.won .status {
    color: var(--np-good);
  }
  .fate.standing .status {
    color: var(--np-ink);
  }
  .detail {
    margin: 3px 0 0;
    font-family: var(--text);
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 9px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--np-rule);
    font-family: var(--text);
    font-size: 0.8em;
  }
  dt {
    color: var(--np-ink-2);
  }
  dd {
    margin: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
    font-weight: 500;
  }
  .mini {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--np-rule);
    border-radius: 2px;
    background: transparent;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .mini:hover,
  .mini:focus-visible {
    border-color: var(--np-ink);
    color: var(--np-ink);
  }
  .podium {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-family: var(--text);
    font-size: 0.86em;
  }
  .podium li {
    display: grid;
    grid-template-columns: 1.2em 28px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }
  .podium img {
    width: 28px;
    height: 19px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .rank {
    font-family: var(--title);
    font-weight: 700;
    color: var(--np-ink-2);
  }
  .pn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }

  /* Section heads: a title on a rule. */
  .rule {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 9px;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.02em;
    color: var(--np-ink);
  }
  .rule::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--np-rule);
  }
  .figure {
    min-width: 0;
  }

  /* Turning points */
  .points {
    padding-left: 22px;
    border-left: 1px solid var(--np-rule);
    min-width: 0;
  }
  .points ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .points li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 10px;
    padding: 8px 0 9px;
  }
  .points li + li {
    border-top: 1px solid var(--np-rule);
  }
  .no {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border: 1px solid var(--np-ink-2);
    border-radius: 50%;
    font-family: var(--text);
    font-size: 0.7em;
    font-weight: 600;
    color: var(--np-ink);
  }
  .points li:hover .no,
  .points li:focus-within .no {
    background: var(--np-ink);
    border-color: var(--np-ink);
    color: var(--np-paper);
  }
  .when {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0 0 2px;
    font-family: var(--text);
    font-size: 0.74em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-3);
  }
  .fall .when,
  .betrayal .when,
  .nuke .when {
    color: var(--np-spot);
  }
  .alliance .when {
    color: var(--np-good);
  }
  h4 {
    margin: 0;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.04em;
    line-height: 1.18;
    color: var(--np-ink);
    text-wrap: balance;
  }
  h4 img {
    float: left;
    width: 24px;
    height: 16px;
    margin: 2px 7px 0 0;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .points :global(.press) {
    margin-top: 6px;
  }
  .points .deck {
    margin: 3px 0 0;
    font-size: 0.84em;
    line-height: 1.42;
    color: var(--np-ink-2);
  }
  .go {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--text);
    font-size: 0.76em;
    font-weight: 500;
    color: var(--np-ink-2);
    text-decoration: underline;
    text-decoration-color: var(--np-rule);
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .go + .go {
    margin-left: 10px;
  }
  .go:hover,
  .go:focus-visible {
    color: var(--np-ink);
    text-decoration-color: currentColor;
  }
  .empty {
    margin: 0 0 8px;
    font-style: italic;
    color: var(--np-ink-2);
  }

  /* "Continued on page 2", as papers send the reader inside. */
  .jump {
    display: flex;
    justify-content: flex-end;
    margin: 14px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--np-ink);
    font-style: italic;
  }
  .jump .np-btn {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.98em;
  }

  @media (max-width: 1100px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
    .points {
      padding: 14px 0 0;
      border-left: 0;
      border-top: 1px solid var(--np-ink);
      margin-top: 16px;
    }
    .opening {
      grid-template-columns: minmax(0, 1fr);
    }
    h2 {
      font-size: 2.4em;
    }
  }
</style>
