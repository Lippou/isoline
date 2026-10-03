<script lang="ts">
  // The journal as a newspaper: a masthead with the game clock, then each minute of
  // play newest first, its important news as headlines and the rest as briefs.
  import { hud, type LogEntry } from '../stores/game.svelte';
  import { clock, t, i18n } from '../i18n/i18n.svelte';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import PressPhoto from './PressPhoto.svelte';
  import type { GameController } from '../game/controller';
  import { inPaper, minuteLabel, storyOf, type Story } from './news';

  let { ctl }: { ctl: GameController } = $props();
  type Section = 'all' | 'danger' | 'warn' | 'good';
  const SECTIONS: Section[] = ['all', 'danger', 'warn', 'good'];
  let section = $state<Section>('all');

  /** What was already read when the paper was opened: newer news is marked. */
  const seenAtOpen = hud.journalSeen > 0 ? hud.journalSeen : Infinity;
  $effect(() => {
    hud.journalSeen = hud.tick;
  });

  const start = $derived(hud.world?.startTick ?? 0);
  const name = (id: number) => ctl.session.state.name(id, i18n.lang);
  const mapName = $derived.by(() => {
    const n = ctl.session.state.meta.name;
    return n ? n[i18n.lang] || n.en : '';
  });
  const standing = $derived(hud.players.filter((p) => p.alive && p.spawned && p.kind !== 'tribe').length);

  const pages = $derived.by(() => {
    void i18n.lang;
    const byMinute = new Map<number, Story[]>();
    for (const e of hud.log) {
      if (!inPaper(e) || (section !== 'all' && e.level !== section)) continue;
      const m = Math.floor(Math.max(0, e.tick - start) / 600);
      let list = byMinute.get(m);
      if (!list) byMinute.set(m, (list = []));
      list.push(storyOf(e, name));
    }
    return [...byMinute.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([minute, stories]) => {
        const heads = stories
          .filter((s) => s.weight > 0)
          .sort((a, b) => b.weight - a.weight || b.entry.tick - a.entry.tick);
        const briefs = stories.filter((s) => s.weight === 0).reverse();
        return { minute, heads, briefs };
      });
  });

  function go(e: LogEntry): void {
    if (e.tile === undefined) return;
    const w = ctl.session.state.width;
    ctl.renderer.camera.goTo(
      (e.tile % w) + 0.5,
      ((e.tile / w) | 0) + 0.5,
      Math.max(3, ctl.renderer.camera.zoom),
    );
  }
  const flagOf = (id: number) => hud.players.find((p) => p.id === id);
  /** News printed since the last reading (the magenta marks). */
  const fresh = $derived(hud.log.filter((e) => e.tick > seenAtOpen && inPaper(e)).length);
  const when = (e: LogEntry) => clock(Math.max(0, e.tick - start));
</script>

<div class="paper newsprint" data-testid="journal">
  <header class="mast">
    <button class="x" onclick={() => (hud.panels.log = false)} aria-label={t('common.close')}
      ><Icon name="close" size={16} /></button
    >
    <h2>{t('news.masthead')}</h2>
    <p class="dateline">
      <span>{mapName}</span>
      <span class="mid">{t('news.edition', { clock: clock(Math.max(0, hud.tick - start)) })}</span>
      <span class="end">{standing === 1 ? t('news.standingOne') : t('news.standing', { n: standing })}</span>
    </p>
    <nav class="sections" aria-label={t('news.sections')}>
      {#each SECTIONS as s (s)}
        <button class:on={section === s} aria-pressed={section === s} onclick={() => (section = s)}
          >{t(`news.section.${s}`)}</button
        >
      {/each}
      {#if fresh}<span class="new"
          ><i></i>{fresh === 1 ? t('news.freshOne') : t('news.freshMany', { n: fresh })}</span
        >{/if}
    </nav>
  </header>

  <div class="columns scroll">
    {#each pages as pg (pg.minute)}
      <section class="minute">
        <h3 class="mark"><span>{minuteLabel(pg.minute)}</span></h3>
        {#each pg.heads as s, k (s.entry)}
          {@const lead = k === 0 && s.weight >= 60}
          <article class="story {s.entry.level}" class:lead class:fresh={s.entry.tick > seenAtOpen}>
            {#if s.flags.length}
              <span class="flags">
                {#each s.flags.slice(0, 2) as id (id)}
                  {@const pv = flagOf(id)}
                  {#if pv}<img src={flagUrl(pv, lead ? 64 : 32)} alt="" />{/if}
                {/each}
              </span>
            {/if}
            <div class="copy">
              <h4>{s.title}</h4>
              {#if s.deck}<p class="deck">{s.deck}</p>{/if}
              {#if s.photo}<PressPhoto id={s.photo} size={lead ? 'full' : 'banner'} />{/if}
              <p class="meta">
                <time>{when(s.entry)}</time>
                {#if s.entry.tile !== undefined}
                  <button class="go" onclick={() => go(s.entry)}
                    ><Icon name="target" size={12} />{t('news.goTo')}</button
                  >
                {/if}
              </p>
            </div>
          </article>
        {/each}
        {#if pg.briefs.length}
          <div class="briefs" class:alone={!pg.heads.length}>
            {#if pg.heads.length}<p class="kicker">{t('news.inBrief')}</p>{/if}
            {#each pg.briefs as s (s.entry)}
              <p class="brief {s.entry.level}" class:fresh={s.entry.tick > seenAtOpen}>
                <time>{when(s.entry)}</time>
                {s.title}
                {#if s.entry.tile !== undefined}
                  <button class="go icon" onclick={() => go(s.entry)} aria-label={t('news.goTo')}
                    ><Icon name="target" size={12} /></button
                  >
                {/if}
              </p>
            {/each}
          </div>
        {/if}
      </section>
    {:else}
      <p class="empty">{hud.log.some(inPaper) ? t('news.emptySection') : t('news.empty')}</p>
    {/each}
  </div>
</div>

<style>
  .paper {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    font-family: var(--np-serif);
  }

  /* Masthead: the title between rules, the dateline, the sections. */
  .mast {
    position: relative;
    padding: 11px 18px 0;
  }
  .x {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .x:hover {
    background: var(--np-paper-2);
    color: var(--np-ink);
  }
  h2 {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.6em;
    line-height: 1;
    letter-spacing: -0.012em;
    text-align: center;
    padding-bottom: 7px;
    border-bottom: 3px solid var(--np-ink);
  }
  .dateline {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 10px;
    margin: 2px 0 0;
    padding: 5px 0 4px;
    border-top: 1px solid var(--np-ink);
    border-bottom: 1px solid var(--np-ink);
    font-family: var(--text);
    font-size: 0.78em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
  }
  .dateline .mid {
    color: var(--np-ink);
    font-weight: 600;
  }
  .dateline .end {
    text-align: right;
  }
  .sections {
    display: flex;
    gap: 16px;
    padding: 6px 0 0;
    border-bottom: 1px solid var(--np-rule);
  }
  .sections button {
    appearance: none;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 2px 0 5px;
    background: none;
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 500;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .new {
    margin-left: auto;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding-bottom: 3px;
    font-family: var(--text);
    font-size: 0.74em;
    font-weight: 600;
    color: var(--np-spot);
  }
  .new i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--np-spot);
  }
  .sections button:hover {
    color: var(--np-ink);
  }
  .sections button.on {
    color: var(--np-ink);
    border-bottom-color: var(--np-ink);
  }

  .columns {
    min-height: 0;
    padding: 4px 18px 18px;
    scrollbar-color: var(--np-rule) transparent;
  }

  /* A minute of play: its mark, the headlines, the briefs. */
  .minute + .minute {
    margin-top: 6px;
  }
  .mark {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 12px 0 8px;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.8em;
    font-variant-numeric: lining-nums;
    color: var(--np-ink-2);
  }
  .mark::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--np-rule);
  }

  .story {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    padding: 2px 0 10px;
  }
  .story + .story {
    padding-top: 10px;
    border-top: 1px solid var(--np-rule);
  }
  .copy {
    grid-column: 2;
    min-width: 0;
  }
  .story:not(:has(.flags)) .copy {
    grid-column: 1 / -1;
  }
  .flags {
    display: grid;
    gap: 4px;
    align-content: start;
    padding-top: 3px;
  }
  .flags img {
    display: block;
    width: 26px;
    height: 18px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  h4 {
    margin: 0;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.08em;
    line-height: 1.16;
    letter-spacing: -0.004em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  .lead h4 {
    font-size: 1.45em;
    line-height: 1.08;
    letter-spacing: -0.012em;
  }
  .lead .flags img {
    width: 44px;
    height: 30px;
  }
  .story.danger h4 {
    color: var(--np-spot);
  }
  .deck {
    margin: 4px 0 0;
    font-size: 0.9em;
    line-height: 1.5;
    color: var(--np-ink-2);
  }
  .lead .deck {
    font-family: var(--title);
    font-style: italic;
    font-size: 1em;
    line-height: 1.38;
    color: var(--np-ink);
  }
  .copy :global(.press) {
    margin-top: 8px;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 5px 0 0;
    font-family: var(--text);
    font-size: 0.74em;
    color: var(--np-ink-3);
    font-variant-numeric: tabular-nums;
  }
  .go {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--np-ink-2);
    font: inherit;
    text-decoration: underline;
    text-decoration-color: var(--np-rule);
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .go:hover {
    color: var(--np-ink);
    text-decoration-color: currentColor;
  }
  .go.icon {
    vertical-align: -1px;
    margin-left: 2px;
  }

  /* Briefs: two narrow columns with a column rule, the time run in. */
  .briefs {
    columns: 2;
    column-gap: 22px;
    column-rule: 1px solid var(--np-rule);
    padding-top: 8px;
    border-top: 1px solid var(--np-rule);
  }
  .story + .briefs,
  .briefs.alone {
    border-top: 0;
  }
  .story + .briefs {
    padding-top: 0;
  }
  .story + .briefs::before {
    content: '';
    display: block;
    column-span: all;
    border-top: 1px solid var(--np-ink);
    margin-bottom: 8px;
  }
  .kicker {
    column-span: all;
    margin: 0 0 4px;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .brief {
    break-inside: avoid;
    margin: 0 0 7px;
    font-size: 0.82em;
    line-height: 1.45;
    color: var(--np-ink);
  }
  .brief time {
    margin-right: 3px;
    font-family: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-3);
  }
  .brief.danger time {
    color: var(--np-spot);
  }
  .brief.good time {
    color: var(--np-good);
  }
  .brief.warn time {
    color: var(--np-warn);
  }

  /* News printed since the paper was last read: a magenta mark in the margin. */
  .fresh {
    position: relative;
  }
  .story.fresh::before,
  .brief.fresh::before {
    content: '';
    position: absolute;
    left: -11px;
    top: 0.55em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--np-spot);
  }
  .story.fresh::before {
    top: 1.05em;
  }
  .story + .story.fresh::before {
    top: calc(10px + 0.5em);
  }

  .empty {
    margin: 26px 0 0;
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
    text-align: center;
    text-wrap: balance;
  }
</style>
