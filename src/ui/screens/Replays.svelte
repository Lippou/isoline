<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import { onMount } from 'svelte';
  import { t, date, clock } from '../i18n/i18n.svelte';
  import { bridge, readText } from '../bridge';
  import { parseReplay, type ReplayFile } from '../../engine/replay';
  import { startReplay } from './launch';
  import { toast } from '../stores/game.svelte';

  let files: { name: string; size: number; mtime: number }[] = $state([]);
  let meta = $state<Record<string, ReplayFile['summary'] & { map: string; date: string }>>({});

  async function refresh(): Promise<void> {
    files = (await bridge.storage.list('replays')).filter((f) => f.name.endsWith('.rpl'));
    for (const f of files.slice(0, 40)) {
      const txt = await readText('replays', f.name);
      if (!txt) continue;
      try {
        const r = parseReplay(txt);
        meta[f.name] = { ...r.summary, map: r.config.mapId, date: r.date };
      } catch {
        /* ignore */
      }
    }
  }
  onMount(refresh);

  async function open(name: string): Promise<void> {
    const txt = await readText('replays', name);
    if (!txt) return;
    try {
      startReplay(parseReplay(txt));
    } catch {
      toast(t('replay.invalid'), 'warn');
    }
  }
  async function importFile(): Promise<void> {
    const f = await bridge.storage.importFile('Isoline replay', ['rpl']);
    if (!f) return;
    try {
      const txt = new TextDecoder().decode(f.data);
      parseReplay(txt);
      await bridge.storage.write('replays', f.name, txt);
      await refresh();
    } catch {
      toast(t('replay.invalid'), 'warn');
    }
  }
  async function exportFile(name: string): Promise<void> {
    const txt = await readText('replays', name);
    if (txt) await bridge.storage.exportFile(name, txt, 'Isoline replay', 'rpl');
  }
  async function del(name: string): Promise<void> {
    await bridge.storage.remove('replays', name);
    await refresh();
  }
</script>

<div class="rep" data-testid="replays">
  <PageHeader title={t('title.replays')} subtitle={t('replay.subtitle')}>
    {#snippet actions()}
      <button class="btn" onclick={importFile}><Icon name="upload" size={15} />{t('replay.import')}</button>
    {/snippet}
  </PageHeader>
  <section class="panel table">
    <div class="thead">
      <span>{t('replay.colMap')}</span><span>{t('replay.colWinner')}</span><span
        >{t('replay.colDuration')}</span
      ><span>{t('replay.colDate')}</span><span></span>
    </div>
    <ul class="scroll">
      {#each files as f (f.name)}
        {@const m = meta[f.name]}
        <li>
          <span class="name">{m ? m.map : f.name}</span>
          <span>{m ? m.winner : '—'}</span>
          <span class="mono">{m ? clock(m.durationTicks) : ''}</span>
          <span class="muted">{m ? date(Date.parse(m.date)) : ''}</span>
          <span class="acts">
            <button class="btn primary small" onclick={() => open(f.name)} data-testid="replay-open"
              ><Icon name="play" size={13} />{t('replay.watch')}</button
            >
            <button
              class="btn small"
              onclick={() => exportFile(f.name)}
              aria-label={t('replay.export')}
              data-tip={t('replay.export')}><Icon name="download" size={14} /></button
            >
            <button
              class="btn small danger"
              onclick={() => del(f.name)}
              aria-label={t('common.delete')}
              data-tip={t('common.delete')}><Icon name="trash" size={14} /></button
            >
          </span>
        </li>
      {:else}
        <li class="empty muted">{t('replay.none')}</li>
      {/each}
    </ul>
  </section>
</div>

<style>
  .rep {
    position: fixed;
    inset: 0;
    padding: 18px 22px;
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--abyss);
  }
  .table {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
    max-width: 1100px;
    width: 100%;
    justify-self: center;
  }
  .thead,
  li {
    display: grid;
    grid-template-columns: 1.4fr 1.2fr 6em 12em auto;
    gap: 12px;
    align-items: center;
    padding: 9px 14px;
  }
  .thead {
    font-size: 0.74em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--faint);
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    min-height: 0;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  li:hover {
    background: var(--panel-2);
  }
  .empty {
    display: block;
    padding: 30px;
    text-align: center;
  }
  .muted {
    color: var(--faint);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .acts {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }
</style>
