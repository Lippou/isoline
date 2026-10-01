<script lang="ts">
  import { onMount } from 'svelte';
  import { go } from '../stores/app.svelte';
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
  <header>
    <button class="btn ghost" onclick={() => go('title')}>← {t('common.back')}</button>
    <h1>{t('title.replays')}</h1>
    <button class="btn" onclick={importFile}>{t('replay.import')}</button>
  </header>
  <ul>
    {#each files as f (f.name)}
      {@const m = meta[f.name]}
      <li class="glass">
        <span class="name">{m ? `${m.map} · ${m.winner}` : f.name}</span>
        <span class="mono">{m ? clock(m.durationTicks) : ''}</span>
        <span class="muted">{m ? date(Date.parse(m.date)) : ''}</span>
        <button class="btn primary" onclick={() => open(f.name)} data-testid="replay-open"
          >▶ {t('replay.watch')}</button
        >
        <button class="btn" onclick={() => exportFile(f.name)}>⤓</button>
        <button class="btn danger" onclick={() => del(f.name)}>🗑</button>
      </li>
    {:else}
      <li class="muted">{t('replay.none')}</li>
    {/each}
  </ul>
</div>

<style>
  .rep {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    overflow-y: auto;
    background: radial-gradient(ellipse at 30% 0%, #172947, var(--abyss) 60%);
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
  }
  header h1 {
    flex: 1;
  }
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0.5rem;
    max-width: 1000px;
  }
  li {
    display: grid;
    grid-template-columns: 1fr 5em 12em auto auto auto;
    gap: 0.7rem;
    align-items: center;
    padding: 0.6rem 0.9rem;
  }
  .muted {
    color: var(--faint);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
