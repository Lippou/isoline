<script lang="ts">
  // Reading mode (zones.ts): a big window (the technology planche, the journal, any window
  // the player maximised) takes the screen, and the columns fold into this slim strip at
  // its top, printed as the journal's running head: the essentials (gold, troops, the game
  // clock), then what cannot wait as chips — an invasion, the missiles coming (who fired,
  // when they land), the alliance offers (Accept / Refuse; K and L answer the oldest), the
  // pact just signed, the words just spoken — then what can (the council's vote, the lost
  // capital, a special edition, the dispatches). A chip that needs the map, and the button
  // at the end, bring the columns back (the windows stand in the stage again).
  import { hud, openPanel } from '../stores/game.svelte';
  import { t, short, clock } from '../i18n/i18n.svelte';
  import { hudSize } from '../stores/hudBox.svelte';
  import { layout } from '../stores/layout.svelte';
  import { restoreColumns } from '../stores/windows.svelte';
  import Icon from '../icons/Icon.svelte';
  import NukeSender from './NukeSender.svelte';
  import AllyRequests from './AllyRequests.svelte';
  import PactBanner from './PactBanner.svelte';
  import type { GameController } from '../game/controller';
  import type { PieceId } from '../stores/zones';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  const live = $derived(!hud.spectating && hud.replay === null && !!L?.alive);
  const elapsed = $derived(hud.world ? Math.max(0, hud.tick - hud.world.startTick) : 0);
  const spawnLeft = $derived(hud.world ? Math.max(0, hud.world.spawnEndTick - hud.tick) : 0);
  const council = $derived(hud.world?.council && L?.alive ? hud.world.council : null);

  // An invasion: a chip for a few seconds after each new wave (the edges flash as well).
  let seenWave = hud.invasion?.n ?? 0;
  let invaded = $state(false);
  $effect(() => {
    const n = hud.invasion?.n ?? 0;
    if (n <= seenWave) return;
    seenWave = n;
    invaded = true;
    const timer = setTimeout(() => (invaded = false), 6000);
    return () => clearTimeout(timer);
  });

  /** Back to the map, the piece asked for unfolded in its column. */
  function back(piece?: PieceId): void {
    restoreColumns();
    if (piece) layout.pin(piece);
  }
</script>

<header
  class="rstrip newsprint"
  data-testid="reading-strip"
  aria-label={t('reading.title')}
  use:hudSize={'strip'}
>
  <div class="ess">
    {#if L && live}
      <span class="fig" data-tip={t('hud.gold')}
        ><Icon name="gold" size={14} /><b class="mono brass">{short(L.gold)}</b></span
      >
      <span class="fig" data-tip={t('hud.troopsTip')}
        ><Icon name="troops" size={14} /><b class="mono">{short(L.troops)}</b><small class="mono"
          >/ {short(L.popCap)}</small
        ></span
      >
    {/if}
    <span class="fig clock" data-tip={hud.phase === 'spawn' ? t('hud.spawnTimerTip') : t('hud.elapsed')}
      ><Icon name="time" size={14} /><b class="mono"
        >{hud.phase === 'spawn' ? `${Math.ceil(spawnLeft / 10)} s` : clock(elapsed)}</b
      >{#if hud.paused}<Icon name="pause" size={12} />{/if}</span
    >
  </div>
  <div class="chips" aria-live="polite">
    {#if invaded}
      <button class="zchip spot urgent" onclick={() => back()} data-testid="reading-invasion"
        ><Icon name="war" size={13} /><b>{t('reading.invasion')}</b></button
      >
    {/if}
    <NukeSender {ctl} docked />
    {#if live}<AllyRequests {ctl} variant="chips" />{/if}
    <PactBanner {ctl} slim />
    {#each hud.subtitles.slice(-1) as s (s.id)}
      <span class="caption" aria-hidden="true">{s.text}</span>
    {/each}
    {#if council}
      <button class="zchip" onclick={() => back('council')} data-testid="reading-council"
        ><Icon name="council" size={13} /><b>{t('zone.council')}</b><span class="mono"
          >{Math.ceil(Math.max(0, council.closes - hud.tick) / 10)} s</span
        ></button
      >
    {/if}
    {#if live && L && L.capital < 0}
      <button class="zchip spot" onclick={() => back('capital')} data-testid="reading-capital"
        ><Icon name="capital" size={13} /><b>{t('capital.kickerLost')}</b></button
      >
    {/if}
    {#if hud.breaking && !hud.panels.log}
      <button class="zchip spot" onclick={() => openPanel('log')} data-testid="reading-breaking"
        ><Icon name="news" size={13} /><b>{t('news.breaking')}</b></button
      >
    {/if}
    {#if hud.toasts.length}
      <button
        class="zchip"
        onclick={() => back('dispatches')}
        title={hud.toasts.at(-1)?.text}
        data-testid="reading-dispatches"
        ><Icon name="news" size={13} /><b
          >{hud.toasts.length === 1
            ? t('zone.dispatchesOne')
            : t('zone.dispatches', { n: hud.toasts.length })}</b
        ></button
      >
    {/if}
  </div>
  <button class="back" onclick={() => back()} data-tip={t('reading.backTip')} data-testid="reading-restore"
    ><Icon name="collapse" size={14} /><span>{t('reading.back')}</span></button
  >
</header>

<style>
  /* The running head of the reading mode: a band of paper across the top of the screen. */
  .rstrip {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 12px;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 6px 12px;
    min-height: 44px;
    padding: 6px 8px 6px 12px;
    border: 1px solid var(--np-edge);
    border-bottom: 2px solid var(--np-ink);
    border-radius: 1px;
    box-shadow: var(--np-lift);
    font-family: var(--text);
  }
  .ess {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    padding-right: 12px;
    border-right: 1px solid var(--np-rule);
  }
  .fig {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--np-ink-2);
    white-space: nowrap;
  }
  .fig b {
    font-weight: 600;
    font-size: 1.02em;
    color: var(--np-ink);
  }
  .fig b.brass {
    color: var(--np-brass);
  }
  .fig small {
    font-size: 0.8em;
    color: var(--np-ink-3);
  }
  .chips {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chips > :global(*) {
    flex: none;
  }
  .zchip.urgent {
    height: 30px;
    font-weight: 600;
    color: var(--np-spot);
  }
  .caption {
    flex: 0 1 auto !important;
    min-width: 0;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.88em;
    color: var(--np-ink-2);
  }
  .back {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--np-ink-2);
    border-radius: 2px;
    background: transparent;
    font-family: var(--text);
    font-size: 0.82em;
    font-weight: 600;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    white-space: nowrap;
  }
  .back:hover,
  .back:focus-visible {
    background: var(--np-paper-2);
    border-color: var(--np-ink);
  }
  /* Compact: the button's name in its tooltip. */
  :global(.game[data-layout='compact']) .back span {
    display: none;
  }
</style>
