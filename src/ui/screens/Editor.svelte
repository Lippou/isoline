<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { go } from '../stores/app.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { bridge, mapsBase, readText } from '../bridge';
  import { EditorModel, EDITOR_COLORS, type Brush } from '../editor/editorModel';
  import { TERRAIN, RESOURCE_KEYS, IS_LAND } from '../../core/map/terrain';
  import type { MapMeta } from '../../core/map/gamemap';
  import { toast } from '../stores/game.svelte';
  import { startSolo, playerName } from './launch';
  import { defaultConfig } from '../../core/game/config';

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
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = view.z < 1;
    ctx.drawImage(off!, view.x, view.y, model.meta.width * view.z, model.meta.height * view.z);
    const P = (x: number, y: number) => [view.x + (x + 0.5) * view.z, view.y + (y + 0.5) * view.z] as const;
    for (const [x, y] of model.meta.spawnPoints) {
      const [sx, sy] = P(x, y);
      ctx.strokeStyle = '#4fe3c1';
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const d of model.meta.deposits) {
      const [sx, sy] = P(d.x, d.y);
      ctx.fillStyle = ['#000', '#d8d0c0', '#9be564', '#f2d06b', '#9ad0f5'][d.type] ?? '#fff';
      ctx.fillRect(sx - 3, sy - 3, 6, 6);
    }
    ctx.font = '12px "IBM Plex Sans"';
    for (const n of model.meta.nations) {
      const [sx, sy] = P(n.x, n.y);
      ctx.fillStyle = '#f2b84b';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 6);
      ctx.lineTo(sx + 5, sy);
      ctx.lineTo(sx, sy + 6);
      ctx.lineTo(sx - 5, sy);
      ctx.fill();
      ctx.fillStyle = '#eae6da';
      ctx.fillText(n.name[i18n.lang] || n.name.en, sx + 8, sy + 4);
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
    draw();
    void readText;
  });
  onDestroy(() => cancelAnimationFrame(raf));

  const brushes: Brush[] = ['terrain', 'raise', 'lower', 'smooth', 'spawn', 'nation', 'deposit', 'erase'];
</script>

<div class="editor" data-testid="editor">
  <header>
    <button class="btn ghost" onclick={() => go('title')}
      ><Icon name="back" size={16} />{t('common.back')}</button
    >
    <h1>{t('title.editor')}</h1>
    <input type="text" bind:value={name} onchange={sync} />
    <button class="btn" onclick={importFile}>{t('editor.import')}</button>
    <button class="btn" onclick={exportMap} disabled={!model}>{t('editor.export')}</button>
    <button class="btn" onclick={save} disabled={!model} data-testid="editor-save">{t('editor.save')}</button>
    <button class="btn primary" onclick={test} disabled={!model} data-testid="editor-test"
      >{t('editor.test')}</button
    >
  </header>
  <div class="main">
    <aside class="tools glass scroll">
      {#if !model}
        <h3>{t('editor.new')}</h3>
        <button class="btn" onclick={() => newMap(800, 500)} data-testid="editor-new">800 × 500</button>
        <button class="btn" onclick={() => newMap(1200, 800)}>1200 × 800</button>
        <button class="btn" onclick={() => newMap(2000, 1000)}>2000 × 1000</button>
        <h3>{t('editor.fromMap')}</h3>
        <select onchange={(e) => openBuiltin((e.target as HTMLSelectElement).value)}>
          <option value="">—</option>
          {#each builtins as b (b.id)}<option value={b.id}>{b.name[i18n.lang]}</option>{/each}
        </select>
      {:else}
        <h3>{t('editor.brush')}</h3>
        <div class="brushes">
          {#each brushes as b (b)}
            <button class="chip" class:on={brush === b} onclick={() => (brush = b)}
              >{t(`editor.b.${b}`)}</button
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
          <label>{t('editor.size')} {radius}<input type="range" min="1" max="60" bind:value={radius} /></label
          >
        {/if}
        <button class="btn" onclick={() => model?.autoMarkers()}>{t('editor.auto')}</button>
        <button class="btn" onclick={fit}>{t('editor.fit')}</button>
        <p class="muted">
          {model.meta.width}×{model.meta.height} · {model.meta.spawnPoints.length} spawns · {model.meta
            .nations.length} nations · {model.meta.deposits.length}
          {t('editor.depositsShort')}
        </p>
        <p class="muted">{t('editor.hint')}</p>
        {#each errors as er (er)}<p class="err">{t(er)}</p>{/each}
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
      {#if !model}<p class="empty">{t('editor.empty')}</p>{/if}
    </div>
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 0.8rem;
    padding: 1rem 1.4rem;
    background: var(--abyss);
  }
  header {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  header h1 {
    margin-right: auto;
  }
  .main {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: 0.8rem;
    min-height: 0;
  }
  .tools {
    padding: 0.9rem;
    display: grid;
    gap: 0.6rem;
    align-content: start;
  }
  .brushes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .chip {
    background: none;
    cursor: pointer;
  }
  .chip.on {
    color: var(--aurora);
    border-color: var(--aurora);
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .sw {
    aspect-ratio: 1;
    border-radius: 6px;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .sw.on {
    border-color: var(--parchment);
  }
  .view {
    position: relative;
    border: 1px solid var(--line);
    border-radius: 12px;
    overflow: hidden;
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
    place-items: center;
    color: var(--faint);
    pointer-events: none;
  }
  .muted {
    color: var(--faint);
    font-size: 0.82em;
    margin: 0;
  }
  .err {
    color: var(--signal);
    font-size: 0.85em;
    margin: 0;
  }
  label {
    display: grid;
    gap: 0.2rem;
    color: var(--muted);
  }
</style>
