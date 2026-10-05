<script lang="ts">
  // The map's properties: name, author, size (resize), and its figures.
  import { ed, setModel, touched } from './editorSession.svelte';
  import { t, num } from '../i18n/i18n.svelte';
  import { confirmModal } from '../stores/app.svelte';
  import { MIN_SIZE, MAX_SIZE } from './editorModel';
  import { IS_LAND } from '../../core/map/terrain';
  import EdIcon from './EdIcon.svelte';

  let { onswitch }: { onswitch: () => void } = $props();

  const m = $derived(ed.model!);
  let rw = $state(0);
  let rh = $state(0);
  $effect(() => {
    rw = ed.model?.width ?? 0;
    rh = ed.model?.height ?? 0;
  });

  const facts = $derived.by(() => {
    void ed.rev;
    const mm = ed.model;
    if (!mm) return null;
    let land = 0;
    for (let i = 0; i < mm.terrain.length; i++) land += IS_LAND[mm.terrain[i]!]!;
    return {
      land,
      share: land / mm.terrain.length,
      nations: mm.meta.nations.length,
      spawns: mm.meta.spawnPoints.length,
      deposits: mm.meta.deposits.length,
    };
  });

  function setAuthor(v: string): void {
    m.meta.author = v.trim();
    m.metaEdited = true;
    touched();
  }

  function resize(): void {
    const w = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(rw)));
    const h = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(rh)));
    if (w === m.width && h === m.height) return;
    confirmModal(
      t('editor.resizeTitle'),
      t('editor.resizeBody', { w, h }),
      () => setModel(m.resized(w, h)),
      t('editor.resize'),
      t('common.cancel'),
    );
  }
</script>

<section class="props">
  <h3 class="np-rule">{t('editor.properties')}</h3>
  <label class="field"
    >{t('editor.author')}<input
      type="text"
      value={m.meta.author ?? ''}
      maxlength="40"
      onchange={(e) => setAuthor((e.currentTarget as HTMLInputElement).value)}
    /></label
  >
  <div class="field">
    <span>{t('editor.canvasSize')}</span>
    <div class="dims">
      <input
        type="number"
        min={MIN_SIZE}
        max={MAX_SIZE}
        step="10"
        bind:value={rw}
        aria-label={t('editor.width')}
      />
      <span aria-hidden="true">×</span>
      <input
        type="number"
        min={MIN_SIZE}
        max={MAX_SIZE}
        step="10"
        bind:value={rh}
        aria-label={t('editor.height')}
      />
      <button class="np-btn" onclick={resize} disabled={rw === m.width && rh === m.height}
        >{t('editor.resize')}</button
      >
    </div>
    <small>{t('editor.resizeHint')}</small>
  </div>
  {#if facts}
    <dl class="np-figures">
      <dt>{t('editor.landTiles')}</dt>
      <dd>{num(facts.land)} <small>({Math.round(facts.share * 100)} %)</small></dd>
      <dt>{t('lobby.nations')}</dt>
      <dd>{facts.nations}</dd>
      <dt>{t('editor.spawns')}</dt>
      <dd>{facts.spawns}</dd>
      <dt>{t('editor.deposits')}</dt>
      <dd>{facts.deposits}</dd>
      <dt>{t('editor.file')}</dt>
      <dd class="file">{m.fileName || t('editor.notSaved')}</dd>
    </dl>
  {/if}
  <button class="np-btn switch" onclick={onswitch}
    ><EdIcon name="open" size={15} />{t('editor.switch')}</button
  >
</section>

<style>
  .props {
    display: grid;
    gap: 12px;
    align-content: start;
  }
  h3 {
    margin: 0;
  }
  .field {
    display: grid;
    gap: 4px;
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .field small {
    color: var(--np-ink-3);
    font-size: 0.9em;
  }
  .dims {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dims input {
    width: 0;
    flex: 1;
    min-width: 0;
    font-family: var(--mono);
  }
  .file {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .np-figures small {
    color: var(--np-ink-3);
    font-weight: 400;
  }
  .switch {
    justify-self: start;
  }
</style>
