<script lang="ts">
  // A wave of troops is sent at us: the screen's edges flash in the chart's magenta (the
  // danger colour) three times, then fade (about 1.8 s; once per wave, not for the whole
  // attack). The glow is brightest on the edge facing the attack. Reduced motion: one slow
  // pulse, no blinking. In reading mode (a big window open) it flashes over the window.
  import { hud } from '../stores/game.svelte';
  import { layout } from '../stores/layout.svelte';
  import { settings } from '../stores/settings.svelte';

  const still = $derived(
    settings.access.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
</script>

{#key hud.invasion?.n}
  {#if hud.invasion}
    <div
      class="flash"
      class:over={layout.reading}
      class:still
      style:--ex="{hud.invasion.ex * 100}%"
      style:--ey="{hud.invasion.ey * 100}%"
      style:--k={hud.invasion.strength}
      aria-hidden="true"
      data-testid="invasion-flash"
    ></div>
  {/if}
{/key}

<style>
  .flash {
    position: absolute;
    inset: 0;
    z-index: 27;
    pointer-events: none;
    opacity: 0;
    box-shadow:
      inset 0 0 110px 26px rgb(214 40 98 / calc(0.7 * var(--k))),
      inset 0 0 0 4px rgb(232 72 122 / calc(0.85 * var(--k)));
    background: radial-gradient(
      circle at var(--ex) var(--ey),
      rgb(214 40 98 / calc(0.5 * var(--k))) 0,
      rgb(214 40 98 / calc(0.14 * var(--k))) 22%,
      transparent 42%
    );
    animation: blink 1.8s ease-out forwards;
  }
  .flash.over {
    z-index: 31;
  }
  .flash.still {
    animation: pulse 1.6s ease-in-out forwards;
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
