<script lang="ts">
  // The pause menu, printed on the Courier's paper as the windows: a small sheet with the
  // orders as a map's legend (the grave ones in magenta under a rule); its save register
  // and its reference of the controls. Its settings are the main menu's very page.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { note } from '../stores/note.svelte';
  import { resetWindows } from '../stores/windows.svelte';
  import { allFolded, toggleAllFolds } from '../stores/folds.svelte';
  import { t, date, i18n, clock } from '../i18n/i18n.svelte';
  import { go, confirmModal } from '../stores/app.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { listSaves, SAVE_SLOTS, type SaveInfo } from '../game/saves';
  import { onMount } from 'svelte';
  import SettingsBody from '../screens/SettingsBody.svelte';
  import PageHeader from '../PageHeader.svelte';
  import PaperMast from './PaperMast.svelte';
  import Icon from '../icons/Icon.svelte';

  let { ctl }: { ctl: GameController } = $props();
  let view = $state<'main' | 'save' | 'settings' | 'help'>('main');
  let saves: SaveInfo[] = $state([]);
  const solo = ctl.session.kind === 'solo';
  const wasPaused = ctl.session.paused;

  onMount(() => {
    if (solo && !wasPaused) {
      ctl.session.setPaused(true);
      hud.paused = true;
    }
    return () => {
      if (solo && !wasPaused) {
        ctl.session.setPaused(false);
        hud.paused = false;
      }
    };
  });

  const resume = () => (hud.panels.menu = false);
  const mapName = $derived.by(() => {
    const n = ctl.session.state.meta?.name;
    return n ? n[i18n.lang] || n.en : ctl.session.config.mapId;
  });
  const elapsed = $derived(clock(Math.max(0, hud.tick - (hud.world?.startTick ?? 0))));
  const canSurrender = $derived(!hud.spectating && !!hud.local?.alive && ctl.session.kind !== 'replay');

  async function openSave(): Promise<void> {
    saves = await listSaves();
    view = 'save';
  }
  async function save(slot: number): Promise<void> {
    const ok = await ctl.saveGame(slot);
    note(ok ? t('menu.saved', { slot }) : t('menu.saveFailed'), ok ? 'good' : 'warn');
    saves = await listSaves();
  }
  function quit(): void {
    confirmModal(
      t('menu.quitTitle'),
      t('menu.quitBody'),
      () => go('title'),
      t('menu.quit'),
      t('common.cancel'),
    );
  }
  function surrender(): void {
    confirmModal(
      t('menu.surrenderTitle'),
      t('menu.surrenderBody'),
      () => {
        ctl.session.cmd({ t: 'surrender' });
        hud.panels.menu = false; // closing the menu resumes the game so the order is processed
      },
      t('menu.surrender'),
      t('common.cancel'),
    );
  }

  /** The reference of the keys, by group (the help page). */
  const GROUPS: [string, string[]][] = $derived([
    ['attack', ['attackHover', 'boatHover', 'ratioDown', 'ratioUp']],
    [
      'build',
      [
        'buildCity',
        'buildPort',
        'buildFactory',
        'lineDefense',
        'lineOffense',
        'buildSilo',
        'buildSam',
        'warship',
      ],
    ],
    ['nukes', ['nukeA', 'nukeH', 'nukeMirv', 'flipArc']],
    ['command', ['selectWarships', 'general', 'home']],
    ['diplomacy', ['allyAccept', 'allyRefuse', 'chat']],
    [
      'views',
      [
        'terrainView',
        'fogView',
        'resourcesView',
        // The loyalty layer only exists in a game with loyalty on (off by default).
        ...(ctl.session.config.features.loyalty ? ['loyaltyView'] : []),
        'hudFold',
      ],
    ],
    ['time', ['speedDown', 'speedUp', 'pause']],
    ['capture', ['screenshot', 'photoMode', 'fps', 'bugReport']],
  ]);
  const MOUSE = ['click', 'radial', 'drag', 'wheel'];
  /** Every panel folded (the minimal interface): the entry unfolds them all. */
  const minimal = $derived(allFolded());
</script>

{#if view === 'settings'}
  <!-- The very same page as the main menu's Settings (chart paper, side tabs, switches). -->
  <div class="page-shell chart sheet rise-in" data-testid="game-menu">
    <PageHeader
      title={t('title.settings')}
      subtitle={t('settings.subtitle')}
      onback={() => (view = 'main')}
    />
    <div class="page-body sheet-body scroll"><SettingsBody /></div>
  </div>
{:else}
  <div class="np-veil fade-in" data-testid="game-menu">
    <div
      class="menu newsprint np-sheet"
      class:wide={view === 'help'}
      class:register={view === 'save'}
      role="dialog"
      aria-modal="true"
      aria-label={view === 'save' ? t('menu.save') : view === 'help' ? t('menu.help') : t('menu.title')}
    >
      {#if view === 'main'}
        <PaperMast title={t('menu.title')} onclose={resume}>
          <p class="np-dateline">
            <span>{mapName}</span>
            <span>{t('hud.elapsed')} <b>{elapsed}</b></span>
            <span>{solo ? t('menu.held') : t('menu.running')}</span>
          </p>
        </PaperMast>
        <div class="body">
          <ul class="np-legend">
            <li>
              <button class="lead" onclick={resume}
                ><Icon name="play" size={16} /><span class="lb">{t('menu.resume')}</span><small
                  >{t('menu.d.resume')}</small
                ><kbd class="np-key">{keyLabel('Escape')}</kbd></button
              >
            </li>
            {#if solo}
              <li>
                <button onclick={openSave}
                  ><Icon name="save" size={16} /><span class="lb">{t('menu.save')}</span><small
                    >{t('menu.d.save')}</small
                  ></button
                >
              </li>
            {/if}
            <li>
              <button onclick={() => (view = 'settings')}
                ><Icon name="settings" size={16} /><span class="lb">{t('menu.settings')}</span><small
                  >{t('menu.d.settings')}</small
                ></button
              >
            </li>
            <li>
              <button onclick={() => (view = 'help')}
                ><Icon name="help" size={16} /><span class="lb">{t('menu.help')}</span><small
                  >{t('menu.d.help')}</small
                ></button
              >
            </li>
            <li>
              <button onclick={() => void ctl.enterPhoto()} data-testid="menu-photo"
                ><Icon name="camera" size={16} /><span class="lb">{t('photo.open')}</span><small
                  >{t('menu.d.photo')}</small
                ><kbd class="np-key">{keyLabel(settings.keys.photoMode ?? '')}</kbd></button
              >
            </li>
            <li>
              <button
                onclick={() => {
                  resetWindows();
                  note(t('menu.windowsReset'), 'info');
                }}
                data-testid="menu-reset-windows"
                ><Icon name="refresh" size={16} /><span class="lb">{t('menu.resetWindows')}</span><small
                  >{t('menu.d.resetWindows')}</small
                ></button
              >
            </li>
            <li>
              <button
                onclick={() => {
                  toggleAllFolds();
                  resume();
                }}
                aria-pressed={minimal}
                data-testid="menu-fold-hud"
                ><Icon name={minimal ? 'expand' : 'collapse'} size={16} /><span class="lb"
                  >{minimal ? t('menu.unfoldHud') : t('menu.foldHud')}</span
                ><small>{minimal ? t('menu.d.unfoldHud') : t('menu.d.foldHud')}</small><kbd class="np-key"
                  >{keyLabel(settings.keys.hudFold ?? '')}</kbd
                ></button
              >
            </li>
          </ul>
          <ul class="np-legend grave">
            {#if canSurrender}
              <li>
                <button class="spot" onclick={surrender}
                  ><Icon name="surrender" size={16} /><span class="lb">{t('menu.surrender')}</span><small
                    >{t('menu.surrenderBody')}</small
                  ></button
                >
              </li>
            {/if}
            <li>
              <button class="spot" onclick={quit} data-testid="menu-quit"
                ><Icon name="quit" size={16} /><span class="lb">{t('menu.quit')}</span><small
                  >{t('menu.d.quit')}</small
                ></button
              >
            </li>
          </ul>
        </div>
      {:else if view === 'save'}
        <PaperMast title={t('menu.save')} onclose={resume}>
          <p class="np-dateline">
            <span>{t('menu.autoEvery')}</span>
            <b>{t('menu.used', { n: saves.filter((x) => x.slot > 0).length, of: SAVE_SLOTS })}</b>
          </p>
        </PaperMast>
        <div class="body scroll">
          <table class="slots">
            <thead>
              <tr>
                <th scope="col" class="n">{t('menu.colNo')}</th>
                <th scope="col">{t('menu.colMap')}</th>
                <th scope="col" class="when">{t('menu.colSaved')}</th>
                <th scope="col"><span class="sr-only">{t('menu.colAction')}</span></th>
              </tr>
            </thead>
            <tbody>
              {#each Array.from({ length: SAVE_SLOTS }, (_, k) => k + 1) as slot (slot)}
                {@const s = saves.find((x) => x.slot === slot)}
                <tr class:empty={!s}>
                  <th scope="row" class="n">{slot}</th>
                  <td class="map">{s ? s.mapName[i18n.lang] : t('menu.empty')}</td>
                  <td class="when">{s ? date(Date.parse(s.date)) : '—'}</td>
                  <td class="act">
                    <button
                      class="np-act"
                      data-slot={slot}
                      aria-label={`${t('menu.slot', { slot })} : ${s ? t('menu.overwrite') : t('menu.saveHere')}`}
                      onclick={() => save(slot)}
                      ><Icon name="save" size={13} />{s ? t('menu.overwrite') : t('menu.saveHere')}</button
                    >
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <footer class="foot">
          <button class="np-btn quiet" onclick={() => (view = 'main')}
            ><Icon name="back" size={14} />{t('common.back')}</button
          >
        </footer>
      {:else}
        <PaperMast title={t('menu.help')} onclose={resume}>
          <p class="np-dateline">
            <span>{t('help.dateline')}</span>
            <span>{t('help.rebind')}</span>
          </p>
        </PaperMast>
        <div class="body scroll">
          <p class="standfirst">{t('help.intro')}</p>
          <h3 class="np-mark">{t('help.group.mouse')}</h3>
          <ul class="mouse">
            {#each MOUSE as m (m)}<li>{t(`help.${m}`)}</li>{/each}
          </ul>
          <div class="groups">
            {#each GROUPS as [g, keys] (g)}
              <section>
                <h3 class="np-mark">{t(`help.group.${g}`)}</h3>
                <dl>
                  {#each keys as k (k)}
                    <div class="key">
                      <dt>{t(`keys.${k}`)}</dt>
                      <dd>
                        <kbd class="np-key">{keyLabel(settings.keys[k] ?? '')}</kbd
                        ><!-- The pause has two keys (Space, and P as before). -->{#if k === 'pause' && settings.keys.pauseAlt}&nbsp;/&nbsp;<kbd
                            class="np-key">{keyLabel(settings.keys.pauseAlt)}</kbd
                          >{/if}
                      </dd>
                    </div>
                  {/each}
                </dl>
              </section>
            {/each}
          </div>
        </div>
        <footer class="foot">
          <button class="np-btn quiet" onclick={() => (view = 'main')}
            ><Icon name="back" size={14} />{t('common.back')}</button
          >
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .sheet {
    z-index: 70;
  }
  .sheet-body {
    background: var(--panel-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow-y: auto;
  }
  .np-veil {
    z-index: 70;
  }
  .menu {
    width: min(380px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .menu.register {
    width: min(560px, calc(100vw - 32px));
  }
  .menu.wide {
    width: min(860px, calc(100vw - 32px));
  }
  .body {
    min-height: 0;
    padding: 8px 18px 16px;
    scrollbar-color: var(--np-rule) transparent;
  }
  .menu:not(.wide, .register) .body {
    padding-top: 6px;
  }
  /* Resume leads the legend: its pictogram printed in ink. */
  .np-legend .lead > :global(svg) {
    color: var(--np-ink);
  }
  /* The grave orders, apart under the ink rule. */
  .np-legend.grave {
    margin-top: 8px;
    padding-top: 4px;
    border-top: 2px solid var(--np-ink);
  }
  .foot {
    display: flex;
    justify-content: flex-start;
    padding: 8px 12px 10px;
    border-top: 1px solid var(--np-ink);
  }

  /* The save register: one line per slot, as a ledger. */
  .slots {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--text);
    font-size: 0.86em;
    font-variant-numeric: tabular-nums;
  }
  .slots thead th {
    padding: 4px 6px;
    border-bottom: 2px solid var(--np-ink);
    font-weight: 600;
    font-size: 0.92em;
    text-align: left;
    color: var(--np-ink-2);
    white-space: nowrap;
  }
  .slots td,
  .slots tbody th {
    padding: 3px 6px;
    border-bottom: 1px solid var(--np-rule);
    text-align: left;
    font-weight: 400;
    color: var(--np-ink);
  }
  .slots .n {
    width: 2.2em;
    text-align: right;
  }
  .slots tbody .n {
    font-family: var(--title);
    font-weight: 700;
    color: var(--np-ink-2);
  }
  .slots .map {
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.04em;
  }
  .slots .when {
    white-space: nowrap;
    color: var(--np-ink-2);
  }
  .slots .act {
    width: 1%;
    text-align: right;
  }
  .slots tr.empty .map {
    font-style: italic;
    font-weight: 400;
    color: var(--np-ink-3);
  }
  .slots tr.empty .when {
    color: var(--np-ink-3);
  }

  /* The help: a reference page, the keys as figures in the right margin of each group. */
  .standfirst {
    margin: 6px 0 2px;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.08em;
    line-height: 1.4;
    color: var(--np-ink);
    text-wrap: pretty;
  }
  .mouse {
    margin: 0;
    padding: 0;
    list-style: none;
    columns: 2;
    column-gap: 28px;
  }
  .mouse li {
    break-inside: avoid;
    padding: 3px 0 5px 12px;
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.45;
    color: var(--np-ink-2);
    text-indent: -12px;
  }
  .mouse li::before {
    content: '— ';
    color: var(--np-rule-2);
  }
  .groups {
    columns: 2;
    column-gap: 28px;
  }
  .groups section {
    break-inside: avoid;
  }
  .groups dl {
    margin: 0;
  }
  .key {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 2px 0;
    border-bottom: 1px dotted var(--np-rule);
    font-family: var(--text);
    font-size: 0.84em;
  }
  .key dt {
    flex: 1;
    min-width: 0;
    color: var(--np-ink);
  }
  .key dd {
    margin: 0;
  }
  @media (max-width: 720px) {
    .mouse,
    .groups {
      columns: 1;
    }
  }
</style>
