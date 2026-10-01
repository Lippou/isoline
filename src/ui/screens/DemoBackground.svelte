<script lang="ts">
  // Living title-screen backdrop: an AI-only match rendered with the game renderer.
  import { onMount, onDestroy } from 'svelte';
  import { Session } from '../../engine/session';
  import { GameRenderer } from '../../render/renderer';
  import { defaultConfig } from '../../core/game/config';
  import { mapsBase } from '../bridge';
  import { settings } from '../stores/settings.svelte';
  import { i18n } from '../i18n/i18n.svelte';
  import { LocalServer } from '../../engine/turns';

  let host: HTMLDivElement;
  let session: Session | null = null;
  let renderer: GameRenderer | null = null;
  let disposed = false;
  let ready = $state(false);

  onMount(async () => {
    const maps = ['pangaea', 'mediterranean', 'europe', 'archipelago'];
    const cfg = {
      ...defaultConfig((Math.random() * 1e9) >>> 0),
      mapId: maps[Math.floor(Math.random() * maps.length)]!,
      players: [],
      nations: 22,
      tribes: 30,
      spawnSeconds: 0,
      difficulty: 'hard' as const,
    };
    cfg.features = { ...cfg.features, events: false, council: false };
    const src = new LocalServer(0, 0);
    src.setSpeed(2.5);
    session = new Session({ kind: 'demo', config: cfg, viewer: -1, source: src });
    try {
      await session.start(mapsBase());
    } catch (e) {
      console.warn('[demo] failed', e);
      return;
    }
    if (disposed) {
      session.stop();
      return;
    }
    renderer = new GameRenderer(session.state, {
      quality: settings.graphics.quality === 'performance' ? 'performance' : 'balanced',
      particles: settings.graphics.particles * 0.6,
      vision: settings.access.vision,
      highContrast: false,
      reducedMotion: settings.access.reducedMotion,
      showFps: false,
      maxFps: 60,
      lang: i18n.lang,
      uiScale: 1,
    });
    await renderer.init(host);
    if (disposed) return;
    const cam = renderer.camera;
    cam.fit();
    let t = 0;
    renderer.onFrame = (dt) => {
      t += dt;
      // Slow cinematic drift + breathing zoom.
      cam.cx = session!.state.width * (0.5 + 0.18 * Math.sin(t * 0.03));
      cam.cy = session!.state.height * (0.5 + 0.12 * Math.cos(t * 0.025));
      cam.zoom = cam.minZoom * (2.3 + 0.4 * Math.sin(t * 0.05));
    };
    ready = true;
  });

  onDestroy(() => {
    disposed = true;
    renderer?.destroy();
    session?.stop();
  });
</script>

<div class="demo" class:ready bind:this={host} aria-hidden="true"></div>

<style>
  .demo {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 1.6s ease;
    filter: saturate(0.9) brightness(0.62);
  }
  .demo.ready {
    opacity: 1;
  }
</style>
