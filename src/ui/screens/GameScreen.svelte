<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { GameController } from '../game/controller';
  import TopBar from '../hud/TopBar.svelte';
  import ResourcePanel from '../hud/ResourcePanel.svelte';
  import BuildBar from '../hud/BuildBar.svelte';
  import Minimap from '../hud/Minimap.svelte';
  import Leaderboard from '../hud/Leaderboard.svelte';
  import Toasts from '../hud/Toasts.svelte';
  import RadialMenu from '../hud/RadialMenu.svelte';
  import HoverCard from '../hud/HoverCard.svelte';
  import NukeAlerts from '../hud/NukeAlerts.svelte';
  import Panels from '../hud/Panels.svelte';
  import EndScreen from '../hud/EndScreen.svelte';
  import GameMenu from '../hud/GameMenu.svelte';
  import Dialogue from '../hud/Dialogue.svelte';
  import ReplayBar from '../hud/ReplayBar.svelte';
  import Requests from '../hud/Requests.svelte';
  import Perf from '../hud/Perf.svelte';

  let host: HTMLDivElement;
  let ctl: GameController | null = $state(null);

  onMount(() => {
    const req = app.launch;
    if (!req) {
      go('title');
      return;
    }
    const c = new GameController(req);
    ctl = c;
    c.start(host).catch((e) => {
      console.error(e);
      hud.loadingText = String(e);
    });
  });

  onDestroy(() => ctl?.dispose());
</script>

<div class="game" data-testid="game-screen">
  <div class="canvas-host" bind:this={host}></div>
  {#if hud.loading}
    <div class="loading fade-in">
      <div class="spinner"></div>
      <p>{hud.loadingText || t('loading.map')}</p>
    </div>
  {/if}
  {#if ctl && hud.ready}
    <TopBar />
    {#if !hud.spectating && hud.replay === null}
      <ResourcePanel {ctl} />
      <BuildBar {ctl} />
    {/if}
    <Minimap {ctl} />
    <Leaderboard {ctl} />
    <HoverCard />
    <NukeAlerts {ctl} />
    <Requests {ctl} />
    <Panels {ctl} />
    <RadialMenu {ctl} />
    <Dialogue />
    <Toasts {ctl} />
    {#if hud.replay}<ReplayBar {ctl} />{/if}
    {#if hud.panels.menu}<GameMenu {ctl} />{/if}
    {#if hud.end}<EndScreen {ctl} />{/if}
    {#if hud.showPerf}<Perf {ctl} />{/if}
  {/if}
</div>

<style>
  .game {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--abyss);
  }
  .canvas-host {
    position: absolute;
    inset: 0;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    color: var(--muted);
    background: radial-gradient(circle at 50% 45%, #13213a, var(--abyss));
  }
  .spinner {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: 3px solid rgba(79, 227, 193, 0.15);
    border-top-color: var(--aurora);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
