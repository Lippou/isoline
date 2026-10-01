<script lang="ts">
  import { hud, toast } from '../stores/game.svelte';
  import { t, date, i18n } from '../i18n/i18n.svelte';
  import { go, confirmModal } from '../stores/app.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { listSaves, SAVE_SLOTS, type SaveInfo } from '../game/saves';
  import { onMount } from 'svelte';
  import SettingsBody from '../screens/SettingsBody.svelte';

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

  async function openSave(): Promise<void> {
    saves = await listSaves();
    view = 'save';
  }
  async function save(slot: number): Promise<void> {
    const ok = await ctl.saveGame(slot);
    toast(ok ? t('menu.saved', { slot }) : t('menu.saveFailed'), ok ? 'good' : 'warn');
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
  const keys = [
    'attackHover',
    'boatHover',
    'ratioDown',
    'ratioUp',
    'buildCity',
    'buildPort',
    'buildFactory',
    'buildDefense',
    'buildSilo',
    'buildSam',
    'warship',
    'nukeA',
    'nukeH',
    'nukeMirv',
    'allyAccept',
    'allyRefuse',
    'selectWarships',
    'terrainView',
    'fogView',
    'resourcesView',
    'loyaltyView',
    'home',
    'chat',
    'pause',
    'general',
    'screenshot',
    'fps',
  ];
</script>

<div class="overlay fade-in" data-testid="game-menu">
  <div class="menu glass rise-in" class:wide={view !== 'main'}>
    {#if view === 'main'}
      <h2>{t('menu.title')}</h2>
      <button class="btn primary" onclick={() => (hud.panels.menu = false)}>{t('menu.resume')}</button>
      {#if solo}<button class="btn" onclick={openSave}>{t('menu.save')}</button>{/if}
      <button class="btn" onclick={() => (view = 'settings')}>{t('menu.settings')}</button>
      <button class="btn" onclick={() => (view = 'help')}>{t('menu.help')}</button>
      {#if !hud.spectating && hud.local?.alive && ctl.session.kind !== 'replay'}
        <button
          class="btn danger"
          onclick={() =>
            confirmModal(
              t('menu.surrenderTitle'),
              t('menu.surrenderBody'),
              () => ctl.session.cmd({ t: 'surrender' }),
              t('menu.surrender'),
              t('common.cancel'),
            )}>{t('menu.surrender')}</button
        >
      {/if}
      <button class="btn danger" onclick={quit} data-testid="menu-quit">{t('menu.quit')}</button>
    {:else if view === 'save'}
      <h2>{t('menu.save')}</h2>
      <div class="slots">
        {#each Array.from({ length: SAVE_SLOTS }, (_, k) => k + 1) as slot (slot)}
          {@const s = saves.find((x) => x.slot === slot)}
          <button class="slot" onclick={() => save(slot)}>
            <b>{t('menu.slot', { slot })}</b>
            <span>{s ? `${s.mapName[i18n.lang]} · ${date(Date.parse(s.date))}` : t('menu.empty')}</span>
          </button>
        {/each}
      </div>
      <button class="btn" onclick={() => (view = 'main')}>{t('common.back')}</button>
    {:else if view === 'settings'}
      <h2>{t('menu.settings')}</h2>
      <div class="scroll settings"><SettingsBody /></div>
      <button class="btn" onclick={() => (view = 'main')}>{t('common.back')}</button>
    {:else}
      <h2>{t('menu.help')}</h2>
      <div class="help scroll">
        <p>{t('help.intro')}</p>
        <ul>
          <li>{t('help.click')}</li>
          <li>{t('help.radial')}</li>
          <li>{t('help.drag')}</li>
          <li>{t('help.wheel')}</li>
        </ul>
        <table>
          <tbody>
            {#each keys as k (k)}
              <tr><td>{t(`keys.${k}`)}</td><td><kbd>{keyLabel(settings.keys[k] ?? '')}</kbd></td></tr>
            {/each}
          </tbody>
        </table>
      </div>
      <button class="btn" onclick={() => (view = 'main')}>{t('common.back')}</button>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    background: rgba(4, 8, 16, 0.55);
    display: grid;
    place-items: center;
    z-index: 70;
  }
  .menu {
    width: 340px;
    padding: 1.4rem;
    display: grid;
    gap: 0.6rem;
  }
  .menu.wide {
    width: min(760px, 92vw);
    max-height: 88vh;
    grid-template-rows: auto 1fr auto;
  }
  h2 {
    text-align: center;
    margin-bottom: 0.4rem;
  }
  .slots {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }
  .slot {
    display: grid;
    text-align: left;
    gap: 0.1rem;
    padding: 0.5rem 0.7rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.03);
    cursor: pointer;
  }
  .slot:hover {
    border-color: var(--aurora);
  }
  .slot span {
    color: var(--faint);
    font-size: 0.85em;
  }
  .settings,
  .help {
    max-height: 62vh;
    padding-right: 0.4rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9em;
  }
  td {
    padding: 0.2rem 0.3rem;
    border-bottom: 1px solid var(--line);
  }
  kbd {
    font-family: var(--mono);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 0.4em;
  }
</style>
