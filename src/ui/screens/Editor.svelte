<script lang="ts">
  // The map editor, printed as a page of the Courier: the tools down the left margin,
  // their settings and the map's sheets (tool, map, nations, check) beside them, the
  // plate filling the rest. The map can be swapped at any time (« Changer de carte »),
  // with a word first when there are unsaved changes.
  import { onDestroy } from 'svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { bridge } from '../bridge';
  import { app, go } from '../stores/app.svelte';
  import { toast } from '../stores/game.svelte';
  import { startSolo, playerName } from './launch';
  import { defaultConfig } from '../../core/game/config';
  import { TERRAIN } from '../../core/map/terrain';
  import { EditorModel, type Issue } from '../editor/editorModel';
  import {
    ed,
    view,
    viewCtl,
    setModel,
    setTool,
    touched,
    TOOLS,
    KEYS,
    type SideTab,
  } from '../editor/editorSession.svelte';
  import { MOD, keyLabel, typing, withKey } from '../editor/keys';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import EdIcon from '../editor/EdIcon.svelte';
  import EditorCanvas from '../editor/EditorCanvas.svelte';
  import MapChooser from '../editor/MapChooser.svelte';
  import ToolPanel from '../editor/ToolPanel.svelte';
  import MapPanel from '../editor/MapPanel.svelte';
  import MarkersPanel from '../editor/MarkersPanel.svelte';
  import CheckPanel from '../editor/CheckPanel.svelte';

  let chooser = $state(false);
  let busy = $state('');
  let issues: Issue[] = $state([]);
  let canvasRef: EditorCanvas | undefined = $state();

  // ---------------------------------------------------------------- the map's name
  let name = $state('');
  $effect(() => {
    void ed.rev;
    const m = ed.model;
    name = m ? m.meta.name[i18n.lang] || m.meta.name.en : '';
  });
  function setName(v: string): void {
    const m = ed.model;
    if (!m) return;
    const n = v.trim() || t('editor.untitled');
    m.meta.name = { fr: n, en: n };
    m.metaEdited = true;
    touched();
  }

  // ---------------------------------------------------------------- live validation
  let vt: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void ed.rev;
    const m = ed.model;
    clearTimeout(vt);
    if (!m) {
      issues = [];
      return;
    }
    vt = setTimeout(() => (issues = m.validate()), 200);
  });
  const errorCount = $derived(issues.filter((i) => i.level === 'error').length);
  const unsaved = $derived.by(() => {
    void ed.rev;
    return !!ed.model?.unsaved;
  });
  const canUndo = $derived.by(() => {
    void ed.rev;
    return !!ed.model?.history.canUndo;
  });
  const canRedo = $derived.by(() => {
    void ed.rev;
    return !!ed.model?.history.canRedo;
  });

  // ---------------------------------------------------------------- dialogs
  /** A yes / no question in the Courier's modal. */
  function ask(title: string, body: string, yes: string): Promise<boolean> {
    return new Promise((resolve) => {
      app.modal = {
        title,
        body,
        actions: [
          { label: t('common.cancel'), kind: 'ghost', run: () => ((app.modal = null), resolve(false)) },
          { label: yes, kind: 'primary', run: () => ((app.modal = null), resolve(true)) },
        ],
      };
    });
  }

  /** Runs `then` once unsaved changes are saved or knowingly dropped. */
  function guard(then: () => void): void {
    const m = ed.model;
    if (!m || !m.unsaved) return then();
    app.modal = {
      title: t('editor.unsavedTitle'),
      body: t('editor.unsavedBody', { name }),
      actions: [
        { label: t('common.cancel'), kind: 'ghost', run: () => (app.modal = null) },
        {
          label: t('editor.discard'),
          kind: 'danger',
          run: () => {
            app.modal = null;
            then();
          },
        },
        {
          label: t('editor.saveFirst'),
          kind: 'primary',
          run: async () => {
            app.modal = null;
            if (await save()) then();
          },
        },
      ],
    };
  }

  function open(m: EditorModel, fileName?: string): void {
    guard(() => {
      if (fileName) {
        m.fileName = fileName;
        m.markSaved();
      }
      view.modelId = '';
      setModel(m);
      chooser = false;
      ed.tab = 'tool';
    });
  }

  function leave(): void {
    guard(() => {
      setModel(null);
      view.modelId = '';
      go('title');
    });
  }

  // ---------------------------------------------------------------- files
  /** Lets the "saving…" line show before the PNG encoding blocks the page. */
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  async function freeFileName(base: string): Promise<string> {
    const stem =
      base
        .replace(/[^\p{L}\p{N} _-]/gu, '_')
        .trim()
        .slice(0, 60) || 'map';
    const taken = new Set((await bridge.storage.list('maps')).map((f) => f.name));
    let file = `${stem}.isomap`;
    for (let k = 2; taken.has(file); k++) file = `${stem}-${k}.isomap`;
    return file;
  }

  async function save(): Promise<boolean> {
    const m = ed.model;
    if (!m || busy) return false;
    const errs = m.validate().filter((i) => i.level === 'error');
    if (errs.length) {
      ed.tab = 'check';
      const go = await ask(
        t('editor.saveAnywayTitle'),
        t('editor.saveAnywayBody', { n: errs.length }),
        t('editor.saveAnyway'),
      );
      if (!go) return false;
    }
    busy = t('editor.saving');
    await nextFrame();
    try {
      const file = m.fileName || (await freeFileName(name));
      const ok = await bridge.storage.write('maps', file, m.toIsoMap());
      if (ok) {
        m.fileName = file;
        m.markSaved();
        touched();
      }
      toast(ok ? t('editor.saved') : t('editor.saveFailed'), ok ? 'good' : 'warn');
      return ok;
    } finally {
      busy = '';
    }
  }

  async function exportMap(): Promise<void> {
    const m = ed.model;
    if (!m) return;
    busy = t('editor.saving');
    await nextFrame();
    try {
      await bridge.storage.exportFile(`${name}.isomap`, m.toIsoMap(), 'Isoline map', 'isomap');
    } finally {
      busy = '';
    }
  }

  async function importFile(): Promise<void> {
    const f = await bridge.storage.importFile('Map', ['isomap', 'png']);
    if (!f) return;
    try {
      const m = f.name.endsWith('.png')
        ? EditorModel.fromImage(f.data, f.name.replace(/\.png$/, ''))
        : EditorModel.fromIsoMap(new TextDecoder().decode(f.data));
      open(m);
    } catch (e) {
      toast(`${t('editor.importFailed')}: ${String(e)}`, 'warn');
    }
  }

  async function test(): Promise<void> {
    const m = ed.model;
    if (!m || busy) return;
    issues = m.validate();
    if (issues.some((i) => i.level === 'error')) {
      ed.tab = 'check';
      toast(t('editor.fixFirst'), 'warn');
      return;
    }
    busy = t('editor.launching');
    await nextFrame();
    const text = m.toIsoMap();
    busy = '';
    const cfg = {
      ...defaultConfig((Math.random() * 1e9) >>> 0),
      mapId: m.meta.id,
      nations: Math.min(20, m.meta.nations.length),
      tribes: Math.min(20, Math.floor(m.meta.spawnPoints.length / 2)),
      players: [{ slot: 0, name: playerName(), kind: 'human' as const, team: 1 }],
    };
    startSolo(cfg, text);
    // Leaving the game comes back here, to the same map, tool and view.
    if (app.launch) app.launch.returnTo = 'editor';
  }

  // ---------------------------------------------------------------- edit
  function undo(): void {
    if (ed.model?.undo()) {
      ed.selected = null;
      touched();
    }
  }
  function redo(): void {
    if (ed.model?.redo()) {
      ed.selected = null;
      touched();
    }
  }

  function keydown(e: KeyboardEvent): void {
    if (app.modal || chooser || !ed.model) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (typing(e) || mod || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      ed.spaceHand = true;
      return;
    }
    if (e.key === 'Escape') {
      canvasRef?.cancel();
      ed.selected = null;
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ed.selected) {
      e.preventDefault();
      ed.model.removeMarker(ed.selected);
      ed.selected = null;
      touched();
      return;
    }
    if (e.key === '+' || e.key === '=') return viewCtl.zoomBy(1.25);
    if (e.key === '-' || e.key === '_') return viewCtl.zoomBy(0.8);
    if (e.key === '[') ed.size = Math.max(1, ed.size - 1);
    else if (e.key === ']') ed.size = Math.min(80, ed.size + 1);
    else if (k === KEYS.grid) ed.grid = !ed.grid;
    else if (k === KEYS.motifs) ed.motifs = !ed.motifs;
    else if (k === KEYS.fit) viewCtl.fit();
    else {
      const def = TOOLS.find((d) => d.key === k);
      if (def) {
        setTool(def.id);
        ed.tab = 'tool';
      }
    }
  }
  function keyup(e: KeyboardEvent): void {
    if (e.key === ' ' && ed.spaceHand) {
      ed.spaceHand = false;
      if (!typing(e)) e.preventDefault();
    }
  }

  onDestroy(() => {
    clearTimeout(vt);
    ed.spaceHand = false;
  });

  // QA hooks (?automation): what a script cannot read from the pixels.
  if (new URLSearchParams(location.search).has('automation'))
    (window as unknown as { __isoEditor: unknown }).__isoEditor = {
      model: () => ed.model,
      /** Client (CSS pixel) position of the centre of tile (x, y). */
      screenOf: (x: number, y: number) => {
        const r = document.querySelector('[data-testid=editor-canvas]')!.getBoundingClientRect();
        return [r.left + view.x + (x + 0.5) * view.z, r.top + view.y + (y + 0.5) * view.z];
      },
      digest: () => {
        const m = ed.model;
        if (!m) return null;
        let hash = 0;
        for (let i = 0; i < m.terrain.length; i++)
          hash = (hash * 31 + m.terrain[i]! * 7 + m.elevation[i]!) >>> 0;
        return {
          name: m.meta.name.fr,
          w: m.width,
          h: m.height,
          hash,
          nations: m.meta.nations.length,
          spawns: m.meta.spawnPoints.length,
          deposits: m.meta.deposits.length,
          file: m.fileName,
          unsaved: m.unsaved,
          undo: m.history.size,
        };
      },
      /** Pieces (8-connected) of each painted terrain: a continuous stroke is one piece. */
      continuity: () => {
        const m = ed.model;
        if (!m) return null;
        const { width: w, height: h } = m;
        const out: Record<string, { tiles: number; pieces: number }> = {};
        const seen = new Uint8Array(w * h);
        for (let s = 0; s < w * h; s++) {
          const tt = m.terrain[s]!;
          if (seen[s] || tt < 4) continue;
          const key = TERRAIN[tt]!.key;
          const o = (out[key] ??= { tiles: 0, pieces: 0 });
          o.pieces++;
          const stack = [s];
          seen[s] = 1;
          while (stack.length) {
            const i = stack.pop()!;
            o.tiles++;
            const x = i % w;
            const y = (i / w) | 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx;
                const yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                const j = yy * w + xx;
                if (seen[j] || m.terrain[j] !== tt) continue;
                seen[j] = 1;
                stack.push(j);
              }
          }
        }
        return out;
      },
    };

  // ---------------------------------------------------------------- status line
  const status = $derived.by(() => {
    void ed.rev;
    const m = ed.model;
    const h = ed.hover;
    if (!m || !h || h.x < 0 || h.y < 0 || h.x >= m.width || h.y >= m.height) return null;
    const tt = m.terrainAt(h.x, h.y);
    return { x: h.x, y: h.y, terrain: TERRAIN[tt]?.key ?? '', alt: m.elevation[h.y * m.width + h.x]! };
  });

  const GROUPS: (typeof TOOLS)[number]['id'][][] = [
    ['brush', 'eraser', 'line', 'rect', 'ellipse', 'fill', 'picker'],
    ['relief', 'markers'],
    ['hand'],
  ];
  const TABS: { id: SideTab; icon: 'brush' | 'open' | 'markers' | 'ok' }[] = [
    { id: 'tool', icon: 'brush' },
    { id: 'map', icon: 'open' },
    { id: 'nations', icon: 'markers' },
    { id: 'check', icon: 'ok' },
  ];
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} onblur={() => (ed.spaceHand = false)} />

<div class="editor" data-testid="editor">
  <PageHeader wide title={t('title.editor')} onback={leave}>
    {#snippet dateline()}
      {#if ed.model}
        <label class="mapname" title={t('editor.mapName')}
          ><span class="sr-only">{t('editor.mapName')}</span><Icon name="edit" size={14} /><input
            type="text"
            value={name}
            maxlength="60"
            onchange={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            data-testid="editor-name"
          /></label
        >
        {#if unsaved}<span class="unsaved" data-testid="editor-unsaved" title={t('editor.unsavedHint')}
            ><span class="star" aria-hidden="true">✱</span>{t('editor.unsaved')}</span
          >{/if}
      {:else}
        <span class="sub">{t('title.editorDesc')}</span>
      {/if}
      <div class="acts">
        {#if busy}<span class="busy" role="status">{busy}</span>{/if}
        {#if ed.model}
          <button
            class="np-btn"
            onclick={() => (chooser = true)}
            data-testid="editor-switch"
            title={t('editor.switchHint')}><EdIcon name="open" size={15} />{t('editor.switch')}</button
          >
        {/if}
        <button class="np-btn" onclick={importFile} title={t('editor.importHint')}
          ><Icon name="upload" size={14} />{t('editor.import')}</button
        >
        {#if ed.model}
          <button class="np-btn" onclick={exportMap}
            ><Icon name="download" size={14} />{t('editor.export')}</button
          >
          <span class="sep" aria-hidden="true"></span>
          <button
            class="np-btn icon"
            onclick={undo}
            disabled={!canUndo}
            title="{t('editor.undo')} ({MOD}+Z)"
            aria-label={t('editor.undo')}
            data-testid="editor-undo"><EdIcon name="undo" size={16} /></button
          >
          <button
            class="np-btn icon"
            onclick={redo}
            disabled={!canRedo}
            title="{t('editor.redo')} ({MOD}+⇧+Z)"
            aria-label={t('editor.redo')}
            data-testid="editor-redo"><EdIcon name="redo" size={16} /></button
          >
          <span class="sep" aria-hidden="true"></span>
          <button
            class="np-btn"
            onclick={save}
            disabled={!!busy}
            data-testid="editor-save"
            title="{t('editor.save')} ({MOD}+S)"><Icon name="save" size={14} />{t('editor.save')}</button
          >
          <button
            class="np-btn ink"
            onclick={test}
            disabled={!!busy}
            data-testid="editor-test"
            title={t('editor.testHint')}><Icon name="play" size={14} />{t('editor.test')}</button
          >
        {/if}
      </div>
    {/snippet}
  </PageHeader>

  {#if !ed.model}
    <MapChooser onopen={open} />
  {:else}
    <div class="work">
      <nav class="rail" aria-label={t('editor.tools')}>
        {#each GROUPS as g, gi (gi)}
          {#if gi}<span class="rule" aria-hidden="true"></span>{/if}
          {#each g as id (id)}
            {@const def = TOOLS.find((d) => d.id === id)!}
            <button
              class="tb"
              class:on={ed.tool === id}
              aria-pressed={ed.tool === id}
              title={withKey(t(`editor.tool.${id}`), def.key)}
              aria-label={t(`editor.tool.${id}`)}
              data-testid="tool-{id}"
              onclick={() => {
                setTool(id);
                ed.tab = 'tool';
              }}><EdIcon name={id} size={19} /><kbd aria-hidden="true">{keyLabel(def.key)}</kbd></button
            >
          {/each}
        {/each}
      </nav>

      <aside class="side">
        <div class="tabs" role="tablist">
          {#each TABS as tb (tb.id)}
            <button
              role="tab"
              class:on={ed.tab === tb.id}
              aria-selected={ed.tab === tb.id}
              data-testid="tab-{tb.id}"
              onclick={() => (ed.tab = tb.id)}
              >{t(`editor.tab.${tb.id}`)}{#if tb.id === 'check' && errorCount}<span
                  class="badge"
                  title={t('editor.errorsBadge', { n: errorCount })}
                  ><EdIcon name="error" size={12} />{errorCount}</span
                >{/if}</button
            >
          {/each}
        </div>
        <div class="sheetbody scroll">
          {#if ed.tab === 'tool'}<ToolPanel />
          {:else if ed.tab === 'map'}<MapPanel onswitch={() => (chooser = true)} />
          {:else if ed.tab === 'nations'}<MarkersPanel />
          {:else}<CheckPanel {issues} />{/if}
        </div>
      </aside>

      <section class="frame" aria-label={t('editor.plate')}>
        <EditorCanvas bind:this={canvasRef} onpicked={() => (ed.tab = 'tool')} />
        <div class="status" aria-live="off">
          {#if status}
            <span class="mono">{status.x}, {status.y}</span>
            <span><EdIcon name={status.terrain as 'plains'} size={13} />{t(`terrain.${status.terrain}`)}</span
            >
            <span class="mono">{t('editor.alt')} {status.alt}</span>
          {:else}
            <span class="hint">{t('editor.viewHint')}</span>
          {/if}
        </div>
        <div class="viewbar" role="toolbar" aria-label={t('editor.viewTools')}>
          <button
            onclick={() => viewCtl.zoomBy(0.8)}
            title="{t('editor.zoomOut')} (−)"
            aria-label={t('editor.zoomOut')}><EdIcon name="zoomOut" size={16} /></button
          >
          <span class="zoom mono" data-testid="editor-zoom"
            >{ed.zoom >= 1 ? ed.zoom.toFixed(ed.zoom < 10 ? 1 : 0) : ed.zoom.toFixed(2)}×</span
          >
          <button
            onclick={() => viewCtl.zoomBy(1.25)}
            title="{t('editor.zoomIn')} (+)"
            aria-label={t('editor.zoomIn')}><EdIcon name="zoomIn" size={16} /></button
          >
          <button
            onclick={() => viewCtl.fit()}
            title={withKey(t('editor.fit'), KEYS.fit)}
            aria-label={t('editor.fit')}
            data-testid="editor-fit"><EdIcon name="fit" size={16} /></button
          >
          <span class="sep" aria-hidden="true"></span>
          <button
            class:on={ed.grid}
            aria-pressed={ed.grid}
            onclick={() => (ed.grid = !ed.grid)}
            title={withKey(t('editor.grid'), KEYS.grid)}
            aria-label={t('editor.grid')}><EdIcon name="grid" size={16} /></button
          >
          <button
            class:on={ed.motifs}
            aria-pressed={ed.motifs}
            onclick={() => (ed.motifs = !ed.motifs)}
            title={withKey(t('editor.motifs'), KEYS.motifs)}
            aria-label={t('editor.motifs')}
            data-testid="editor-motifs"><EdIcon name="motifs" size={16} /></button
          >
        </div>
      </section>
    </div>
  {/if}

  {#if chooser}
    <MapChooser overlay onclose={() => (chooser = false)} onopen={open} />
  {/if}
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 12px;
    padding: 16px clamp(14px, 2vw, 32px) 16px;
    background: var(--abyss);
    min-width: 0;
  }
  /* The dateline: the map's name, then the page's tools. */
  .mapname {
    flex: 1 1 180px;
    min-width: 140px;
    max-width: 340px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--np-ink-2);
  }
  .mapname input {
    flex: 1;
    min-width: 0;
    padding: 0.2em 0.5em;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.08em;
    background-color: transparent;
    border-color: transparent;
  }
  .mapname input:hover,
  .mapname input:focus {
    background-color: var(--np-card);
    border-color: var(--np-rule-2);
  }
  .unsaved {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--np-serif);
    font-style: italic;
    font-size: 0.84em;
    color: var(--np-warn);
    white-space: nowrap;
  }
  .star {
    font-style: normal;
  }
  .sub {
    font-family: var(--np-serif);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .acts {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 5px;
  }
  .acts .np-btn {
    padding: 5px 10px;
  }
  .acts .np-btn.icon {
    padding: 5px 7px;
  }
  .np-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 3px;
    background: var(--np-rule);
  }
  .busy {
    font-family: var(--np-serif);
    font-style: italic;
    font-size: 0.86em;
    color: var(--np-ink-2);
    margin-right: 6px;
  }

  /*
   * The workspace: the tool rail, the sheets, the plate. Every track may shrink
   * (minmax(0, …)), each column scrolls on its own, and the plate is isolated in its own
   * stacking context: nothing of the sidebar can slip under the map any more.
   */
  .work {
    display: grid;
    grid-template-columns: 50px clamp(244px, 21vw, 320px) minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 2px 8px 2px 0;
    border-right: 1px solid var(--np-rule);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    min-height: 0;
  }
  .rail .rule {
    flex: none;
    width: 26px;
    margin: 4px 0;
    border-top: 1px solid var(--np-rule);
  }
  .tb {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 38px;
    height: 36px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
    transition:
      color 0.12s,
      border-color 0.12s,
      background 0.12s;
  }
  .tb:hover,
  .tb:focus-visible {
    border-color: var(--np-rule-2);
    color: var(--np-ink);
    background: var(--np-card);
  }
  .tb.on {
    border-color: var(--np-ink);
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .tb kbd {
    position: absolute;
    right: 1px;
    bottom: 0;
    font-family: var(--mono);
    font-size: 8.5px;
    line-height: 1;
    opacity: 0.75;
  }
  .side {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    min-width: 0;
    padding: 0 14px;
    border-right: 1px solid var(--np-rule);
  }
  .tabs {
    display: flex;
    gap: 2px 12px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--np-ink);
    margin-bottom: 10px;
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 1px 6px;
    margin-bottom: -1px;
    border: 0;
    border-bottom: 3px solid transparent;
    background: none;
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 500;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
  }
  .tabs button:hover {
    color: var(--np-ink);
  }
  .tabs button.on {
    color: var(--np-ink);
    font-weight: 600;
    border-bottom-color: var(--np-ink);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    border-radius: 2px;
    background: var(--np-spot);
    color: var(--np-paper);
    font-size: 0.8em;
    font-weight: 700;
  }
  .sheetbody {
    min-height: 0;
    min-width: 0;
    overflow-x: hidden;
    padding: 0 2px 12px 0;
  }
  .frame {
    position: relative;
    min-width: 0;
    min-height: 0;
    margin-left: 14px;
    border: 1px solid var(--np-ink);
    background: var(--np-paper-2);
    overflow: hidden;
    isolation: isolate;
    contain: strict;
  }
  /* Printed captions over the plate: where the pointer is, and the view's tools. */
  .status,
  .viewbar {
    position: absolute;
    bottom: 8px;
    display: flex;
    align-items: center;
    background: var(--np-card);
    border: 1px solid var(--np-ink);
    box-shadow: 2px 2px 0 rgba(23, 42, 60, 0.12);
    z-index: 1;
  }
  .status {
    left: 8px;
    gap: 12px;
    max-width: calc(100% - 250px);
    padding: 4px 10px;
    font-size: 0.8em;
    color: var(--np-ink);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
  }
  .status span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .status .hint {
    font-family: var(--np-serif);
    font-style: italic;
    color: var(--np-ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .viewbar {
    right: 8px;
    gap: 1px;
    padding: 2px;
  }
  .viewbar button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
  }
  .viewbar button:hover {
    color: var(--np-ink);
    border-color: var(--np-rule-2);
  }
  .viewbar button.on {
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .viewbar .zoom {
    min-width: 46px;
    text-align: center;
    font-size: 0.78em;
    color: var(--np-ink);
  }
  .viewbar .sep {
    height: 18px;
    align-self: center;
  }
</style>
