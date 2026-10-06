<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { wm, focusWindow, relayout, type WinId } from '../stores/windows.svelte';
  import { layout } from '../stores/layout.svelte';
  import { hudSize } from '../stores/hudBox.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import DiplomacyPanel from './DiplomacyPanel.svelte';
  import TechPanel from './TechPanel.svelte';
  import StatsPanel from './StatsPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import TradePanel from './TradePanel.svelte';
  import FrontPanel from './FrontPanel.svelte';
  import Window from './Window.svelte';
  import { unreadOf } from './news';
  import { researchIdle } from './research';
  import { audio } from '../../audio/audio';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  let { ctl }: { ctl: GameController } = $props();
  const tabs: { id: WinId; icon: IconName; hidden?: boolean }[] = [
    { id: 'diplomacy', icon: 'diplomacy' },
    { id: 'trade', icon: 'trade' },
    { id: 'front', icon: 'lineDefense' },
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
  /**
   * Unread news (1.10.0: every notification goes to the journal): their count on the
   * Journal's button, magenta when an alert is among them.
   */
  const unread = $derived(
    hud.panels.log ? { n: 0, danger: false, head: false } : unreadOf(hud.log, hud.journalSeen),
  );

  /** Research has stopped while it could go on: the Technologies button pulses. */
  const techIdle = $derived(
    !hud.replay && !hud.panels.tech && researchIdle(hud.local, ctl.session.config.features.tech),
  );

  const showRail = $derived(!hud.spectating || !!hud.replay);
  // The stage moved or changed size (the screen, the interface scale, a piece of the HUD):
  // the open windows stay in it (zones.ts).
  const stageKey = $derived.by(() => {
    const s = layout.normal.stage;
    return `${s.x},${s.y},${s.w},${s.h}`;
  });
  $effect(() => {
    void stageKey;
    relayout();
  });
</script>

{#if showRail}
  <!-- The dock: a rail along the left edge, centred in its zone (above the resources panel);
       in reading mode it stays put (zones.ts, railPlacement): opening a window never moves it. -->
  <div class="strip" class:reading={layout.reading}>
    <nav class="rail glass" aria-label={t('hud.panels')} use:hudSize={'rail'}>
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
          {#if tb.id === 'log' && unread.n}<i
              class="count mono"
              class:danger={unread.danger}
              data-testid="journal-unread"
              title={t(unread.danger ? 'inbox.tipDanger' : 'inbox.tip', { n: unread.n })}
              >{unread.danger ? '! ' : ''}{unread.n > 99 ? '99+' : unread.n}</i
            >{/if}
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
      <!-- The journal and its siblings are printed on the paper: they bring their own masthead. -->
      {#if tb.id === 'log'}
        <Window id="log" paper><LogPanel {ctl} /></Window>
      {:else if tb.id === 'diplomacy'}
        <Window id="diplomacy" paper><DiplomacyPanel {ctl} /></Window>
      {:else if tb.id === 'tech'}
        <Window id="tech" paper><TechPanel {ctl} /></Window>
      {:else if tb.id === 'chat'}
        <Window id="chat" paper><ChatPanel {ctl} /></Window>
      {:else if tb.id === 'trade'}
        <Window id="trade" paper><TradePanel {ctl} /></Window>
      {:else if tb.id === 'front'}
        <Window id="front" paper><FrontPanel {ctl} /></Window>
      {:else if tb.id === 'stats'}
        <Window id="stats" paper><StatsPanel {ctl} /></Window>
      {/if}
    {/if}
  {/each}
</div>

<style>
  .strip {
    position: absolute;
    left: 12px;
    top: var(--zone-rail-y, 12px);
    height: var(--zone-rail-h, 50vh);
    display: flex;
    /* Its top is placed by the zones (centred there), the same in reading mode. */
    align-items: flex-start;
    pointer-events: none;
    z-index: 29;
  }
  /* The dock: a strip of paper along the edge, its sections as the journal's index. */
  .rail {
    display: grid;
    gap: 1px;
    padding: 3px;
    pointer-events: auto;
    max-height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }
  .rail button {
    position: relative;
    width: 66px;
    padding: 7px 2px 5px;
    display: grid;
    justify-items: center;
    gap: 3px;
    border-radius: 1px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    color: var(--np-ink-2);
  }
  .lbl {
    font-size: 0.66em;
    font-weight: 500;
    line-height: 1.1;
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rail button:hover {
    color: var(--np-ink);
    background: var(--np-card);
  }
  /* An open window: its section shaded, an ink tab in the margin. */
  .rail button.active {
    color: var(--np-ink);
    background: var(--np-paper-2);
  }
  /* The window in front: reversed, as the journal prints what is current. */
  .rail button.front {
    color: var(--np-paper);
    background: var(--np-ink);
    border-color: var(--np-ink);
  }
  .rail button.active::before {
    content: '';
    position: absolute;
    left: -3px;
    top: 7px;
    bottom: 7px;
    width: 3px;
    background: var(--np-ink);
  }
  .sep {
    height: 1px;
    background: var(--np-rule);
    margin: 3px 6px;
  }
  .dot {
    position: absolute;
    top: 6px;
    right: 13px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--np-gold);
    box-shadow: 0 0 0 1.5px var(--np-paper);
  }
  /* Unread news: their count in a tab of ink at the button's corner, magenta with an alert. */
  .count {
    position: absolute;
    top: 3px;
    right: 6px;
    min-width: 17px;
    height: 15px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: 1px;
    background: var(--np-ink);
    box-shadow: 0 0 0 1.5px var(--np-paper);
    color: var(--np-paper);
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  /* Alarming news unread: a "!" before the count and a doubled rule (not only magenta). */
  .count.danger {
    background: var(--np-spot);
    box-shadow:
      0 0 0 1.5px var(--np-paper),
      0 0 0 2.5px var(--np-spot);
  }
  .rail button.front .count {
    box-shadow: 0 0 0 1.5px var(--np-ink);
  }
  /* Research stopped: a slow pulse in the sea's blue. */
  .dot.research {
    background: var(--np-sea);
    animation: research-pulse 1.6s ease-in-out infinite;
  }
  @keyframes research-pulse {
    50% {
      opacity: 0.35;
    }
  }
  .strip.reading {
    top: var(--zone-read-rail-y, 66px);
    height: var(--zone-read-rail-h, 80vh);
  }
  /* Short windows and the compact layout: icons only (the name is in the tooltip). */
  @media (max-height: 760px) {
    .lbl {
      display: none;
    }
    .rail button {
      width: 44px;
      padding: 8px 2px;
    }
    .dot {
      right: 6px;
    }
    .count {
      right: 2px;
    }
  }
  :global(.game[data-layout='compact']) .lbl {
    display: none;
  }
  :global(.game[data-layout='compact']) .rail button {
    width: 44px;
    padding: 8px 2px;
  }
  :global(.game[data-layout='compact']) .dot {
    right: 6px;
  }
  :global(.game[data-layout='compact']) .count {
    right: 2px;
  }
  .wins {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 28;
  }
</style>
