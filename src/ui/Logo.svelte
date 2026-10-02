<script lang="ts">
  // Animated Isoline mark: contour lines draw themselves, then the brass summit lights up.
  let {
    size = 120,
    animated = false,
    wordmark = true,
    tone = 'dark',
    row = false,
  }: {
    size?: number;
    animated?: boolean;
    wordmark?: boolean;
    /** 'light' = the symbol-light.svg tints, for chart paper. */
    tone?: 'dark' | 'light';
    /** Symbol beside the logotype instead of above it. */
    row?: boolean;
  } = $props();

  function contour(cx: number, cy: number, r: number, harm: [number, number, number][]): string {
    const n = 72;
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      let k = 1;
      for (const [a, f, p] of harm) k += a * Math.sin(f * t + p);
      pts.push([cx + Math.cos(t) * r * k, cy + Math.sin(t) * r * k]);
    }
    const p = (i: number) => pts[(i + n) % n]!;
    let d = `M${p(0)[0].toFixed(1)},${p(0)[1].toFixed(1)}`;
    for (let i = 0; i < n; i++) {
      const p0 = p(i - 1),
        p1 = p(i),
        p2 = p(i + 1),
        p3 = p(i + 2);
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d + 'Z';
  }
  const HARM: [number, number, number][] = [
    [0.07, 2, 0.6],
    [0.045, 3, 2.1],
    [0.02, 5, 4.0],
  ];
  const rings = [320, 225, 132].map((r, i) => {
    const shift = i * 26;
    return contour(
      512 - shift * 0.6,
      540 - shift,
      r,
      HARM.map(([a, f, p]) => [a * (1 - i * 0.18), f, p + i * 0.35] as [number, number, number]),
    );
  });
  const colors = $derived(
    tone === 'light' ? ['#7FB8AC', '#2E8C79', '#0E6B5A'] : ['#2A8F7C', '#3BC2A5', '#4FE3C1'],
  );
  const summit = $derived(tone === 'light' ? '#C98A16' : '#F2B84B');
</script>

<div class="logo" class:animated class:row style="--s:{size}px">
  <svg viewBox="150 150 724 724" width={size} height={size} aria-label="Isoline">
    {#each rings as d, i (i)}
      <path
        {d}
        fill="none"
        stroke={colors[i]}
        stroke-width="44"
        stroke-linejoin="round"
        pathLength="1"
        style="animation-delay:{i * 0.22}s"
      />
    {/each}
    <path class="summit" d="M471,428 L508,474 L471,520 L434,474 Z" fill={summit} />
  </svg>
  {#if wordmark}<div class="word">ISOLINE</div>{/if}
</div>

<style>
  .logo {
    display: grid;
    justify-items: center;
    gap: calc(var(--s) * 0.08);
  }
  .row {
    grid-auto-flow: column;
    align-items: center;
    gap: calc(var(--s) * 0.16);
  }
  .row .word {
    font-size: calc(var(--s) * 0.42);
    letter-spacing: 0.2em;
    padding-left: 0;
    line-height: 1;
  }
  .word {
    font-family: var(--title);
    font-weight: 600;
    letter-spacing: 0.32em;
    font-size: calc(var(--s) * 0.22);
    padding-left: 0.32em;
    color: var(--parchment);
  }
  .animated path:not(.summit) {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw 0.9s cubic-bezier(0.6, 0, 0.2, 1) forwards;
  }
  .animated .summit {
    opacity: 0;
    transform-origin: 471px 474px;
    animation: pop 0.45s 0.95s cubic-bezier(0.3, 1.6, 0.5, 1) forwards;
  }
  .animated .word {
    opacity: 0;
    animation: fade 0.5s 1.05s ease-out forwards;
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.2);
    }
    to {
      opacity: 1;
      transform: scale(1);
      filter: drop-shadow(0 0 30px rgba(242, 184, 75, 0.8));
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
      letter-spacing: 0.6em;
    }
    to {
      opacity: 1;
    }
  }
</style>
