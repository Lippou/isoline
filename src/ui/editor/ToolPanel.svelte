<script lang="ts">
  // The chosen tool's settings: brush size, fill tolerance, relief, markers; the terrain
  // palette for the tools that paint; the selected marker.
  import { ed, TOOLS, touched } from './editorSession.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { rangeFill } from '../components/rangeFill';
  import { RESOURCE_KEYS, TERRAIN } from '../../core/map/terrain';
  import TerrainPalette from './TerrainPalette.svelte';
  import EdIcon from './EdIcon.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { FillTolerance } from './raster';
  import type { MarkerKind } from './editorModel';
  import { keyLabel } from './keys';

  const def = $derived(TOOLS.find((d) => d.id === ed.tool)!);
  const TOLS: FillTolerance[] = ['same', 'family', 'medium'];
  const RELIEFS = ['raise', 'lower', 'smooth'] as const;
  const KINDS: { id: MarkerKind; icon: 'markers' | 'spawn' | 'deposit' }[] = [
    { id: 'nation', icon: 'markers' },
    { id: 'spawn', icon: 'spawn' },
    { id: 'deposit', icon: 'deposit' },
  ];

  // The selected marker, read again whenever the model changes.
  const sel = $derived.by(() => {
    void ed.rev;
    const m = ed.model;
    const s = ed.selected;
    if (!m || !s) return null;
    const pos = m.markerPos(s);
    if (!pos) return null;
    const terrain = m.terrainAt(pos[0], pos[1]);
    return {
      ...s,
      pos,
      terrain: terrain >= 0 ? TERRAIN[terrain]!.key : '',
      where: m.spawnable(pos[0], pos[1]),
      name: s.kind === 'nation' ? (m.meta.nations[s.index]?.name.fr ?? '') : '',
      type: s.kind === 'deposit' ? (m.meta.deposits[s.index]?.type ?? 1) : 0,
    };
  });

  function rename(v: string): void {
    if (!ed.model || !ed.selected || ed.selected.kind !== 'nation') return;
    ed.model.renameNation(ed.selected.index, v.trim());
    touched();
  }
  function remove(): void {
    if (!ed.model || !ed.selected) return;
    ed.model.removeMarker(ed.selected);
    ed.selected = null;
    touched();
  }
</script>

<section class="tool">
  <h3 class="np-rule">
    <EdIcon name={def.id} size={16} />{t(`editor.tool.${def.id}`)}<kbd>{keyLabel(def.key)}</kbd>
  </h3>
  <p class="hint">{t(`editor.toolHint.${def.id}`)}</p>

  {#if def.sized}
    <label class="slider"
      ><span>{t('editor.brushSize')} <b class="mono">{ed.size}</b></span><input
        type="range"
        min="1"
        max="80"
        bind:value={ed.size}
        use:rangeFill={ed.size}
        data-testid="editor-size"
      /></label
    >
    <p class="fine">{t('editor.sizeKeys')}</p>
  {/if}

  {#if ed.tool === 'fill'}
    <div class="choice" role="radiogroup" aria-label={t('editor.tolerance')}>
      <span class="lbl">{t('editor.tolerance')}</span>
      {#each TOLS as k (k)}
        <button
          role="radio"
          aria-checked={ed.tolerance === k}
          class:on={ed.tolerance === k}
          onclick={() => (ed.tolerance = k)}
          ><span class="dot" aria-hidden="true"></span><span
            ><b>{t(`editor.tol.${k}`)}</b><small>{t(`editor.tolHint.${k}`)}</small></span
          ></button
        >
      {/each}
    </div>
  {/if}

  {#if ed.tool === 'relief'}
    <div class="choice row3" role="radiogroup" aria-label={t('editor.tool.relief')}>
      {#each RELIEFS as k (k)}
        <button
          role="radio"
          aria-checked={ed.relief === k}
          class:on={ed.relief === k}
          onclick={() => (ed.relief = k)}
          ><span class="dot" aria-hidden="true"></span><b>{t(`editor.relief.${k}`)}</b></button
        >
      {/each}
    </div>
    <label class="slider"
      ><span>{t('editor.strength')} <b class="mono">{ed.strength}</b></span><input
        type="range"
        min="1"
        max="24"
        bind:value={ed.strength}
        use:rangeFill={ed.strength}
      /></label
    >
  {/if}

  {#if ed.tool === 'markers'}
    <div class="choice" role="radiogroup" aria-label={t('editor.markerKind')}>
      {#each KINDS as k (k.id)}
        <button
          role="radio"
          aria-checked={ed.markerKind === k.id}
          class:on={ed.markerKind === k.id}
          onclick={() => (ed.markerKind = k.id)}
          data-testid="marker-{k.id}"
          ><EdIcon name={k.icon} size={15} /><b>{t(`editor.kind.${k.id}`)}</b></button
        >
      {/each}
    </div>
    {#if ed.markerKind === 'deposit'}
      <label class="field"
        >{t('editor.depositType')}<select bind:value={ed.depositType}>
          {#each [1, 2, 3, 4] as r (r)}<option value={r}>{t(`resource.${RESOURCE_KEYS[r]}`)}</option>{/each}
        </select></label
      >
    {/if}
    {#if sel}
      <div class="np-box inspector" data-testid="marker-inspector">
        <h4>
          <EdIcon name={sel.kind === 'nation' ? 'markers' : sel.kind} size={14} />{t(
            `editor.kind.${sel.kind}`,
          )}
        </h4>
        {#if sel.kind === 'nation'}
          <label class="field"
            >{t('editor.nationName')}<input
              type="text"
              value={sel.name}
              maxlength="40"
              onchange={(e) => rename((e.currentTarget as HTMLInputElement).value)}
              data-testid="nation-name"
            /></label
          >
        {/if}
        <dl class="np-figures">
          <dt>{t('editor.position')}</dt>
          <dd class="mono">{sel.pos[0]}, {sel.pos[1]}</dd>
          <dt>{t('editor.terrain')}</dt>
          <dd>{sel.terrain ? t(`terrain.${sel.terrain}`) : '—'}</dd>
        </dl>
        {#if sel.kind !== 'deposit'}
          <p class="status" class:bad={sel.where !== 'ok'}>
            <EdIcon name={sel.where === 'ok' ? 'ok' : sel.where === 'islet' ? 'warn' : 'error'} size={15} />
            {t(`editor.where.${sel.where}`)}
          </p>
        {/if}
        <button class="np-btn" onclick={remove} data-testid="marker-delete"
          ><Icon name="trash" size={14} />{t('common.delete')} <kbd>{t('editor.key.delete')}</kbd></button
        >
      </div>
    {/if}
  {/if}

  {#if def.paints}
    <TerrainPalette />
  {:else if ed.tool === 'eraser'}
    <p class="fine">{t('editor.eraserPaints', { terrain: t('terrain.deepOcean') })}</p>
  {/if}
</section>

<style>
  .tool {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  h3 {
    margin: 0;
  }
  h3 kbd {
    order: 3;
  }
  .hint {
    margin: -4px 0 0;
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.45;
    color: var(--np-ink-2);
  }
  .fine {
    margin: -4px 0 0;
    font-size: 0.76em;
    color: var(--np-ink-3);
  }
  kbd {
    display: inline-block;
    min-width: 1.5em;
    padding: 0 0.35em;
    border: 1px solid var(--np-rule-2);
    border-bottom-width: 2px;
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 0.78em;
    font-weight: 500;
    line-height: 1.5;
    text-align: center;
    color: var(--np-ink-2);
    background: var(--np-card);
  }
  .slider,
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .slider span {
    display: flex;
    justify-content: space-between;
    font-weight: 600;
    color: var(--np-ink);
  }
  .field select,
  .field input {
    width: 100%;
  }
  .choice {
    display: grid;
    gap: 3px;
  }
  .choice.row3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .lbl {
    font-size: 0.86em;
    font-weight: 600;
  }
  .choice button {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 5px 7px;
    border: 1px solid var(--np-rule-2);
    border-radius: 2px;
    background: none;
    color: var(--np-ink-2);
    font-size: 0.84em;
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .choice.row3 button {
    justify-content: center;
    padding: 5px 4px;
  }
  .choice button:hover {
    border-color: var(--np-ink);
    color: var(--np-ink);
  }
  .choice button.on {
    border-color: var(--np-ink);
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .choice b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .choice small {
    display: block;
    font-size: 0.86em;
    opacity: 0.85;
  }
  /* A radio's state printed as a shape too: a hollow ring, a filled one when chosen. */
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
  }
  .on .dot {
    background: currentColor;
    box-shadow: inset 0 0 0 1.5px var(--np-ink);
  }
  .row3 .dot {
    display: none;
  }
  .inspector {
    display: grid;
    gap: 8px;
    background: var(--np-card);
  }
  .inspector h4 {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 0;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.95em;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 0.84em;
    color: var(--np-good);
  }
  .status.bad {
    color: var(--np-spot);
  }
  .inspector .np-btn {
    justify-self: start;
  }
</style>
