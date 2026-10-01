<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import DiplomacyPanel from './DiplomacyPanel.svelte';
  import TechPanel from './TechPanel.svelte';
  import StatsPanel from './StatsPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import ChatPanel from './ChatPanel.svelte';
  import { audio } from '../../audio/audio';

  let { ctl }: { ctl: GameController } = $props();
  type P = 'diplomacy' | 'tech' | 'stats' | 'log' | 'chat';
  const tabs: { id: P; icon: string; hidden?: boolean }[] = [
    { id: 'diplomacy', icon: '🏳' },
    { id: 'tech', icon: '⚙', hidden: !ctl.session.config.features.tech },
    { id: 'stats', icon: '📈' },
    { id: 'log', icon: '📜' },
    { id: 'chat', icon: '💬' },
  ];
  function toggle(id: P): void {
    const open = hud.panels[id];
    for (const tb of tabs) hud.panels[tb.id] = false;
    hud.panels[id] = !open;
    audio.ui('open');
  }
  const openId = $derived(tabs.find((tb) => hud.panels[tb.id])?.id ?? null);
</script>

{#if !hud.spectating || hud.replay}
  <nav class="dock glass" aria-label={t('hud.panels')}>
    {#each tabs.filter((tb) => !tb.hidden) as tb (tb.id)}
      <button
        class:active={hud.panels[tb.id]}
        onclick={() => toggle(tb.id)}
        title={t(`panel.${tb.id}`)}
        data-testid="panel-{tb.id}"
      >
        <span>{tb.icon}</span>
        {#if tb.id === 'log' && hud.log.length}<i class="dot"></i>{/if}
      </button>
    {/each}
    <button onclick={() => (hud.panels.menu = true)} title={t('hud.menu')}>☰</button>
  </nav>
{/if}

{#if openId}
  <section class="drawer glass rise-in" data-testid="panel-open">
    <header>
      <h3>{t(`panel.${openId}`)}</h3>
      <button class="x" onclick={() => (hud.panels[openId] = false)}>✕</button>
    </header>
    <div class="body scroll">
      {#if openId === 'diplomacy'}<DiplomacyPanel {ctl} />{/if}
      {#if openId === 'tech'}<TechPanel {ctl} />{/if}
      {#if openId === 'stats'}<StatsPanel {ctl} />{/if}
      {#if openId === 'log'}<LogPanel {ctl} />{/if}
      {#if openId === 'chat'}<ChatPanel {ctl} />{/if}
    </div>
  </section>
{/if}

<style>
  .dock {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    gap: 4px;
    padding: 5px;
    z-index: 7;
  }
  .dock button {
    position: relative;
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    font-size: 1.05em;
    color: var(--parchment);
  }
  .dock button:hover,
  .dock button.active {
    background: rgba(79, 227, 193, 0.15);
    border-color: var(--line-strong);
  }
  .dot {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--aurora);
  }
  .drawer {
    position: absolute;
    left: 62px;
    top: 90px;
    bottom: calc(330px * var(--ui-scale));
    width: calc(380px * var(--ui-scale));
    min-height: 260px;
    display: grid;
    grid-template-rows: auto 1fr;
    z-index: 8;
    overflow: hidden;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--line);
  }
  .x {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
  }
  .body {
    padding: 0.6rem 0.8rem;
    font-size: 0.88em;
    min-height: 0;
  }
</style>
