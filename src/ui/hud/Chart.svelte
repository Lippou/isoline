<script lang="ts">
  // Small multi-series line chart (SVG) on a shared vertical scale, printed on the
  // paper: ink hairlines, a baseline, the scale's top and the time span in the margins.
  import { short } from '../i18n/i18n.svelte';
  let {
    series,
    height = 90,
    span = null,
  }: {
    series: { label: string; color: string; values: number[] }[];
    height?: number;
    /** Time at the first and the last point (printed under the baseline), or null. */
    span?: [string, string] | null;
  } = $props();
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

<figure class="plot">
  <div class="frame">
    <svg
      viewBox="0 0 {W} {height}"
      preserveAspectRatio="none"
      role="img"
      aria-label={series.map((s) => s.label).join(', ')}
    >
      {#each [0.25, 0.5, 0.75] as g (g)}
        <line x1="0" x2={W} y1={height * g} y2={height * g} class="grid" />
      {/each}
      <line x1="0" x2={W} y1={height - 6} y2={height - 6} class="axis" />
      {#each series as s (s.label)}
        <path d={path(s.values)} style:stroke={s.color} />
      {/each}
    </svg>
    <span class="top">{short(sharedMax)}</span>
  </div>
  {#if span}
    <p class="span"><span>{span[0]}</span><span>{span[1]}</span></p>
  {/if}
  <figcaption>
    {#each series as s (s.label)}
      <span
        ><i style:background={s.color}></i>{s.label}
        <b>{short(s.values[s.values.length - 1] ?? 0)}</b>
        <small>max {short(Math.max(0, ...s.values))}</small></span
      >
    {/each}
  </figcaption>
</figure>

<style>
  .plot {
    margin: 4px 0 12px;
    font-family: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .frame {
    position: relative;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
    overflow: visible;
  }
  path {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .grid {
    stroke: rgba(23, 42, 60, 0.1);
    vector-effect: non-scaling-stroke;
  }
  .axis {
    stroke: rgba(23, 42, 60, 0.45);
    vector-effect: non-scaling-stroke;
  }
  /* The scale's top, set in the margin over the highest hairline. */
  .top {
    position: absolute;
    top: -2px;
    left: 0;
    padding-right: 4px;
    background: var(--np-paper);
    font-size: 0.68em;
    line-height: 1;
    color: var(--np-ink-3);
  }
  .span {
    display: flex;
    justify-content: space-between;
    margin: 2px 0 0;
    font-size: 0.68em;
    color: var(--np-ink-3);
  }
  figcaption {
    display: flex;
    gap: 2px 14px;
    flex-wrap: wrap;
    margin-top: 3px;
    font-size: 0.78em;
    color: var(--np-ink-2);
  }
  figcaption span {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
  }
  /* The key: a stroke of the curve's ink. */
  i {
    align-self: center;
    width: 14px;
    height: 2px;
  }
  b {
    font-weight: 600;
    color: var(--np-ink);
  }
  small {
    font-size: 0.92em;
    color: var(--np-ink-3);
  }
</style>
