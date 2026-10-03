<script lang="ts">
  // A floating HUD window: dragged by its title bar (the paper ones: by their masthead),
  // resized by its corner, brought to the front on click. Double-clicking the title bar
  // puts it back in its default place. The content is the panel's own.
  import { onDestroy, type Snippet } from 'svelte';
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import {
    wm,
    mountWindow,
    unmountWindow,
    focusWindow,
    setRect,
    resetWindows,
    MIN_W,
    MIN_H,
    type WinId,
    type Rect,
  } from '../stores/windows.svelte';
  import Icon from '../icons/Icon.svelte';

  let {
    id,
    title = '',
    paper = false,
    children,
  }: { id: WinId; title?: string; paper?: boolean; children: Snippet } = $props();

  // svelte-ignore state_referenced_locally
  mountWindow(id);
  onDestroy(() => unmountWindow(id));

  const rect = $derived(wm.rects[id]);
  const z = $derived(wm.order.indexOf(id) + 1);
  const front = $derived(wm.order.at(-1) === id);

  let drag: null | { mode: 'move' | 'size'; px: number; py: number; r: Rect; moved: boolean } = null;
  let dragging = $state(false);

  /** The title bar: our header, or the masthead of a window printed on the paper. */
  function isHandle(el: HTMLElement): boolean {
    if (el.closest('button, input, select, textarea, a, label, [data-nodrag]')) return false;
    return !!el.closest(paper ? 'header' : '.win-head');
  }

  function begin(e: PointerEvent, mode: 'move' | 'size', host: HTMLElement): void {
    if (e.button !== 0 || !rect) return;
    drag = { mode, px: e.clientX, py: e.clientY, r: { ...rect }, moved: false };
    host.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function down(e: PointerEvent): void {
    if (isHandle(e.target as HTMLElement)) begin(e, 'move', e.currentTarget as HTMLElement);
  }
  function move(e: PointerEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    dragging = true;
    const r = drag.r;
    if (drag.mode === 'move') setRect(id, { ...r, x: r.x + dx, y: r.y + dy });
    else
      setRect(id, {
        ...r,
        w: Math.min(window.innerWidth - r.x, Math.max(MIN_W, r.w + dx)),
        h: Math.min(window.innerHeight - r.y, Math.max(MIN_H, r.h + dy)),
      });
  }
  function end(): void {
    if (drag?.moved && rect) setRect(id, rect, true);
    drag = null;
    dragging = false;
  }
  function dblclick(e: MouseEvent): void {
    if (isHandle(e.target as HTMLElement)) resetWindows(id);
  }
</script>

{#if rect}
  <div
    class="win rise-in"
    class:glass={!paper}
    class:paper
    class:front
    class:dragging
    style:left="{rect.x}px"
    style:top="{rect.y}px"
    style:width="{rect.w}px"
    style:height="{rect.h}px"
    style:z-index={z}
    role="dialog"
    aria-label={title || t(`panel.${id}`)}
    data-testid="panel-open"
    data-window={id}
    onpointerdowncapture={() => focusWindow(id)}
    onfocusin={() => focusWindow(id)}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={end}
    onpointercancel={end}
    ondblclick={dblclick}
  >
    {#if paper}
      {@render children()}
    {:else}
      <header class="win-head" title={t('hud.windowMoveTip')}>
        <h3>{title || t(`panel.${id}`)}</h3>
        <button class="x" onclick={() => (hud.panels[id] = false)} aria-label={t('common.close')}
          ><Icon name="close" size={16} /></button
        >
      </header>
      <div class="body scroll">{@render children()}</div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="grip"
      title={t('hud.windowResize')}
      onpointerdown={(e) => {
        e.stopPropagation();
        begin(e, 'size', e.currentTarget.parentElement as HTMLElement);
      }}
    ></div>
  </div>
{/if}

<style>
  .win {
    position: absolute;
    pointer-events: auto;
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    overflow: hidden;
  }
  .win.glass {
    border-color: var(--line);
  }
  /* The window in front: a shoal-blue rule over its title bar. */
  .win.glass.front {
    border-color: var(--line-strong);
    box-shadow:
      0 14px 34px rgba(3, 10, 16, 0.55),
      inset 0 2px 0 var(--aurora);
  }
  .win.dragging {
    user-select: none;
    opacity: 0.94;
  }
  /* The journal and its siblings are printed on newsprint: a sheet over the map, square-cut. */
  .win.paper {
    display: block;
    border-radius: 2px;
    border: 1px solid #d9d1c1;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.4) inset,
      0 14px 34px rgba(3, 10, 16, 0.55);
  }
  .win.paper :global(header) {
    cursor: grab;
  }
  .win.dragging,
  .win.dragging :global(header) {
    cursor: grabbing;
  }
  .win-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
    cursor: grab;
    touch-action: none;
  }
  h3 {
    margin: 0;
  }
  .x {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
  }
  .x:hover {
    color: var(--parchment);
    background: var(--panel-3);
  }
  .body {
    padding: 12px 14px;
    font-size: 0.9em;
    min-height: 0;
  }
  /* Resize corner: three engraved ticks. */
  .grip {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    touch-action: none;
    z-index: 2;
    background: linear-gradient(
      135deg,
      transparent 0 52%,
      var(--line-strong) 52% 58%,
      transparent 58% 68%,
      var(--line-strong) 68% 74%,
      transparent 74% 84%,
      var(--line-strong) 84% 90%,
      transparent 90%
    );
    opacity: 0.8;
  }
  .paper .grip {
    --line-strong: #a89e8a;
  }
  .grip:hover {
    opacity: 1;
  }
</style>
