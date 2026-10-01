<script lang="ts">
  // Small multi-series line chart (SVG) on a shared vertical scale.
  import { short } from '../i18n/i18n.svelte';
  let {
    series,
    height = 90,
  }: { series: { label: string; color: string; values: number[] }[]; height?: number } = $props();
  const W = 340;
  // One shared scale for every series (comparable curves).
  const sharedMax = $derived(Math.max(1, ...series.flatMap((x) => x.values)));
  function path(values: number[]): string {
    if (values.length < 2) return '';
    const max = sharedMax;
    return values
      .map(
        (v, k) =>
          `${k === 0 ? 'M' : 'L'}${((k / (values.length - 1)) * W).toFixed(1)},${(height - 6 - (v / max) * (height - 14)).toFixed(1)}`,
      )
      .join('');
  }
</script>

<figure class="chart">
  <svg viewBox="0 0 {W} {height}" preserveAspectRatio="none" role="img">
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1="0" x2={W} y1={height * g} y2={height * g} class="grid" />
    {/each}
    {#each series as s (s.label)}
      <path d={path(s.values)} stroke={s.color} />
    {/each}
  </svg>
  <figcaption>
    {#each series as s (s.label)}
      <span
        ><i style="background:{s.color}"></i>{s.label}
        <b class="mono">{short(s.values[s.values.length - 1] ?? 0)}</b>
        <small>max {short(Math.max(0, ...s.values))}</small></span
      >
    {/each}
  </figcaption>
</figure>

<style>
  .chart {
    margin: 0 0 0.6rem;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  path {
    fill: none;
    stroke-width: 1.8;
    vector-effect: non-scaling-stroke;
  }
  .grid {
    stroke: rgba(255, 255, 255, 0.06);
    vector-effect: non-scaling-stroke;
  }
  figcaption {
    display: flex;
    gap: 0.8rem;
    flex-wrap: wrap;
    font-size: 0.78em;
    color: var(--muted);
    margin-top: 0.25rem;
  }
  i {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    margin-right: 0.3em;
  }
  small {
    color: var(--faint);
  }
</style>
