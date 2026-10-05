<script lang="ts">
  // The map's nations (named, each checked on its tile), spawn points and deposits.
  import { ed, setTool, touched, viewCtl } from './editorSession.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { confirmModal } from '../stores/app.svelte';
  import EdIcon from './EdIcon.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { MarkerKind } from './editorModel';

  const rows = $derived.by(() => {
    void ed.rev;
    const m = ed.model;
    if (!m) return [];
    return m.meta.nations.map((n, k) => ({
      k,
      name: n.name.fr || n.name.en,
      x: n.x,
      y: n.y,
      where: m.spawnable(n.x, n.y),
    }));
  });
  const counts = $derived.by(() => {
    void ed.rev;
    const m = ed.model;
    return { spawns: m?.meta.spawnPoints.length ?? 0, deposits: m?.meta.deposits.length ?? 0 };
  });

  function select(k: number, x: number, y: number): void {
    ed.selected = { kind: 'nation', index: k };
    setTool('markers');
    ed.markerKind = 'nation';
    viewCtl.focus(x, y);
  }
  function rename(k: number, v: string): void {
    ed.model?.renameNation(k, v.trim());
    touched();
  }
  function remove(k: number): void {
    ed.model?.removeMarker({ kind: 'nation', index: k });
    if (ed.selected?.kind === 'nation') ed.selected = null;
    touched();
  }
  function auto(): void {
    const m = ed.model;
    if (!m) return;
    const run = () => {
      m.autoMarkers();
      ed.selected = null;
      touched();
    };
    if (m.meta.nations.length || m.meta.spawnPoints.length || m.meta.deposits.length)
      confirmModal(t('editor.autoTitle'), t('editor.autoBody'), run, t('editor.autoGo'), t('common.cancel'));
    else run();
  }
  function clear(kind: MarkerKind): void {
    ed.model?.clearMarkers(kind);
    ed.selected = null;
    touched();
  }
  function add(kind: MarkerKind): void {
    setTool('markers');
    ed.markerKind = kind;
  }
</script>

<section class="markers">
  <button class="np-btn ink auto" onclick={auto} data-testid="editor-auto"
    ><Icon name="sparkles" size={15} />{t('editor.auto')}</button
  >
  <h3 class="np-rule">{t('lobby.nations')} <small>{rows.length}</small></h3>
  <div class="line">
    <button class="np-btn" onclick={() => add('nation')}
      ><Icon name="plus" size={14} />{t('editor.addNation')}</button
    >
    {#if rows.length}<button class="np-btn quiet" onclick={() => clear('nation')}
        >{t('editor.clearAll')}</button
      >{/if}
  </div>
  {#if rows.length}
    <ul class="list">
      {#each rows as r (r.k)}
        <li class:sel={ed.selected?.kind === 'nation' && ed.selected.index === r.k}>
          <button
            class="loc"
            onclick={() => select(r.k, r.x, r.y)}
            title={t('editor.locate')}
            aria-label={t('editor.locate')}
            ><EdIcon
              name={r.where === 'ok' ? 'markers' : r.where === 'islet' ? 'warn' : 'error'}
              size={14}
            /></button
          >
          <input
            type="text"
            value={r.name}
            maxlength="40"
            aria-label={t('editor.nationName')}
            onchange={(e) => rename(r.k, (e.currentTarget as HTMLInputElement).value)}
          />
          {#if r.where !== 'ok'}<span class="bad" title={t(`editor.where.${r.where}`)}
              >{t(`editor.whereShort.${r.where}`)}</span
            >{/if}
          <button
            class="del"
            onclick={() => remove(r.k)}
            title={t('common.delete')}
            aria-label={t('common.delete')}><Icon name="close" size={13} /></button
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">{t('editor.noNations')}</p>
  {/if}

  <h3 class="np-rule">{t('editor.spawns')} <small>{counts.spawns}</small></h3>
  <p class="hint">{t('editor.spawnsHint')}</p>
  <div class="line">
    <button class="np-btn" onclick={() => add('spawn')}
      ><Icon name="plus" size={14} />{t('editor.addSpawn')}</button
    >
    {#if counts.spawns}<button class="np-btn quiet" onclick={() => clear('spawn')}
        >{t('editor.clearAll')}</button
      >{/if}
  </div>
  <h3 class="np-rule">{t('editor.deposits')} <small>{counts.deposits}</small></h3>
  <div class="line">
    <button class="np-btn" onclick={() => add('deposit')}
      ><Icon name="plus" size={14} />{t('editor.addDeposit')}</button
    >
    {#if counts.deposits}<button class="np-btn quiet" onclick={() => clear('deposit')}
        >{t('editor.clearAll')}</button
      >{/if}
  </div>
</section>

<style>
  .markers {
    display: grid;
    gap: 8px;
    align-content: start;
  }
  h3 {
    margin: 6px 0 0;
  }
  h3 small {
    font-family: var(--mono);
    font-weight: 500;
    font-size: 0.8em;
    color: var(--np-ink-2);
  }
  .auto {
    justify-self: stretch;
    justify-content: center;
    white-space: normal;
    text-align: left;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hint,
  .empty {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--np-ink);
    max-height: 260px;
    overflow-y: auto;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    border-bottom: 1px solid var(--np-rule);
  }
  .list li.sel {
    background: var(--np-card);
    box-shadow: inset 3px 0 0 var(--np-ink);
  }
  .list input {
    flex: 1;
    min-width: 0;
    padding: 2px 5px;
    font-size: 0.86em;
    background: transparent;
    border-color: transparent;
  }
  .list input:hover,
  .list input:focus {
    background: var(--np-card);
    border-color: var(--np-rule-2);
  }
  .loc,
  .del {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
  }
  .loc:hover,
  .del:hover {
    border-color: var(--np-rule-2);
    color: var(--np-ink);
  }
  .bad {
    flex: none;
    font-size: 0.72em;
    font-weight: 600;
    color: var(--np-spot);
  }
</style>
