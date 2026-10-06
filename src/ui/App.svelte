<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from './stores/app.svelte';
  import { loadSettings, settings } from './stores/settings.svelte';
  import { loadProfile } from './stores/profile.svelte';
  import { bridge } from './bridge';
  import { audio } from '../audio/audio';
  import Splash from './screens/Splash.svelte';
  import Title from './screens/Title.svelte';
  import Lobby from './screens/Lobby.svelte';
  import LanBrowser from './screens/LanBrowser.svelte';
  import GameScreen from './screens/GameScreen.svelte';
  import Editor from './screens/Editor.svelte';
  import Replays from './screens/Replays.svelte';
  import Profile from './screens/Profile.svelte';
  import Settings from './screens/Settings.svelte';
  import About from './screens/About.svelte';
  import Campaign from './screens/Campaign.svelte';
  import LoadGame from './screens/LoadGame.svelte';
  import Modal from './Modal.svelte';
  import ScreenSweep from './components/ScreenSweep.svelte';
  import { defaultConfig } from '../core/game/config';
  import { withMyFlag, startMission, startFromSave } from './screens/launch';
  import { applyUiScale, setInGame, startViewport } from './stores/viewport.svelte';

  let booted = $state(false);
  // Screen transition: a quick contour sweep, except for the splash and the title's own
  // opening sequence (which draws its contours from the logo).
  const sweep = $derived(app.screen !== 'splash' && !(app.screen === 'title' && app.previous === 'splash'));
  const sweepSeed = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  onMount(async () => {
    const info = await bridge.info().catch(() => null);
    if (info) {
      app.version = info.version;
      app.platform = info.platform;
    }
    await Promise.all([loadSettings(), loadProfile()]);
    audio.setVolumes(settings.audio);
    audio.voiceLang = settings.lang;
    startViewport();
    booted = true;
    autostart();
    // Autoplay policy: the audio context starts on the first gesture (later gestures
    // only resume it if the system suspended it). The scene is never re-set here: that
    // restarted the music at every click.
    const unlock = () => audio.ensure();
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener(
      'error',
      (e) => void bridge.storage.log(`[renderer] ${e.message} ${e.filename}:${e.lineno}`),
    );
    window.addEventListener(
      'unhandledrejection',
      (e) => void bridge.storage.log(`[renderer] unhandled: ${String(e.reason)}`),
    );
  });

  $effect(() => {
    if (booted) audio.setVolumes(settings.audio);
  });

  // Interface scale: the page zoom follows the window (automatic) or the player's setting;
  // a game takes it in full, the menus only grow with it (stores/viewport.svelte.ts).
  $effect(() => {
    void settings.graphics.uiScale;
    if (booted) applyUiScale();
  });
  $effect(() => {
    if (booted) setInGame(app.screen === 'game');
  });

  /**
   * Automation hooks (tests, screenshots, media): ?autostart=<map>&nations=&tribes=&spectate&notech&screen=<name>,
   * ?mission=<id>, ?load=<save slot>
   */
  function autostart(): void {
    const q = new URLSearchParams(location.search);
    const screen = q.get('screen');
    if (screen) {
      app.screen = screen as typeof app.screen;
      return;
    }
    const load = q.get('load');
    if (load) {
      void startFromSave(Number(load));
      return;
    }
    const mission = q.get('mission');
    if (mission) {
      startMission(mission);
      return;
    }
    const map = q.get('autostart');
    if (!map) return;
    const cfg = defaultConfig(Number(q.get('seed') ?? 4242));
    cfg.mapId = map;
    cfg.nations = Number(q.get('nations') ?? 30);
    cfg.tribes = Number(q.get('tribes') ?? 40);
    cfg.spawnSeconds = Number(q.get('spawn') ?? 15);
    if (q.get('mode')) cfg.mode = q.get('mode') as typeof cfg.mode;
    if (q.has('fog')) cfg.features.fog = true;
    if (q.has('notech')) cfg.features.tech = false;
    if (q.get('gold')) cfg.goldMultiplier = Number(q.get('gold'));
    if (q.get('startGold')) cfg.startGold = Number(q.get('startGold'));
    if (q.get('threshold')) cfg.victoryThreshold = Number(q.get('threshold'));
    if (q.get('difficulty')) cfg.difficulty = q.get('difficulty') as typeof cfg.difficulty;
    const spectate = q.has('spectate');
    cfg.players = spectate ? [] : [{ slot: 0, name: q.get('name') ?? 'Ilse', kind: 'human', team: 1 }];
    app.launch = { kind: 'solo', config: withMyFlag(cfg), viewer: spectate ? -1 : 1 };
    app.screen = 'game';
  }
</script>

{#if booted}
  <!-- Persistent backdrop: screens fade in over paper (menus) or ink (game), never over a flash. -->
  <div class="stage" class:chart={app.screen !== 'game'}></div>
  {#key app.screen}
    <div class="screen" class:chart={app.screen !== 'game'} class:newsprint={app.screen !== 'game'}>
      {#if app.screen === 'splash'}<Splash />
      {:else if app.screen === 'title' || app.screen === 'play'}<Title />
      {:else if app.screen === 'lobby'}<Lobby />
      {:else if app.screen === 'lan'}<LanBrowser />
      {:else if app.screen === 'game'}<GameScreen />
      {:else if app.screen === 'editor'}<Editor />
      {:else if app.screen === 'replays'}<Replays />
      {:else if app.screen === 'profile'}<Profile />
      {:else if app.screen === 'settings'}<Settings />
      {:else if app.screen === 'about'}<About />
      {:else if app.screen === 'campaign'}<Campaign />
      {:else if app.screen === 'load'}<LoadGame />
      {/if}
      {#if sweep}<ScreenSweep seed={sweepSeed(app.screen)} />{/if}
    </div>
  {/key}
  <Modal />
{/if}

<style>
  .stage {
    position: fixed;
    inset: 0;
    background: var(--abyss);
  }
  .screen {
    position: fixed;
    inset: 0;
    animation: screen-in 0.3s ease-out both;
  }
  .screen.chart {
    animation: screen-rise 0.34s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes screen-in {
    from {
      opacity: 0;
    }
  }
  @keyframes screen-rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
