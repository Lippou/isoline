<script lang="ts">
  // Where a map starts: a blank sheet of a chosen size, a map of the game, a procedural
  // world, or one of the player's own maps. The editor's first page, and a dialog later
  // (« Changer de carte »): the map being edited can always be swapped for another.
  import { onMount } from 'svelte';
  import { t, i18n, date } from '../i18n/i18n.svelte';
  import { bridge, mapsBase, readText } from '../bridge';
  import { EditorModel, MIN_SIZE, MAX_SIZE, type BlankFill } from './editorModel';
  import { parseIsoMap } from '../../core/map/format';
  import type { MapMeta } from '../../core/map/gamemap';
  import { defaultGenParams } from '../../core/map/generator';
  import { confirmModal } from '../stores/app.svelte';
  import { toast } from '../stores/game.svelte';
  import EdIcon from './EdIcon.svelte';
  import Icon from '../icons/Icon.svelte';
  import { rangeFill } from '../components/rangeFill';

  let {
    overlay = false,
    onclose,
    onopen,
  }: {
    overlay?: boolean;
    onclose?: () => void;
    /** A model is ready; `fileName` when it is one of the player's maps. */
    onopen: (m: EditorModel, fileName?: string) => void;
  } = $props();

  type Tab = 'blank' | 'shipped' | 'procedural' | 'mine';
  let tab: Tab = $state('blank');
  let busy = $state('');

  // ---- blank
  const PRESETS = [
    { w: 800, h: 500, k: 'gen.small' },
    { w: 1200, h: 800, k: 'gen.medium' },
    { w: 2000, h: 1000, k: 'gen.huge' },
    { w: 3200, h: 1612, k: 'editor.giant' },
  ];
  let bw = $state(800);
  let bh = $state(500);
  let fill: BlankFill = $state('island');
  const FILLS: { id: BlankFill; icon: 'deepOcean' | 'plains' | 'hills' }[] = [
    { id: 'ocean', icon: 'deepOcean' },
    { id: 'island', icon: 'hills' },
    { id: 'land', icon: 'plains' },
  ];

  // ---- shipped
  interface Shipped {
    id: string;
    name: { fr: string; en: string };
    width: number;
    height: number;
    category: string;
  }
  let shipped: Shipped[] = $state([]);
  let query = $state('');
  const shown = $derived(
    shipped.filter(
      (m) => !query.trim() || m.name[i18n.lang].toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );

  // ---- procedural
  let gen = $state({
    seed: (Math.random() * 1e6) >>> 0,
    size: 1,
    land: 0.42,
    islands: 0.35,
    mountains: 0.5,
    rivers: 0.5,
  });

  // ---- mine
  interface Mine {
    file: string;
    name: string;
    width: number;
    height: number;
    mtime: number;
  }
  let mine: Mine[] = $state([]);
  let mineLoaded = $state(false);

  async function loadMine(): Promise<void> {
    const out: Mine[] = [];
    for (const f of await bridge.storage.list('maps')) {
      if (!f.name.endsWith('.isomap')) continue;
      const text = await readText('maps', f.name);
      if (!text) continue;
      try {
        // (Only the metadata: the file's JSON head, the images stay encoded.)
        const meta = (JSON.parse(text) as { meta: MapMeta }).meta;
        out.push({
          file: f.name,
          name: meta.name[i18n.lang] || meta.name.en,
          width: meta.width,
          height: meta.height,
          mtime: f.mtime,
        });
      } catch {
        /* a broken file is skipped */
      }
    }
    mine = out.sort((a, b) => b.mtime - a.mtime);
    mineLoaded = true;
  }

  onMount(async () => {
    try {
      shipped = (await fetch(`${mapsBase()}index.json`).then((r) => r.json())) as Shipped[];
    } catch {
      shipped = [];
    }
    await loadMine();
  });

  /** Runs a slow load after the "loading" line has had a frame to show. */
  async function run(label: string, f: () => Promise<void> | void): Promise<void> {
    busy = label;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    try {
      await f();
    } catch (e) {
      toast(`${t('editor.importFailed')}: ${String(e)}`, 'warn');
    } finally {
      busy = '';
    }
  }

  function createBlank(w = bw, h = bh): void {
    void run(t('editor.creating'), () => onopen(EditorModel.blank(w, h, t('editor.untitled'), fill)));
  }

  function openShipped(m: Shipped): void {
    void run(t('editor.loadingMap', { name: m.name[i18n.lang] }), async () => {
      const [meta, tp, ep] = await Promise.all([
        fetch(`${mapsBase()}${m.id}.json`).then((r) => r.json() as Promise<MapMeta>),
        fetch(`${mapsBase()}${m.id}.png`).then((r) => r.arrayBuffer()),
        fetch(`${mapsBase()}${m.id}.elev.png`).then((r) => r.arrayBuffer()),
      ]);
      const name = t('editor.copyOf', { name: meta.name[i18n.lang] });
      onopen(EditorModel.fromPngs(meta, new Uint8Array(tp), new Uint8Array(ep), name));
    });
  }

  const GEN_SIZES = [
    { w: 800, h: 500, k: 'gen.small' },
    { w: 1200, h: 800, k: 'gen.medium' },
    { w: 1600, h: 1000, k: 'gen.large' },
    { w: 2000, h: 1000, k: 'gen.huge' },
  ];
  function generate(): void {
    void run(t('editor.generating'), () => {
      const s = GEN_SIZES[gen.size]!;
      const p = {
        ...defaultGenParams(gen.seed),
        width: s.w,
        height: s.h,
        landRatio: gen.land,
        islands: gen.islands,
        mountains: gen.mountains,
        rivers: gen.rivers,
        nations: 30,
      };
      onopen(EditorModel.procedural(p, t('editor.procName', { seed: gen.seed })));
    });
  }

  function openMine(f: Mine): void {
    void run(t('editor.loadingMap', { name: f.name }), async () => {
      const text = await readText('maps', f.file);
      if (!text) throw new Error(f.file);
      parseIsoMap(text);
      onopen(EditorModel.fromIsoMap(text), f.file);
    });
  }

  function removeMine(f: Mine): void {
    confirmModal(
      t('editor.deleteTitle'),
      t('editor.deleteBody', { name: f.name }),
      async () => {
        await bridge.storage.remove('maps', f.file);
        await loadMine();
      },
      t('common.delete'),
      t('common.cancel'),
    );
  }

  const TABS: { id: Tab; icon: 'open' | 'dice' | 'deepOcean' | 'plains' }[] = [
    { id: 'blank', icon: 'deepOcean' },
    { id: 'shipped', icon: 'plains' },
    { id: 'procedural', icon: 'dice' },
    { id: 'mine', icon: 'open' },
  ];

  function key(e: KeyboardEvent): void {
    if (overlay && e.key === 'Escape') {
      e.stopPropagation();
      onclose?.();
    }
  }
</script>

<svelte:window onkeydown={key} />

<div class="chooser" class:overlay data-testid="editor-chooser">
  {#if overlay}<button class="scrim" aria-label={t('common.close')} onclick={() => onclose?.()}></button>{/if}
  <div
    class="sheet"
    role={overlay ? 'dialog' : undefined}
    aria-modal={overlay ? 'true' : undefined}
    aria-labelledby="chooser-title"
  >
    <header>
      <h2 id="chooser-title">{overlay ? t('editor.switchTitle') : t('editor.startTitle')}</h2>
      {#if overlay}
        <button class="np-btn quiet close" onclick={() => onclose?.()} aria-label={t('common.close')}
          ><Icon name="close" size={16} /></button
        >
      {/if}
    </header>
    <p class="lede">{overlay ? t('editor.switchLede') : t('editor.startLede')}</p>
    <div class="tabs" role="tablist">
      {#each TABS as tb (tb.id)}
        <button
          role="tab"
          class:on={tab === tb.id}
          aria-selected={tab === tb.id}
          data-testid="chooser-{tb.id}"
          onclick={() => (tab = tb.id)}><EdIcon name={tb.icon} size={15} />{t(`editor.from.${tb.id}`)}</button
        >
      {/each}
    </div>

    <div class="body scroll">
      {#if busy}
        <p class="busy" role="status"><span class="spinner" aria-hidden="true"></span>{busy}</p>
      {:else if tab === 'blank'}
        <div class="blank">
          <section>
            <h3 class="np-rule">{t('editor.size')}</h3>
            <div class="presets">
              {#each PRESETS as p (p.w)}
                <button
                  class="preset"
                  class:on={bw === p.w && bh === p.h}
                  onclick={() => {
                    bw = p.w;
                    bh = p.h;
                  }}><b class="mono">{p.w} × {p.h}</b><small>{t(p.k)}</small></button
                >
              {/each}
            </div>
            <div class="dims">
              <label
                >{t('editor.width')}<input
                  type="number"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  step="10"
                  bind:value={bw}
                /></label
              >
              <span aria-hidden="true">×</span>
              <label
                >{t('editor.height')}<input
                  type="number"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  step="10"
                  bind:value={bh}
                /></label
              >
            </div>
          </section>
          <section>
            <h3 class="np-rule">{t('editor.fill')}</h3>
            <div class="fills" role="radiogroup">
              {#each FILLS as f (f.id)}
                <button
                  class="fillopt"
                  role="radio"
                  aria-checked={fill === f.id}
                  class:on={fill === f.id}
                  onclick={() => (fill = f.id)}
                  ><EdIcon name={f.icon} size={20} /><span>{t(`editor.fills.${f.id}`)}</span></button
                >
              {/each}
            </div>
          </section>
          <div class="go">
            <button class="np-btn ink" data-testid="editor-new" onclick={() => createBlank()}
              ><Icon name="plus" size={15} />{t('editor.createBlank', { w: bw, h: bh })}</button
            >
          </div>
        </div>
      {:else if tab === 'shipped'}
        <label class="search"
          ><Icon name="search" size={14} /><input
            type="search"
            placeholder={t('editor.searchMap')}
            bind:value={query}
          /></label
        >
        <div class="grid">
          {#each shown as m (m.id)}
            <button class="card" onclick={() => openShipped(m)} data-testid="shipped-{m.id}">
              <img src="{mapsBase()}{m.id}.thumb.png" alt="" loading="lazy" />
              <span class="nm">{m.name[i18n.lang]}</span>
              <small class="mono">{m.width} × {m.height}</small>
            </button>
          {/each}
        </div>
      {:else if tab === 'procedural'}
        <div class="proc">
          <label class="row"
            ><span>{t('gen.seed')}</span>
            <span class="seed"
              ><input type="number" bind:value={gen.seed} /><button
                class="np-btn quiet"
                aria-label={t('gen.reroll')}
                title={t('gen.reroll')}
                onclick={() => (gen.seed = (Math.random() * 1e6) >>> 0)}
                ><EdIcon name="dice" size={16} /></button
              ></span
            ></label
          >
          <label class="row"
            ><span>{t('editor.size')}</span><select bind:value={gen.size}>
              {#each GEN_SIZES as s, k (k)}<option value={k}>{t(s.k)} · {s.w} × {s.h}</option>{/each}
            </select></label
          >
          {#each [['land', 0.15, 0.8], ['islands', 0, 1], ['mountains', 0, 1], ['rivers', 0, 1]] as const as [k, lo, hi] (k)}
            <label class="row slider"
              ><span>{t(`gen.${k}`)} <b class="mono">{Math.round(gen[k] * 100)} %</b></span><input
                type="range"
                min={lo}
                max={hi}
                step="0.01"
                bind:value={gen[k]}
                use:rangeFill={gen[k]}
              /></label
            >
          {/each}
          <div class="go">
            <button class="np-btn ink" onclick={generate} data-testid="editor-generate"
              ><EdIcon name="dice" size={15} />{t('editor.generate')}</button
            >
          </div>
        </div>
      {:else if !mineLoaded}
        <p class="busy"><span class="spinner" aria-hidden="true"></span>{t('editor.loadingList')}</p>
      {:else if !mine.length}
        <p class="empty">{t('editor.noMaps')}</p>
      {:else}
        <ul class="mine">
          {#each mine as f (f.file)}
            <li>
              <button class="open" onclick={() => openMine(f)} data-testid="mine-{f.file}"
                ><span class="nm">{f.name}</span><small class="mono">{f.width} × {f.height}</small><small
                  >{date(f.mtime)}</small
                ></button
              >
              <button
                class="np-btn quiet"
                onclick={() => removeMine(f)}
                title={t('common.delete')}
                aria-label={t('common.delete')}><Icon name="trash" size={15} /></button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .chooser {
    display: grid;
    place-items: center;
    min-height: 0;
    height: 100%;
    padding: 12px 0;
  }
  .chooser.overlay {
    position: fixed;
    inset: 0;
    z-index: 900;
    padding: 24px;
  }
  .scrim {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgba(23, 42, 60, 0.32);
    cursor: default;
  }
  .sheet {
    position: relative;
    width: min(100%, 860px);
    max-height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto auto minmax(0, 1fr);
    padding: 18px 22px 16px;
    background: var(--np-paper);
    border: 1px solid var(--np-ink);
    box-shadow: 4px 4px 0 var(--np-paper-2);
    color: var(--np-ink);
  }
  .overlay .sheet {
    height: min(640px, 100%);
    box-shadow:
      4px 4px 0 var(--np-paper-2),
      0 18px 50px rgba(23, 42, 60, 0.28);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6px;
    border-bottom: 3px solid var(--np-ink);
  }
  h2 {
    margin: 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.55em;
    line-height: 1.1;
  }
  .close {
    padding: 4px 6px;
  }
  .lede {
    margin: 8px 0 10px;
    font-family: var(--np-serif);
    font-style: italic;
    color: var(--np-ink-2);
    font-size: 0.92em;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 18px;
    border-bottom: 1px solid var(--np-rule);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 2px 7px;
    border: 0;
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    background: none;
    font-family: var(--text);
    font-weight: 500;
    font-size: 0.92em;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
  }
  .tabs button:hover,
  .tabs button:focus-visible {
    color: var(--np-ink);
  }
  .tabs button.on {
    color: var(--np-ink);
    font-weight: 600;
    border-bottom-color: var(--np-ink);
  }
  .body {
    min-height: 0;
    padding: 14px 2px 2px;
    overflow-x: hidden;
  }
  .busy,
  .empty {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: center;
    padding: 40px 0;
    font-family: var(--np-serif);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--np-rule);
    border-top-color: var(--np-ink);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Blank sheet */
  .blank {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 14px 24px;
  }
  .presets {
    display: grid;
    border-top: 1px solid var(--np-ink);
  }
  .preset {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 7px 8px;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--np-rule);
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
  }
  .preset small {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .preset:hover,
  .preset:focus-visible {
    background: var(--np-card);
  }
  .preset.on {
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .preset.on small {
    color: var(--np-paper);
  }
  .dims {
    display: flex;
    align-items: end;
    gap: 8px;
    margin-top: 10px;
  }
  .dims label {
    display: grid;
    gap: 3px;
    font-size: 0.82em;
    color: var(--np-ink-2);
    flex: 1;
  }
  .dims input {
    width: 100%;
    font-family: var(--mono, monospace);
  }
  .dims span {
    padding-bottom: 6px;
    color: var(--np-ink-2);
  }
  .fills {
    display: grid;
    gap: 6px;
  }
  .fillopt {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--np-rule-2);
    border-radius: 2px;
    background: none;
    color: var(--np-ink-2);
    text-align: left;
    font-size: 0.9em;
    cursor: var(--cursor-pointer, pointer);
  }
  .fillopt:hover {
    border-color: var(--np-ink);
    color: var(--np-ink);
  }
  .fillopt.on {
    border-color: var(--np-ink);
    background: var(--np-ink);
    color: var(--np-paper);
    font-weight: 600;
  }
  .go {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    padding-top: 6px;
    border-top: 1px solid var(--np-rule);
  }
  /* Shipped maps */
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    color: var(--np-ink-2);
  }
  .search input {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .card {
    display: grid;
    gap: 3px;
    padding: 6px;
    border: 1px solid var(--np-rule);
    background: var(--np-card);
    text-align: left;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    transition: border-color 0.14s;
  }
  .card:hover,
  .card:focus-visible {
    border-color: var(--np-ink);
    box-shadow: 2px 2px 0 var(--np-paper-2);
  }
  .card img {
    width: 100%;
    aspect-ratio: 2 / 1;
    object-fit: cover;
    border: 1px solid var(--np-rule);
    background: var(--np-paper-2);
  }
  .card .nm {
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.95em;
    line-height: 1.2;
  }
  .card small {
    color: var(--np-ink-2);
    font-size: 0.75em;
  }
  /* Procedural */
  .proc {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 24px;
  }
  .row {
    display: grid;
    gap: 4px;
    font-size: 0.88em;
    color: var(--np-ink-2);
  }
  .row span {
    display: flex;
    justify-content: space-between;
  }
  .row b {
    color: var(--np-ink);
  }
  .seed {
    display: flex;
    gap: 6px;
  }
  .seed input {
    flex: 1;
    min-width: 0;
  }
  /* Mine */
  .mine {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--np-ink);
  }
  .mine li {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--np-rule);
  }
  .mine .open {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 14px;
    align-items: baseline;
    padding: 9px 8px;
    background: none;
    border: 0;
    color: var(--np-ink);
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .mine .open:hover,
  .mine .open:focus-visible {
    background: var(--np-card);
  }
  .mine .nm {
    font-family: var(--title);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mine small {
    color: var(--np-ink-2);
  }
  @media (max-width: 760px) {
    .blank,
    .proc {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
