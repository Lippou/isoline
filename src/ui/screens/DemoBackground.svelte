<script lang="ts">
  // Living title-screen backdrop: an AI-only match rendered with the game renderer, shown in
  // daylight as a chart on paper (BRAND.md §4): a pale paper wash and paper margins over the
  // map, and a slow drift of the camera. The map shader itself is not touched here.
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
    let t = Math.random() * 200;
    const still = settings.access.reducedMotion;
    renderer.onFrame = (dt) => {
      if (!still) t += dt;
      // Slow drift across the chart with a gentle breathing zoom, always covering the screen
      // (the view never slides past the map's edges).
      const cover = Math.max(cam.viewW / cam.mapW, cam.viewH / cam.mapH);
      cam.zoom = cover * (1.35 + 0.15 * Math.sin(t * 0.03));
      const hw = cam.viewW / cam.zoom / 2;
      const hh = cam.viewH / cam.zoom / 2;
      cam.cx = hw + (cam.mapW - 2 * hw) * (0.5 + 0.46 * Math.sin(t * 0.018));
      cam.cy = hh + (cam.mapH - 2 * hh) * (0.5 + 0.46 * Math.cos(t * 0.014));
    };
    ready = true;
  });

  onDestroy(() => {
    disposed = true;
    renderer?.destroy();
    session?.stop();
  });
</script>

<div class="daylight" aria-hidden="true">
  <div class="demo" class:ready bind:this={host}></div>
  <div class="wash"></div>
  <div class="margins"></div>
</div>

<style>
  .daylight {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--abyss);
  }
  .demo {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 1.6s ease;
    filter: saturate(0.78) brightness(1.08) contrast(0.92);
  }
  .demo.ready {
    opacity: 1;
  }
  /* A pale paper wash: the live map reads as a chart printed in daylight. */
  .wash {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--abyss) 34%, transparent);
    mix-blend-mode: screen;
  }
  /* Paper margins: the chart fades into the paper behind the cartouche and the legend. */
  .margins {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(
        130% 95% at 52% 46%,
        transparent 38%,
        color-mix(in srgb, var(--abyss) 72%, transparent) 100%
      ),
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--abyss) 55%, transparent),
        transparent 34%,
        transparent 66%,
        color-mix(in srgb, var(--abyss) 50%, transparent)
      );
  }
</style>
