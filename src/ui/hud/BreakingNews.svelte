<script lang="ts">
  // Special edition: a country has fallen. A newspaper clipping unfolds under the
  // dock for a few seconds, then folds back into the journal it comes from. One at
  // a time: countries falling meanwhile join it as a stop-press line. Never modal.
  import { cubicIn, cubicOut } from 'svelte/easing';
  import { hud, openPanel } from '../stores/game.svelte';
  import { columnPlace } from '../stores/windows.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { flagUrl } from '../../render/flags';
  import type { GameController } from '../game/controller';
  import { fallBody, fallHead, nameList } from './news';

  let { ctl }: { ctl: GameController } = $props();
  const SHOW_MS = 7000;
  const MORE_MS = 2500;
  const MAX_MS = 12000;
  /** Held back while a drawer covers the column; too old by then, it stays in the journal only. */
  const STALE_MS = 20000;

  const name = (id: number) => ctl.session.state.name(id, i18n.lang);
  const b = $derived(hud.breaking);
  /** Under a window: the clipping waits (its timer stops) until it can be read. */
  const covered = $derived(columnPlace().covered);
  let hovered = $state(false);

  // Display time: paused under the pointer or under a drawer, longer with stop-press lines.
  let shownFor = -1;
  let shown = 0;
  $effect(() => {
    const cur = hud.breaking;
    if (!cur) return;
    if (cur.fall.id !== shownFor) {
      shownFor = cur.fall.id;
      shown = 0;
    }
    if (hud.panels.log) {
      hud.breaking = null; // the reader already has the paper open
      return;
    }
    if (covered || hovered) return;
    if (shown === 0 && performance.now() - cur.t > STALE_MS) {
      hud.breaking = null;
      return;
    }
    const total = Math.min(MAX_MS, SHOW_MS + cur.more.length * MORE_MS);
    const t0 = performance.now();
    const timer = setTimeout(() => (hud.breaking = null), Math.max(0, total - shown));
    return () => {
      clearTimeout(timer);
      shown += performance.now() - t0;
    };
  });

  const still = () => settings.access.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** The column opens to make room while the clipping unfolds from its top crease. */
  function room(node: HTMLElement, { duration }: { duration: number }) {
    const h = node.offsetHeight;
    return still()
      ? { duration: 0 }
      : {
          duration,
          easing: cubicOut,
          css: (k: number) => `height:${k * h}px; margin-bottom:${(k - 1) * 8}px`,
        };
  }
  function unfold(_node: HTMLElement) {
    return still()
      ? { duration: 180, css: (k: number) => `opacity:${k}` }
      : {
          duration: 560,
          easing: cubicOut,
          css: (k: number, u: number) =>
            `transform: perspective(900px) rotateX(${-88 * u}deg); opacity:${Math.min(1, k * 2.5)}`,
        };
  }
  /** Folding away: the clipping shrinks into the journal's dock button. */
  function foldAway(node: HTMLElement) {
    if (still()) return { duration: 180, css: (k: number) => `opacity:${k}` };
    const from = node.getBoundingClientRect();
    const to = document.querySelector('[data-testid="panel-log"]')?.getBoundingClientRect();
    const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
    const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : -from.height;
    return {
      duration: 520,
      easing: cubicIn,
      css: (_k: number, u: number) =>
        `transform: translate(${dx * u}px, ${dy * u}px) perspective(900px) rotateX(${60 * u}deg) scale(${1 - 0.86 * u}); opacity:${1 - u * u}`,
    };
  }
  function roomOut(node: HTMLElement) {
    const h = node.offsetHeight;
    return still()
      ? { duration: 180 }
      : {
          duration: 520,
          easing: cubicIn,
          css: (k: number) => `height:${k * h}px; margin-bottom:${(k - 1) * 8}px`,
        };
  }

  const fallen = $derived(b ? hud.players.find((p) => p.id === b.fall.player) : undefined);
  const head = $derived.by(() => {
    void i18n.lang;
    return b ? fallHead(b.fall, name) : null;
  });
  /** Read out by screen readers: the special edition appears without taking the focus. */
  let said = $state('');
  $effect(() => {
    if (head) said = `${t('news.breaking')}. ${head.title}. ${head.deck}`;
  });
  const stop = $derived.by(() => {
    if (!b || !b.more.length) return '';
    const list = nameList(b.more.map((f) => name(f.player)));
    return t(b.more.length === 1 ? 'news.stopPressOne' : 'news.stopPressMany', { list });
  });
</script>

<p class="sr-only" aria-live="polite">{said}</p>
{#if b && head && !covered}
  <div class="room" in:room={{ duration: 560 }} out:roomOut>
    <button
      class="clip newsprint"
      data-testid="breaking-news"
      in:unfold
      out:foldAway
      onclick={() => openPanel('log')}
      onmouseenter={() => (hovered = true)}
      onmouseleave={() => (hovered = false)}
      onfocus={() => (hovered = true)}
      onblur={() => (hovered = false)}
    >
      <span class="kicker"><span>{t('news.breaking')}</span><time>{clock(b.fall.at)}</time></span>
      <span class="row">
        {#if fallen}<img src={flagUrl(fallen, 96)} alt="" />{/if}
        <span class="head">
          <strong>{head.title}</strong>
          <em>{head.deck}</em>
        </span>
      </span>
      <span class="body">{fallBody(b.fall)}</span>
      {#if stop}<span class="stop">{stop}</span>{/if}
      <span class="more">{t('news.readMore')}</span>
    </button>
  </div>
{/if}

<style>
  .room {
    width: 300px;
  }
  /* A clipping cut from the paper: square edges, a crease line, lifted off the map. */
  .clip {
    appearance: none;
    display: grid;
    gap: 8px;
    width: 300px;
    padding: 0 14px 11px;
    border: 0;
    border-radius: 1px;
    text-align: left;
    cursor: pointer;
    transform-origin: top center;
    font-family: var(--np-serif);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 12px 28px rgba(3, 10, 16, 0.55);
  }
  /* The magenta band: the one place the spot colour is printed solid. */
  .kicker {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 -14px;
    padding: 5px 14px 4px;
    background: var(--np-spot);
    font-family: var(--text);
    font-size: 0.78em;
    font-weight: 600;
    color: #fff7f9;
  }
  .kicker time {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 247, 249, 0.82);
  }
  .row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 11px;
    align-items: start;
  }
  img {
    width: 58px;
    height: 40px;
    margin-top: 4px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.4);
    mix-blend-mode: multiply;
  }
  .head {
    display: grid;
    gap: 3px;
  }
  strong {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.62em;
    line-height: 1.02;
    letter-spacing: -0.014em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  em {
    font-family: var(--title);
    font-size: 0.95em;
    line-height: 1.3;
    color: var(--np-ink);
  }
  .body {
    padding-top: 6px;
    border-top: 1px solid var(--np-rule);
    font-size: 0.8em;
    line-height: 1.45;
    color: var(--np-ink-2);
  }
  .stop {
    font-size: 0.8em;
    line-height: 1.45;
    font-weight: 600;
    color: var(--np-spot);
  }
  .more {
    font-family: var(--text);
    font-size: 0.72em;
    color: var(--np-ink-3);
    text-decoration: underline;
    text-decoration-color: var(--np-rule);
    text-underline-offset: 2px;
  }
  .clip:hover .more,
  .clip:focus-visible .more {
    color: var(--np-ink);
    text-decoration-color: currentColor;
  }
</style>
