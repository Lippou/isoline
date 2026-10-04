<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { hud, openPaper } from '../stores/game.svelte';
  import { layout, NUDGE_ROOM } from '../stores/layout.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { GameController } from '../game/controller';
  import TopBar from '../hud/TopBar.svelte';
  import ResourcePanel from '../hud/ResourcePanel.svelte';
  import BuildBar from '../hud/BuildBar.svelte';
  import Minimap from '../hud/Minimap.svelte';
  import Leaderboard from '../hud/Leaderboard.svelte';
  import CursorNote from '../hud/CursorNote.svelte';
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
  import PhotoBar from '../hud/PhotoBar.svelte';
  import InvasionFlash from '../hud/InvasionFlash.svelte';
  import NukeSender from '../hud/NukeSender.svelte';
  import ReadingStrip from '../hud/ReadingStrip.svelte';
  import Icon from '../icons/Icon.svelte';
  import '../hud/paper.css';
  import '../hud/hud.css';

  let host: HTMLDivElement;
  let ctl: GameController | null = $state(null);
  // The zones (stores/zones.ts): the columns, the strips and the stage stand where the
  // layout says, through the CSS variables set on the screen's root.
  const reading = $derived(layout.reading);
  const live = $derived(!hud.spectating && hud.replay === null);
  // Room kept over the build bar for the "research stopped" reminder, all the time research
  // exists, so that the stage (and the windows in it) never jump when it shows.
  $effect(() => {
    layout.nudge = ctl && hud.ready && live && ctl.session.config.features.tech ? NUDGE_ROOM : 0;
  });

  // Settings changed during the game reach the map at once (they were only read when it
  // started): country names in the new language, colour vision, contrast, motion, frame cap.
  $effect(() => {
    const live = {
      lang: i18n.lang,
      vision: settings.access.vision,
      highContrast: settings.access.highContrast,
      reducedMotion: settings.access.reducedMotion,
      maxFps: settings.graphics.maxFps,
    };
    const r = ctl && hud.ready ? ctl.renderer : null;
    if (!r) return;
    Object.assign(r.settings, live);
    r.applySettings();
  });
  // Graphics quality apart, so that changing anything else keeps an automatic downgrade.
  $effect(() => {
    const live = { quality: settings.graphics.quality, particles: settings.graphics.particles };
    const r = ctl && hud.ready ? ctl.renderer : null;
    if (r) Object.assign(r.settings, live);
  });

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

  // The interface scale is the page zoom: when it changes (the window was resized), the
  // map's canvas follows the new device pixel ratio to stay sharp.
  function syncResolution(): void {
    const r = ctl?.renderer?.app?.renderer;
    if (!r) return;
    const res = Math.min(2, window.devicePixelRatio || 1);
    if (Math.abs(r.resolution - res) > 0.01) r.resize(r.screen.width, r.screen.height, res);
  }
</script>

<svelte:window onresize={syncResolution} />

<!-- The whole HUD is printed on the Courier's paper (hud/hud.css). -->
<div
  class="game np-hud"
  class:photo={hud.photo}
  class:reading
  data-layout={layout.normal.cls}
  style={layout.vars}
  data-testid="game-screen"
>
  <div class="canvas-host" bind:this={host}></div>
  {#if hud.loading}
    <div class="loading fade-in">
      <div class="ripple" aria-hidden="true">
        <Isolines mode="ripple" count={7} r0={14} step={16} color="var(--np-ink-2)" stroke={1.2} />
      </div>
      <p>{hud.loadingText || t('loading.map')}</p>
    </div>
  {/if}
  {#if ctl && hud.ready}
    <!-- Under the panels' cards and windows, over the map and the HUD's edges. -->
    {#if !hud.photo}<InvasionFlash /><NukeSender {ctl} />{/if}
    <!-- Reading mode folds these away (they keep their state): the reading strip shows
         what matters of them. -->
    <div class="normal">
      <TopBar {ctl} />
      {#if live}
        <ResourcePanel {ctl} />
        <BuildBar {ctl} />
      {/if}
      <Minimap {ctl} />
      <Leaderboard {ctl} />
    </div>
    <HoverCard />
    {#if reading}
      <ReadingStrip {ctl} />
    {:else}
      <!-- The news column, beside the dock: nuclear alerts, the council vote, the lost-capital
           dispatch, the news (special edition, flash) and alliances. Short of height, the
           least important go on one line, then become chips (zones.ts). -->
      <div class="tl">
        <Requests {ctl} />
        <NukeAlerts {ctl} />
        <CapitalCard {ctl} />
        <BreakingNews {ctl} />
        <EventCard {ctl} />
        {#if !hud.spectating}<Alliances {ctl} />{/if}
      </div>
      <PactBanner {ctl} />
      <!-- The right column, between the leaderboard and the minimap: the launch panel while
           aiming and, nearest the minimap, the alliance offers. (The notifications go to the
           journal from 1.10.0: its dock button counts the unread.) -->
      <div class="tr">
        {#if live}<NukePanel {ctl} />{/if}
        {#if live}<AllyRequests {ctl} />{/if}
      </div>
    {/if}
    <Panels {ctl} />
    <RadialMenu {ctl} />
    <Dialogue {ctl} />
    {#if hud.replay && !reading}<ReplayBar {ctl} />{/if}
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
    {#if hud.photo}<PhotoBar {ctl} />{/if}
    {#if !hud.photo}<CursorNote />{/if}
  {/if}
</div>

<style>
  /* The news column: its zone (zones.ts), its pieces whole or on one line, chips at its foot.
     Scrolling is a last resort (urgent pieces alone taller than the room). */
  .tl {
    position: absolute;
    left: var(--zone-left-x, 94px);
    top: var(--zone-left-y, 12px);
    width: var(--card-w, 300px);
    max-height: var(--zone-left-h, 60vh);
    overflow-y: auto;
    /* An explanation (tooltip) wider than the column never adds a scrollbar under the pointer. */
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--np-rule-2) transparent;
    display: flex;
    flex-flow: row wrap;
    align-content: flex-start;
    gap: 8px;
    z-index: 27;
    pointer-events: none;
  }
  .tl > :global(*) {
    pointer-events: auto;
    flex: 0 0 100%;
    min-width: 0;
  }
  /* (What is read out to screen readers takes no room.) */
  .tl > :global(.sr-only) {
    margin: 0;
  }
  /* Folded pieces: chips side by side at the column's foot. */
  .tl > :global([data-zone-chip]) {
    flex: none;
    order: 1;
  }
  /* The right column: under the leaderboard, down to the minimap; its pieces sit at the foot. */
  .tr {
    position: absolute;
    left: var(--zone-right-x, auto);
    width: var(--zone-right-w, var(--right-w, 310px));
    top: calc(12px + var(--hud-lb-h, 240px) + 10px);
    bottom: calc(var(--hud-mini-h, 200px) + 22px);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-end;
    gap: 8px;
    z-index: 29;
    pointer-events: none;
  }
  .tr > :global(:is(.launch, .offers, [data-zone-chip])) {
    flex: none;
    pointer-events: auto;
  }
  .tr > :global([data-zone-chip]) {
    align-self: flex-end;
  }
  /* The launch panel at the head of the column, the rest at its foot. */
  .tr > :global(.launch) {
    margin-bottom: auto;
  }
  /* Reading mode: the pieces of the normal layout step aside (and keep their state). */
  .normal {
    display: contents;
  }
  .game.reading .normal {
    display: none;
  }
  /* The folded paper: a newsprint tab above the build bar, clear of the toasts. */
  .reopen {
    position: fixed;
    left: 50%;
    bottom: calc(var(--hud-bar-h, 100px) + 24px);
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
  /*
   * The HUD's layout tokens (--res-w, --mini-w, --card-w, --right-w, the zones' --zone-*)
   * come from the layout (stores/layout.svelte.ts), set on this root: the interface scale
   * (page zoom) has already fitted the window, the layout class (wide, standard, compact)
   * chooses the columns' widths.
   */
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
  /* Photo mode: only the map and the photo bar (the HUD keeps its state, just hidden). */
  .game.photo > :global(:not(.canvas-host):not(.photo-bar)) {
    display: none !important;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1rem;
    color: var(--np-ink-2);
    font-family: var(--np-serif);
    font-style: italic;
    background: var(--np-paper);
  }
  .ripple {
    width: 220px;
    height: 160px;
  }
</style>
