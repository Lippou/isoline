<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../i18n/i18n.svelte';
  import { MISSIONS } from '../campaign/missions';
  import { profile } from '../stores/profile.svelte';
  import { startMission } from './launch';
  import { mapsBase } from '../bridge';
  import Icon from '../icons/Icon.svelte';
  import PageHeader from '../PageHeader.svelte';
  import ChartMap from '../components/ChartMap.svelte';
  import { nationsOfMap, type MapNation } from '../components/chartRender';
  import { pickNations } from '../../core/map/nationPick';
  import { contourFamily } from '../components/contours';

  const unlocked = (k: number) => k === 0 || (profile.campaign[MISSIONS[k - 1]!.id] ?? 0) > 0;
  const totalStars = $derived(MISSIONS.reduce((s, m) => s + (profile.campaign[m.id] ?? 0), 0));
  // Open on the first mission still to win (the frontier of the route).
  const frontier = $derived(
    Math.max(
      0,
      MISSIONS.findIndex((mi, k) => unlocked(k) && !(profile.campaign[mi.id] ?? 0)),
    ),
  );
  let sel = $state(-1);
  const at = $derived(sel < 0 ? frontier : sel);
  const m = $derived(MISSIONS[at]!);
  const lastOpen = $derived(MISSIONS.reduce((a, _, k) => (unlocked(k) ? k : a), 0));

  // The route: stations on a chart, each mission a summit wrapped in its own contours.
  // Laid out in the panel's own pixels, so the chart fills it without distortion.
  let W = $state(0);
  let H = $state(0);
  const STATIONS: [number, number][] = [
    [0.12, 0.74],
    [0.28, 0.38],
    [0.44, 0.7],
    [0.6, 0.28],
    [0.75, 0.6],
    [0.88, 0.2],
  ];
  const pts = $derived(STATIONS.map(([x, y]) => [x * W, y * H] as [number, number]));
  function routeTo(n: number): string {
    const p = (i: number) => pts[Math.max(0, Math.min(n, i))]!;
    let d = `M${p(0)[0]},${p(0)[1]}`;
    for (let i = 0; i < n; i++) {
      const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
      d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
    }
    return d;
  }
  const scale = $derived(Math.max(0.7, Math.min(1.3, Math.min(W / 1000, H / 620))));
  const summits = $derived(
    pts.map(([x, y], k) =>
      contourFamily({
        cx: x,
        cy: y,
        count: 5,
        r0: 22 * scale,
        step: 14 * scale,
        growth: 1.12,
        seed: k * 13 + 5,
        wobble: 1.3,
      }),
    ),
  );
  const grid = $derived({
    x: Array.from({ length: Math.floor(W / 160) }, (_, k) => (k + 1) * (W / (Math.floor(W / 160) + 1))),
    y: Array.from({ length: Math.floor(H / 160) }, (_, k) => (k + 1) * (H / (Math.floor(H / 160) + 1))),
  });

  // Mission maps: sizes (index) and nations (a mission with fewer than the map lists places the
  // pick that covers the map, core/map/nationPick.ts; its seed is drawn at launch, so the
  // preview shows the pick of seed 1, nearly the same).
  let sizes = $state<Record<string, [number, number]>>({});
  let nations = $state<MapNation[]>([]);
  const missionNations = MISSIONS.map((mi) => {
    try {
      return mi.config(1, '').nations;
    } catch {
      return 0;
    }
  });
  onMount(() => {
    void fetch(`${mapsBase()}index.json`)
      .then((r) => r.json() as Promise<{ id: string; width: number; height: number }[]>)
      .then((l) => (sizes = Object.fromEntries(l.map((x) => [x.id, [x.width, x.height]]))))
      .catch(() => {});
  });
  const active = $derived(Math.min(missionNations[at] ?? 0, nations.length));
  const shown = $derived.by(() => {
    const size = sizes[m.mapId];
    if (!size || active >= nations.length) return nations;
    const picked = pickNations(nations, active, 1, size[0], size[1]);
    const set = new Set(picked);
    return [...picked, ...nations.filter((n) => !set.has(n))];
  });
  $effect(() => {
    const id = m.mapId;
    let live = true;
    nationsOfMap(id).then(
      (n) => live && (nations = n),
      () => live && (nations = []),
    );
    return () => {
      live = false;
    };
  });
</script>

<div class="camp page-shell" data-testid="campaign">
  <PageHeader wide title={t('campaign.title')} subtitle={t('campaign.intro')} back="play">
    {#snippet actions()}
      <span
        class="stars-total"
        aria-label={t('campaign.starsTotal', { n: totalStars, total: MISSIONS.length * 3 })}
        ><Icon name="star" size={16} /><b class="mono">{totalStars}</b><span class="mono"
          >/ {MISSIONS.length * 3}</span
        ></span
      >
    {/snippet}
  </PageHeader>

  <div class="body">
    <section class="route" aria-label={t('campaign.routeLabel')} bind:clientWidth={W} bind:clientHeight={H}>
      {#if W && H}
        <svg viewBox="0 0 {W} {H}" width={W} height={H} aria-hidden="true">
          <defs>
            <mask id="route-all" maskUnits="userSpaceOnUse">
              <path class="reveal" d={routeTo(pts.length - 1)} pathLength="1" />
            </mask>
            <mask id="route-done" maskUnits="userSpaceOnUse">
              <path class="reveal late" d={routeTo(lastOpen)} pathLength="1" />
            </mask>
          </defs>
          <g class="grat">
            {#each grid.x as x (x)}<line x1={x} y1="0" x2={x} y2={H} />{/each}
            {#each grid.y as y (y)}<line x1="0" y1={y} x2={W} y2={y} />{/each}
          </g>
          {#each summits as rings, k (k)}
            <g class="summit" class:open={unlocked(k)}>
              {#each rings as r, j (j)}<path d={r.d} />{/each}
            </g>
          {/each}
          <path class="track" d={routeTo(pts.length - 1)} mask="url(#route-all)" />
          <path class="progress" d={routeTo(pts.length - 1)} mask="url(#route-done)" />
        </svg>
      {/if}
      <ol class="stations">
        {#each MISSIONS as mi, k (mi.id)}
          {@const stars = profile.campaign[mi.id] ?? 0}
          <li style="left:{STATIONS[k]![0] * 100}%;top:{STATIONS[k]![1] * 100}%">
            <button
              class="st"
              class:on={at === k}
              class:done={stars > 0}
              class:next={unlocked(k) && !stars}
              class:locked={!unlocked(k)}
              aria-pressed={at === k}
              onclick={() => (sel = k)}
            >
              <span class="mk" aria-hidden="true"></span>
              <span class="lbl">
                <small>{t('campaign.missionN', { n: k + 1 })}</small>
                <b>{t(`campaign.${mi.id}.title`)}</b>
                {#if unlocked(k)}
                  <span class="stars" aria-label={t('campaign.starsOf', { n: stars })}
                    >{#each [1, 2, 3] as s (s)}<span class:got={s <= stars}
                        ><Icon name="star" size={12} /></span
                      >{/each}</span
                  >
                {:else}
                  <span class="lock"><Icon name="lock" size={12} />{t('campaign.locked')}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ol>
    </section>

    <section class="detail">
      {#key m.id}
        <div class="chartbox">
          {#if sizes[m.mapId]}
            <ChartMap
              mapId={m.mapId}
              mapW={sizes[m.mapId]![0]}
              mapH={sizes[m.mapId]![1]}
              width={900}
              fit="contain"
              nations={shown}
              {active}
            />
          {/if}
        </div>
        <div class="dtxt">
          <span class="kicker">{t('campaign.missionN', { n: at + 1 })}</span>
          <h2>{t(`campaign.${m.id}.title`)}</h2>
          <p class="brief">{t(`campaign.${m.id}.brief`)}</p>
          <ul class="objs">
            {#each m.objectives as o (o.key)}
              <li>
                <span class="ok"><Icon name="target" size={16} /></span>
                <span><b>{t('campaign.objective')}</b>{t(o.key)}</span>
              </li>
            {/each}
            <li class="bonus">
              <span class="ok"><Icon name="star" size={16} /></span>
              <span><b>{t('campaign.bonusLabel')}</b>{t(m.bonus.key)}</span>
            </li>
            <li>
              <span class="ok"><Icon name="time" size={16} /></span>
              <span><b>{t('campaign.parTime')}</b>{Math.round(m.parTicks / 600)} min</span>
            </li>
          </ul>
          <p class="hint">{t('campaign.starsRule')}</p>
          <div class="act">
            {#if unlocked(at)}
              <button class="btn primary play" onclick={() => startMission(m.id)} data-testid="mission-{m.id}"
                ><Icon name="play" size={16} />{t('campaign.play')}</button
              >
            {:else}
              <p class="locked-hint"><Icon name="lock" size={14} />{t('campaign.lockedHint')}</p>
            {/if}
          </div>
        </div>
      {/key}
    </section>
  </div>
</div>

<style>
  .stars-total {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    color: var(--brass-text);
    font-size: 1.02em;
    font-variant-numeric: tabular-nums;
  }
  .stars-total :global(svg) {
    color: var(--brass);
    transform: translateY(2px);
  }
  .stars-total b {
    font-size: 1.25em;
    font-weight: 600;
  }
  .stars-total span {
    color: var(--np-ink-2);
  }

  /* The route's plate, then the mission's column, a fine rule between. */
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(380px, 1fr);
    min-height: 0;
  }

  /* Touch web version (tactile.ts) on a phone held upright: one column, the page scrolls. */
  @media (max-width: 699px) {
    :global(html.tactile) .body {
      grid-template-columns: minmax(0, 1fr);
      grid-auto-rows: max-content;
      gap: 18px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    :global(html.tactile) .route {
      height: clamp(260px, 48svh, 420px);
      margin-right: 0;
    }
  }
  /* The route chart: a plate of the atlas, square-cut in an ink frame. */
  .route {
    position: relative;
    min-height: 0;
    margin-right: 22px;
    background: var(--np-card);
    border: 1px solid var(--np-ink);
    overflow: hidden;
  }
  .route svg,
  .stations {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .stations {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .grat line {
    stroke: var(--np-rule);
    stroke-width: 1;
    opacity: 0.55;
  }
  .summit path {
    fill: none;
    stroke: var(--contour-ink);
    stroke-width: 1.1;
    opacity: 0.32;
  }
  .summit.open path {
    opacity: 0.6;
  }
  .track {
    fill: none;
    stroke: var(--np-rule-2);
    stroke-width: 2.5;
    stroke-dasharray: 0.1 9;
    stroke-linecap: round;
  }
  .progress {
    fill: none;
    stroke: var(--np-ink);
    stroke-width: 3.5;
    stroke-dasharray: 0.1 9;
    stroke-linecap: round;
  }
  .reveal {
    fill: none;
    stroke: #fff;
    stroke-width: 24;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: reveal 1.6s 0.2s cubic-bezier(0.5, 0, 0.3, 1) forwards;
  }
  .reveal.late {
    animation-duration: 1.1s;
    animation-delay: 0.5s;
  }
  @keyframes reveal {
    to {
      stroke-dashoffset: 0;
    }
  }
  .stations li {
    position: absolute;
    transform: translate(-50%, -14px);
  }
  .st {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 0;
    background: none;
    border: 0;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    text-align: center;
  }
  .mk {
    position: relative;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
  }
  .mk::before {
    content: '';
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--np-card);
    border: 2px solid var(--np-rule-2);
    transition:
      transform 0.22s var(--ease-out),
      background 0.16s,
      border-color 0.16s;
  }
  .done .mk::before {
    background: var(--np-ink);
    border-color: var(--np-ink);
  }
  .next .mk::before {
    width: 15px;
    height: 15px;
    border-radius: 2px;
    background: var(--brass);
    border: 2px solid var(--np-card);
    transform: rotate(45deg);
    box-shadow: 0 0 0 1px var(--brass);
  }
  .mk::after {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 2px solid var(--np-ink);
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity 0.2s,
      transform 0.25s var(--ease-out);
  }
  .st.on .mk::after {
    opacity: 1;
    transform: scale(1);
  }
  .st:hover .mk::before {
    transform: scale(1.2);
  }
  .next:hover .mk::before {
    transform: rotate(45deg) scale(1.2);
  }
  .st:focus-visible {
    outline: none;
  }
  .st:focus-visible .lbl {
    outline: 2px solid var(--np-ink);
    outline-offset: 3px;
  }
  /* A station's label: a slip of paper, framed in ink when chosen. */
  .lbl {
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 4px 10px 5px;
    border-radius: 2px;
    border: 1px solid transparent;
    background: color-mix(in srgb, var(--np-card) 90%, transparent);
    transition:
      border-color 0.16s,
      box-shadow 0.16s;
  }
  .st:hover .lbl {
    border-color: var(--np-rule-2);
  }
  .st.on .lbl {
    background: var(--np-paper);
    border-color: var(--np-ink);
    box-shadow: 3px 3px 0 var(--np-paper-2);
  }
  .lbl small {
    color: var(--np-ink-2);
    font-size: 0.78em;
  }
  .lbl b {
    font-family: var(--title);
    font-style: italic;
    font-weight: 400;
    font-size: 1.08em;
    white-space: nowrap;
  }
  .st.on .lbl b {
    font-weight: 600;
  }
  .locked .lbl b {
    color: var(--np-ink-2);
  }
  .stars {
    display: flex;
    gap: 1px;
    color: var(--np-rule-2);
  }
  /* Earned stars are filled, the others outlined (not only brass against grey). */
  .got {
    color: var(--brass);
  }
  .got :global(svg) {
    fill: currentColor;
  }
  .lock {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.78em;
    color: var(--np-ink-2);
  }

  /* Mission detail: the article — its map as a photograph, then kicker, head, lead. */
  .detail {
    min-height: 0;
    overflow-y: auto;
    padding-left: 22px;
    border-left: 1px solid var(--np-rule);
    display: grid;
    align-content: start;
    scrollbar-width: thin;
  }
  .chartbox {
    position: relative;
    height: clamp(150px, 24vh, 290px);
    border: 1px solid var(--np-ink);
    background: var(--np-card);
    animation: fade 0.3s ease-out both;
  }
  .dtxt {
    display: grid;
    gap: 9px;
    padding: 14px 0 16px;
    animation: rise 0.3s ease-out both;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .kicker {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
    font-size: 0.95em;
  }
  .dtxt h2 {
    font-weight: 700;
    font-size: 1.9em;
    line-height: 1.05;
    letter-spacing: -0.012em;
    margin-top: -6px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--np-ink);
  }
  .brief {
    margin: 0;
    font-family: var(--np-serif);
    line-height: 1.6;
    max-width: 62ch;
    text-wrap: pretty;
  }
  /* The orders, as a legend: pictogram, kind, words; a fine rule between. */
  .objs {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;
    display: grid;
    border-top: 1px solid var(--np-rule);
  }
  .objs li {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 12px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid var(--np-rule);
  }
  .ok {
    display: grid;
    place-items: center;
    color: var(--np-ink);
  }
  .objs li > span:last-child {
    display: grid;
  }
  .objs b {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.86em;
    font-weight: 400;
    color: var(--np-ink-2);
  }
  .bonus .ok {
    color: var(--brass-text);
  }
  .act {
    margin-top: 4px;
  }
  .play {
    font-size: 1.08em;
    padding: 0.7em 1.4em;
  }
  .locked-hint {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .dtxt > .hint {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.82em;
  }
</style>
