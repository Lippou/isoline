<script lang="ts">
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import Isolines from '../components/Isolines.svelte';
  import { onMount } from 'svelte';
  import { t, i18n, date, clock } from '../i18n/i18n.svelte';
  import { bridge, readText, mapsBase } from '../bridge';
  import { parseReplay, type ReplayFile } from '../../engine/replay';
  import { startReplay } from './launch';
  import { toast } from '../stores/game.svelte';
  import { app, go } from '../stores/app.svelte';

  let files: { name: string; size: number; mtime: number }[] = $state([]);
  let loading = $state(true);
  let meta = $state<Record<string, ReplayFile['summary'] & { map: string; date: string; stale: boolean }>>(
    {},
  );
  let mapNames = $state<Record<string, { fr: string; en: string }>>({});
  // The simulation rules change between minor versions: older replays play out differently.
  const minor = (v: string) => v.split('.').slice(0, 2).join('.');
  const mapName = (id: string) => {
    const n = mapNames[id];
    return n ? n[i18n.lang] || n.en : id;
  };

  async function refresh(): Promise<void> {
    files = (await bridge.storage.list('replays')).filter((f) => f.name.endsWith('.rpl'));
    loading = false;
    for (const f of files.slice(0, 40)) {
      const txt = await readText('replays', f.name);
      if (!txt) continue;
      try {
        const r = parseReplay(txt);
        meta[f.name] = {
          ...r.summary,
          map: r.config.mapId,
          date: r.date,
          stale: minor(r.appVersion ?? '') !== minor(app.version),
        };
      } catch {
        /* ignore */
      }
    }
  }
  onMount(() => {
    void refresh();
    void fetch(`${mapsBase()}index.json`)
      .then((r) => r.json() as Promise<{ id: string; name: { fr: string; en: string } }[]>)
      .then((l) => (mapNames = Object.fromEntries(l.map((m) => [m.id, m.name]))))
      .catch(() => {});
  });

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
  function newGame(): void {
    app.lobby.lan = false;
    go('lobby');
  }
</script>

<div class="page-shell" data-testid="replays">
  <PageHeader title={t('title.replays')} subtitle={t('replay.subtitle')}>
    {#snippet actions()}
      <button class="btn" onclick={importFile}><Icon name="upload" size={15} />{t('replay.import')}</button>
    {/snippet}
  </PageHeader>
  <section class="page-body table">
    {#if files.length}
      <div class="thead" aria-hidden="true">
        <span>{t('replay.colMap')}</span><span>{t('replay.colWinner')}</span><span class="num"
          >{t('replay.colDuration')}</span
        ><span>{t('replay.colDate')}</span><span></span>
      </div>
      <ul class="scroll">
        {#each files as f, k (f.name)}
          {@const m = meta[f.name]}
          <li style="--k:{Math.min(k, 12)}">
            <span class="name"
              >{m ? mapName(m.map) : f.name}{#if m?.stale}<span class="stale" data-tip={t('replay.staleTip')}
                  ><Icon name="warning" size={13} /></span
                >{/if}</span
            >
            <span class="winner"
              >{#if m}<Icon name="leader" size={13} />{m.winner}{:else}—{/if}</span
            >
            <span class="mono num">{m ? clock(m.durationTicks) : ''}</span>
            <span class="muted">{m ? date(Date.parse(m.date)) : ''}</span>
            <span class="racts">
              <button class="btn primary small" onclick={() => open(f.name)} data-testid="replay-open"
                ><Icon name="play" size={13} />{t('replay.watch')}</button
              >
              <button
                class="btn small ghost"
                onclick={() => exportFile(f.name)}
                aria-label={t('replay.export')}
                data-tip={t('replay.export')}><Icon name="download" size={14} /></button
              >
              <button
                class="btn small ghost del"
                onclick={() => del(f.name)}
                aria-label={t('common.delete')}
                data-tip={t('common.delete')}><Icon name="trash" size={14} /></button
              >
            </span>
          </li>
        {/each}
      </ul>
    {:else if loading}
      <div class="wait">
        <Isolines mode="ripple" count={4} r0={14} step={12} duration={2.2} stagger={0.55} />
      </div>
    {:else}
      <div class="empty-state">
        <div class="motif">
          <Isolines mode="static" cx={0.46} cy={0.46} count={5} r0={8} step={7} seed={21} indexEvery={5} />
        </div>
        <h3>{t('replay.emptyTitle')}</h3>
        <p>{t('replay.emptyHint')}</p>
        <div class="acts">
          <button class="btn primary" onclick={newGame}
            ><Icon name="play" size={15} />{t('profile.playFirst')}</button
          >
          <button class="btn" onclick={importFile}
            ><Icon name="upload" size={15} />{t('replay.import')}</button
          >
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  /* The register of games, printed as a newspaper's table: an ink rule over the heads,
     a fine rule between the rows. */
  .table {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    align-content: start;
    overflow: hidden;
    align-self: start;
    max-height: 100%;
  }
  .thead,
  li {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.1fr) 6em 13em 11.5em;
    gap: 16px;
    align-items: center;
    padding: 8px 6px;
  }
  .thead {
    padding-top: 4px;
    padding-bottom: 5px;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.9em;
    color: var(--np-ink-2);
    border-bottom: 1px solid var(--np-ink);
  }
  .num {
    text-align: right;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    min-height: 0;
  }
  li {
    border-bottom: 1px solid var(--np-rule);
    animation: row-in 0.3s calc(var(--k) * 30ms) ease-out both;
    transition: background 0.14s;
  }
  @keyframes row-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  li:hover {
    background: var(--np-card);
  }
  .muted {
    color: var(--np-ink-2);
    font-variant-numeric: tabular-nums;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.1em;
  }
  .winner {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
  }
  .winner :global(svg) {
    color: var(--brass-text);
  }
  .stale {
    display: inline-flex;
    margin-left: 0.4em;
    color: var(--np-warn);
    vertical-align: -2px;
  }
  .racts {
    display: flex;
    gap: 2px;
    justify-content: flex-end;
  }
  .del:hover,
  .del:focus-visible {
    color: var(--np-spot);
  }
  .wait {
    position: relative;
    height: 220px;
    color: var(--np-sea);
  }
  .motif {
    position: relative;
    width: 120px;
    height: 120px;
    color: var(--np-sea);
    margin-bottom: 4px;
  }
</style>
