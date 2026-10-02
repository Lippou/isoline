<script lang="ts">
  // Screen transition: a quick sweep of contour lines across the screen (~350 ms), drawn from
  // a summit off the lower-left corner. Purely decorative, never blocks input.
  import { onMount } from 'svelte';
  import { contourFamily } from './contours';
  import { settings } from '../stores/settings.svelte';

  let { seed = 1 }: { seed?: number } = $props();

  const reduced =
    settings.access.reducedMotion ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let done = $state(reduced);
  const w = typeof innerWidth === 'number' ? innerWidth : 1600;
  const h = typeof innerHeight === 'number' ? innerHeight : 900;
  const rings = $derived(
    contourFamily({
      cx: -w * 0.08,
      cy: h * 1.1,
      count: 7,
      r0: Math.hypot(w, h) * 0.28,
      step: Math.hypot(w, h) * 0.085,
      growth: 1.04,
      drift: [0.2, -0.12],
      seed,
      // Only the arc that crosses the screen (from the top edge to the right edge).
      start: -Math.PI / 2 - 0.25,
      span: 0.34,
    }),
  );

  onMount(() => {
    if (done) return;
    const id = setTimeout(() => (done = true), 520);
    return () => clearTimeout(id);
  });
</script>

{#if !done}
  <svg class="sweep" viewBox="0 0 {w} {h}" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
    <g fill="none" stroke="var(--aurora)" stroke-width="1.5" stroke-linecap="round">
      {#each rings as ring, k (k)}
        <path d={ring.d} pathLength="1" style="animation-delay:{k * 22}ms" />
      {/each}
    </g>
  </svg>
{/if}

<style>
  .sweep {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 900;
    animation: sweep-out 0.2s 0.3s ease-in forwards;
  }
  path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    opacity: 0.42;
    animation: sweep-trace 0.28s cubic-bezier(0.5, 0, 0.2, 1) forwards;
  }
  @keyframes sweep-trace {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes sweep-out {
    to {
      opacity: 0;
    }
  }
</style>
