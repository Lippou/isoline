<script lang="ts">
  // A wave of troops is sent at us: the screen edge facing the attack — or the two edges of
  // a corner — flashes in the chart's magenta (the danger colour) three times, then fades
  // (about 1.8 s; once per wave, not for the whole attack). The glow peaks where the attack
  // lies beyond the edge; a front already in view only lights its nearest edge softly (the
  // map marks the front itself). A riposte of a country we attack shows no edge at all
  // (game/invasion.ts). Reduced motion: one slow pulse, no blinking. In reading mode (a big
  // window open) it flashes over the window.
  import { hud } from '../stores/game.svelte';
  import { layout } from '../stores/layout.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { EdgeGlow } from '../game/invasion';

  const still = $derived(
    settings.access.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const SIDES: (keyof EdgeGlow)[] = ['top', 'right', 'bottom', 'left'];
  /** Where the glow peaks along an edge (fraction of its length). */
  const along = (side: keyof EdgeGlow, ex: number, ey: number) =>
    side === 'top' || side === 'bottom' ? ex : ey;
</script>

{#key hud.invasion?.n}
  {#if hud.invasion}
    {@const inv = hud.invasion}
    <div
      class="flash"
      class:over={layout.reading}
      class:still
      style:--k={inv.strength}
      aria-hidden="true"
      data-testid="invasion-flash"
      data-wave={inv.n}
    >
      {#each SIDES as side (side)}
        {#if inv.edges[side] > 0}
          <i
            class="edge {side}"
            style:--a={inv.edges[side]}
            style:--at="{along(side, inv.ex, inv.ey) * 100}%"
            data-edge={side}
          ></i>
        {/if}
      {/each}
    </div>
  {/if}
{/key}

<style>
  .flash {
    position: absolute;
    inset: 0;
    z-index: 27;
    pointer-events: none;
    opacity: 0;
    animation: blink 1.8s ease-out forwards;
  }
  .flash.over {
    z-index: 31;
  }
  .flash.still {
    animation: pulse 1.6s ease-in-out forwards;
  }
  /* One strip per lit edge: a rule on the edge itself, a wash fading inwards, brightest
     where the attack lies. */
  .edge {
    --c: 214 40 98;
    --depth: 96px;
    position: absolute;
    opacity: var(--a);
  }
  .edge.top,
  .edge.bottom {
    left: 0;
    right: 0;
    height: var(--depth);
  }
  .edge.left,
  .edge.right {
    top: 0;
    bottom: 0;
    width: var(--depth);
  }
  .edge.top {
    top: 0;
    border-top: 4px solid rgb(232 72 122 / calc(0.9 * var(--k)));
    background:
      radial-gradient(60% 100% at var(--at) 0, rgb(var(--c) / calc(0.55 * var(--k))), transparent 75%),
      linear-gradient(to bottom, rgb(var(--c) / calc(0.4 * var(--k))), transparent);
  }
  .edge.bottom {
    bottom: 0;
    border-bottom: 4px solid rgb(232 72 122 / calc(0.9 * var(--k)));
    background:
      radial-gradient(60% 100% at var(--at) 100%, rgb(var(--c) / calc(0.55 * var(--k))), transparent 75%),
      linear-gradient(to top, rgb(var(--c) / calc(0.4 * var(--k))), transparent);
  }
  .edge.left {
    left: 0;
    border-left: 4px solid rgb(232 72 122 / calc(0.9 * var(--k)));
    background:
      radial-gradient(100% 60% at 0 var(--at), rgb(var(--c) / calc(0.55 * var(--k))), transparent 75%),
      linear-gradient(to right, rgb(var(--c) / calc(0.4 * var(--k))), transparent);
  }
  .edge.right {
    right: 0;
    border-right: 4px solid rgb(232 72 122 / calc(0.9 * var(--k)));
    background:
      radial-gradient(100% 60% at 100% var(--at), rgb(var(--c) / calc(0.55 * var(--k))), transparent 75%),
      linear-gradient(to left, rgb(var(--c) / calc(0.4 * var(--k))), transparent);
  }
  @keyframes blink {
    0% {
      opacity: 0;
    }
    8% {
      opacity: 1;
    }
    24% {
      opacity: 0.2;
    }
    36% {
      opacity: 1;
    }
    52% {
      opacity: 0.2;
    }
    64% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0;
    }
    35% {
      opacity: 0.8;
    }
  }
</style>
