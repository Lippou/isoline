<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { GameController } from '../game/controller';
  import { settings } from '../stores/settings.svelte';
  import { inkRgb } from '../../render/colors';
  import { UNIT_STRIDE } from '../../engine/protocol';
  import { U } from '../../core/units/unit';
  import { t } from '../i18n/i18n.svelte';
  import { minimapPalette } from '../../render/worldPalette';
  import { hudSize } from '../stores/hudBox.svelte';
  import { layout, zonePiece } from '../stores/layout.svelte';
  import { liveRing } from '../../core/rules/victory';
  import { setFold } from '../stores/folds.svelte';
  import FoldButton from './FoldButton.svelte';

  let { ctl }: { ctl: GameController } = $props();
  let canvas: HTMLCanvasElement;
  let raf = 0;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const st = ctl.session.state;
  const W = 260;
  const H = Math.max(80, Math.round((st.height / st.width) * W));
  let base: ImageData | null = null;
  let img: ImageData | null = null;
  // The foot of the right column (zones.ts): folded to a slim tab when the player folds it
  // (remembered, folds.svelte.ts) or when the column is short of room; the tab unfolds it
  // (the other pieces giving way). Folded, it still shows the missiles in flight.
  const level = $derived(layout.levelOf('minimap'));
  const collapsed = $derived(level === 'chip');
  function fold(): void {
    setFold('minimap', true);
    layout.pin('minimap', false);
  }
  function unfold(): void {
    setFold('minimap', false);
    layout.pin('minimap');
  }
  /** Missiles in flight (the folded tab's alarm). */
  let missiles = $state(0);

  const EARTH_COLORS: [number, number, number][] = [
    [10, 20, 36],
    [16, 34, 52],
    [22, 46, 66],
    [40, 90, 110],
    [48, 66, 52],
    [70, 68, 50],
    [96, 90, 84],
    [100, 88, 62],
    [32, 54, 42],
    [140, 150, 156],
    [40, 36, 44],
  ];
  const TERRAIN_COLORS = minimapPalette(st.meta?.palette) ?? EARTH_COLORS;

  function buildBase(ctx: CanvasRenderingContext2D): void {
    base = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = Math.floor(((x + 0.5) / W) * st.width);
        const sy = Math.floor(((y + 0.5) / H) * st.height);
        const i = sy * st.width + sx;
        const c = TERRAIN_COLORS[st.terrain[i]!] ?? [0, 0, 0];
        const k = (y * W + x) * 4;
        base.data[k] = c[0];
        base.data[k + 1] = c[1];
        base.data[k + 2] = c[2];
        base.data[k + 3] = 255;
      }
    }
    img = ctx.createImageData(W, H);
  }

  function refresh(): void {
    let n = 0;
    for (let k = 0; k < st.unitCount; k++) if (st.units[k * UNIT_STRIDE + 1] === U.Nuke) n++;
    if (n !== missiles) missiles = n;
    if (!base || !img || collapsed) return;
    const colors = new Map<number, [number, number, number]>();
    for (const p of st.playerList) colors.set(p.id, inkRgb(p.color, settings.access.vision));
    const now = performance.now();
    const fog = st.fog && ctl.renderer.overlay.fogView ? st.fog : null;
    // Under the fog only the viewer's (and allies') land keeps its ink.
    const me = st.players.get(st.viewer);
    const friends = new Set<number>([st.viewer, ...(me?.allies ?? [])]);
    if (me && me.team > 0) for (const p of st.playerList) if (p.team === me.team) friends.add(p.id);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = Math.floor(((x + 0.5) / W) * st.width);
        const sy = Math.floor(((y + 0.5) / H) * st.height);
        const i = sy * st.width + sx;
        const k = (y * W + x) * 4;
        let r = base.data[k]!;
        let g = base.data[k + 1]!;
        let b = base.data[k + 2]!;
        let v = 255;
        if (fog) {
          const fx = Math.min(fog.w - 1, Math.floor((sx / st.width) * fog.w));
          const fy = Math.min(fog.h - 1, Math.floor((sy / st.height) * fog.h));
          v = fog.data[fy * fog.w + fx]!;
        }
        const o = st.owner[i]!;
        if (o > 0 && (v === 255 || friends.has(o))) {
          const c = colors.get(o);
          if (c) {
            r = r * 0.35 + c[0] * 0.65;
            g = g * 0.35 + c[1] * 0.65;
            b = b * 0.35 + c[2] * 0.65;
          }
          if (now - st.changeTime[i]! < 1500) {
            r = Math.min(255, r + 90);
            g = Math.min(255, g + 70);
            b = Math.min(255, b + 40);
          }
        }
        if (st.fallout[i]! > 0) {
          r = r * 0.5 + 180 * 0.5;
          g = g * 0.5 + 220 * 0.5;
          b = b * 0.5 + 60 * 0.5;
        }
        // Battle royale: land the zone has left (dark, with a hint of red).
        if (st.flags[i]! & 1) {
          r = 34 + ((x + y) & 2 ? 14 : 0);
          g = 14;
          b = 20;
        }
        if (fog) {
          const m = v === 255 ? 1 : v > 0 ? 0.5 : 0.32;
          r *= m;
          g *= m;
          b *= m;
        }
        img.data[k] = r;
        img.data[k + 1] = g;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
  }

  function draw(): void {
    raf = requestAnimationFrame(draw);
    if (collapsed) return;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !img) return;
    ctx.putImageData(img, 0, 0);
    // Missiles and warships.
    const sx = W / st.width;
    const sy = H / st.height;
    for (let k = 0; k < st.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      const type = st.units[o + 1];
      if (type === U.Nuke) {
        ctx.fillStyle = '#e0456f';
        ctx.beginPath();
        ctx.arc(st.units[o + 3]! * sx, st.units[o + 4]! * sy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(224,69,111,0.7)';
        ctx.beginPath();
        ctx.arc(st.units[o + 10]! * sx, st.units[o + 11]! * sy, 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (type === U.Warship && st.units[o + 2] === ctl.session.viewer) {
        ctx.fillStyle = '#eae6da';
        ctx.fillRect(st.units[o + 3]! * sx - 1, st.units[o + 4]! * sy - 1, 2, 2);
      }
    }
    // Battle royale: the zone in force (red) and the next one (paper-white dashes ruled in ink).
    const ring = st.world?.ring;
    if (ring) {
      const [lx, ly, lr] = liveRing(ring, st.tick);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(214,52,84,0.95)';
      ctx.beginPath();
      ctx.ellipse(lx * sx, ly * sy, lr * sx, lr * sy, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (ring.endAt < 0) {
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(23,42,60,0.7)';
        ctx.beginPath();
        ctx.ellipse(ring.nx * sx, ring.ny * sy, ring.nr * sx, ring.nr * sy, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = '#f8f4ec';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // The view: a paper-white frame, ruled in ink so it reads on sea and land alike.
    const [x0, y0, x1, y1] = ctl.renderer.camera.bounds();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(23,42,60,0.85)';
    ctx.strokeRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#f8f4ec';
    ctx.strokeRect(x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy);
  }

  function goto(e: PointerEvent): void {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * st.width;
    const y = ((e.clientY - r.top) / r.height) * st.height;
    const cam = ctl.renderer.camera;
    cam.cx = x;
    cam.cy = y;
    cam.vx = cam.vy = 0;
  }
  let dragging = false;

  // Unfolded again: the picture is brought up to date at once.
  $effect(() => {
    if (!collapsed) untrack(refresh);
  });

  onMount(() => {
    const ctx = canvas.getContext('2d')!;
    buildBase(ctx);
    refresh();
    refreshTimer = setInterval(refresh, 500);
    draw();
  });
  onDestroy(() => {
    cancelAnimationFrame(raf);
    if (refreshTimer) clearInterval(refreshTimer);
  });
</script>

<aside
  class="mini"
  class:panel={!collapsed}
  class:collapsed
  data-testid="minimap"
  data-folded={collapsed || undefined}
  use:hudSize={'mini'}
  use:zonePiece={{ id: 'minimap', level }}
>
  {#if collapsed}
    <button
      class="ftab fold-in"
      onclick={unfold}
      aria-expanded="false"
      aria-label={t('fold.unfold', { name: t('fold.minimap') })}
      title={t('fold.unfold', { name: t('fold.minimap') })}
      data-testid="minimap-tab"
    >
      <FoldButton glyph folded name={t('fold.minimap')} dir="down" />
      <Icon name="globe" size={17} />
      <span class="lbl">{t('fold.map')}</span>
      {#if missiles > 0}<span class="alarm mono" title={t('fold.missiles', { n: missiles })}
          ><Icon name="nuke" size={12} />{missiles}</span
        >{/if}
    </button>
  {:else}
    <span class="fbtn"
      ><FoldButton
        folded={false}
        name={t('fold.minimap')}
        dir="down"
        tip="left"
        onclick={fold}
        testid="fold-minimap"
      /></span
    >
  {/if}
  <canvas
    bind:this={canvas}
    width={W}
    height={H}
    style:aspect-ratio="{W} / {H}"
    style:width="min(var(--mini-w, 270px), {((34 * W) / H).toFixed(2)}vh)"
    onpointerdown={(e) => {
      dragging = true;
      goto(e);
    }}
    onpointermove={(e) => dragging && goto(e)}
    onpointerup={() => (dragging = false)}
    onpointerleave={() => (dragging = false)}
  ></canvas>
</aside>

<style>
  /* Bottom right: the map in a paper mount. */
  .mini {
    position: absolute;
    right: 12px;
    bottom: 12px;
    padding: 4px;
    z-index: 6;
  }
  .mini.collapsed canvas {
    display: none;
  }
  .fbtn {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
  }
  /* As wide as the layout allows (--mini-w, GameScreen.svelte), never taller than a third of the window. */
  canvas {
    display: block;
    height: auto;
    border: 1px solid var(--np-ink);
    border-radius: 1px;
    cursor: crosshair;
    image-rendering: pixelated;
  }
  .mini.collapsed {
    padding: 0;
  }
</style>
