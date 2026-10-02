<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { bridge, isDesktop } from '../bridge';
  import { LanClient, setCurrentLan } from '../../engine/lanClient';
  import { playerName } from './launch';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';

  let games: Awaited<ReturnType<typeof bridge.lan.discover>> = $state([]);
  let addresses: string[] = $state([]);
  let manual = $state('');
  let code = $state('');
  let spectator = $state(false);
  let status = $state('');
  let timer: ReturnType<typeof setInterval> | null = null;

  async function scan(): Promise<void> {
    games = await bridge.lan.discover();
  }

  onMount(async () => {
    addresses = await bridge.lan.localAddresses();
    await scan();
    timer = setInterval(scan, 3000);
  });
  onDestroy(() => timer && clearInterval(timer));

  function join(url: string, invite: string): void {
    status = t('lan.connecting');
    const c = new LanClient(url);
    c.onReject = (r) => (status = t(`lan.reject.${r}`));
    c.onLobby = () => {
      setCurrentLan(c);
      app.lobby.lan = true;
      go('lobby');
    };
    c.connect(playerName(), invite.trim().toUpperCase(), spectator);
  }

  async function host(): Promise<void> {
    status = t('lan.starting');
    const res = await bridge.lan.host({
      name: `${playerName()} — Isoline`,
      config: $state.snapshot(app.lobby.config),
    });
    if ('error' in res) {
      status = res.error;
      return;
    }
    join(`ws://127.0.0.1:${res.port}`, res.code);
  }

  function joinManual(): void {
    const v = manual.trim();
    if (!v) return;
    join(v.startsWith('ws') ? v : `ws://${v}`, code);
  }
</script>

<div class="lan" data-testid="lan-browser">
  <PageHeader title={t('lan.title')} subtitle={t('lan.subtitle')} back="play" />
  {#if !isDesktop}<p class="warn chip warn">{t('lan.desktopOnly')}</p>{/if}
  <div class="cols">
    <section class="panel">
      <h3 class="section-title"><Icon name="network" size={14} />{t('lan.host')}</h3>
      <p class="hint">{t('lan.hostDesc')}</p>
      <ol class="steps hint">
        <li>{t('lan.hostStep1')}</li>
        <li>{t('lan.hostStep2')}</li>
        <li>{t('lan.hostStep3')}</li>
      </ol>
      <button class="btn primary" onclick={host} data-testid="lan-host"
        ><Icon name="play" size={15} />{t('lan.hostButton')}</button
      >
      {#if addresses.length}<p class="hint mono">{t('lan.yourIp')} : {addresses.join(', ')}</p>{/if}
    </section>
    <section class="panel">
      <h3 class="section-title"><Icon name="globe" size={14} />{t('lan.found')}</h3>
      <ul class="games">
        {#each games as g (g.host + g.port)}
          <li>
            <div>
              <b>{g.name}</b>
              <small
                >{g.map} · <Icon name="users" size={12} />{g.players}{g.started
                  ? ` · ${t('lan.inProgress')}`
                  : ''}</small
              >
            </div>
            <button class="btn small" onclick={() => join(`ws://${g.host}:${g.port}`, g.code)}
              >{g.started ? t('lan.spectate') : t('lan.join')}</button
            >
          </li>
        {:else}
          <li class="empty hint">{t('lan.none')}</li>
        {/each}
      </ul>
      <h3 class="section-title"><Icon name="key" size={14} />{t('lan.manual')}</h3>
      <p class="hint">{t('lan.manualHelp')}</p>
      <div class="manual">
        <label class="field"
          ><span>{t('lan.address')}</span><input
            type="text"
            placeholder="192.168.1.20:41234"
            bind:value={manual}
          /></label
        >
        <label class="field"
          ><span>{t('lan.code')}</span><input
            type="text"
            placeholder="ABC123"
            bind:value={code}
            maxlength="6"
          /></label
        >
        <label class="tog"><input type="checkbox" bind:checked={spectator} /> {t('lobby.spectator')}</label>
        <button class="btn" onclick={joinManual}><Icon name="next" size={14} />{t('lan.join')}</button>
      </div>
    </section>
  </div>
  {#if status}<p class="status chip">{status}</p>{/if}
</div>

<style>
  .lan {
    position: fixed;
    inset: 0;
    padding: 18px 22px;
    background: var(--abyss);
    overflow-y: auto;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    max-width: 1100px;
    margin: 0 auto;
  }
  section {
    padding: 16px 18px;
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .steps {
    margin: 0;
    padding-left: 1.2em;
    display: grid;
    gap: 4px;
  }
  .games {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: grid;
    gap: 4px;
  }
  .games li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  .games li div {
    display: grid;
  }
  .games small {
    color: var(--faint);
  }
  .games .empty {
    background: none;
    border: 0;
    padding: 6px 0;
  }
  .manual {
    display: grid;
    grid-template-columns: 1fr 140px;
    gap: 8px;
    align-items: end;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field span {
    color: var(--muted);
    font-size: 0.88em;
  }
  .tog {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .status {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 1em;
    padding: 0.5em 1em;
  }
  .warn {
    margin: 0 auto 12px;
    display: table;
  }
</style>
