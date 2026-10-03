<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { rangeFill } from '../components/rangeFill';
  import { onMount, onDestroy } from 'svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { bridge, mapsBase, readText } from '../bridge';
  import { EditorModel, EDITOR_COLORS, type Brush } from '../editor/editorModel';
  import { TERRAIN, RESOURCE_KEYS, IS_LAND } from '../../core/map/terrain';
  import type { MapMeta } from '../../core/map/gamemap';
  import { toast } from '../stores/game.svelte';
  import { startSolo, playerName } from './launch';
  import { defaultConfig } from '../../core/game/config';
  import Isolines from '../components/Isolines.svelte';
  import PageHeader from '../PageHeader.svelte';

  // Canvas inks, read from the theme tokens (the Courier's paper in the menus).
  const ink = { paper: '#e6dfd1', text: '#172a3c', halo: '#f8f4ec', spawn: '#2c6e91', nation: '#b8862a' };
  function readInks(): void {
    if (!wrap) return;
    const cs = getComputedStyle(wrap);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    ink.paper = v('--slate', ink.paper);
    ink.text = v('--parchment', ink.text);
    ink.halo = v('--panel-solid', ink.halo);
    ink.spawn = v('--np-sea', ink.spawn);
    ink.nation = v('--brass', ink.nation);
  }

  let model: EditorModel | null = $state(null);
  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;
  let off: HTMLCanvasElement | null = null;
  let img: ImageData | null = null;
  let brush: Brush = $state('terrain');
  let terrainType = $state(4);
  let radius = $state(6);
  let depositType = $state(1);
  let nationName = $state('');
  let name = $state('Nouvelle carte');
  let view = { x: 0, y: 0, z: 1 };
  let painting = false;
  let panning: { x: number; y: number } | null = null;
  let raf = 0;
  let builtins: { id: string; name: { fr: string; en: string } }[] = $state([]);
  let errors: string[] = $state([]);

  function rebuildImage(): void {
    if (!model) return;
    const { width: w, height: h } = model.meta;
    if (!off || off.width !== w || off.height !== h) {
      off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      img = off.getContext('2d')!.createImageData(w, h);
    }
    const d = img!.data;
    for (let i = 0; i < w * h; i++) {
      const c = EDITOR_COLORS[model.terrain[i]!] ?? [0, 0, 0];
      const shade = IS_LAND[model.terrain[i]!] ? 0.75 + (model.elevation[i]! / 255) * 0.5 : 1;
      d[i * 4] = Math.min(255, c[0] * shade);
      d[i * 4 + 1] = Math.min(255, c[1] * shade);
      d[i * 4 + 2] = Math.min(255, c[2] * shade);
      d[i * 4 + 3] = 255;
    }
    off.getContext('2d')!.putImageData(img!, 0, 0);
    model.dirty = false;
  }

  function fit(): void {
    if (!model || !wrap) return;
    const r = wrap.getBoundingClientRect();
    view.z = Math.min(r.width / model.meta.width, r.height / model.meta.height) * 0.95;
    view.x = (r.width - model.meta.width * view.z) / 2;
    view.y = (r.height - model.meta.height * view.z) / 2;
  }

  function draw(): void {
    raf = requestAnimationFrame(draw);
    if (!model || !canvas) return;
    if (model.dirty) rebuildImage();
    const ctx = canvas.getContext('2d')!;
    const r = wrap.getBoundingClientRect();
    if (canvas.width !== r.width || canvas.height !== r.height) {
      canvas.width = r.width;
      canvas.height = r.height;
    }
    ctx.fillStyle = ink.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = view.z < 1;
    ctx.drawImage(off!, view.x, view.y, model.meta.width * view.z, model.meta.height * view.z);
    const P = (x: number, y: number) => [view.x + (x + 0.5) * view.z, view.y + (y + 0.5) * view.z] as const;
    for (const [x, y] of model.meta.spawnPoints) {
      const [sx, sy] = P(x, y);
      ctx.strokeStyle = ink.spawn;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const d of model.meta.deposits) {
      const [sx, sy] = P(d.x, d.y);
      ctx.fillStyle = ['#000', '#d8d0c0', '#9be564', '#f2d06b', '#9ad0f5'][d.type] ?? '#fff';
      ctx.fillRect(sx - 3, sy - 3, 6, 6);
    }
    ctx.font = '500 12px "IBM Plex Sans"';
    ctx.lineJoin = 'round';
    for (const n of model.meta.nations) {
      const [sx, sy] = P(n.x, n.y);
      ctx.fillStyle = ink.nation;
      ctx.strokeStyle = ink.halo;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx + 5, sy);
      ctx.lineTo(sx, sy + 6);
      ctx.lineTo(sx - 5, sy);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      const label = n.name[i18n.lang] || n.name.en;
      ctx.lineWidth = 3;
      ctx.strokeText(label, sx + 8, sy + 4);
      ctx.fillStyle = ink.text;
      ctx.fillText(label, sx + 8, sy + 4);
    }
  }

  function toMap(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    return [
      Math.floor((e.clientX - r.left - view.x) / view.z),
      Math.floor((e.clientY - r.top - view.y) / view.z),
    ];
  }

  function down(e: PointerEvent): void {
    if (!model) return;
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
    const [x, y] = toMap(e);
    if (['spawn', 'nation', 'deposit', 'erase'].includes(brush)) {
      if (brush === 'nation' && !nationName.trim()) nationName = `Nation ${model.meta.nations.length + 1}`;
      model.addMarker(x, y, brush, depositType, nationName.trim());
      model.dirty = true;
      return;
    }
    painting = true;
    model.paint(x, y, radius, brush, terrainType);
  }
  function move(e: PointerEvent): void {
    if (panning) {
      view.x += e.clientX - panning.x;
      view.y += e.clientY - panning.y;
      panning = { x: e.clientX, y: e.clientY };
      return;
    }
    if (painting && model) {
      const [x, y] = toMap(e);
      model.paint(x, y, radius, brush, terrainType);
    }
  }
  function up(): void {
    painting = false;
    panning = null;
  }
  function wheel(e: WheelEvent): void {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    view.x = mx - (mx - view.x) * f;
    view.y = my - (my - view.y) * f;
    view.z *= f;
  }

  function newMap(w: number, h: number): void {
    model = EditorModel.blank(w, h, name);
    setTimeout(fit, 0);
  }
  async function openBuiltin(id: string): Promise<void> {
    const [meta, tp, ep] = await Promise.all([
      fetch(`${mapsBase()}${id}.json`).then((r) => r.json() as Promise<MapMeta>),
      fetch(`${mapsBase()}${id}.png`).then((r) => r.arrayBuffer()),
      fetch(`${mapsBase()}${id}.elev.png`).then((r) => r.arrayBuffer()),
    ]);
    model = EditorModel.fromPngs(meta, new Uint8Array(tp), new Uint8Array(ep));
    name = `${meta.name[i18n.lang]} (custom)`;
    model.meta.name = { fr: name, en: name };
    setTimeout(fit, 0);
  }
  async function importFile(): Promise<void> {
    const f = await bridge.storage.importFile('Map', ['isomap', 'png']);
    if (!f) return;
    try {
      if (f.name.endsWith('.png')) model = EditorModel.fromImage(f.data, f.name.replace(/\.png$/, ''));
      else model = EditorModel.fromIsoMap(new TextDecoder().decode(f.data));
      name = model.meta.name[i18n.lang] || model.meta.name.en;
      setTimeout(fit, 0);
    } catch (e) {
      toast(`${t('editor.importFailed')}: ${String(e)}`, 'warn');
    }
  }
  function sync(): void {
    if (model) model.meta.name = { fr: name, en: name };
  }
  async function save(): Promise<void> {
    if (!model) return;
    sync();
    errors = model.validate();
    if (errors.length) return;
    const file = `${name.replace(/[^\w -]/g, '_')}.isomap`;
    const ok = await bridge.storage.write('maps', file, model.toIsoMap());
    toast(ok ? t('editor.saved') : t('editor.saveFailed'), ok ? 'good' : 'warn');
  }
  async function exportMap(): Promise<void> {
    if (!model) return;
    sync();
    await bridge.storage.exportFile(`${name}.isomap`, model.toIsoMap(), 'Isoline map', 'isomap');
  }
  function test(): void {
    if (!model) return;
    sync();
    errors = model.validate();
    if (errors.length) return;
    const text = model.toIsoMap();
    const cfg = {
      ...defaultConfig((Math.random() * 1e9) >>> 0),
      mapId: model.meta.id,
      nations: Math.min(20, model.meta.nations.length),
      tribes: 20,
      players: [{ slot: 0, name: playerName(), kind: 'human' as const, team: 1, general: 'blitz' as const }],
    };
    startSolo(cfg, text);
  }

  onMount(async () => {
    try {
      builtins = await fetch(`${mapsBase()}index.json`).then((r) => r.json());
    } catch {
      builtins = [];
    }
    readInks();
    draw();
    void readText;
  });
  onDestroy(() => cancelAnimationFrame(raf));

  const brushes: Brush[] = ['terrain', 'raise', 'lower', 'smooth', 'spawn', 'nation', 'deposit', 'erase'];
</script>

<div class="editor" data-testid="editor">
  <PageHeader wide title={t('title.editor')}>
    {#snippet dateline()}
      <label class="mapname"
        ><span class="sr-only">{t('editor.mapName')}</span><Icon name="edit" size={14} /><input
          type="text"
          bind:value={name}
          onchange={sync}
        /></label
      >
      <div class="acts">
        <button class="btn small" onclick={importFile}
          ><Icon name="upload" size={14} />{t('editor.import')}</button
        >
        <button class="btn small" onclick={exportMap} disabled={!model}
          ><Icon name="download" size={14} />{t('editor.export')}</button
        >
        <button class="btn small" onclick={save} disabled={!model} data-testid="editor-save"
          ><Icon name="save" size={14} />{t('editor.save')}</button
        >
        <button class="btn small primary" onclick={test} disabled={!model} data-testid="editor-test"
          ><Icon name="play" size={14} />{t('editor.test')}</button
        >
      </div>
    {/snippet}
  </PageHeader>
  <div class="main">
    <aside class="tools scroll">
      {#if !model}
        <h3>{t('editor.new')}</h3>
        <p class="muted">{t('editor.newHint')}</p>
        <div class="sizes">
          <button class="size" onclick={() => newMap(800, 500)} data-testid="editor-new"
            ><b class="mono">800 × 500</b><small>{t('gen.small')}</small></button
          >
          <button class="size" onclick={() => newMap(1200, 800)}
            ><b class="mono">1200 × 800</b><small>{t('gen.medium')}</small></button
          >
          <button class="size" onclick={() => newMap(2000, 1000)}
            ><b class="mono">2000 × 1000</b><small>{t('gen.huge')}</small></button
          >
        </div>
        <h3>{t('editor.fromMap')}</h3>
        <select onchange={(e) => openBuiltin((e.target as HTMLSelectElement).value)}>
          <option value="">{t('editor.pickMap')}</option>
          {#each builtins as b (b.id)}<option value={b.id}>{b.name[i18n.lang]}</option>{/each}
        </select>
      {:else}
        <h3>{t('editor.brush')}</h3>
        <div class="brushes">
          {#each brushes as b (b)}
            <button
              class="brush"
              class:on={brush === b}
              aria-pressed={brush === b}
              onclick={() => (brush = b)}>{t(`editor.b.${b}`)}</button
            >
          {/each}
        </div>
        {#if brush === 'terrain'}
          <div class="swatches">
            {#each TERRAIN as tr, k (tr.key)}
              <button
                class="sw"
                class:on={terrainType === k}
                style="background: rgb({EDITOR_COLORS[k]!.join(',')})"
                title={t(`terrain.${tr.key}`)}
                aria-label={t(`terrain.${tr.key}`)}
                onclick={() => (terrainType = k)}
              ></button>
            {/each}
          </div>
          <p class="muted">{t(`terrain.${TERRAIN[terrainType]!.key}`)}</p>
        {/if}
        {#if brush === 'deposit'}
          <select bind:value={depositType}>
            {#each [1, 2, 3, 4] as r (r)}<option value={r}>{t(`resource.${RESOURCE_KEYS[r]}`)}</option>{/each}
          </select>
        {/if}
        {#if brush === 'nation'}<input
            type="text"
            placeholder={t('editor.nationName')}
            bind:value={nationName}
          />{/if}
        {#if ['terrain', 'raise', 'lower', 'smooth'].includes(brush)}
          <label class="rad"
            ><span>{t('editor.size')} <b class="mono">{radius}</b></span><input
              type="range"
              min="1"
              max="60"
              bind:value={radius}
              use:rangeFill={radius}
            /></label
          >
        {/if}
        <div class="tool-acts">
          <button class="btn" onclick={() => model?.autoMarkers()}
            ><Icon name="sparkles" size={15} />{t('editor.auto')}</button
          >
          <button class="btn" onclick={fit}><Icon name="expand" size={15} />{t('editor.fit')}</button>
        </div>
        <dl class="facts">
          <dt>{t('gen.size')}</dt>
          <dd class="mono">{model.meta.width} × {model.meta.height}</dd>
          <dt>{t('editor.spawns')}</dt>
          <dd class="mono">{model.meta.spawnPoints.length}</dd>
          <dt>{t('lobby.nations')}</dt>
          <dd class="mono">{model.meta.nations.length}</dd>
          <dt>{t('editor.deposits')}</dt>
          <dd class="mono">{model.meta.deposits.length}</dd>
        </dl>
        <p class="muted">{t('editor.hint')}</p>
        {#each errors as er (er)}<p class="err"><Icon name="warning" size={14} />{t(er)}</p>{/each}
      {/if}
    </aside>
    <div class="view" bind:this={wrap}>
      <canvas
        bind:this={canvas}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointerleave={up}
        onwheel={wheel}
        oncontextmenu={(e) => e.preventDefault()}
      ></canvas>
      {#if !model}
        <div class="empty">
          <div class="motif">
            <Isolines mode="static" cx={0.46} cy={0.46} count={6} r0={9} step={8} seed={4} indexEvery={5} />
          </div>
          <p>{t('editor.empty')}</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 14px;
    padding: 22px var(--page-pad, 32px) 22px;
    background: var(--abyss);
  }
  /* The dateline carries the map's name and the tools. */
  .mapname {
    flex: 1;
    min-width: 180px;
    max-width: 380px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--np-ink-2);
  }
  .mapname input {
    flex: 1;
    min-width: 0;
    padding: 0.25em 0.5em;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.1em;
    background-color: transparent;
    border-color: transparent;
  }
  .mapname input:hover,
  .mapname input:focus {
    background-color: var(--np-card);
  }
  .acts {
    margin-left: auto;
    display: flex;
    gap: 6px;
  }
  /* The tools' column, then the plate, a fine rule between. */
  .main {
    display: grid;
    grid-template-columns: 270px 1fr;
    min-height: 0;
  }
  .tools {
    padding: 2px 20px 12px 0;
    margin-right: 20px;
    display: grid;
    gap: 12px;
    align-content: start;
    border-right: 1px solid var(--np-rule);
  }
  /* Section heads: a title on a rule. */
  .tools h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.05em;
  }
  .tools h3::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--np-rule);
  }
  /* The sizes, as a legend: the figure, then its word; a fine rule between. */
  .sizes {
    display: grid;
    border-top: 1px solid var(--np-ink);
  }
  .size {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 9px 8px;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--np-rule);
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    transition: background 0.14s;
  }
  .size b {
    font-weight: 600;
  }
  .size:hover,
  .size:focus-visible {
    background: var(--np-card);
  }
  .size small {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  /* Brushes: words in fine boxes, the chosen one in solid ink. */
  .brushes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .brush {
    padding: 4px 9px;
    border-radius: 2px;
    border: 1px solid var(--np-rule-2);
    background: none;
    color: var(--np-ink-2);
    font-size: 0.88em;
    font-weight: 500;
    cursor: var(--cursor-pointer, pointer);
    transition:
      border-color 0.14s,
      color 0.14s,
      background 0.14s;
  }
  .brush:hover {
    color: var(--np-ink);
    border-color: var(--np-ink);
  }
  .brush.on {
    color: var(--np-paper);
    border-color: var(--np-ink);
    background: var(--np-ink);
    font-weight: 600;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 5px;
  }
  .sw {
    aspect-ratio: 1;
    border-radius: 2px;
    border: 2px solid transparent;
    box-shadow: inset 0 0 0 1px rgba(23, 42, 60, 0.18);
    cursor: var(--cursor-pointer, pointer);
    transition: transform 0.14s;
  }
  .sw:hover {
    transform: scale(1.08);
  }
  .sw.on {
    border-color: var(--np-ink);
  }
  .rad {
    display: grid;
    gap: 4px;
  }
  .rad span {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
  }
  .rad b {
    color: var(--np-ink);
  }
  .tool-acts {
    display: grid;
    gap: 6px;
  }
  .tool-acts .btn {
    justify-content: flex-start;
  }
  .facts {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 12px;
    padding: 8px 0;
    border-top: 2px solid var(--np-ink);
    border-bottom: 1px solid var(--np-rule);
    font-size: 0.9em;
  }
  .facts dt {
    color: var(--np-ink-2);
  }
  .facts dd {
    margin: 0;
    text-align: right;
    font-weight: 500;
  }
  /* The plate: the map being drawn, in an ink frame. */
  .view {
    position: relative;
    border: 1px solid var(--np-ink);
    overflow: hidden;
    background: var(--np-paper-2);
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: crosshair;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.05em;
    color: var(--np-ink-2);
    pointer-events: none;
  }
  .empty p {
    margin: 0;
  }
  .motif {
    position: relative;
    width: 140px;
    height: 140px;
    color: var(--np-sea);
  }
  .muted {
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.84em;
    margin: 0;
    line-height: 1.45;
  }
  .err {
    display: flex;
    gap: 6px;
    align-items: baseline;
    color: var(--np-spot);
    font-size: 0.88em;
    margin: 0;
  }
</style>
