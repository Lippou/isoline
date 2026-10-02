<script lang="ts">
  // The final edition of the Courier: the end of every game, as one newspaper. Page 1 is
  // the front page (or, after a campaign mission, the mission communiqué), page 2 the
  // results and statistics. A short game, without a story to tell, has the results page
  // alone. The paper is turned with the page numbers at the bottom (or the arrow keys),
  // folded with Escape to watch the map, and every end-of-game action is at its foot.
  import { onMount } from 'svelte';
  import './paper.css';
  import Icon from '../icons/Icon.svelte';
  import FrontPage from './FrontPage.svelte';
  import ResultsPage from './ResultsPage.svelte';
  import MissionReport from './MissionReport.svelte';
  import { hud, openPaper, type PaperPage } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { app, go } from '../stores/app.svelte';
  import { worthPrinting } from './frontPage';
  import { canWatch, nextMission, rematch, retryMission, watchFrom } from './paperActions';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();

  const end = $derived(hud.end);
  const mission = $derived(end?.mission ?? null);
  const pages = $derived.by((): PaperPage[] => {
    const out: PaperPage[] = [];
    if (mission) out.push('mission');
    else if (ctl.edition && (!end || worthPrinting(ctl.edition))) out.push('front');
    if (end) out.push('results');
    return out;
  });
  const page = $derived(pages.includes(hud.paperPage) ? hud.paperPage : (pages[0] ?? 'results'));
  const index = $derived(pages.indexOf(page));
  // Which way the page turns (0: the paper just opened). Read once per page change.
  let prev = -1;
  const turn = $derived.by(() => {
    const k = index;
    const d = prev < 0 || k === prev ? 0 : k > prev ? 1 : -1;
    prev = k;
    return d;
  });
  const TITLES: Record<PaperPage, string> = { front: 'fp-title', mission: 'mr-title', results: 'rp-title' };
  const TESTIDS: Record<PaperPage, string> = {
    front: 'end-paper',
    mission: 'end-mission',
    results: 'end-details',
  };

  // ------------------------------------------------------------- actions
  const spectator = $derived(ctl.session.viewer <= 0);
  const replay = $derived(ctl.session.kind === 'replay');
  const watchable = $derived(canWatch(ctl));
  /** Carry on in the same world after the end (not in missions or replays). */
  const canContinue = $derived(
    !!end &&
      !mission &&
      !spectator &&
      !replay &&
      !!hud.players.find((p) => p.id === ctl.session.viewer)?.alive,
  );
  const canRematch = $derived(!!end && !mission && ctl.session.kind === 'solo' && !app.launch?.missionId);
  const canNext = $derived(!!mission?.success && (!!mission.next || !!mission.onNext));

  // -------------------------------------------------------------- dialog
  let sheet: HTMLElement | undefined = $state();
  onMount(() => sheet?.focus());
  function goTo(p: PaperPage): void {
    if (p === page) return;
    openPaper(p);
  }
  $effect(() => {
    // A new page starts at its top, the keyboard on the sheet.
    void index;
    if (!sheet) return;
    sheet.scrollTop = 0;
    if (!sheet.contains(document.activeElement) || document.activeElement === document.body) sheet.focus();
  });
  function fold(): void {
    hud.paper = false;
  }
  function keys(e: KeyboardEvent): void {
    // The paper reads the keyboard: the map's shortcuts wait until it is folded.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      fold();
      return;
    }
    if (e.defaultPrevented || pages.length < 2) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = pages[index + step];
    if (step && to) {
      e.preventDefault();
      goTo(to);
    }
  }
  function menu(): void {
    go(mission ? 'campaign' : 'title');
  }
</script>

<!-- A click beside the sheet folds it (the keyboard: Escape, or the buttons). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="scrim"
  data-testid={end ? 'end-screen' : 'paper'}
  onkeydown={keys}
  onclick={(e) => {
    if (e.target === e.currentTarget) fold();
  }}
>
  <div
    class="sheet newsprint"
    role="dialog"
    aria-modal="true"
    aria-labelledby={TITLES[page]}
    tabindex="-1"
    bind:this={sheet}
  >
    <button class="x" onclick={fold} aria-label={t('front.fold')} data-tip={t('front.fold')}
      ><Icon name="close" size={16} /></button
    >

    {#key page}
      <div class="leaf" class:fwd={turn > 0} class:back={turn < 0}>
        {#if page === 'front'}
          <FrontPage {ctl} />
        {:else if page === 'mission' && mission}
          <MissionReport {ctl} result={mission} />
        {:else}
          <ResultsPage {ctl} full={pages.length === 1} />
        {/if}
      </div>
    {/key}

    <footer>
      {#if pages.length > 1}
        <nav class="pager" aria-label={t('end.page.nav')}>
          {#each pages as p, k (p)}
            <button
              class="folio"
              class:on={p === page}
              aria-current={p === page ? 'page' : undefined}
              onclick={() => goTo(p)}
              data-testid={TESTIDS[p]}><span class="no">{k + 1}</span>{t(`end.page.${p}`)}</button
            >
          {/each}
        </nav>
        <span class="sr-only" aria-live="polite"
          >{t('end.page.status', { n: index + 1, of: pages.length, name: t(`end.page.${page}`) })}</span
        >
      {/if}
      <span class="grow"></span>
      {#if watchable}
        <button class="np-btn" onclick={() => watchFrom(ctl, 0)} data-testid="end-replay"
          ><Icon name="play" size={14} />{t('front.replayAll')}</button
        >
      {/if}
      <button class="np-btn" onclick={fold} data-testid="end-spectate"
        ><Icon name="eye" size={14} />{end ? t('end.keepWatching') : t('front.fold')}</button
      >
      {#if canContinue}
        <button
          class="np-btn"
          onclick={() => ctl.continuePlaying()}
          data-testid="end-continue"
          data-tip={t('end.continueTip')}><Icon name="forward" size={14} />{t('end.continue')}</button
        >
      {/if}
      {#if mission}
        <button class="np-btn" onclick={() => retryMission(mission)} data-testid="end-retry"
          ><Icon name="refresh" size={14} />{t('end.mission.retry')}</button
        >
      {/if}
      {#if canRematch}
        <button class="np-btn" onclick={rematch} data-testid="end-again" data-tip={t('end.playAgainTip')}
          ><Icon name="refresh" size={14} />{t('end.playAgain')}</button
        >
      {/if}
      {#if end}
        <button class="np-btn" class:ink={!canNext} onclick={menu} data-testid="end-menu"
          >{mission ? t('end.mission.campaign') : t('end.backToMenu')}</button
        >
      {/if}
      {#if canNext && mission}
        <button class="np-btn ink" onclick={() => nextMission(mission)} data-testid="end-next"
          >{t('end.mission.next')}<Icon name="next" size={14} /></button
        >
      {/if}
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 61;
    display: grid;
    place-items: center;
    padding: 18px;
    background: rgba(5, 9, 18, 0.66);
  }
  /* The sheet: one newspaper page lifted off the map, its own scroll. */
  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    width: min(1260px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 18px 34px 0;
    border-radius: 1px;
    font-family: var(--np-serif);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.5) inset,
      0 24px 60px rgba(3, 10, 16, 0.6);
    outline: none;
    scrollbar-color: var(--np-rule) transparent;
    animation: unfold 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
    transform-origin: 50% 0;
  }
  @keyframes unfold {
    from {
      opacity: 0;
      transform: perspective(1400px) rotateX(-9deg) translateY(18px);
    }
  }

  /* Turning a page: the new leaf swings in around the fold, on the side it comes from. */
  .leaf {
    flex: 1 0 auto;
    padding-bottom: 16px;
  }
  .leaf.fwd {
    transform-origin: 0 30%;
    animation: turnFwd 0.5s cubic-bezier(0.22, 0.7, 0.2, 1) both;
  }
  .leaf.back {
    transform-origin: 100% 30%;
    animation: turnBack 0.5s cubic-bezier(0.22, 0.7, 0.2, 1) both;
  }
  @keyframes turnFwd {
    from {
      opacity: 0;
      transform: perspective(1800px) rotateY(-24deg) translateX(4%);
    }
    55% {
      opacity: 1;
    }
  }
  @keyframes turnBack {
    from {
      opacity: 0;
      transform: perspective(1800px) rotateY(24deg) translateX(-4%);
    }
    55% {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .leaf.fwd,
    .leaf.back {
      animation: none;
    }
  }

  .x {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
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

  /* The foot of the page: the folios to turn it, then the actions. It stays in view. */
  footer {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin: 0 -34px;
    padding: 10px 34px 14px;
    border-top: 3px double var(--np-ink);
    background: var(--np-paper);
  }
  .grow {
    flex: 1;
  }
  .pager {
    display: flex;
    gap: 2px;
  }
  .folio {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px 5px 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    font-family: var(--title);
    font-size: 0.96em;
    font-weight: 600;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .folio:hover,
  .folio:focus-visible {
    border-color: var(--np-rule);
    color: var(--np-ink);
  }
  .folio .no {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: 1px solid var(--np-ink-2);
    border-radius: 50%;
    font-family: var(--text);
    font-size: 0.74em;
    font-weight: 600;
  }
  .folio.on {
    color: var(--np-ink);
  }
  .folio.on .no {
    background: var(--np-ink);
    border-color: var(--np-ink);
    color: var(--np-paper);
  }
</style>
