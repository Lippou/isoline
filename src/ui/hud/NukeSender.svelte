<script lang="ts">
  // Who is firing at us: for every nuke heading for our land, a medallion pinned to the
  // screen's edge on the side of the silo that fired it (or over the silo when it is in
  // view), with the sender's flag and name, the weapon and the time to impact, and a red
  // glow pulsing on that edge. It follows the camera; a click shows the silo. Several
  // bombs from one country share its medallion (×N, the first impact).
  import { onMount } from 'svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { flagUrl } from '../../render/flags';
  import { audio } from '../../audio/audio';
  import Icon from '../icons/Icon.svelte';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  const NAMES = ['nukeA', 'nukeH', 'nukeMirv', 'nukeMirv'];
  /** Room kept for the HUD around the screen (top bar, dock, build bar). */
  const INSET = { top: 78, right: 20, bottom: 130, left: 100 };
  /** Half the medallion's size: it stays whole on the screen. */
  const HALF = { w: 125, h: 34 };

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
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!senders.length) {
        if (Object.keys(spots).length) spots = {};
        return;
      }
      const cam = ctl.renderer.camera;
      const W = cam.viewW;
      const H = cam.viewH;
      const x0 = INSET.left + HALF.w;
      const x1 = W - INSET.right - HALF.w;
      const y0 = INSET.top + HALF.h;
      const y1 = H - INSET.bottom - HALF.h;
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
    ctl.renderer.camera.goTo(s.sx + 0.5, s.sy + 0.5, Math.max(ctl.renderer.camera.zoom, 2.5));
  }
</script>

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
    <span
      class="arrow"
      style:left="{at.ax}px"
      style:top="{at.ay}px"
      style:transform="translate(-50%, -50%) rotate({at.angle}rad)"
      aria-hidden="true"><Icon name="chevronRight" size={20} stroke={3} /></span
    >
    <button
      class="sender"
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
{/each}

<style>
  /* Red light on the edge facing the silo. */
  .glow {
    position: absolute;
    z-index: 27;
    width: 640px;
    height: 640px;
    margin: -320px 0 0 -320px;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(circle, rgb(232 52 44 / 0.7) 0, rgb(232 52 44 / 0.32) 28%, transparent 64%);
    animation: glow 0.9s ease-in-out infinite alternate;
  }
  .sender {
    position: absolute;
    z-index: 28;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px 7px 9px;
    border-radius: 8px;
    border: 1px solid var(--signal);
    background: linear-gradient(180deg, rgba(58, 12, 16, 0.96), rgba(34, 8, 11, 0.96));
    color: var(--parchment);
    box-shadow:
      0 10px 26px rgba(0, 0, 0, 0.55),
      0 0 18px rgba(255, 90, 95, 0.35);
    cursor: var(--cursor-pointer, pointer);
    text-align: left;
    white-space: nowrap;
    animation: beat 0.9s ease-in-out infinite alternate;
  }
  .still,
  .sender.still {
    animation: none;
  }
  /* Points from the medallion towards the silo, just outside its rim. */
  .arrow {
    position: absolute;
    z-index: 28;
    display: grid;
    place-items: center;
    color: var(--signal);
    filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.8));
    pointer-events: none;
  }
  img {
    width: 34px;
    height: 23px;
    object-fit: cover;
    border: 1px solid #0008;
    border-radius: 2px;
  }
  .copy {
    display: grid;
    gap: 1px;
  }
  .kicker {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.72em;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--signal);
  }
  b {
    font-family: var(--title);
    font-size: 1.05em;
    font-weight: 600;
  }
  small {
    font-size: 0.8em;
    color: #f1c9c4;
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
        0 10px 26px rgba(0, 0, 0, 0.55),
        0 0 30px rgba(255, 90, 95, 0.7);
    }
  }
</style>
