<script lang="ts">
  // The dispatches: the game's notifications, printed as slips of the Courier's paper in
  // the right column (GameScreen.svelte), above the alliance offers — never over the
  // middle of the map. The newest at the foot; each is dated with the game clock and its
  // rule says what it is (ink: news, green: good, brass: a warning, magenta: danger).
  // A slip that points at a place centres the map on it; one that does not is put away
  // by a click. They stay while the pointer is on them, then leave after a few seconds.
  // They are the column's least important piece (zones.ts): short of room they go on one
  // line each, then fold into a chip (the count; a click unfolds them).
  import { flip } from 'svelte/animate';
  import { fly, fade } from 'svelte/transition';
  import { hud, holdToasts, dropToast, type Toast } from '../stores/game.svelte';
  import { t, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { layout, zonePiece } from '../stores/layout.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { GameController } from '../game/controller';
  let { ctl }: { ctl: GameController } = $props();

  const still = () => settings.access.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enter = (node: Element) =>
    still() ? fade(node, { duration: 120 }) : fly(node, { x: 24, duration: 220 });
  const leave = (node: Element) => fade(node, { duration: still() ? 120 : 260 });

  /** The game clock when it arrived (none before the game starts). */
  function stamp(d: Toast): string {
    const start = hud.world?.startTick ?? 0;
    return hud.phase === 'playing' && d.tick >= start ? clock(d.tick - start) : '';
  }

  function open(d: Toast): void {
    if (d.tile === undefined) {
      dropToast(d.id);
      return;
    }
    const w = ctl.session.state.width;
    ctl.renderer.camera.goTo(
      (d.tile % w) + 0.5,
      ((d.tile / w) | 0) + 0.5,
      Math.max(ctl.renderer.camera.zoom, 3),
    );
  }
  $effect(() => () => holdToasts(false));

  const level = $derived(layout.levelOf('dispatches'));
  /** The chip clicked: the slips unfold for a while (they come and go; the column settles back). */
  const unfold = () => layout.pin('dispatches', true, 15000);
  /** The chip's colour: the gravest of the folded slips. */
  const gravest = $derived(
    hud.toasts.some((d) => d.level === 'danger')
      ? 'danger'
      : hud.toasts.some((d) => d.level === 'warn')
        ? 'warn'
        : 'info',
  );

  // Short of room, the oldest slips leave the clip at the top: they fade out there.
  let tray: HTMLDivElement | undefined = $state();
  let clipped = $state(false);
  // (Packed at the foot, what overflows goes above the top, out of the scroll range.)
  const measure = () => {
    const first = tray?.firstElementChild;
    clipped = !!tray && !!first && first.getBoundingClientRect().top < tray.getBoundingClientRect().top - 1;
  };
  $effect(() => {
    void hud.toasts.length;
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  });
  $effect(() => {
    if (!tray) return;
    const ro = new ResizeObserver(measure);
    ro.observe(tray);
    return () => ro.disconnect();
  });
</script>

<div
  class="dispatches"
  class:clipped
  class:compact={level === 'compact'}
  data-zone-chip={level === 'chip' || undefined}
  use:zonePiece={{ id: 'dispatches', on: hud.toasts.length > 0, level, n: hud.toasts.length }}
  bind:this={tray}
  aria-live="polite"
  aria-label={t('dispatch.title')}
  role="log"
  data-testid="dispatches"
  onpointerenter={() => holdToasts(true)}
  onpointerleave={() => holdToasts(false)}
>
  {#if level === 'chip' && hud.toasts.length}
    <button
      class="chip-n {gravest}"
      onclick={unfold}
      title={hud.toasts.at(-1)?.text}
      aria-label={t('zone.dispatchesShow', { n: hud.toasts.length })}
      data-testid="dispatch-chip"
      ><Icon name="news" size={13} />{hud.toasts.length === 1
        ? t('zone.dispatchesOne')
        : t('zone.dispatches', { n: hud.toasts.length })}</button
    >
  {/if}
  {#each level === 'chip' ? [] : hud.toasts as d (d.id)}
    {@const at = stamp(d)}
    <button
      class="slip {d.level}"
      class:link={d.tile !== undefined}
      onclick={() => open(d)}
      title={(level === 'compact' ? `${d.text} — ` : '') +
        (d.tile !== undefined ? t('dispatch.show') : t('dispatch.dismiss'))}
      data-testid="dispatch"
      animate:flip={{ duration: still() ? 0 : 200 }}
      in:enter
      out:leave
    >
      {#if at}<time>{at}</time>{/if}
      <span class="txt">{d.text}</span>
      {#if d.tile !== undefined}<span class="go" aria-hidden="true"><Icon name="target" size={13} /></span
        >{/if}
    </button>
  {/each}
</div>

<style>
  /* In the right column: the slips sit at its foot; when room runs short the oldest go first. */
  .dispatches {
    width: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 5px;
    overflow: hidden;
    /* Room for the slips' shadow inside the clip. */
    padding: 2px 4px 6px;
    margin: -2px -4px -6px;
  }
  .dispatches:not(:has(> *)) {
    display: none;
  }
  .dispatches.clipped {
    mask-image: linear-gradient(to bottom, transparent 0, #000 30px);
  }
  .slip {
    appearance: none;
    flex: none;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 10px 7px 9px;
    border: 1px solid var(--np-edge);
    border-left: 3px solid var(--np-ink);
    border-radius: 1px;
    background: var(--np-paper);
    box-shadow:
      0 1px 2px rgba(3, 10, 16, 0.2),
      0 4px 12px rgba(3, 10, 16, 0.22);
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.35;
    text-align: left;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
  }
  .slip:not(:has(time)) {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .slip:hover,
  .slip:focus-visible {
    background: var(--np-card);
  }
  .slip.good {
    border-left-color: var(--np-good);
  }
  .slip.warn {
    border-left-color: var(--np-gold);
  }
  .slip.danger {
    border-left-color: var(--np-spot);
  }
  .slip.danger .txt {
    font-weight: 600;
    color: var(--np-spot);
  }
  time {
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-3);
  }
  .txt {
    text-wrap: pretty;
  }
  .go {
    align-self: center;
    display: inline-flex;
    color: var(--np-ink-3);
  }
  /* Short of room: one line each (the whole text in the tooltip). */
  .compact .slip {
    padding: 4px 9px 4px 8px;
  }
  .compact .txt {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Folded: the count of dispatches, the gravest one's rule. */
  .dispatches[data-zone-chip] {
    width: auto;
    overflow: visible;
  }
  .chip-n {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px 4px 8px;
    border: 1px solid var(--np-edge);
    border-left: 3px solid var(--np-ink);
    border-radius: 1px;
    background: var(--np-paper);
    box-shadow: 0 1px 3px rgba(3, 10, 16, 0.25);
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 600;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
  }
  .chip-n:hover,
  .chip-n:focus-visible {
    background: var(--np-card);
  }
  .chip-n.warn {
    border-left-color: var(--np-gold);
  }
  .chip-n.danger {
    border-left-color: var(--np-spot);
    color: var(--np-spot);
  }
  .slip.link:hover .go,
  .slip.link:focus-visible .go {
    color: var(--np-ink);
  }
</style>
