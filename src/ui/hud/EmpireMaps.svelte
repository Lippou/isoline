<script lang="ts">
  // "The empire over time": the world's ownership maps side by side, printed in the
  // paper's inks. The winner (and the reader) in full colour, the other nations faded,
  // the tribes in their neutral ink; borders and coasts drawn as thin ink lines.
  import { TRIBES, type Edition } from '../game/chronicle';
  import { clockText, pickMaps } from './frontPage';
  import { t } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';

  let {
    ed,
    colors,
    strong,
    legend,
    reader = -1,
    active = -1,
    onwatch = null,
  }: {
    ed: Edition;
    /** Ink of each nation (roster index → rgb). */
    colors: [number, number, number][];
    /** Roster indices printed in full colour. */
    strong: Set<number>;
    /** Legend of the full-colour inks (the winner, the reader; `hatched`: the reader's). */
    legend: { label: string; color: [number, number, number]; hatched?: boolean }[];
    /**
     * Roster index of the reader: their land is hatched and ruled in ink, so it parts from
     * the winner's without the inks (colour blindness). -1: none.
     */
    reader?: number;
    /** Tick under the chart's cursor: the nearest map is marked. */
    active?: number;
    /** Watch the replay from a map's moment (null: no replay). */
    onwatch?: ((tick: number) => void) | null;
  } = $props();

  const PAPER: [number, number, number] = [241, 236, 226];
  const INK: [number, number, number] = [23, 42, 60];
  const WATER: [number, number, number] = [203, 215, 216];
  const FREE: [number, number, number] = [232, 226, 212];
  const TRIBE: [number, number, number] = [185, 178, 162];
  const S = 2; // device pixels per map cell

  const mix = (a: [number, number, number], b: [number, number, number], k: number) =>
    [0, 1, 2].map((i) => Math.round(a[i]! * (1 - k) + b[i]! * k)) as [number, number, number];

  /** More maps for tall worlds, fewer for wide ones: the strip keeps a readable height. */
  const aspect = $derived(ed.w / ed.h);
  const count = $derived(aspect >= 1.7 ? 4 : aspect >= 0.85 ? 5 : 6);
  const picked = $derived(pickMaps(ed, count));
  const activeK = $derived.by(() => {
    if (active < 0) return -1;
    let best = -1;
    let gap = Infinity;
    for (const k of picked) {
      const d = Math.abs(ed.maps[k]!.tick - active);
      if (d < gap) {
        gap = d;
        best = k;
      }
    }
    return best;
  });

  const palette = $derived.by(() => {
    const fill: [number, number, number][] = [FREE];
    for (let k = 0; k < TRIBES - 1; k++) {
      const c = colors[k];
      fill.push(c ? (strong.has(k) ? mix(c, PAPER, 0.06) : mix(c, PAPER, 0.58)) : TRIBE);
    }
    fill.push(mix(TRIBE, PAPER, 0.42));
    return fill;
  });

  const css = (c: readonly number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
  /** "Other nations": a swatch of three of their faded inks. */
  const othersSwatch = $derived.by(() => {
    const faded = colors.filter((_, k) => !strong.has(k)).slice(0, 3);
    if (!faded.length) return '';
    const c = faded.map((x) => css(mix(x, PAPER, 0.58)));
    const n = c.length;
    return `linear-gradient(90deg, ${c.map((x, k) => `${x} ${(k / n) * 100}% ${((k + 1) / n) * 100}%`).join(', ')})`;
  });

  function paint(canvas: HTMLCanvasElement, arg: { data: Uint8Array; pal: [number, number, number][] }) {
    const draw = ({ data: d, pal }: { data: Uint8Array; pal: [number, number, number][] }) => {
      const w = ed.w;
      const h = ed.h;
      canvas.width = w * S;
      canvas.height = h * S;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(w * S, h * S);
      const px = img.data;
      const W = w * S;
      const put = (x: number, y: number, c: readonly number[]) => {
        const o = (y * W + x) * 4;
        px[o] = c[0]!;
        px[o + 1] = c[1]!;
        px[o + 2] = c[2]!;
        px[o + 3] = 255;
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const land = ed.land[i] === 1;
          const c = land ? pal[d[i]!]! : WATER;
          for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(x * S + dx, y * S + dy, c);
          if (!land) continue;
          // The reader's land: diagonal ink hatching, one cell in four.
          if (reader >= 0 && d[i] === reader + 1 && (x + y) % 4 === 0)
            for (let dy = 0; dy < S; dy++)
              for (let dx = 0; dx < S; dx++) put(x * S + dx, y * S + dy, mix(c, INK, 0.55));
          // Thin ink lines: coasts (land against sea) and borders (two owners, one of them a country).
          const edge = (j: number) =>
            !ed.land[j] ? 0.42 : d[j] !== d[i] && (d[i] !== 0 || d[j] !== 0) ? 0.3 : 0;
          const right = x + 1 < w ? edge(i + 1) : 0;
          const below = y + 1 < h ? edge(i + w) : 0;
          const left = x > 0 && !ed.land[i - 1] ? 0.42 : 0;
          const above = y > 0 && !ed.land[i - w] ? 0.42 : 0;
          if (right) for (let dy = 0; dy < S; dy++) put(x * S + S - 1, y * S + dy, mix(c, INK, right));
          if (below) for (let dx = 0; dx < S; dx++) put(x * S + dx, y * S + S - 1, mix(c, INK, below));
          if (left) for (let dy = 0; dy < S; dy++) put(x * S, y * S + dy, mix(c, INK, left));
          if (above) for (let dx = 0; dx < S; dx++) put(x * S + dx, y * S, mix(c, INK, above));
        }
      ctx.putImageData(img, 0, 0);
    };
    draw(arg);
    return { update: draw };
  }

  const caption = (k: number, j: number) => {
    const m = ed.maps[k]!;
    const since = m.tick - ed.startTick;
    if (j === picked.length - 1) return `${t('front.maps.end')} · ${clockText(since)}`;
    if (since < 300) return t('front.maps.start');
    return clockText(since);
  };
</script>

<div class="strip" style:--n={picked.length}>
  {#each picked as k, j (k)}
    {@const m = ed.maps[k]!}
    <figure class:on={k === activeK}>
      {#if onwatch}
        <button
          class="plate"
          onclick={() => onwatch(m.tick)}
          aria-label={`${t('front.maps.alt', { clock: clockText(m.tick - ed.startTick) })}. ${t('front.replayAt', { clock: clockText(m.tick - ed.startTick) })}`}
        >
          <canvas use:paint={{ data: m.data, pal: palette }} style:aspect-ratio="{ed.w} / {ed.h}"></canvas>
          <span class="watch" aria-hidden="true"><Icon name="rewind" size={12} />{t('front.replay')}</span>
        </button>
      {:else}
        <div role="img" aria-label={t('front.maps.alt', { clock: clockText(m.tick - ed.startTick) })}>
          <canvas use:paint={{ data: m.data, pal: palette }} style:aspect-ratio="{ed.w} / {ed.h}"></canvas>
        </div>
      {/if}
      <figcaption>{caption(k, j)}</figcaption>
    </figure>
  {/each}
</div>
<ul class="legend">
  {#each legend as l (l.label)}
    <li>
      <i
        style:background={l.hatched
          ? `repeating-linear-gradient(-45deg, ${css(mix(l.color, INK, 0.55))} 0 1.5px, ${css(mix(l.color, PAPER, 0.06))} 1.5px 5px)`
          : css(mix(l.color, PAPER, 0.06))}
      ></i>{l.label}
    </li>
  {/each}
  {#if othersSwatch}<li><i style:background={othersSwatch}></i>{t('front.maps.others')}</li>{/if}
  <li><i style:background={css(mix(TRIBE, PAPER, 0.42))}></i>{t('front.maps.tribes')}</li>
  <li><i class="free" style:background={css(FREE)}></i>{t('front.maps.free')}</li>
</ul>

<style>
  .strip {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 10px;
    align-items: end;
  }
  figure {
    margin: 0;
    display: grid;
    gap: 4px;
  }
  canvas {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid rgba(23, 42, 60, 0.45);
    image-rendering: auto;
  }
  .plate {
    position: relative;
    appearance: none;
    display: block;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  .watch {
    position: absolute;
    right: 4px;
    bottom: 4px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px 2px 5px;
    border-radius: 2px;
    background: var(--np-ink);
    color: var(--np-paper);
    font-family: var(--text);
    font-size: 0.7em;
    font-weight: 500;
    opacity: 0;
    transition: opacity 0.14s;
  }
  .plate:hover .watch,
  .plate:focus-visible .watch {
    opacity: 1;
  }
  .plate:hover canvas,
  .plate:focus-visible canvas {
    border-color: var(--np-ink);
  }
  figure.on canvas {
    outline: 2px solid var(--np-ink);
    outline-offset: 1px;
  }
  figcaption {
    font-family: var(--text);
    font-size: 0.74em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
    text-align: center;
  }
  figure:last-child figcaption {
    color: var(--np-ink);
    font-weight: 600;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-family: var(--text);
    font-size: 0.74em;
    color: var(--np-ink-2);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend i {
    width: 14px;
    height: 9px;
    border: 1px solid rgba(23, 42, 60, 0.35);
  }
</style>
