<script lang="ts">
  // A map shown as a hydrographic chart, optionally with its nations as dots: the first
  // `active` nations (those the game will place) are inked, the others stay hollow.
  import { chartOfMap, chartOfIsoMap, type MapNation } from './chartRender';
  import Isolines from './Isolines.svelte';
  import { i18n } from '../i18n/i18n.svelte';

  let {
    mapId = '',
    custom = '',
    mapW,
    mapH,
    width = 360,
    fit = 'cover',
    nations = null,
    active = 0,
    animateDots = true,
  }: {
    mapId?: string;
    /** .isomap text of a custom map (used instead of mapId). */
    custom?: string;
    mapW: number;
    mapH: number;
    /** Render width in pixels. */
    width?: number;
    fit?: 'cover' | 'contain';
    nations?: MapNation[] | null;
    active?: number;
    animateDots?: boolean;
  } = $props();

  let url = $state('');
  let failed = $state(false);
  let loaded = $state(false);

  $effect(() => {
    const id = mapId;
    const text = custom;
    const wpx = width;
    let live = true;
    url = '';
    loaded = false;
    failed = false;
    const job = text ? chartOfIsoMap(id || 'custom', text, wpx) : chartOfMap(id, mapW, mapH, wpx);
    job.then(
      (u) => live && (url = u),
      () => live && (failed = true),
    );
    return () => {
      live = false;
    };
  });

  const dotR = $derived(Math.max(mapW, mapH) / 115);
  const aspect = $derived(fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
</script>

<div class="cm" class:contain={fit === 'contain'}>
  {#if url}
    <img src={url} alt="" class:in={loaded} onload={() => (loaded = true)} draggable="false" />
  {/if}
  {#if !loaded && !failed}
    <div class="wait">
      <Isolines mode="ripple" count={4} r0={10} step={9} duration={2.2} stagger={0.55} />
    </div>
  {/if}
  {#if nations && loaded}
    {#key mapId}
      <svg viewBox="0 0 {mapW} {mapH}" preserveAspectRatio={aspect} aria-hidden="true">
        {#each nations as n, k (k)}
          <circle
            class:on={k < active}
            class:pop={animateDots}
            cx={n.x}
            cy={n.y}
            r={k < active ? dotR : dotR * 0.62}
            stroke-width={dotR * (k < active ? 0.45 : 0.35)}
            style="animation-delay:{Math.min(k, 60) * 16}ms"
            ><title>{n.name[i18n.lang] || n.name.en}</title></circle
          >
        {/each}
      </svg>
    {/key}
  {/if}
</div>

<style>
  .cm {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #f7fafa;
    color: var(--aurora);
  }
  img,
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  img {
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.35s ease-out;
    user-select: none;
  }
  .contain img {
    object-fit: contain;
  }
  img.in {
    opacity: 1;
  }
  .wait {
    position: absolute;
    inset: 0;
    opacity: 0.6;
  }
  circle {
    fill: var(--panel-solid, #fafcfb);
    stroke: var(--muted);
    opacity: 0.5;
    transform-box: fill-box;
    transform-origin: center;
    transition:
      r 0.2s,
      fill 0.2s,
      stroke 0.2s,
      opacity 0.2s;
  }
  circle.on {
    fill: var(--parchment);
    stroke: var(--panel-solid, #fafcfb);
    opacity: 1;
  }
  circle.pop {
    animation: dot-in 0.32s cubic-bezier(0.3, 1.5, 0.5, 1) both;
  }
  @keyframes dot-in {
    from {
      transform: scale(0);
    }
  }
</style>
