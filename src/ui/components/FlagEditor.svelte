<script lang="ts">
  // Custom flag editor: layout, field colours, emblem (charge, colour, position).
  // Edits a FlagSpec in place; the picker previews and saves it.
  import { t } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import {
    EMBLEM_POSITIONS,
    FLAG_EMBLEMS,
    FLAG_LAYOUTS,
    FLAG_PALETTE,
    LAYOUT_COLORS,
    contrast,
    defaultFlagSpec,
    emblemGround,
    normalizeColor,
    randomFlagSpec,
    type FlagSpec,
  } from '../../core/data/flagSpec';
  import { emblemMarkup, flagSvg } from '../../render/flagSvg';

  let { spec = $bindable() }: { spec: FlagSpec } = $props();

  /** Which colour the palette paints: a field colour (0..2) or the emblem (3). */
  let slot = $state(0);
  const used = $derived(LAYOUT_COLORS[spec.layout]);
  const hasEmblem = $derived(spec.emblem !== 'none');
  const current = $derived(slot === 3 ? spec.emblemColor : spec.colors[slot]!);
  const lowContrast = $derived(hasEmblem && contrast(spec.emblemColor, emblemGround(spec)) < 1.8);

  $effect(() => {
    // Keep the active slot on a colour the layout actually uses.
    if (slot < 3 && slot >= used) slot = 0;
    if (slot === 3 && !hasEmblem) slot = 0;
  });

  function paint(c: string): void {
    const v = normalizeColor(c);
    if (!v) return;
    if (slot === 3) spec.emblemColor = v;
    else spec.colors[slot] = v;
  }
  function randomise(): void {
    const keep = slot;
    spec = randomFlagSpec(Math.random);
    slot = keep;
  }
  function reset(): void {
    spec = defaultFlagSpec();
    slot = 0;
  }
  const thumb = (layout: FlagSpec['layout']) =>
    flagSvg({ ...$state.snapshot(spec), layout, emblem: 'none' } as FlagSpec, 60);
  const emblemIcon = (e: FlagSpec['emblem']) =>
    `<svg viewBox="0 0 100 100" width="26" height="26" aria-hidden="true">${emblemMarkup(e, 'currentColor')}</svg>`;
</script>

<div class="editor" data-testid="flag-editor">
  <section>
    <header class="sh">
      <h3>{t('flag.layoutTitle')}</h3>
      <div class="acts">
        <button class="btn small ghost" onclick={randomise} data-testid="flag-random"
          ><Icon name="dice" size={14} />{t('flag.random')}</button
        >
        <button class="btn small ghost" onclick={reset}
          ><Icon name="undo" size={14} />{t('flag.reset')}</button
        >
      </div>
    </header>
    <div class="layouts" role="radiogroup" aria-label={t('flag.layoutTitle')}>
      {#each FLAG_LAYOUTS as l (l)}
        <button
          class="lay"
          class:on={spec.layout === l}
          role="radio"
          aria-checked={spec.layout === l}
          title={t(`flag.layout.${l}`)}
          aria-label={t(`flag.layout.${l}`)}
          data-testid="flag-layout-{l}"
          onclick={() => (spec.layout = l)}>{@html thumb(l)}</button
        >
      {/each}
    </div>
  </section>

  <section>
    <h3>{t('flag.colorsTitle')}</h3>
    <div class="slots">
      {#each [0, 1, 2] as k (k)}
        {#if k < used}
          <button
            class="slot"
            class:on={slot === k}
            onclick={() => (slot = k)}
            aria-pressed={slot === k}
            data-testid="flag-slot-{k}"
            ><span class="sw" style="background:{spec.colors[k]}"></span>{t('flag.color', {
              n: k + 1,
            })}</button
          >
        {/if}
      {/each}
      {#if hasEmblem}
        <button
          class="slot"
          class:on={slot === 3}
          onclick={() => (slot = 3)}
          aria-pressed={slot === 3}
          data-testid="flag-slot-emblem"
          ><span class="sw" style="background:{spec.emblemColor}"></span>{t('flag.emblemColor')}</button
        >
      {/if}
    </div>
    <div class="palette">
      {#each FLAG_PALETTE as c (c)}
        <button
          class="chipc"
          class:on={current === c}
          style="background:{c}"
          title={c}
          aria-label={c}
          onclick={() => paint(c)}
        ></button>
      {/each}
      <label class="custom" title={t('flag.otherColor')}>
        <input type="color" value={current} oninput={(e) => paint((e.target as HTMLInputElement).value)} />
        <span>{t('flag.otherColor')}</span>
      </label>
    </div>
  </section>

  <section>
    <h3>{t('flag.emblemTitle')}</h3>
    <div class="emblems" role="radiogroup" aria-label={t('flag.emblemTitle')}>
      {#each FLAG_EMBLEMS as e (e)}
        <button
          class="emb"
          class:on={spec.emblem === e}
          role="radio"
          aria-checked={spec.emblem === e}
          title={t(`flag.emblem.${e}`)}
          aria-label={t(`flag.emblem.${e}`)}
          data-testid="flag-emblem-{e}"
          onclick={() => {
            spec.emblem = e;
            if (e !== 'none' && slot !== 3) slot = 3;
          }}
          >{#if e === 'none'}<Icon name="close" size={18} />{:else}{@html emblemIcon(e)}{/if}</button
        >
      {/each}
    </div>
    {#if hasEmblem}
      <div class="pos">
        <span class="lbl">{t('flag.position')}</span>
        <div class="seg" role="radiogroup" aria-label={t('flag.position')}>
          {#each EMBLEM_POSITIONS as p (p)}
            <button
              class:on={spec.emblemAt === p}
              role="radio"
              aria-checked={spec.emblemAt === p}
              onclick={() => (spec.emblemAt = p)}>{t(`flag.at.${p}`)}</button
            >
          {/each}
        </div>
      </div>
      {#if lowContrast}<p class="warnline"><Icon name="warning" size={14} />{t('flag.lowContrast')}</p>{/if}
    {/if}
  </section>
</div>

<style>
  .editor {
    display: grid;
    gap: 18px;
    align-content: start;
  }
  section {
    display: grid;
    gap: 10px;
  }
  h3 {
    font-size: 1.02em;
    font-weight: 600;
    margin: 0;
  }
  .sh {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .acts {
    display: flex;
    gap: 4px;
  }
  .layouts {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 8px;
  }
  .lay {
    padding: 0;
    aspect-ratio: 3 / 2;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    overflow: hidden;
    background: none;
    cursor: var(--cursor-pointer, pointer);
    display: block;
    transition:
      transform 0.12s var(--ease-out),
      box-shadow 0.12s;
  }
  .lay :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .lay:hover {
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(22, 50, 74, 0.16);
  }
  .lay.on,
  .emb.on {
    outline: 2px solid var(--aurora);
    outline-offset: 2px;
  }
  .slots {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .slot {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px 5px 6px;
    border: 1px solid var(--line-strong);
    border-radius: 20px;
    background: var(--panel-solid);
    color: var(--parchment);
    font-size: 0.9em;
    cursor: var(--cursor-pointer, pointer);
  }
  .slot.on {
    border-color: var(--aurora);
    background: var(--select-bg);
    font-weight: 600;
  }
  .sw {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(22, 50, 74, 0.28);
  }
  .palette {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chipc {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    border: none;
    box-shadow: inset 0 0 0 1px rgba(22, 50, 74, 0.25);
    cursor: var(--cursor-pointer, pointer);
    transition: transform 0.1s var(--ease-out);
  }
  .chipc:hover {
    transform: scale(1.1);
  }
  .chipc.on {
    outline: 2px solid var(--aurora);
    outline-offset: 2px;
  }
  .custom {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 6px;
    font-size: 0.86em;
    color: var(--muted);
    cursor: var(--cursor-pointer, pointer);
  }
  .custom input {
    width: 30px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: var(--input-bg);
    cursor: var(--cursor-pointer, pointer);
  }
  .emblems {
    display: grid;
    grid-template-columns: repeat(11, 1fr);
    gap: 6px;
  }
  .emb {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: var(--panel-solid);
    color: var(--parchment);
    cursor: var(--cursor-pointer, pointer);
  }
  .emb:hover {
    border-color: var(--aurora);
  }
  .emb.on {
    background: var(--select-bg);
  }
  .pos {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .lbl {
    font-size: 0.9em;
    color: var(--muted);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .seg button {
    border: none;
    background: var(--panel-solid);
    color: var(--parchment);
    padding: 5px 14px;
    font-size: 0.9em;
    cursor: var(--cursor-pointer, pointer);
  }
  .seg button + button {
    border-left: 1px solid var(--line);
  }
  .seg button.on {
    background: var(--select-bg);
    color: var(--aurora);
    font-weight: 600;
  }
  .warnline {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 0.86em;
    color: var(--warn-text);
  }
</style>
