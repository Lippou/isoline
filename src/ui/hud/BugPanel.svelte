<script lang="ts">
  // The bug journal (1.23, closed beta: the player and Claude test the game). F9 or its dock
  // button opens it, a capture of the screen taken first; the player says what went wrong and
  // saves a report: the note, the capture, the game itself (a save with its replay) and the
  // last errors, in the app-data folder's bugs/ (desktop/bugs.ts). The errors the game caught
  // this session are listed, newest first.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { t, clock } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import PaperMast from './PaperMast.svelte';
  import { bridge } from '../bridge';
  import { audio } from '../../audio/audio';
  import { saveFileOf } from '../game/saves';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();

  let note = $state('');
  let withGame = $state(true);
  let busy = $state(false);
  let saved = $state('');
  let errors = $state<string[]>([]);
  let reports = $state<string[]>([]);

  async function refresh(): Promise<void> {
    errors = (await bridge.bug.errors(30)).reverse();
    reports = await bridge.bug.list();
  }
  $effect(() => {
    void hud.bugErrors;
    void refresh();
  });

  async function save(): Promise<void> {
    if (busy) return;
    busy = true;
    const s = ctl.session;
    const info = await bridge.info();
    const meta = {
      version: info.version,
      platform: `${info.platform} ${info.arch}`,
      date: new Date().toISOString(),
      kind: s.kind,
      map: s.state.meta.name,
      tick: s.state.tick,
      clock: clock(s.state.tick),
      viewer: s.viewer,
      tool: hud.tool,
      selection: hud.selection.length,
      attackRatio: hud.attackRatio,
      errorsThisSession: hud.bugErrors,
    };
    const file = withGame ? await saveFileOf(s).catch(() => null) : null;
    const name = await bridge.bug.save(note, meta, file ? JSON.stringify(file) : '');
    busy = false;
    if (name) {
      saved = name;
      note = '';
      audio.ui('confirm');
      void refresh();
    } else audio.ui('error');
  }
</script>

<div class="paper newsprint np-window bugs">
  <PaperMast title={t('panel.bugs')} onclose={() => (hud.panels.bugs = false)}>
    <p class="np-dateline"><span>{t('bugs.beta')}</span><b>{t('bugs.count', { n: hud.bugErrors })}</b></p>
  </PaperMast>
  <div class="np-body scroll">
    <label class="field">
      <span class="np-mark">{t('bugs.what')}</span>
      <textarea bind:value={note} rows="5" placeholder={t('bugs.placeholder')} data-testid="bug-note"
      ></textarea>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={withGame} disabled={ctl.session.kind !== 'solo'} />
      {t('bugs.withGame')}
    </label>
    <div class="actions">
      <button class="np-btn ink" onclick={save} disabled={busy || !note.trim()} data-testid="bug-save"
        ><Icon name="save" size={14} />{t('bugs.save')}</button
      >
      <button class="np-btn" onclick={() => void bridge.bug.reveal()}
        ><Icon name="book" size={14} />{t('bugs.folder')}</button
      >
    </div>
    {#if saved}<p class="done"><Icon name="check" size={13} />{t('bugs.saved', { name: saved })}</p>{/if}

    <aside class="np-box">
      <h3>{t('bugs.errors')}</h3>
      {#if errors.length}
        <ol class="log mono">
          {#each errors as e, i (i)}<li>{e}</li>{/each}
        </ol>
      {:else}
        <p class="np-empty">{t('bugs.noErrors')}</p>
      {/if}
    </aside>
    {#if reports.length}
      <p class="small">{t('bugs.reports', { n: reports.length })}</p>
    {/if}
  </div>
</div>

<style>
  .field {
    display: grid;
    gap: 6px;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font: inherit;
    padding: 8px;
    color: var(--np-ink);
    background: var(--np-paper-2);
    border: 1px solid var(--np-ink);
  }
  .check {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .actions :global(.np-btn[disabled]) {
    opacity: 0.5;
    cursor: default;
  }
  .done {
    display: flex;
    gap: 6px;
    align-items: center;
    font-weight: 600;
  }
  .log {
    margin: 0;
    padding-left: 18px;
    font-size: 0.78em;
    line-height: 1.35;
    word-break: break-word;
    max-height: 260px;
    overflow: auto;
  }
  .small {
    font-size: 0.85em;
    color: var(--np-ink-2);
  }
</style>
