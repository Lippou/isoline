<script lang="ts">
  // A dispatch when we fall while the game goes on (LAN, other humans still in): who
  // took us down and when, then the choice to follow the game to its end (the final
  // edition appears then) or to leave it.
  import { onMount } from 'svelte';
  import './paper.css';
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { go } from '../stores/app.svelte';
  import { clockText } from './frontPage';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  const f = $derived(hud.fallen!);
  const at = $derived(clockText(f.tick - (hud.world?.startTick ?? 0)));
  const by = $derived(f.by > 0 ? ctl.session.state.name(f.by, i18n.lang) : '');
  const title = $derived(f.cause === 'surrender' ? t('end.fall.surrendered') : t('end.fall.title'));
  const line = $derived(
    f.cause === 'surrender'
      ? t('end.fall.at', { clock: at })
      : f.cause === 'nuked'
        ? t('end.fall.nuked', { clock: at })
        : by
          ? t('end.fall.by', { name: by, clock: at })
          : t('end.fall.at', { clock: at }),
  );
  let card: HTMLElement | undefined = $state();
  onMount(() => card?.querySelector<HTMLButtonElement>('.np-btn.ink')?.focus());
  function keys(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      hud.fallen = null;
    }
  }
</script>

<div
  class="dispatch newsprint"
  role="alertdialog"
  tabindex="-1"
  aria-labelledby="fn-title"
  aria-describedby="fn-body"
  data-testid="fall-notice"
  bind:this={card}
  onkeydown={keys}
>
  <p class="ear"><Icon name="eliminated" size={13} />{t('end.fall.ear')}</p>
  <h2 id="fn-title">{title}</h2>
  <p class="line">{line}</p>
  <p class="body" id="fn-body">{t('end.fall.body')}</p>
  <div class="acts">
    <button class="np-btn" onclick={() => go('title')} data-testid="fall-quit">{t('end.fall.quit')}</button>
    <button class="np-btn ink" onclick={() => (hud.fallen = null)} data-testid="fall-watch"
      ><Icon name="eye" size={14} />{t('end.fall.watch')}</button
    >
  </div>
</div>

<style>
  /* At the head of the map's stage (zones.ts). */
  .dispatch {
    position: absolute;
    top: var(--zone-stage-y, 72px);
    left: var(--zone-band-c, 50%);
    z-index: 40;
    width: min(440px, var(--zone-band-w, calc(100vw - 32px)));
    transform: translateX(-50%);
    padding: 12px 18px 14px;
    border-top: 4px solid var(--np-spot);
    font-family: var(--np-serif);
    box-shadow: 0 18px 44px rgba(3, 10, 16, 0.55);
    animation: drop 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translate(-50%, -12px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dispatch {
      animation: none;
    }
  }
  .ear {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-family: var(--text);
    font-size: 0.78em;
    font-weight: 600;
    color: var(--np-spot);
  }
  h2 {
    margin: 4px 0 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.9em;
    line-height: 1.05;
    color: var(--np-ink);
  }
  .line {
    margin: 4px 0 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.05em;
    color: var(--np-ink);
  }
  .body {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px solid var(--np-rule);
    font-size: 0.9em;
    line-height: 1.45;
    color: var(--np-ink-2);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
