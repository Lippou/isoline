<script lang="ts">
  // Share of the usable land over the game, on the front page: the winner (and the
  // reader) in their ink, the other nations as faint grey lines, the victory threshold,
  // and the numbered turning points along the time axis. A time cursor follows the
  // pointer (or the arrow keys) and reads the values out.
  import type { Edition } from '../game/chronicle';
  import { clockText, pctText, type ChartSeries as Series } from './frontPage';
  import { t, i18n } from '../i18n/i18n.svelte';

  let {
    ed,
    series,
    marks,
    threshold = null,
    focusMark = -1,
    oncursor = () => {},
  }: {
    ed: Edition;
    series: Series[];
    /** Turning points: their number and tick. */
    marks: { n: number; tick: number }[];
    /** Victory threshold (share 0..1), or null. */
    threshold?: number | null;
    /** Turning point highlighted from the list (its number). */
    focusMark?: number;
    /** The cursor moved: the tick under it (-1: none). */
    oncursor?: (tick: number) => void;
  } = $props();

  let width = $state(640);
  const H = 196;
  const L = 40;
  const R = 112;
  const T = 14;
  const B = 46;
  const plotW = $derived(Math.max(120, width - L - R));
  const plotH = H - T - B;
  const span = $derived(Math.max(1, ed.endTick - ed.startTick));
  const x = (tick: number) => L + ((tick - ed.startTick) / span) * plotW;

  /** The victory threshold is drawn when it is within reach of the curves (not to flatten them). */
  const dataMax = $derived(Math.max(0, ...series.flatMap((s) => s.values)));
  const showThreshold = $derived(threshold !== null && threshold <= Math.max(0.1, dataMax) * 1.6);
  const ymax = $derived.by(() => {
    const m = Math.max(dataMax, showThreshold ? threshold! : 0);
    return Math.min(1, Math.max(0.1, Math.ceil(m * 1.08 * 10) / 10));
  });
  const y = (v: number) => T + plotH - (v / ymax) * plotH;
  const yTicks = $derived.by(() => {
    const step = ymax <= 0.3 ? 0.1 : ymax <= 0.6 ? 0.2 : 0.25;
    const out: number[] = [];
    for (let v = 0; v <= ymax + 1e-6; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  });
  const xTicks = $derived.by(() => {
    const min = span / 600;
    const step = min <= 8 ? 2 : min <= 20 ? 5 : min <= 50 ? 10 : 20;
    const out: number[] = [];
    for (let m = step; m < min - step * 0.4; m += step) out.push(m);
    return out;
  });

  function path(values: number[]): string {
    let d = '';
    values.forEach((v, k) => {
      const tk = ed.ticks[k];
      if (tk === undefined) return;
      d += `${d ? 'L' : 'M'}${x(tk).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  }

  const strong = $derived(series.filter((s) => s.strong));
  const faint = $derived(series.filter((s) => !s.strong));
  /** Direct labels at the end of the strong lines, pushed apart when they would overlap. */
  const ends = $derived.by(() => {
    const out = strong.map((s) => ({ s, y: y(s.values.at(-1) ?? 0) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < out.length; k++) if (out[k]!.y - out[k - 1]!.y < 15) out[k]!.y = out[k - 1]!.y + 15;
    return out;
  });
  /** Turning-point markers on one row: pushed aside where they would touch, a leader to their time. */
  const markers = $derived.by(() => {
    const GAP = 17;
    const xs = marks.map((m) => x(m.tick));
    const at = xs.slice();
    for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i]!, at[i - 1]! + GAP);
    for (let i = at.length - 1; i >= 0; i--) {
      const limit = i === at.length - 1 ? L + plotW + 4 : at[i + 1]! - GAP;
      if (at[i]! > limit) at[i] = limit;
    }
    return marks.map((m, i) => ({ ...m, x0: xs[i]!, x: at[i]!, y: T + plotH + 16 }));
  });

  // ---------------------------------------------------------------- cursor
  let k = $state(-1);
  $effect(() => oncursor(k >= 0 ? (ed.ticks[k] ?? -1) : -1));
  function nearest(px: number): number {
    const tick = ed.startTick + ((px - L) / plotW) * span;
    let best = 0;
    let gap = Infinity;
    ed.ticks.forEach((tk, j) => {
      const d = Math.abs(tk - tick);
      if (d < gap) {
        gap = d;
        best = j;
      }
    });
    return best;
  }
  function move(e: PointerEvent): void {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    k = nearest(((e.clientX - r.left) / r.width) * width);
  }
  function key(e: KeyboardEvent): void {
    const n = ed.ticks.length;
    if (!n) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowRight') k = Math.min(n - 1, (k < 0 ? n - 1 : k) + step);
    else if (e.key === 'ArrowLeft') k = Math.max(0, (k < 0 ? n - 1 : k) - step);
    else if (e.key === 'Home') k = 0;
    else if (e.key === 'End') k = n - 1;
    else return;
    e.preventDefault();
  }
  const pct = (v: number) => t('front.chart.pct', { share: pctText(v, i18n.lang) });
  const readout = $derived.by(() => {
    if (k < 0) return null;
    const tick = ed.ticks[k]!;
    // The country in the lead at that moment, when it is not one of the strong lines.
    let lead: Series | null = null;
    for (const s of series) if (!lead || (s.values[k] ?? 0) > (lead.values[k] ?? 0)) lead = s;
    const rows = strong.map((s) => ({ label: s.label, color: s.color, v: s.values[k] ?? 0 }));
    if (lead && !lead.strong) rows.push({ label: lead.label, color: '#8d8677', v: lead.values[k] ?? 0 });
    return { tick, x: x(tick), rows };
  });
  const valueText = $derived(
    readout
      ? `${clockText(readout.tick - ed.startTick)} — ${readout.rows.map((r) => `${r.label} ${pct(r.v)}`).join(', ')}`
      : t('front.chart.title'),
  );
  const focusTick = $derived(marks.find((m) => m.n === focusMark)?.tick ?? -1);
  /** Rows of the table view: about a dozen moments. */
  const tableRows = $derived.by(() => {
    const n = ed.ticks.length;
    const every = Math.max(1, Math.ceil(n / 12));
    return ed.ticks.map((tk, j) => ({ tk, j })).filter(({ j }) => j % every === 0 || j === n - 1);
  });
</script>

<div class="wrap" bind:clientWidth={width}>
  <div
    class="plot"
    role="slider"
    tabindex="0"
    aria-label={t('front.chart.aria')}
    aria-valuemin={0}
    aria-valuemax={Math.max(0, ed.ticks.length - 1)}
    aria-valuenow={k < 0 ? ed.ticks.length - 1 : k}
    aria-valuetext={valueText}
    onkeydown={key}
    onblur={() => (k = -1)}
  >
    <svg
      viewBox="0 0 {width} {H}"
      {width}
      height={H}
      aria-hidden="true"
      onpointermove={move}
      onpointerleave={() => (k = -1)}
    >
      <!-- Grid and axes: hairlines one shade off the paper. -->
      {#each yTicks as v (v)}
        <line class="grid" x1={L} x2={L + plotW} y1={y(v)} y2={y(v)} />
        <text class="ylab" x={L - 6} y={y(v) + 3.5}>{pct(v)}</text>
      {/each}
      {#each xTicks as m (m)}
        <line
          class="tick"
          x1={x(ed.startTick + m * 600)}
          x2={x(ed.startTick + m * 600)}
          y1={T + plotH}
          y2={T + plotH + 4}
        />
        <text class="xlab" x={x(ed.startTick + m * 600)} y={H - 3}>{t('front.chart.min', { n: m })}</text>
      {/each}
      <line class="axis" x1={L} x2={L + plotW} y1={T + plotH} y2={T + plotH} />
      {#if showThreshold && threshold !== null}
        <line class="threshold" x1={L} x2={L + plotW} y1={y(threshold)} y2={y(threshold)} />
        <text class="thlab" x={L + 4} y={y(threshold) - 4}
          >{t('front.chart.threshold', { n: Math.round(threshold * 100) })}</text
        >
      {/if}
      {#if focusTick >= 0}
        <line class="focus" x1={x(focusTick)} x2={x(focusTick)} y1={T} y2={T + plotH} />
      {/if}
      {#each faint as s (s.key)}
        <path class="faint" d={path(s.values)} />
      {/each}
      {#each strong as s (s.key)}
        <path
          class="strong"
          d={path(s.values)}
          stroke={s.color}
          stroke-dasharray={s.dashed ? '7 4' : undefined}
        />
      {/each}
      {#each ends as e (e.s.key)}
        {@const ey = y(e.s.values.at(-1) ?? 0)}
        <circle cx={L + plotW} cy={ey} r="3" fill={e.s.color} class="dot" />
        <!-- A label pushed off its line keeps a leader to its dot (never matched by colour alone). -->
        {#if Math.abs(e.y - ey) > 3}<line
            class="leader"
            x1={L + plotW + 3}
            y1={ey}
            x2={L + plotW + 7}
            y2={e.y}
          />{/if}
        <text class="end" x={L + plotW + 8} y={e.y + 4}>{e.s.label}</text>
      {/each}
      {#each markers as m (m.n)}
        <g class="mark" class:on={m.n === focusMark}>
          <line x1={m.x0} x2={m.x} y1={T + plotH} y2={m.y - 7.5} />
          <circle cx={m.x} cy={m.y} r="7.5" />
          <text x={m.x} y={m.y + 3.5}>{m.n}</text>
        </g>
      {/each}
      {#if readout}
        <line class="cursor" x1={readout.x} x2={readout.x} y1={T} y2={T + plotH} />
        {#each strong as s (s.key)}
          <circle cx={readout.x} cy={y(s.values[k] ?? 0)} r="4" fill={s.color} class="dot" />
        {/each}
      {/if}
    </svg>
    {#if readout}
      <div class="tip" style:left="{Math.min(width - 190, Math.max(0, readout.x + 10))}px" aria-hidden="true">
        <b>{clockText(readout.tick - ed.startTick)}</b>
        {#each readout.rows as r (r.label)}
          <span><i style:background={r.color}></i>{r.label}<em>{pct(r.v)}</em></span>
        {/each}
      </div>
    {/if}
  </div>
  <!-- The table view (screen readers): a table cannot be shrunk, its wrapper can. -->
  <div class="sr-only">
    <table>
      <caption>{t('front.chart.table')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('front.chart.time')}</th>
          {#each series as s (s.key)}<th scope="col">{s.label}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each tableRows as r (r.j)}
          <tr>
            <th scope="row">{clockText(r.tk - ed.startTick)}</th>
            {#each series as s (s.key)}<td>{pctText(s.values[r.j] ?? 0, i18n.lang)}</td>{/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .wrap {
    position: relative;
    min-width: 0;
  }
  .plot {
    position: relative;
    outline: none;
    border-radius: 2px;
  }
  .plot:focus-visible {
    outline: 2px solid var(--np-ink);
    outline-offset: 3px;
  }
  svg {
    display: block;
    overflow: visible;
    font-family: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .grid {
    stroke: rgba(23, 42, 60, 0.1);
  }
  .axis {
    stroke: rgba(23, 42, 60, 0.45);
  }
  .tick {
    stroke: rgba(23, 42, 60, 0.45);
  }
  .ylab,
  .xlab {
    font-size: 10.5px;
    fill: var(--np-ink-3);
  }
  .ylab {
    text-anchor: end;
  }
  .xlab {
    text-anchor: middle;
  }
  .threshold {
    stroke: var(--np-spot);
    stroke-dasharray: 4 3;
    opacity: 0.75;
  }
  .thlab {
    font-size: 10.5px;
    font-weight: 500;
    fill: var(--np-spot);
  }
  .focus,
  .cursor {
    stroke: var(--np-ink);
    stroke-width: 1;
    opacity: 0.55;
  }
  path {
    fill: none;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .faint {
    stroke: #a29a89;
    stroke-width: 1;
    opacity: 0.75;
  }
  .strong {
    stroke-width: 2.2;
  }
  .dot {
    stroke: var(--np-paper);
    stroke-width: 2;
  }
  .leader {
    stroke: var(--np-ink-3);
    stroke-width: 1;
  }
  .end {
    font-size: 11.5px;
    font-weight: 600;
    fill: var(--np-ink);
  }
  .mark line {
    stroke: rgba(23, 42, 60, 0.25);
  }
  .mark circle {
    fill: var(--np-paper);
    stroke: var(--np-ink-2);
    stroke-width: 1;
  }
  .mark text {
    font-size: 9.5px;
    font-weight: 600;
    text-anchor: middle;
    fill: var(--np-ink);
  }
  .mark.on circle {
    fill: var(--np-ink);
    stroke: var(--np-ink);
  }
  .mark.on text {
    fill: var(--np-paper);
  }
  .tip {
    position: absolute;
    top: 6px;
    display: grid;
    gap: 2px;
    min-width: 150px;
    max-width: 190px;
    padding: 6px 9px 7px;
    background: var(--np-paper);
    border: 1px solid var(--np-ink);
    box-shadow: 0 4px 12px rgba(23, 42, 60, 0.16);
    font-family: var(--text);
    font-size: 0.74em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
    pointer-events: none;
  }
  .tip span {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
  }
  .tip i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }
  .tip em {
    font-style: normal;
    font-weight: 600;
  }
</style>
