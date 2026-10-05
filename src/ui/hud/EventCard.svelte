<script lang="ts">
  // News flash: the world event under way, in plain words with its figures, the time
  // left (a draining bar) and when it began; then the World Council's decisions in force.
  // Short of room in the news column (zones.ts): folded to its one-line strip, then a chip
  // (a click unfolds it, the other pieces giving way). In reading mode it waits.
  import { hud, openPanel } from '../stores/game.svelte';
  import { layout, zonePiece } from '../stores/layout.svelte';
  import { setFold } from '../stores/folds.svelte';
  import FoldButton from './FoldButton.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import PressPhoto from './PressPhoto.svelte';
  import { hasPressPhoto } from './pressPhotos';
  import type { IconName } from '../icons/icons';
  import type { GameController } from '../game/controller';
  import { WORLD_EVENT_TICKS, type WorldEventId } from '../../core/rules/features';
  import { eventIcon } from './worldEvents';

  let { ctl }: { ctl: GameController } = $props();

  const w = $derived(hud.world);
  const now = $derived(hud.tick);
  const start = $derived(w?.startTick ?? 0);
  const ev = $derived.by(() => {
    const e = w?.event;
    if (!e || e.until <= now) return null;
    const id = e.id as WorldEventId;
    const total = WORLD_EVENT_TICKS[id] ?? 1200;
    return { id, left: e.until - now, total, since: Math.max(0, e.until - total - start) };
  });
  /** Council decisions in force (a peace summit's truce is the event itself, not the Council's). */
  const council = $derived.by(() => {
    if (!w) return [];
    const out: { key: string; icon: IconName; title: string; desc: string; left: number; flag?: number }[] =
      [];
    if (w.sanction && w.sanction.until > now)
      out.push({
        key: 'sanction',
        icon: 'council',
        title: t('news.flash.sanction', { target: ctl.session.state.name(w.sanction.target, i18n.lang) }),
        desc: t('news.flash.sanctionDesc'),
        left: w.sanction.until - now,
        flag: w.sanction.target,
      });
    if (w.nukeBanUntil > now)
      out.push({
        key: 'nukeBan',
        icon: 'embargo',
        title: t('news.flash.nukeBan'),
        desc: t('news.flash.nukeBanDesc'),
        left: w.nukeBanUntil - now,
      });
    const summit = w.event?.id === 'peaceSummit' && w.ceasefireUntil === w.event.until;
    if (w.ceasefireUntil > now && !summit)
      out.push({
        key: 'ceasefire',
        icon: 'ceasefire',
        title: t('news.flash.ceasefire'),
        desc: t('news.flash.ceasefireDesc'),
        left: w.ceasefireUntil - now,
      });
    return out;
  });
  /** The vote itself is in the requests (with its buttons); spectators read it here. */
  const voting = $derived(w?.council && !hud.local?.alive ? w.council : null);
  const next = $derived(w && w.councilNext > now ? w.councilNext - now : -1);
  /** Reading mode: the column is folded. */
  const covered = $derived(layout.reading);
  const visible = $derived(!covered && (!!ev || council.length > 0 || !!voting));
  const level = $derived(layout.levelOf('flash'));

  // A new story is printed in full for half a minute, then folds to a one-line strip
  // (it also folds while a special edition is on screen), unless the player chose. Folded by
  // the player (the news fold, remembered: folds.svelte.ts), it stays on its one line.
  const FRESH_MS = 30000;
  const story = $derived(
    (ev ? `${ev.id}@${ev.since}` : '') + council.map((c) => c.key).join(',') + (voting ? 'vote' : ''),
  );
  let manual = $state<boolean | null>(null);
  let fresh = $state(true);
  $effect(() => {
    void story;
    manual = null;
    fresh = true;
    const timer = setTimeout(() => (fresh = false), FRESH_MS);
    return () => clearTimeout(timer);
  });
  const open = $derived(level === 'full' && (manual ?? (fresh && !hud.breaking)));
  /** The player folds the news (remembered), or unfolds it: the column makes room (the others give way). */
  function toggle(): void {
    if (open) {
      manual = false;
      setFold('news', true);
      layout.pin('flash', false);
    } else {
      manual = true;
      setFold('news', false);
      if (level !== 'full') layout.pin('flash');
    }
  }
  const flagOf = (id: number) => hud.players.find((p) => p.id === id);
</script>

{#if visible && level === 'chip'}
  <button
    class="zchip spot newsprint"
    data-zone-chip
    data-testid="news-flash"
    onclick={toggle}
    aria-label="{t('news.flash.title')} — {t('zone.unfold')}"
    use:zonePiece={{ id: 'flash', level }}
    ><b>{t('news.flash.title')}</b>{#if ev}<span class="mono">{clock(ev.left)}</span>{/if}</button
  >
{:else if visible}
  <section
    class="flash newsprint rise-in"
    data-testid="news-flash"
    aria-label={t('news.flash.title')}
    use:zonePiece={{ id: 'flash', level }}
  >
    <div class="topline">
      <button
        class="top"
        onclick={toggle}
        tabindex="-1"
        aria-expanded={open}
        aria-label={open ? t('news.flash.collapse') : t('news.flash.expand')}
      >
        <span class="kicker">{t('news.flash.title')}</span>
        {#if !open}
          <span class="peek">{ev ? t(`worldEvent.${ev.id}.title`) : council[0]?.title}</span>
        {/if}
        {#if ev}<time class="left">{clock(ev.left)}</time>{/if}
      </button>
      <FoldButton
        folded={!open}
        name={t('fold.news')}
        dir="up"
        tip="below"
        onclick={toggle}
        testid="fold-news"
      />
    </div>
    {#if ev && !open}
      <span class="bar slim" aria-hidden="true"><i style="width:{(ev.left / ev.total) * 100}%"></i></span>
    {/if}
    {#if open}
      {#if ev}
        <article class="story">
          <h3>{t(`worldEvent.${ev.id}.title`)}</h3>
          <!-- The press photo: a strip of it here, the whole picture in the journal. -->
          {#if hasPressPhoto(ev.id)}
            <PressPhoto
              id={ev.id}
              size="banner"
              caption={false}
              onopen={() => openPanel('log')}
              openLabel={t('pressPhoto.open')}
            />
          {/if}
          <p class="fx"><Icon name={eventIcon(ev.id)} size={15} />{t(`worldEvent.${ev.id}.fx`)}</p>
          <p class="desc">{t(`worldEvent.${ev.id}.desc`)}</p>
          <p class="when">
            <span>{t('news.flash.since', { clock: clock(ev.since) })}</span>
            <span>{t('news.flash.ends', { clock: clock(ev.since + ev.total) })}</span>
          </p>
          <span class="bar" aria-hidden="true"><i style="width:{(ev.left / ev.total) * 100}%"></i></span>
        </article>
      {/if}
      {#if council.length || voting}
        <div class="council">
          <h4><Icon name="council" size={14} />{t('news.flash.council')}</h4>
          {#if voting}
            <p class="line">
              {t('news.flash.voting', {
                votes: voting.votes,
                s: Math.max(0, Math.ceil((voting.closes - now) / 10)),
              })}
            </p>
          {/if}
          {#each council as c (c.key)}
            {@const pv = c.flag !== undefined ? flagOf(c.flag) : undefined}
            <p class="line">
              {#if pv}<img src={flagUrl(pv, 24)} alt="" />{/if}
              <span class="what"><b>{c.title}</b> {c.desc}</span>
              <time>{clock(c.left)}</time>
            </p>
          {/each}
        </div>
      {/if}
      {#if next > 0 && !voting}
        <p class="next">{t('news.flash.next', { clock: clock(next) })}</p>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .flash {
    width: 100%;
    padding: 0 14px 10px;
    border-radius: 1px;
    font-family: var(--np-serif);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 10px 24px rgba(3, 10, 16, 0.5);
  }
  .flash:has(.slim) {
    padding-bottom: 8px;
  }
  .topline {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 -14px;
    padding-right: 8px;
  }
  .top {
    appearance: none;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 4px 6px 14px;
    border: 0;
    background: none;
    color: var(--np-ink-2);
    cursor: pointer;
    text-align: left;
  }
  .kicker {
    font-family: var(--text);
    font-size: 0.76em;
    font-weight: 600;
    color: var(--np-spot);
  }
  .peek {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.9em;
    color: var(--np-ink);
  }
  .left {
    margin-left: auto;
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
  }
  /* Time left: a printed bar that drains between the start and the end. */
  .bar {
    display: block;
    height: 4px;
    margin-top: 4px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .bar.slim {
    height: 3px;
    margin: 0 0 1px;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--np-ink);
    transition: width 0.5s linear;
  }
  .story {
    padding-top: 8px;
  }
  .story :global(.press) {
    margin-top: 7px;
  }
  h3 {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.32em;
    line-height: 1.06;
    letter-spacing: -0.012em;
    color: var(--np-ink);
  }
  .fx {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 0;
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 600;
    color: var(--np-ink);
  }
  .fx :global(svg) {
    color: var(--np-spot);
  }
  .desc {
    margin: 5px 0 0;
    font-size: 0.8em;
    line-height: 1.5;
    color: var(--np-ink-2);
  }
  .when {
    display: flex;
    justify-content: space-between;
    margin: 8px 0 0;
    font-family: var(--text);
    font-size: 0.74em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-3);
  }
  .council {
    margin-top: 9px;
    padding-top: 7px;
    border-top: 2px solid var(--np-ink);
  }
  .council h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 4px;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.95em;
    color: var(--np-ink);
  }
  .line {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 7px;
    margin: 4px 0 0;
    font-size: 0.8em;
    line-height: 1.4;
    color: var(--np-ink-2);
  }
  .line:not(:has(img)) {
    grid-template-columns: 1fr auto;
  }
  .line b {
    font-weight: 600;
    color: var(--np-ink);
  }
  .line img {
    width: 20px;
    height: 14px;
    margin-top: 2px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.4);
    mix-blend-mode: multiply;
  }
  .line time {
    font-family: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
  }
  .next {
    margin: 8px 0 0;
    font-family: var(--text);
    font-size: 0.74em;
    color: var(--np-ink-3);
  }
</style>
