<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { onMount, onDestroy } from 'svelte';
  import type { GameController } from '../game/controller';
  import { settings } from '../stores/settings.svelte';
  import { inkRgb } from '../../render/colors';
  import { UNIT_STRIDE } from '../../engine/protocol';
  import { U } from '../../core/units/unit';
  import { t } from '../i18n/i18n.svelte';

  let { ctl }: { ctl: GameController } = $props();
  let canvas: HTMLCanvasElement;
  let raf = 0;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const st = ctl.session.state;
  const W = 260;
  const H = Math.max(80, Math.round((st.height / st.width) * W));
  let base: ImageData | null = null;
  let img: ImageData | null = null;
  let collapsed = $state(false);

  const TERRAIN_COLORS: [number, number, number][] = [
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
    if (!base || !img) return;
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
        ctx.fillStyle = '#ff5a5f';
        ctx.beginPath();
        ctx.arc(st.units[o + 3]! * sx, st.units[o + 4]! * sy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,90,95,0.6)';
        ctx.beginPath();
        ctx.arc(st.units[o + 10]! * sx, st.units[o + 11]! * sy, 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (type === U.Warship && st.units[o + 2] === ctl.session.viewer) {
        ctx.fillStyle = '#eae6da';
        ctx.fillRect(st.units[o + 3]! * sx - 1, st.units[o + 4]! * sy - 1, 2, 2);
      }
    }
    const [x0, y0, x1, y1] = ctl.renderer.camera.bounds();
    ctx.strokeStyle = 'rgba(79,227,193,0.95)';
    ctx.lineWidth = 1.5;
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

<aside class="mini panel" class:collapsed data-testid="minimap">
  <button class="toggle" onclick={() => (collapsed = !collapsed)} title={t('hud.minimap')}
    ><Icon name={collapsed ? 'expand' : 'collapse'} size={13} /></button
  >
  <canvas
    bind:this={canvas}
    width={W}
    height={H}
    style="height:{H}px"
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
  canvas {
    display: block;
    width: calc(270px * var(--ui-scale));
    border-radius: 3px;
    cursor: crosshair;
    image-rendering: pixelated;
  }
  .toggle {
    position: absolute;
    top: -12px;
    left: -12px;
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border-radius: 3px;
    border: 1px solid var(--line-strong);
    background: var(--glass-strong);
    color: var(--muted);
    cursor: pointer;
  }
</style>
