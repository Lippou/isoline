<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { wm, focusWindow, clampAll, type WinId } from '../stores/windows.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import DiplomacyPanel from './DiplomacyPanel.svelte';
  import TechPanel from './TechPanel.svelte';
  import StatsPanel from './StatsPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import TradePanel from './TradePanel.svelte';
  import Window from './Window.svelte';
  import { inPaper, weightOf } from './news';
  import { researchIdle } from './research';
  import { audio } from '../../audio/audio';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  let { ctl }: { ctl: GameController } = $props();
  const tabs: { id: WinId; icon: IconName; hidden?: boolean }[] = [
    { id: 'diplomacy', icon: 'diplomacy' },
    { id: 'trade', icon: 'trade' },
    { id: 'tech', icon: 'tech', hidden: !ctl.session.config.features.tech },
    { id: 'stats', icon: 'stats' },
    { id: 'log', icon: 'log' },
    { id: 'chat', icon: 'chat' },
  ];
  /** A closed window opens; one hidden behind another comes to the front; the front one closes. */
  function toggle(id: WinId): void {
    if (hud.panels[id] && wm.order.at(-1) !== id) {
      focusWindow(id);
      audio.ui('click');
      return;
    }
    hud.panels[id] = !hud.panels[id];
    audio.ui('open');
  }
  /** Unread news: 'head' when a headline is among it (the mark turns magenta). */
  const unread = $derived.by(() => {
    let level: '' | 'brief' | 'head' = '';
    for (let k = hud.log.length - 1; k >= 0; k--) {
      const e = hud.log[k]!;
      if (e.tick <= hud.journalSeen) break;
      if (!inPaper(e)) continue;
      if (weightOf(e.key) > 0) return 'head';
      level = 'brief';
    }
    return level;
  });

  /** Research has stopped while it could go on: the Technologies button pulses. */
  const techIdle = $derived(
    !hud.replay && !hud.panels.tech && researchIdle(hud.local, ctl.session.config.features.tech),
  );

  const showRail = $derived(!hud.spectating || !!hud.replay);
  let railW = $state(0);
  // Windows and the column of cards open beside the rail (at the edge without it).
  $effect(() => {
    wm.railRight = showRail && railW ? 12 + railW : 2;
  });
</script>

<svelte:window onresize={clampAll} />

{#if showRail}
  <!-- The dock: a rail along the left edge, centred in the room above the resources panel. -->
  <div class="strip">
    <nav class="rail glass" aria-label={t('hud.panels')} bind:clientWidth={railW}>
      {#each tabs.filter((tb) => !tb.hidden) as tb (tb.id)}
        <button
          class:active={hud.panels[tb.id]}
          class:front={hud.panels[tb.id] && wm.order.at(-1) === tb.id}
          onclick={() => toggle(tb.id)}
          title={t(`panel.${tb.id}`)}
          aria-pressed={hud.panels[tb.id]}
          data-testid="panel-{tb.id}"
        >
          <Icon name={tb.icon} size={18} />
          <span class="lbl">{t(`panel.${tb.id}`)}</span>
          {#if tb.id === 'log' && unread}<i class="dot" class:head={unread === 'head'}></i>{/if}
          {#if tb.id === 'tech' && techIdle}<i class="dot research" data-testid="tech-idle-dot"></i>{/if}
        </button>
      {/each}
      <div class="sep"></div>
      <button onclick={() => (hud.panels.menu = true)} title={t('hud.menu')} data-testid="open-menu">
        <Icon name="menu" size={18} /><span class="lbl">{t('hud.menu')}</span>
      </button>
    </nav>
  </div>
{/if}

<!-- The windows' layer: it lets the map be clicked everywhere around them. -->
<div class="wins">
  {#each tabs as tb (tb.id)}
    {#if hud.panels[tb.id] && !tb.hidden}
      {#if tb.id === 'log'}
        <Window id="log" paper><LogPanel {ctl} /></Window>
      {:else}
        <Window id={tb.id}>
          {#if tb.id === 'diplomacy'}<DiplomacyPanel {ctl} />
          {:else if tb.id === 'tech'}<TechPanel {ctl} />
          {:else if tb.id === 'trade'}<TradePanel {ctl} />
          {:else if tb.id === 'stats'}<StatsPanel {ctl} />
          {:else if tb.id === 'chat'}<ChatPanel {ctl} />
          {/if}
        </Window>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .strip {
    position: absolute;
    left: 12px;
    top: 12px;
    bottom: calc(280px * var(--ui-scale));
    display: flex;
    align-items: center;
    pointer-events: none;
    z-index: 29;
  }
  .rail {
    display: grid;
    gap: 2px;
    padding: 3px;
    pointer-events: auto;
    max-height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .rail button {
    position: relative;
    width: calc(62px * var(--ui-scale));
    padding: 7px 2px 5px;
    display: grid;
    justify-items: center;
    gap: 3px;
    border-radius: 4px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: var(--muted);
  }
  .lbl {
    font-size: 0.62em;
    line-height: 1.1;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rail button:hover {
    color: var(--parchment);
    background: var(--panel-2);
  }
  .rail button.active {
    color: var(--parchment);
    background: var(--select-bg);
    border-color: var(--line-strong);
  }
  /* The window in front: its button carries the shoal-blue edge. */
  .rail button.front {
    border-color: var(--aurora);
  }
  .rail button.active::before {
    content: '';
    position: absolute;
    left: -3px;
    top: 9px;
    bottom: 9px;
    width: 2px;
    border-radius: 1px;
    background: var(--aurora);
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 3px 6px;
  }
  .dot {
    position: absolute;
    top: 6px;
    right: 13px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brass);
  }
  .dot.head {
    background: var(--signal);
    box-shadow: 0 0 0 2px var(--glass);
  }
  /* Research stopped: a slow aurora pulse. */
  .dot.research {
    background: var(--aurora);
    animation: research-pulse 1.6s ease-in-out infinite;
  }
  @keyframes research-pulse {
    50% {
      opacity: 0.35;
    }
  }
  .wins {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 28;
  }
</style>
