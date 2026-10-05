<script lang="ts">
  // Every terrain, by family, each with its colour, its glyph and its name: the choice
  // never rests on colour alone.
  import { T, TERRAIN } from '../../core/map/terrain';
  import { EDITOR_COLORS } from './editorModel';
  import { ed, setTool } from './editorSession.svelte';
  import { t } from '../i18n/i18n.svelte';
  import EdIcon from './EdIcon.svelte';
  import type { EdIconName } from './editorIcons';

  const GROUPS: { key: string; items: number[] }[] = [
    { key: 'waters', items: [T.DeepOcean, T.Shallow, T.Lake, T.River] },
    { key: 'lowlands', items: [T.Plains, T.Forest, T.Desert, T.Tundra] },
    { key: 'highlands', items: [T.Hills, T.Mountain, T.Peaks, T.Glacier] },
    { key: 'walls', items: [T.Impassable] },
  ];

  /** Glyph ink on a swatch: paper on dark colours, ink on light ones. */
  function glyphInk(k: number): string {
    const [r, g, b] = EDITOR_COLORS[k]!;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#172a3c' : '#f8f4ec';
  }
</script>

<div class="palette" role="radiogroup" aria-label={t('editor.terrain')}>
  {#each GROUPS as g (g.key)}
    <h4>{t(`editor.family.${g.key}`)}</h4>
    <div class="items" class:single={g.items.length === 1}>
      {#each g.items as k (k)}
        {@const key = TERRAIN[k]!.key}
        <button
          class="item"
          class:on={ed.terrain === k}
          role="radio"
          aria-checked={ed.terrain === k}
          title={t(`editor.terrainHint.${key}`)}
          data-testid="terrain-{key}"
          onclick={() => {
            ed.terrain = k;
            if (!['brush', 'line', 'rect', 'ellipse', 'fill'].includes(ed.tool)) setTool(ed.lastPaintTool);
          }}
        >
          <span class="sw" style:background="rgb({EDITOR_COLORS[k]!.join(',')})" style:color={glyphInk(k)}
            ><EdIcon name={key as EdIconName} size={14} /></span
          >
          <span class="nm">{t(`terrain.${key}`)}</span>
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .palette {
    display: grid;
    gap: 4px;
  }
  h4 {
    margin: 4px 0 0;
    font-family: var(--title);
    font-style: italic;
    font-weight: 500;
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .items {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
  }
  .items.single {
    grid-template-columns: minmax(0, 1fr);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    min-height: 30px;
    padding: 3px 5px 3px 3px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    color: var(--np-ink);
    font-size: 0.82em;
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .item:hover,
  .item:focus-visible {
    border-color: var(--np-rule-2);
    background: var(--np-card);
  }
  .item.on {
    border-color: var(--np-ink);
    background: var(--np-ink);
    color: var(--np-paper);
    font-weight: 600;
  }
  .sw {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px rgba(23, 42, 60, 0.3);
  }
  .item.on .sw {
    box-shadow: 0 0 0 1px var(--np-paper);
  }
  .nm {
    min-width: 0;
    line-height: 1.15;
    overflow-wrap: break-word;
    hyphens: auto;
  }
</style>
