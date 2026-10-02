<script lang="ts">
  // The signature of the brand (BRAND.md §4): contour lines that draw themselves.
  //  - mode "draw":   rings draw outward from the summit, one after the other, then settle;
  //  - mode "ripple": rings expand and fade continuously (loading, searching);
  //  - mode "static": rings already drawn (backgrounds, empty states, reduced motion).
  // Coordinates: cx / cy are fractions of the box; radii and spacing are in pixels.
  import { contourFamily } from './contours';
  import { settings } from '../stores/settings.svelte';

  let {
    mode = 'static',
    cx = 0.5,
    cy = 0.5,
    count = 6,
    r0 = 24,
    step = 18,
    growth = 1.06,
    drift = [0.25, 0.18],
    wobble = 1,
    seed = 7,
    color = 'currentColor',
    stroke = 1.25,
    opacity = 1,
    settle = -1,
    delay = 0,
    stagger = 0.09,
    duration = 1.1,
    indexEvery = 0,
    class: klass = '',
  }: {
    mode?: 'draw' | 'ripple' | 'static';
    cx?: number;
    cy?: number;
    count?: number;
    r0?: number;
    step?: number;
    growth?: number;
    drift?: [number, number];
    wobble?: number;
    seed?: number;
    color?: string;
    stroke?: number;
    opacity?: number;
    /** Opacity once every ring is drawn (draw mode); -1 keeps `opacity`. */
    settle?: number;
    delay?: number;
    stagger?: number;
    duration?: number;
    /** Every Nth ring is an index contour (thicker), as on topographic maps. 0 = none. */
    indexEvery?: number;
    class?: string;
  } = $props();

  let w = $state(0);
  let h = $state(0);

  const reduced =
    settings.access.reducedMotion ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const shown = $derived(reduced && mode !== 'static' ? 'static' : mode);

  const px = $derived(cx * w);
  const py = $derived(cy * h);
  const rings = $derived(
    w && h ? contourFamily({ cx: px, cy: py, count, r0, step, growth, drift, wobble, seed }) : [],
  );
  const total = $derived(delay + stagger * Math.max(0, count - 1) + duration);
  const restOpacity = $derived(settle >= 0 ? settle : opacity);
</script>

<div class="iso {klass}" bind:clientWidth={w} bind:clientHeight={h} aria-hidden="true">
  {#if rings.length}
    <svg
      viewBox="0 0 {w} {h}"
      width={w}
      height={h}
      class={shown}
      style="--o:{opacity};--rest:{restOpacity};--total:{total}s;--cx:{px}px;--cy:{py}px"
    >
      <g fill="none" stroke={color} stroke-linejoin="round" stroke-linecap="round">
        {#each rings as ring, k (k)}
          <path
            d={ring.d}
            pathLength="1"
            stroke-width={indexEvery && (k + 1) % indexEvery === 0 ? stroke * 2 : stroke}
            style="--d:{shown === 'ripple' ? k * stagger : delay + k * stagger}s;--dur:{duration}s"
          />
        {/each}
      </g>
    </svg>
  {/if}
</div>

<style>
  .iso {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .static g {
    opacity: var(--o);
  }

  /* draw: each ring traces itself, then the whole family settles to a quieter tone. */
  .draw g {
    opacity: var(--o);
    animation: settle 1.2s var(--total) ease-out forwards;
  }
  .draw path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: trace var(--dur) var(--d) cubic-bezier(0.6, 0, 0.2, 1) forwards;
  }
  @keyframes trace {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes settle {
    to {
      opacity: var(--rest);
    }
  }

  /* ripple: soundings that spread from the summit and fade (loading, searching). */
  .ripple g {
    opacity: var(--o);
  }
  .ripple path {
    transform-origin: var(--cx) var(--cy);
    opacity: 0;
    animation: ripple var(--dur) var(--d) cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
  }
  @keyframes ripple {
    0% {
      opacity: 0;
      transform: scale(0.55);
    }
    25% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: scale(1.25);
    }
  }
</style>
