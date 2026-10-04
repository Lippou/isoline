<script lang="ts">
  // Who is firing at us: for every nuke heading for our land, a medallion pinned to the
  // screen's edge on the side of the silo that fired it (or over the silo when it is in
  // view), with the sender's flag and name, the weapon and the time to impact, and a red
  // glow pulsing on that edge. It follows the camera; a click shows the silo. Several
  // bombs from one country share its medallion (×N, the first impact).
  // The medallion stays in the map's stage (zones.ts), beside the windows standing there.
  // In reading mode (a big window open) the medallion is a chip of the reading strip
  // (`docked`, pulsing as it does): a click there restores the map and shows the silo.
  import { onMount } from 'svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { flagUrl } from '../../render/flags';
  import { audio } from '../../audio/audio';
  import Icon from '../icons/Icon.svelte';
  import { layout } from '../stores/layout.svelte';
  import { wm, windowRect, restoreColumns, type WinId } from '../stores/windows.svelte';
  import type { Rect } from '../stores/zones';
  import type { GameController } from '../game/controller';

  let { ctl, docked = false }: { ctl: GameController; docked?: boolean } = $props();
  const NAMES = ['nukeA', 'nukeH', 'nukeMirv', 'nukeMirv'];
  /** Half the medallion's size: it stays whole in the stage. */
  const HALF = { w: 125, h: 34 };
  /** Between the medallion and a window it steps aside from. */
  const AIR = 8;

  /** The windows standing in the stage (the medallion steps aside from them). */
  function windowBoxes(): Rect[] {
    return (wm.order as WinId[]).map((id) => windowRect(id)).filter((r): r is Rect => !!r);
  }
  const hits = (x: number, y: number, boxes: readonly Rect[]) =>
    boxes.some(
      (r) => x + HALF.w > r.x && x - HALF.w < r.x + r.w && y + HALF.h > r.y && y - HALF.h < r.y + r.h,
    );
  /**
   * The nearest place to (x, y) inside [x0, x1] × [y0, y1] where the medallion covers no
   * window and no other medallion: beside, above or under what it would cover.
   */
  function stepAside(
    x: number,
    y: number,
    lim: { x0: number; x1: number; y0: number; y1: number },
    boxes: readonly Rect[],
  ): [number, number] {
    if (!hits(x, y, boxes)) return [x, y];
    const clampX = (v: number) => Math.min(lim.x1, Math.max(lim.x0, v));
    const clampY = (v: number) => Math.min(lim.y1, Math.max(lim.y0, v));
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const r of boxes) {
      for (const [cx, cy] of [
        [r.x - HALF.w - AIR, y],
        [r.x + r.w + HALF.w + AIR, y],
        [x, r.y - HALF.h - AIR],
        [x, r.y + r.h + HALF.h + AIR],
      ] as [number, number][]) {
        const px = clampX(cx);
        const py = clampY(cy);
        if (hits(px, py, boxes)) continue;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [px, py];
        }
      }
    }
    return best ?? [x, y];
  }

  const still = $derived(
    settings.access.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  const senders = $derived.by(() => {
    const by = new Map<
      number,
      { by: number; kind: number; impact: number; n: number; sx: number; sy: number }
    >();
    for (const a of hud.nukeAlerts) {
      const g = by.get(a.by);
      if (!g) by.set(a.by, { by: a.by, kind: a.kind, impact: a.impact, n: 1, sx: a.sx, sy: a.sy });
      else {
        g.n++;
        if (a.impact < g.impact) Object.assign(g, { kind: a.kind, impact: a.impact, sx: a.sx, sy: a.sy });
      }
    }
    return [...by.values()];
  });

  /**
   * Per frame: each medallion's centre, its arrow (towards the silo, just outside its rim)
   * and, when the silo is off-screen, the glow on the screen's edge facing it.
   */
  let spots = $state<
    Record<
      number,
      { x: number; y: number; ax: number; ay: number; angle: number; glow: [number, number] | null }
    >
  >({});
  onMount(() => {
    let raf = 0;
    if (docked) return;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!senders.length) {
        if (Object.keys(spots).length) spots = {};
        return;
      }
      const cam = ctl.renderer.camera;
      const W = cam.viewW;
      const H = cam.viewH;
      // The stage of the normal layout (zones.ts): clear of the columns and the strips.
      const st = layout.normal.stage;
      const lim = {
        x0: st.x + HALF.w,
        x1: Math.max(st.x + HALF.w, st.x + st.w - HALF.w),
        y0: st.y + HALF.h,
        y1: Math.max(st.y + HALF.h, st.y + st.h - HALF.h),
      };
      const { x0, x1, y0, y1 } = lim;
      const boxes = windowBoxes();
      const next: typeof spots = {};
      for (const s of senders) {
        const [px, py] = cam.worldToScreen(s.sx + 0.5, s.sy + 0.5);
        let x: number;
        let y: number;
        let glow: [number, number] | null = null;
        if (px >= 0 && px <= W && py >= 0 && py <= H) {
          // The silo is in view: the medallion stands a little above it.
          x = Math.min(x1, Math.max(x0, px));
          y = Math.min(y1, Math.max(y0, py - 70));
        } else {
          // Towards the silo from the screen's centre, out to the screen's edge (glow),
          // the medallion kept inside the room left by the HUD.
          const dx = px - W / 2;
          const dy = py - H / 2;
          const k = Math.min(Math.abs(W / 2 / (dx || 1e-6)), Math.abs(H / 2 / (dy || 1e-6)));
          glow = [W / 2 + dx * k, H / 2 + dy * k];
          x = Math.min(x1, Math.max(x0, glow[0]));
          y = Math.min(y1, Math.max(y0, glow[1]));
        }
        [x, y] = stepAside(x, y, lim, boxes);
        // The next medallion keeps clear of this one too.
        boxes.push({ x: x - HALF.w, y: y - HALF.h, w: 2 * HALF.w, h: 2 * HALF.h });
        const angle = Math.atan2(py - y, px - x);
        next[s.by] = {
          x,
          y,
          ax: x + Math.cos(angle) * (HALF.w + 10),
          ay: y + Math.sin(angle) * (HALF.h + 10),
          angle,
          glow,
        };
      }
      spots = next;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  function show(s: { sx: number; sy: number }): void {
    audio.ui('click');
    if (docked) restoreColumns();
    ctl.renderer.camera.goTo(s.sx + 0.5, s.sy + 0.5, Math.max(ctl.renderer.camera.zoom, 2.5));
  }
</script>

{#if docked}
  <!-- Reading mode: a chip of the reading strip each (who, what, when it lands). -->
  {#each senders as s (s.by)}
    {@const p = hud.players.find((x) => x.id === s.by)}
    <button
      class="chip newsprint"
      class:still
      onclick={() => show(s)}
      title={t('nuke.senderShow')}
      data-testid="nuke-sender"
    >
      <Icon name="nuke" size={13} />
      {#if p}<img src={flagUrl(p, 24)} alt="" />{/if}
      <b>{ctl.session.state.name(s.by, i18n.lang)}</b>
      <small
        >{t(`nuke.${NAMES[s.kind] ?? 'nukeA'}.name`)}{#if s.n > 1}&nbsp;×{s.n}{/if}</small
      >
      <span class="mono">{Math.max(0, (s.impact - hud.tick) / 10).toFixed(1)} s</span>
    </button>
  {/each}
{:else}
  {#each senders as s (s.by)}
    {@const at = spots[s.by]}
    {@const p = hud.players.find((x) => x.id === s.by)}
    {#if at}
      {#if at.glow}<div
          class="glow"
          class:still
          style:left="{at.glow[0]}px"
          style:top="{at.glow[1]}px"
          aria-hidden="true"
        ></div>{/if}
      {#if !layout.reading}
        <span
          class="arrow"
          style:left="{at.ax}px"
          style:top="{at.ay}px"
          style:transform="translate(-50%, -50%) rotate({at.angle}rad)"
          aria-hidden="true"><Icon name="chevronRight" size={20} stroke={3} /></span
        >
        <button
          class="sender newsprint"
          class:still
          style:left="{at.x}px"
          style:top="{at.y}px"
          onclick={() => show(s)}
          title={t('nuke.senderShow')}
          data-testid="nuke-sender"
        >
          {#if p}<img src={flagUrl(p, 48)} alt="" />{/if}
          <span class="copy">
            <span class="kicker"><Icon name="nuke" size={12} />{t('nuke.incoming')}</span>
            <b>{ctl.session.state.name(s.by, i18n.lang)}</b>
            <small
              >{t(`nuke.${NAMES[s.kind] ?? 'nukeA'}.name`)}{#if s.n > 1}&nbsp;×{s.n}{/if} ·
              <span class="mono">{Math.max(0, (s.impact - hud.tick) / 10).toFixed(1)} s</span></small
            >
          </span>
        </button>
      {/if}
    {/if}
  {/each}
{/if}

<style>
  /* Magenta light on the edge facing the silo (the chart's danger colour). */
  .glow {
    position: absolute;
    z-index: 27;
    width: 640px;
    height: 640px;
    margin: -320px 0 0 -320px;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(circle, rgb(214 40 98 / 0.62) 0, rgb(214 40 98 / 0.28) 28%, transparent 64%);
    animation: glow 0.9s ease-in-out infinite alternate;
  }
  /* A medallion of paper pinned towards the silo: who fired, what, and when it lands. */
  .sender {
    position: absolute;
    z-index: 28;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 12px 7px 8px;
    border: 1.5px solid var(--np-spot);
    border-radius: 2px;
    box-shadow:
      0 1px 2px rgba(3, 10, 16, 0.25),
      0 8px 22px rgba(3, 10, 16, 0.4);
    cursor: var(--cursor-pointer, pointer);
    text-align: left;
    white-space: nowrap;
    animation: beat 0.9s ease-in-out infinite alternate;
  }
  .sender:hover,
  .sender:focus-visible {
    background: var(--np-card);
  }
  .still,
  .chip.still,
  .sender.still {
    animation: none;
  }
  /* Reading mode: a chip of the reading strip. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 30px;
    padding: 0 10px 0 7px;
    border: 1px solid var(--np-spot);
    border-left-width: 3px;
    border-radius: 1px;
    font-size: 0.84em;
    color: var(--np-spot);
    white-space: nowrap;
    cursor: var(--cursor-pointer, pointer);
    animation: beat 0.9s ease-in-out infinite alternate;
  }
  .chip:hover,
  .chip:focus-visible {
    background: var(--np-card);
  }
  .chip img {
    width: 22px;
    height: 15px;
  }
  .chip b {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--title);
    font-weight: 600;
    color: var(--np-ink);
  }
  .chip small {
    color: var(--np-ink-2);
  }
  .chip .mono {
    font-weight: 600;
  }
  /* Points from the medallion towards the silo, just outside its rim. */
  .arrow {
    position: absolute;
    z-index: 28;
    display: grid;
    place-items: center;
    color: var(--np-spot);
    filter: drop-shadow(0 0 2px rgba(241, 236, 226, 0.95));
    pointer-events: none;
  }
  img {
    width: 32px;
    height: 22px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .copy {
    display: grid;
    gap: 0;
  }
  .kicker {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--text);
    font-size: 0.74em;
    font-weight: 600;
    color: var(--np-spot);
  }
  b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.08em;
    line-height: 1.15;
    color: var(--np-ink);
  }
  small {
    font-family: var(--text);
    font-size: 0.8em;
    color: var(--np-ink-2);
  }
  small .mono {
    font-weight: 600;
    color: var(--np-spot);
  }
  @keyframes glow {
    from {
      opacity: 0.55;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes beat {
    to {
      box-shadow:
        0 1px 2px rgba(3, 10, 16, 0.25),
        0 0 0 3px color-mix(in srgb, var(--np-spot) 35%, transparent),
        0 8px 22px rgba(3, 10, 16, 0.4);
    }
  }
</style>
