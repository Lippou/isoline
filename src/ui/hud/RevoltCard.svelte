<script module lang="ts">
  /** The revolutions already printed whole, and until when the latest stays so (per game). */
  const memo: { ctl: unknown; seen: Set<number>; freshUntil: number } = {
    ctl: null,
    seen: new Set(),
    freshUntil: 0,
  };
</script>

<script lang="ts">
  // Revolutions under way (rules/revolution.ts, GAME_DESIGN.md §6.5), for every player: a
  // dispatch in the news column under a hatched oxblood band (the rebels' land, printed),
  // the raised fist, whom it rose against, the land it holds and the time before it runs
  // out of steam (a draining bar). « Voir » takes the camera there. A new revolution is
  // printed whole for half a minute, then folds to one line per revolution; short of room
  // (zones.ts) it becomes a chip that keeps the fist and the countdown. Ours is printed
  // first, in a heavier frame. Never top-centre, never over the alliance offers.
  import { untrack } from 'svelte';
  import { hud } from '../stores/game.svelte';
  import { layout, zonePiece } from '../stores/layout.svelte';
  import { setFold } from '../stores/folds.svelte';
  import { settings } from '../stores/settings.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import FoldButton from './FoldButton.svelte';
  import type { GameController } from '../game/controller';
  import { REVOLUTION_TICKS } from '../../core/game/constants';

  let { ctl }: { ctl: GameController } = $props();

  const name = (id: number) => ctl.session.state.name(id, i18n.lang);
  const revolts = $derived(
    hud.players
      .filter((p) => p.revoltFor !== undefined && p.alive && p.tiles > 0)
      .map((p) => ({
        id: p.id,
        against: p.rebelOf,
        mine: p.rebelOf > 0 && p.rebelOf === hud.viewer,
        left: p.revoltFor ?? 0,
        tiles: p.tiles,
      }))
      .sort((a, b) => Number(b.mine) - Number(a.mine) || a.left - b.left),
  );
  const visible = $derived(revolts.length > 0 && !layout.reading && hud.phase === 'playing');
  const level = $derived(layout.levelOf('revolts'));
  const lead = $derived(revolts[0]);
  const mine = $derived(!!lead?.mine);

  // A new revolution is printed whole for half a minute (unless the player folds it). What
  // has been printed is kept per game across remounts (reading mode folds the column away:
  // coming back, the card does not break the news again).
  const FRESH_MS = 30000;
  const game = untrack(() => ctl);
  if (memo.ctl !== game) {
    memo.ctl = game;
    memo.seen = new Set();
    memo.freshUntil = 0;
  }
  const ids = $derived(revolts.map((r) => r.id).join(','));
  let fresh = $state(performance.now() < memo.freshUntil);
  let manual = $state<boolean | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    clearTimeout(timer);
    const left = memo.freshUntil - performance.now();
    if (left > 0) timer = setTimeout(() => (fresh = false), left);
  };
  expire();
  /** Read out by screen readers when one breaks out (once, not at every tick). */
  let said = $state('');
  $effect(() => {
    const list = ids ? ids.split(',').map(Number) : [];
    const born = list.some((id) => !memo.seen.has(id));
    for (const id of list) memo.seen.add(id);
    if (!born) return;
    memo.freshUntil = performance.now() + FRESH_MS;
    fresh = true;
    manual = null;
    expire();
    untrack(() => {
      const r = revolts[0];
      if (r)
        said = r.mine
          ? `${t('revolt.titleMine')}. ${t('revolt.deckMine', { tribe: name(r.id), tiles: r.tiles.toLocaleString(i18n.lang), time: clock(r.left) })}`
          : `${t('revolt.titleOther', { player: name(r.against) })}.`;
    });
  });
  $effect(() => () => clearTimeout(timer));
  const open = $derived(level === 'full' && (manual ?? fresh));
  function toggle(): void {
    if (open) {
      manual = false;
      setFold('news', true);
      layout.pin('revolts', false);
    } else {
      manual = true;
      setFold('news', false);
      if (level !== 'full') layout.pin('revolts');
    }
  }
  function show(id: number): void {
    ctl.focusPlayer(id);
  }
  const still = $derived(settings.access.reducedMotion);
</script>

<p class="sr-only" aria-live="assertive">{said}</p>
{#if visible && lead}
  {#if level === 'chip'}
    <button
      class="zchip revolt-chip newsprint"
      class:mine
      data-zone-chip
      data-testid="revolt-card"
      onclick={() => show(lead.id)}
      aria-label="{t('revolt.kicker')} — {lead.mine
        ? t('revolt.titleMine')
        : t('revolt.titleOther', { player: name(lead.against) })} — {clock(lead.left)}"
      use:zonePiece={{ id: 'revolts', level, n: revolts.length }}
      ><Icon name="revolt" size={14} />{#if revolts.length > 1}<b>{revolts.length}</b>{/if}<span class="mono"
        >{clock(lead.left)}</span
      ></button
    >
  {:else}
    <section
      class="revolts newsprint rise-in"
      class:mine
      class:still
      data-testid="revolt-card"
      aria-label={t('revolt.kicker')}
      use:zonePiece={{ id: 'revolts', level, n: revolts.length }}
    >
      <div class="kicker">
        <button class="top" onclick={toggle} tabindex="-1" aria-expanded={open}>
          <Icon name="revolt" size={14} stroke={2.2} />
          <span>{mine ? t('revolt.kickerMine') : t('revolt.kicker')}</span>
          {#if revolts.length > 1}<span class="count">×{revolts.length}</span>{/if}
        </button>
        <FoldButton
          folded={!open}
          name={t('revolt.kicker')}
          dir="up"
          tip="below"
          onclick={toggle}
          testid="fold-revolts"
        />
      </div>
      {#if open}
        <article class="story">
          <h3>
            {lead.mine ? t('revolt.titleMine') : t('revolt.titleOther', { player: name(lead.against) })}
          </h3>
          <p class="deck">
            {lead.mine
              ? t('revolt.deckMine', {
                  tribe: name(lead.id),
                  tiles: lead.tiles.toLocaleString(i18n.lang),
                  time: clock(lead.left),
                })
              : t('revolt.deckOther', { tribe: name(lead.id), tiles: lead.tiles.toLocaleString(i18n.lang) })}
          </p>
          <p class="when">
            <span>{t('revolt.ends')}</span>
            <time>{clock(lead.left)}</time>
          </p>
          <span class="bar" aria-hidden="true"
            ><i style="width:{(lead.left / REVOLUTION_TICKS) * 100}%"></i></span
          >
          <button class="act" onclick={() => show(lead.id)} data-testid="revolt-show"
            ><Icon name="target" size={14} />{t('revolt.show')}</button
          >
        </article>
        {#each revolts.slice(1) as r (r.id)}
          <button class="line" class:mine={r.mine} onclick={() => show(r.id)} data-tip={t('revolt.showTip')}>
            <Icon name="revolt" size={13} />
            <span class="who">{r.mine ? t('revolt.lineMine') : name(r.against)}</span>
            <time class="mono">{clock(r.left)}</time>
          </button>
        {/each}
      {:else}
        {#each revolts as r (r.id)}
          <button
            class="line"
            class:mine={r.mine}
            onclick={() => show(r.id)}
            data-tip={t('revolt.showTip')}
            data-testid="revolt-line"
          >
            <span class="who"
              >{r.mine ? t('revolt.lineMine') : name(r.against)}<small
                >{t('revolt.tiles', { tiles: r.tiles.toLocaleString(i18n.lang) })}</small
              ></span
            >
            <time class="mono">{clock(r.left)}</time>
            <span class="go" aria-label={t('revolt.show')}><Icon name="target" size={14} /></span>
          </button>
        {/each}
      {/if}
    </section>
  {/if}
{/if}

<style>
  .revolts {
    width: 100%;
    padding: 0 12px 8px;
    border-radius: 1px;
    font-family: var(--np-serif);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 10px 24px rgba(3, 10, 16, 0.5);
  }
  /* Our own land: a heavier oxblood frame that breathes (not with reduced motion). */
  .revolts.mine {
    outline: 2px solid var(--rebel);
    outline-offset: -2px;
    animation: breathe 1.1s ease-in-out 6 alternate;
  }
  .revolts.mine.still {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .revolts.mine {
      animation: none;
    }
  }
  @keyframes breathe {
    to {
      box-shadow:
        0 1px 0 rgba(255, 255, 255, 0.45) inset,
        0 0 0 4px color-mix(in srgb, var(--rebel) 45%, transparent),
        0 10px 24px rgba(3, 10, 16, 0.5);
    }
  }
  /* The band: the rebels' oxblood hatched with paper lines, as their land is on the map. */
  .kicker {
    --rebel: #6e2a2a;
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 -12px;
    padding-right: 6px;
    background:
      repeating-linear-gradient(-45deg, rgba(246, 241, 228, 0.18) 0 2px, transparent 2px 7px), var(--rebel);
    color: #fbf6ec;
  }
  .revolts {
    --rebel: #6e2a2a;
  }
  .top {
    appearance: none;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 4px 4px 12px;
    border: 0;
    background: none;
    color: inherit;
    font-family: var(--text);
    font-size: 0.78em;
    font-weight: 600;
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .count {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }
  /* The fold control printed on the band: paper lines on oxblood (ink on paper on hover). */
  .kicker :global(.fold) {
    width: 20px;
    height: 20px;
    border-color: rgba(251, 246, 236, 0.6);
    background: transparent;
    color: #fbf6ec;
  }
  .story {
    padding-top: 7px;
  }
  h3 {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.32em;
    line-height: 1.06;
    letter-spacing: -0.012em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  .deck {
    margin: 5px 0 0;
    font-size: 0.8em;
    line-height: 1.45;
    color: var(--np-ink-2);
  }
  .when {
    display: flex;
    justify-content: space-between;
    margin: 7px 0 0;
    font-family: var(--text);
    font-size: 0.76em;
    color: var(--np-ink-3);
  }
  .when time {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
  }
  .bar {
    display: block;
    height: 4px;
    margin-top: 4px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--rebel);
    transition: width 0.5s linear;
  }
  /* Printed button: navy ink on paper. */
  .act {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 5px 12px;
    border: 1.5px solid var(--np-ink);
    border-radius: 2px;
    background: var(--np-ink);
    color: var(--np-paper);
    font-family: var(--text);
    font-size: 0.82em;
    font-weight: 600;
    cursor: var(--cursor-pointer, pointer);
  }
  .act:hover {
    background: #22405a;
  }
  /* One line per revolution: whom, the land, the countdown, a target to go there. */
  .line {
    appearance: none;
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    padding: 4px 2px 0;
    border: 0;
    border-top: 1px solid var(--np-rule);
    background: none;
    color: var(--np-ink);
    font-family: var(--text);
    font-size: 0.82em;
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .story ~ .line {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .kicker + .line {
    border-top: 0;
  }
  .line :global(svg) {
    color: var(--rebel);
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 600;
  }
  .line.mine .who {
    color: var(--rebel);
    font-weight: 700;
  }
  .who small {
    margin-left: 6px;
    font-family: var(--text);
    font-weight: 500;
    font-size: 0.86em;
    color: var(--np-ink-3);
  }
  .line time {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .go {
    display: grid;
    place-items: center;
    width: 24px;
    height: 22px;
    border: 1px solid var(--np-rule);
    border-radius: 2px;
  }
  .line:hover .go,
  .line:focus-visible .go {
    border-color: var(--np-ink);
    background: var(--np-paper-2);
  }
  /* The chip: the fist and the countdown in an oxblood-ruled tab. */
  .revolt-chip {
    border-left-color: #6e2a2a;
  }
  .revolt-chip :global(svg) {
    color: #6e2a2a;
  }
  .revolt-chip.mine {
    border-color: #6e2a2a;
    border-left-width: 5px;
  }
</style>
