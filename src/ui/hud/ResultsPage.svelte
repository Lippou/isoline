<script lang="ts">
  // The final edition, page 2: results and statistics. The reader's result as the
  // headline, the final ranking (every nation: flag, territory, troops, gold, kills,
  // buildings, bombs, fate; sortable), the reader's own figures, the achievements this
  // game unlocked, the game's settings and the archives (replay, CSV). Alone (a short
  // game), it carries the full masthead.
  import Icon from '../icons/Icon.svelte';
  import Masthead from './Masthead.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n, num, short, date } from '../i18n/i18n.svelte';
  import { flagUrl } from '../../render/flags';
  import { go } from '../stores/app.svelte';
  import { ACHIEVEMENTS } from '../stores/profile.svelte';
  import { clockText, fateOf, ordinal, render, type Tx } from './frontPage';
  import {
    maxOf,
    outcomeOf,
    rankPlayers,
    shownRows,
    sortRows,
    sparkline,
    type ResultRow,
    type SortKey,
  } from './results';
  import { exportCsv, exportReplay } from './paperActions';
  import { profile } from '../stores/profile.svelte';
  import type { GameController } from '../game/controller';

  let { ctl, full = false }: { ctl: GameController; full?: boolean } = $props();

  const end = hud.end!;
  const stats = end.stats;
  // svelte-ignore state_referenced_locally
  const viewer = ctl.session.viewer;
  // svelte-ignore state_referenced_locally
  const cfg = ctl.session.config;
  // svelte-ignore state_referenced_locally
  const ed = end.mission ? null : ctl.edition;
  const rows = rankPlayers(stats, (id) => ctl.session.state.players.get(id));
  const mine = rows.find((r) => r.p.id === viewer);
  const winRow = rows.find((r) => r.p.id === stats.winner) ?? rows[0];
  /** Whose figures the side box prints: the reader's, else the winner's. */
  const subject = mine ?? winRow;
  const outcome = outcomeOf(stats, viewer, end.won);
  const teams = rows.some((r) => r.p.team > 0);
  const tx: Tx = {
    t,
    name: (id) => ctl.session.state.name(id, i18n.lang),
    get lang() {
      return i18n.lang;
    },
  };
  const name = (r: ResultRow) => r.p.name[i18n.lang] || r.p.name.en;
  const teamLabel = (team: number) =>
    t(`front.team.${cfg.mode === 'humansVsNations' ? (team === 1 ? 'humans' : 'nations') : 'n'}`, {
      n: team,
    });

  // ------------------------------------------------------------ headline
  const durationTicks = stats.tick - stats.startTick;
  const minutes = Math.max(1, Math.round(durationTicks / 600));
  const day = $derived(
    new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'full' }).format(
      new Date(ed?.date ?? Date.now()),
    ),
  );
  const mapName = $derived.by(() => {
    const n = ed?.mapName ?? ctl.session.state.meta?.name;
    return n ? n[i18n.lang] || n.en : cfg.mapId;
  });
  const reasonKey = stats.reason.startsWith('mission') ? 'mission' : stats.reason || 'none';
  const title = $derived.by(() => {
    void i18n.lang;
    if (end.mission) return t(end.won ? 'end.missionComplete' : 'end.missionFailed');
    if (outcome === 'victory') return t('end.victory');
    if (outcome === 'defeat') return t('end.defeat');
    if (outcome === 'winnerIs') return t('end.results.winnerHead', { name: winRow ? name(winRow) : '' });
    return t('end.reason.none');
  });
  const fate = ed ? fateOf(ed) : null;
  const deck = $derived.by(() => {
    void i18n.lang;
    const parts: string[] = [];
    if (fate && !fate.won) parts.push(render(ed!, fate.status, tx));
    if (mine) parts.push(t('front.fate.rank', { rank: ordinal(mine.rank, i18n.lang), n: rows.length }));
    parts.push(t('end.results.lasted', { duration: t('news.min', { n: minutes }) }));
    const text = parts.join(' · ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  const headFlag = outcome === 'winnerIs' ? winRow : (mine ?? winRow);

  // ------------------------------------------------------------- ranking
  const LIMIT = 12;
  let sortKey = $state<SortKey>('rank');
  let all = $state(false);
  const sorted = $derived(sortRows(rows, sortKey));
  const shown = $derived(all ? sorted : shownRows(sorted, viewer, LIMIT));
  const hidden = rows.length - shownRows(rows, viewer, LIMIT).length;
  const maxTiles = maxOf(rows, 'tiles');
  const COLS: { key: Exclude<SortKey, 'rank'>; label: string }[] = [
    { key: 'tiles', label: 'end.results.col.tiles' },
    { key: 'troops', label: 'end.results.col.troops' },
    { key: 'gold', label: 'end.results.col.gold' },
    { key: 'kills', label: 'end.results.col.kills' },
    { key: 'buildings', label: 'end.results.col.buildings' },
    { key: 'nukes', label: 'end.results.col.nukes' },
  ];
  const cell = (r: ResultRow, key: Exclude<SortKey, 'rank'>): string =>
    key === 'tiles'
      ? short(r.p.tiles)
      : key === 'troops'
        ? short(r.troops)
        : key === 'gold'
          ? short(r.gold)
          : key === 'kills'
            ? short(r.p.stats.enemiesKilled)
            : key === 'buildings'
              ? num(r.p.stats.buildingsBuilt)
              : num(r.p.stats.nukesLaunched);

  // ------------------------------------------------------------- figures
  const s = subject?.p.stats;
  // The territory over the game (a sample every 5 s, then the end): a minute at least.
  const series = subject ? [...subject.p.history.map((h) => h.tiles), subject.p.tiles] : [];
  const curve = series.length >= 12 && Math.max(...series) > 0 ? sparkline(series, 260, 44) : '';
  const figures = $derived.by(() => {
    void i18n.lang;
    if (!subject || !s) return [];
    const out: [string, string][] = [
      [t('end.results.final'), short(subject.p.tiles)],
      [t('stats.maxTiles'), short(s.maxTiles)],
      [t('stats.conquered'), short(s.tilesConquered)],
      [t('stats.lost'), short(s.tilesLost)],
      [t('stats.buildings'), num(s.buildingsBuilt)],
      [t('stats.shipsSunk'), num(s.shipsSunk)],
      [t('stats.nukes'), num(s.nukesLaunched)],
      [t('stats.intercepts'), num(s.nukesIntercepted)],
      [t('stats.goldEarned'), short(s.goldEarned)],
      [t('stats.trade'), short(s.tradeGold)],
      [t('stats.trains'), short(s.trainGold)],
      [t('stats.killed'), short(s.enemiesKilled)],
      [t('stats.troopsLost'), short(s.troopsLost)],
      [t('end.results.betrayals'), num(s.betrayals)],
    ];
    if (subject === mine && end.score !== undefined) out.push([t('end.results.score'), num(end.score)]);
    return out;
  });

  // -------------------------------------------------------------- awards
  // svelte-ignore state_referenced_locally
  const showAwards = !!mine && ctl.session.kind !== 'replay' && !end.mission;
  const awards = (end.awards ?? []).filter((a) => (ACHIEVEMENTS as readonly string[]).includes(a));
  const owned = Object.keys(profile.achievements).length;

  // ------------------------------------------------------------ settings
  const settingsRows = $derived.by(() => {
    void i18n.lang;
    const out: [string, string][] = [
      [t('end.results.map'), mapName],
      [t('end.results.mode'), t(`mode.${cfg.mode}`)],
    ];
    if (cfg.mode !== 'campaign') {
      out.push([t('end.results.difficulty'), t(`difficulty.${cfg.difficulty}`)]);
      out.push([
        t('end.results.threshold'),
        cfg.victoryThreshold > 100
          ? t('end.results.sandbox')
          : t('end.results.thresholdValue', { n: cfg.victoryThreshold }),
      ]);
    }
    out.push([t('end.results.nations'), num(rows.length)]);
    if (cfg.tribes > 0) out.push([t('end.results.tribes'), num(cfg.tribes)]);
    if (cfg.gameSpeed !== 1) out.push([t('end.results.speed'), `×${cfg.gameSpeed}`]);
    if (cfg.goldMultiplier !== 1) out.push([t('end.results.goldRate'), `×${cfg.goldMultiplier}`]);
    out.push([t('end.results.duration'), clockText(durationTicks)]);
    out.push([t('end.results.ending'), t(`end.reason.${reasonKey}`)]);
    out.push([t('end.results.date'), date(ed?.date ?? Date.now())]);
    return out;
  });
  // svelte-ignore state_referenced_locally
  const replayFile = ctl.replayFile ?? ctl.session.replay?.file ?? null;
</script>

<article class="page" aria-labelledby="rp-title">
  <Masthead
    {full}
    ear={full ? t('front.edition') : t('end.results.ear')}
    date={day}
    dateline={full
      ? [
          mapName,
          t('front.dateline.duration', { duration: t('news.min', { n: minutes }) }),
          t('front.dateline.nations', { n: rows.length }),
        ]
      : null}
  />

  <section class="head">
    <p class="kicker">{t('end.results.kicker')} · {t(`end.reason.${reasonKey}`)}</p>
    <div class="hl" class:flagged={!!headFlag}>
      {#if headFlag}<img class="np-flag" src={flagUrl(headFlag.p, 128)} alt="" />{/if}
      <div>
        <h2
          id="rp-title"
          class:won={end.won || outcome === 'winnerIs'}
          class:lost={!end.won && outcome === 'defeat'}
        >
          {title}
        </h2>
        <p class="deck">{deck}</p>
      </div>
    </div>
  </section>

  <div class="grid">
    <div class="left">
      <section class="ranking" aria-labelledby="rp-ranking">
        <h3 class="np-rule" id="rp-ranking"><span>{t('end.results.ranking')}</span></h3>
        <table>
          <thead>
            <tr>
              <th scope="col" class="rk" aria-sort={sortKey === 'rank' ? 'ascending' : 'none'}>
                <button class="sort" class:on={sortKey === 'rank'} onclick={() => (sortKey = 'rank')}
                  >{t('end.results.col.rank')}</button
                >
              </th>
              <th scope="col" class="nation">{t('end.results.col.nation')}</th>
              {#each COLS as c (c.key)}
                <th scope="col" class="n" aria-sort={sortKey === c.key ? 'descending' : 'none'}>
                  <button
                    class="sort"
                    class:on={sortKey === c.key}
                    onclick={() => (sortKey = c.key)}
                    data-testid={`sort-${c.key}`}>{t(c.label)}</button
                  >
                </th>
              {/each}
              <th scope="col" class="fate">{t('end.results.col.fate')}</th>
            </tr>
          </thead>
          <tbody>
            {#each shown as r, k (r.p.id)}
              {@const prevRow = shown[k - 1]}
              {#if prevRow && sortKey === 'rank' && r.rank !== prevRow.rank + 1}
                <tr class="gap" aria-hidden="true"><td colspan={COLS.length + 3}>⋯</td></tr>
              {/if}
              <tr class:me={r.p.id === viewer} class:win={r.winner} class:fallen={!r.p.alive}>
                <td class="rk">{r.rank}</td>
                <th scope="row" class="nation">
                  <span class="who">
                    <img class="np-flag" src={flagUrl(r.p, 48)} alt="" />
                    <span class="nm">{name(r)}</span>
                    {#if r.p.id === viewer}<span class="you">{t('end.results.you')}</span>{/if}
                    {#if teams && r.p.team > 0}<span class="team">{teamLabel(r.p.team)}</span>{/if}
                  </span>
                </th>
                {#each COLS as c (c.key)}
                  <td class="n" class:sorted={sortKey === c.key}>
                    {#if c.key === 'tiles'}<span class="bar" aria-hidden="true"
                        ><span style:width="{(100 * r.p.tiles) / maxTiles}%"></span></span
                      >{/if}
                    {cell(r, c.key)}
                  </td>
                {/each}
                <td class="fate">
                  {#if r.p.id === stats.winner}
                    <span class="crown"><Icon name="crown" size={13} />{t('end.results.winner')}</span>
                  {:else if r.winner}
                    <span class="crown">{t('end.results.winnerTeam')}</span>
                  {:else if r.p.alive}
                    {t('end.results.standing')}
                  {:else}
                    <span class="fell"
                      >{r.fellAt >= 0
                        ? t('end.results.fell', { clock: clockText(r.fellAt) })
                        : t('end.results.out')}</span
                    >
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if hidden > 0}
          <button class="np-btn quiet more" onclick={() => (all = !all)} aria-expanded={all}>
            <Icon name={all ? 'collapse' : 'expand'} size={13} />
            {all ? t('end.results.showLess') : t('end.results.showAll', { n: hidden })}
          </button>
        {/if}
      </section>
      <div class="lower" class:three={showAwards}>
        {#if showAwards}
          <section aria-labelledby="rp-awards">
            <h3 class="np-rule" id="rp-awards"><span>{t('end.results.awards')}</span></h3>
            {#if awards.length}
              <ul class="awards">
                {#each awards as a (a)}
                  <li>
                    <span class="medal"><Icon name="trophy" size={16} /></span>
                    <div>
                      <b>{t(`achievement.${a}.name`)}</b>
                      <span>{t(`achievement.${a}.desc`)}</span>
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="quiet">{t('end.results.noAwards')}</p>
            {/if}
            <p class="count">{t('end.results.awardsCount', { n: owned, total: ACHIEVEMENTS.length })}</p>
          </section>
        {/if}

        <section aria-labelledby="rp-settings">
          <h3 class="np-rule" id="rp-settings"><span>{t('end.results.settings')}</span></h3>
          <dl class="np-figures">
            {#each settingsRows as [k, v] (k)}<dt>{k}</dt>
              <dd>{v}</dd>{/each}
          </dl>
        </section>

        <section aria-labelledby="rp-archives">
          <h3 class="np-rule" id="rp-archives"><span>{t('end.results.archives')}</span></h3>
          <p class="saved">
            {#if end.replaySaved}
              <Icon name="save" size={14} />{t('end.replaySaved')}
            {:else if ctl.session.kind === 'replay'}
              <Icon name="play" size={14} />{t('end.results.replayWatched')}
            {:else}
              {t('end.results.replayNone')}
            {/if}
          </p>
          <div class="links">
            {#if replayFile}
              <button class="np-btn" onclick={() => exportReplay(ctl)} data-testid="end-export-replay"
                ><Icon name="download" size={14} />{t('end.results.exportReplay')}</button
              >
            {/if}
            <button class="np-btn" onclick={exportCsv} data-testid="end-csv"
              ><Icon name="download" size={14} />{t('end.exportCsv')}</button
            >
            <button class="np-btn" onclick={() => go('replays')} data-testid="end-replays"
              ><Icon name="book" size={14} />{t('end.results.allReplays')}</button
            >
          </div>
        </section>
      </div>
    </div>
    {#if subject}
      <aside class="np-box mine" aria-labelledby="rp-mine">
        <h3 id="rp-mine">{subject === mine ? t('end.results.yours') : t('end.results.winners')}</h3>
        {#if curve}
          <figure class="spark">
            <svg viewBox="0 0 260 44" preserveAspectRatio="none" aria-hidden="true">
              <polygon points="0,44 {curve} 260,44" />
              <polyline points={curve} />
            </svg>
            <figcaption>{t('end.results.territory')}</figcaption>
          </figure>
        {/if}
        <dl class="np-figures">
          {#each figures as [k, v] (k)}<dt>{k}</dt>
            <dd>{v}</dd>{/each}
        </dl>
      </aside>
    {/if}
  </div>
</article>

<style>
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
    width: 84px;
    height: 56px;
  }
  h2 {
    margin: 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 2.7em;
    line-height: 1.02;
    letter-spacing: -0.02em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  h2.lost {
    color: var(--np-spot);
  }
  .deck {
    margin: 6px 0 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.16em;
    line-height: 1.3;
    color: var(--np-ink);
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 0 28px;
    padding-top: 14px;
    align-items: start;
  }

  /* The ranking: a results table as sports pages print them. */
  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--text);
    font-size: 0.84em;
    font-variant-numeric: tabular-nums;
  }
  thead th {
    padding: 0 6px 4px;
    border-bottom: 2px solid var(--np-ink);
    font-weight: 600;
    text-align: right;
    color: var(--np-ink-2);
    white-space: nowrap;
  }
  thead th.nation,
  thead th.fate {
    text-align: left;
  }
  thead th.rk {
    text-align: right;
    width: 2.2em;
  }
  .sort {
    appearance: none;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline dotted var(--np-rule);
    text-underline-offset: 3px;
  }
  .sort:hover,
  .sort:focus-visible,
  .sort.on {
    color: var(--np-ink);
    text-decoration: underline solid var(--np-ink);
  }
  tbody td,
  tbody th {
    padding: 4px 6px;
    border-bottom: 1px solid var(--np-rule);
    text-align: right;
    font-weight: 400;
    color: var(--np-ink);
    white-space: nowrap;
  }
  tbody .rk {
    font-family: var(--title);
    font-weight: 700;
    color: var(--np-ink-2);
  }
  tbody th.nation,
  tbody td.fate {
    text-align: left;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .who img {
    width: 26px;
    height: 17px;
    flex: none;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 16em;
    font-weight: 600;
  }
  .you {
    padding: 0 5px;
    border-radius: 2px;
    background: var(--np-ink);
    font-size: 0.78em;
    font-weight: 600;
    color: var(--np-paper);
  }
  .team {
    font-size: 0.86em;
    color: var(--np-ink-3);
  }
  tr.me th,
  tr.me td {
    background: var(--np-paper-2);
  }
  tr.me td.rk {
    box-shadow: inset 3px 0 0 var(--np-ink);
  }
  tr.fallen .nm,
  tr.fallen td.n {
    color: var(--np-ink-3);
  }
  td.sorted {
    font-weight: 600;
  }
  /* Territory: a small bar before the figure, to the scale of the biggest. */
  .bar {
    display: inline-block;
    width: 52px;
    height: 7px;
    margin-right: 8px;
    background: var(--np-paper-2);
    vertical-align: 0;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--np-ink-2);
  }
  tr.win .bar span {
    background: var(--np-ink);
  }
  .crown {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
    color: var(--np-ink);
  }
  .fell {
    color: var(--np-spot);
  }
  tr.gap td {
    padding: 0 6px;
    text-align: center;
    color: var(--np-ink-3);
  }
  .more {
    margin-top: 6px;
    font-size: 0.8em;
  }

  /* The reader's figures. */
  .mine {
    align-self: start;
  }
  .spark {
    margin: 0 0 8px;
  }
  .spark svg {
    display: block;
    width: 100%;
    height: 44px;
    border-bottom: 1px solid var(--np-rule);
  }
  .spark polygon {
    fill: var(--np-paper-2);
    stroke: none;
  }
  .spark polyline {
    fill: none;
    stroke: var(--np-ink);
    stroke-width: 1.6;
    vector-effect: non-scaling-stroke;
  }
  .spark figcaption {
    margin-top: 2px;
    font-family: var(--text);
    font-size: 0.72em;
    color: var(--np-ink-3);
  }

  /* Under the ranking: awards, settings and archives side by side. */
  .left {
    min-width: 0;
  }
  .lower {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 24px;
    margin-top: 22px;
  }
  .lower.three {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 0.9fr);
  }
  .awards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .awards li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 8px;
    align-items: start;
  }
  .medal {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--np-ink);
    border-radius: 50%;
    color: var(--np-ink);
  }
  .awards b {
    display: block;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1em;
    color: var(--np-ink);
  }
  .awards span {
    font-family: var(--text);
    font-size: 0.8em;
    color: var(--np-ink-2);
  }
  .quiet {
    margin: 0;
    font-style: italic;
    color: var(--np-ink-2);
  }
  .count {
    margin: 8px 0 0;
    font-family: var(--text);
    font-size: 0.76em;
    color: var(--np-ink-3);
  }
  .saved {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 8px;
    font-family: var(--text);
    font-size: 0.84em;
    color: var(--np-ink);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  @media (max-width: 1100px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .mine {
      margin-top: 16px;
    }
    .lower,
    .lower.three {
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
  }
</style>
