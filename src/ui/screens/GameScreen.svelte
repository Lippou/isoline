<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { hud, openPaper } from '../stores/game.svelte';
  import { columnPlace } from '../stores/windows.svelte';
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
  import NukePanel from '../hud/NukePanel.svelte';
  import PactBanner from '../hud/PactBanner.svelte';
  import Alliances from '../hud/Alliances.svelte';
  import Isolines from '../components/Isolines.svelte';
  import Panels from '../hud/Panels.svelte';
  import FinalEdition from '../hud/FinalEdition.svelte';
  import FallNotice from '../hud/FallNotice.svelte';
  import GameMenu from '../hud/GameMenu.svelte';
  import Dialogue from '../hud/Dialogue.svelte';
  import ReplayBar from '../hud/ReplayBar.svelte';
  import Requests from '../hud/Requests.svelte';
  import AllyRequests from '../hud/AllyRequests.svelte';
  import BreakingNews from '../hud/BreakingNews.svelte';
  import EventCard from '../hud/EventCard.svelte';
  import CapitalCard from '../hud/CapitalCard.svelte';
  import Perf from '../hud/Perf.svelte';
  import Icon from '../icons/Icon.svelte';

  let host: HTMLDivElement;
  let ctl: GameController | null = $state(null);
  // The left column moves beside the windows standing at the left edge (Panels.svelte),
  // so nuclear alerts, the council vote and the news stay readable instead of hiding under them.
  const col = $derived(columnPlace());

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
      <div class="ripple" aria-hidden="true">
        <Isolines mode="ripple" count={7} r0={14} step={16} color="var(--aurora)" stroke={1.4} />
      </div>
      <p>{hud.loadingText || t('loading.map')}</p>
    </div>
  {/if}
  {#if ctl && hud.ready}
    <TopBar {ctl} />
    {#if !hud.spectating && hud.replay === null}
      <ResourcePanel {ctl} />
      <BuildBar {ctl} />
      <NukePanel {ctl} />
    {/if}
    <Minimap {ctl} />
    <Leaderboard {ctl} />
    <HoverCard />
    <!-- Left column, beside the dock: council vote, nuclear alerts, the lost-capital dispatch, the news (special edition, flash) and alliances. -->
    <div class="tl" style:left="{col.left}px" style:max-width="{col.maxW}px">
      <Requests {ctl} />
      <NukeAlerts {ctl} />
      <CapitalCard {ctl} />
      <BreakingNews {ctl} />
      <EventCard {ctl} />
      {#if !hud.spectating && !col.covered}<Alliances {ctl} />{/if}
    </div>
    <PactBanner {ctl} />
    {#if !hud.spectating && hud.replay === null}<AllyRequests {ctl} />{/if}
    <Panels {ctl} />
    <RadialMenu {ctl} />
    <Dialogue {ctl} />
    <Toasts {ctl} />
    {#if hud.replay}<ReplayBar {ctl} />{/if}
    {#if hud.panels.menu}<GameMenu {ctl} />{/if}
    <!-- The end of the game: the final edition of the Courier (front page or mission
         communiqué, then the results); folded, a button opens it again. -->
    {#if hud.paper && (hud.end || ctl.edition)}<FinalEdition {ctl} />{/if}
    {#if hud.end && !hud.paper}
      <button class="reopen newsprint" onclick={() => openPaper()} data-testid="end-reopen"
        ><Icon name="news" size={15} />{t('end.showResults')}</button
      >
    {/if}
    {#if hud.fallen && !hud.end}<FallNotice {ctl} />{/if}
    {#if hud.showPerf}<Perf {ctl} />{/if}
  {/if}
</div>

<style>
  /* Never taller than the room above the resources panel: it scrolls instead. */
  .tl {
    position: absolute;
    left: 84px;
    top: 64px;
    max-height: calc(100vh - 64px - 300px * var(--ui-scale));
    overflow-y: auto;
    scrollbar-width: none;
    display: grid;
    align-content: start;
    gap: 8px;
    justify-items: start;
    z-index: 27;
    pointer-events: none;
  }
  .tl > :global(*) {
    pointer-events: auto;
  }
  /* The folded paper: a newsprint tab above the build bar, clear of the toasts. */
  .reopen {
    position: fixed;
    left: 50%;
    bottom: calc(12px + 112px * var(--ui-scale));
    transform: translateX(-50%);
    z-index: 30;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: 0;
    border-top: 3px solid var(--np-ink);
    border-radius: 1px;
    font-family: var(--title);
    font-size: 1.05em;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 10px 28px rgba(3, 10, 16, 0.5);
  }
  .reopen:hover,
  .reopen:focus-visible {
    background: var(--np-paper-2);
  }
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
    background: radial-gradient(circle at 50% 45%, #15405e, var(--abyss));
  }
  .ripple {
    width: 220px;
    height: 160px;
  }
</style>
