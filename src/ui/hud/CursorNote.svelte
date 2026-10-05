<script lang="ts">
  // The cursor note (stores/note.svelte.ts): a refused order answered where it was given —
  // a slip of paper beside the pointer for two seconds, kept inside the map's stage (never
  // over the columns, the alliance offers among them). It does not follow the pointer and
  // takes no clicks: nothing jitters under the hand.
  import { notes } from '../stores/note.svelte';
  import { layout } from '../stores/layout.svelte';
  import Icon from '../icons/Icon.svelte';
  import { LEVEL_ICON } from './levels';

  const n = $derived(notes.current);
  let w = $state(0);
  let h = $state(0);
  const pos = $derived.by(() => {
    if (!n) return null;
    const s = layout.zones.stage;
    const room =
      s.w > 40 && s.h > 30 ? s : { x: 8, y: 8, w: window.innerWidth - 16, h: window.innerHeight - 16 };
    let x = n.x + 16;
    let y = n.y + 18;
    // Too near the stage's right or bottom edge: on the other side of the pointer.
    if (x + w > room.x + room.w) x = n.x - 12 - w;
    if (y + h > room.y + room.h) y = n.y - 12 - h;
    x = Math.max(room.x, Math.min(x, room.x + room.w - w));
    y = Math.max(room.y, Math.min(y, room.y + room.h - h));
    return { x: Math.round(x), y: Math.round(y) };
  });
</script>

{#if n && pos}
  {#key n.id}
    <div
      class="cnote newsprint {n.level}"
      class:ready={w > 0}
      role="status"
      aria-live="polite"
      data-testid="cursor-note"
      style:left="{pos.x}px"
      style:top="{pos.y}px"
      bind:offsetWidth={w}
      bind:offsetHeight={h}
    >
      {#if LEVEL_ICON[n.level]}<span class="sign"><Icon name={LEVEL_ICON[n.level]!} size={13} /></span
        >{/if}{n.text}
    </div>
  {/key}
{/if}

<style>
  .cnote {
    position: fixed;
    z-index: 80;
    max-width: 280px;
    padding: 4px 9px 5px;
    border: 1px solid var(--np-edge);
    border-left: 3px solid var(--np-ink);
    border-radius: 1px;
    box-shadow: 0 4px 14px rgba(3, 10, 16, 0.32);
    font-family: var(--text);
    font-size: 0.8em;
    line-height: 1.35;
    color: var(--np-ink);
    pointer-events: none;
    opacity: 0;
  }
  .cnote.ready {
    animation: note-in 0.12s ease-out both;
  }
  /* The level's sign before the text (never colour alone). */
  .sign {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 5px;
  }
  .cnote.warn {
    border-left-color: var(--np-warn);
  }
  .cnote.warn .sign {
    color: var(--np-warn);
  }
  .cnote.danger .sign {
    color: var(--np-spot);
  }
  .cnote.good .sign {
    color: var(--np-good);
  }
  .cnote.danger {
    border-left-color: var(--np-spot);
  }
  .cnote.good {
    border-left-color: var(--np-good);
  }
  @keyframes note-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  :global(.reduced-motion) .cnote.ready {
    animation: none;
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .cnote.ready {
      animation: none;
      opacity: 1;
    }
  }
</style>
