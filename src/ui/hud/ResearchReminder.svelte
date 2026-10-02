<script lang="ts">
  // "Research stopped — choose": a discreet, persistent prompt above the build bar while
  // nothing is being researched although something could be (it opens the tree). With the
  // auto-continue setting on, the cheapest available technology is started instead.
  import { hud, openPanel } from '../stores/game.svelte';
  import { t, num } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import Icon from '../icons/Icon.svelte';
  import { cheapestAvailable, researchIdle } from './research';

  let { ctl }: { ctl: GameController } = $props();
  const techOn = $derived(ctl.session.config.features.tech);
  const L = $derived(hud.local);
  const live = $derived(!hud.replay && !hud.spectating);
  const idle = $derived(live && researchIdle(L, techOn));

  // Auto-continue: one order at a time (the command takes a few ticks to come back).
  let lastAuto = 0;
  $effect(() => {
    if (!live || !techOn || !settings.game.autoResearch || !L?.alive) return;
    if (L.researching >= 0 || L.researchQueue.length > 0) return;
    const next = cheapestAvailable(L.tech);
    if (next < 0) return;
    const now = performance.now();
    if (now - lastAuto < 1500) return;
    lastAuto = now;
    ctl.session.cmd({ t: 'research', tech: next });
  });
</script>

{#if idle && L && !settings.game.autoResearch && !hud.panels.tech}
  <button class="nudge glass" onclick={() => openPanel('tech')} data-testid="research-idle">
    <i class="pulse" aria-hidden="true"></i>
    <Icon name="tech" size={14} />
    <b>{t('tech.idle')}</b>
    {#if L.researchPoints >= 1}<span class="bank mono"
        >{t('tech.idleBank', { n: num(Math.floor(L.researchPoints)) })}</span
      >{/if}
    <span class="go">{t('tech.idleChoose')}<Icon name="chevronRight" size={12} /></span>
  </button>
{/if}

<style>
  .nudge {
    position: absolute;
    left: 50%;
    translate: -50% 0;
    bottom: calc(100% + 8px);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px 4px 8px;
    border: 1px solid color-mix(in srgb, var(--aurora) 45%, var(--line));
    border-radius: 4px;
    color: var(--parchment);
    font-size: 0.8em;
    white-space: nowrap;
    cursor: pointer;
    animation: rise 0.25s ease-out;
  }
  .nudge:hover {
    border-color: var(--aurora);
  }
  .nudge :global(svg) {
    color: var(--aurora);
  }
  b {
    font-weight: 600;
  }
  .bank {
    color: var(--muted);
    font-size: 0.92em;
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    color: var(--aurora);
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--aurora);
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--aurora) 60%, transparent);
    }
    50% {
      opacity: 0.55;
      box-shadow: 0 0 0 4px transparent;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  :global(.reduced-motion) .pulse,
  :global(.reduced-motion) .nudge {
    animation: none;
  }
</style>
