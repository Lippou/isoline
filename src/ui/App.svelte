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
  import { defaultConfig } from '../core/game/config';

  let booted = $state(false);

  onMount(async () => {
    const info = await bridge.info().catch(() => null);
    if (info) {
      app.version = info.version;
      app.platform = info.platform;
    }
    await Promise.all([loadSettings(), loadProfile()]);
    audio.setVolumes(settings.audio);
    booted = true;
    autostart();
    const unlock = () => {
      audio.ensure();
      audio.setVolumes(settings.audio);
      audio.setScene(app.screen === 'game' ? 'game' : 'menu');
    };
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

  /** Automation hooks (tests, screenshots, media): ?autostart=<map>&nations=&tribes=&spectate&screen=<name> */
  function autostart(): void {
    const q = new URLSearchParams(location.search);
    const screen = q.get('screen');
    if (screen) {
      app.screen = screen as typeof app.screen;
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
    const spectate = q.has('spectate');
    cfg.players = spectate
      ? []
      : [{ slot: 0, name: q.get('name') ?? 'Ilse', kind: 'human', team: 1, general: 'blitz' }];
    app.launch = { kind: 'solo', config: cfg, viewer: spectate ? -1 : 1 };
    app.screen = 'game';
  }
</script>

{#if booted}
  {#key app.screen}
    <div class="screen">
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
    </div>
  {/key}
  <Modal />
{/if}

<style>
  .screen {
    position: fixed;
    inset: 0;
    animation: screenIn 0.35s ease-out both;
  }
  @keyframes screenIn {
    from {
      opacity: 0;
    }
  }
</style>
