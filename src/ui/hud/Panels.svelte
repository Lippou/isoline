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
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  let { ctl }: { ctl: GameController } = $props();
  type P = 'diplomacy' | 'tech' | 'stats' | 'log' | 'chat';
  const tabs: { id: P; icon: IconName; hidden?: boolean }[] = [
    { id: 'diplomacy', icon: 'diplomacy' },
    { id: 'tech', icon: 'tech', hidden: !ctl.session.config.features.tech },
    { id: 'stats', icon: 'stats' },
    { id: 'log', icon: 'log' },
    { id: 'chat', icon: 'chat' },
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
        <Icon name={tb.icon} size={18} />
        <span class="lbl">{t(`panel.${tb.id}`)}</span>
        {#if tb.id === 'log' && hud.log.length}<i class="dot"></i>{/if}
      </button>
    {/each}
    <div class="sep"></div>
    <button onclick={() => (hud.panels.menu = true)} title={t('hud.menu')} data-testid="open-menu">
      <Icon name="menu" size={18} /><span class="lbl">{t('hud.menu')}</span>
    </button>
  </nav>
{/if}

{#if openId}
  <section class="drawer glass rise-in" class:wide={openId === 'tech'} data-testid="panel-open">
    <header>
      <h3>{t(`panel.${openId}`)}</h3>
      <button class="x" onclick={() => (hud.panels[openId] = false)} aria-label={t('common.close')}
        ><Icon name="close" size={16} /></button
      >
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
    gap: 2px;
    padding: 4px;
    z-index: 7;
  }
  .dock button {
    position: relative;
    width: 64px;
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
    font-size: 0.66em;
    line-height: 1.1;
    text-align: center;
  }
  .dock button:hover {
    color: var(--parchment);
    background: var(--panel-2);
  }
  .dock button.active {
    color: var(--parchment);
    background: rgba(127, 169, 214, 0.16);
    border-color: var(--aurora);
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 3px 4px;
  }
  .dot {
    position: absolute;
    top: 5px;
    right: 12px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brass);
  }
  .drawer {
    position: absolute;
    left: 88px;
    top: 90px;
    bottom: calc(360px * var(--ui-scale));
    width: calc(400px * var(--ui-scale));
    min-height: 280px;
    display: grid;
    grid-template-rows: auto 1fr;
    z-index: 8;
    overflow: hidden;
  }
  .drawer.wide {
    width: calc(640px * var(--ui-scale));
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
  }
  .x {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
  }
  .x:hover {
    color: var(--parchment);
  }
  .body {
    padding: 12px 14px;
    font-size: 0.9em;
    min-height: 0;
  }
</style>
