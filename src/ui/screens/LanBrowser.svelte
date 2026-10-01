<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { bridge, isDesktop } from '../bridge';
  import { LanClient, setCurrentLan } from '../../engine/lanClient';
  import { playerName } from './launch';

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
  <header>
    <button class="btn ghost" onclick={() => go('play')}>← {t('common.back')}</button>
    <h1>{t('lan.title')}</h1>
  </header>
  {#if !isDesktop}<p class="warn">{t('lan.desktopOnly')}</p>{/if}
  <div class="cols">
    <section class="glass">
      <h3>{t('lan.host')}</h3>
      <p class="muted">{t('lan.hostDesc')}</p>
      <button class="btn primary" onclick={host} data-testid="lan-host">{t('lan.hostButton')}</button>
      {#if addresses.length}<p class="muted mono">{t('lan.yourIp')}: {addresses.join(', ')}</p>{/if}
    </section>
    <section class="glass">
      <h3>{t('lan.found')}</h3>
      <ul>
        {#each games as g (g.host + g.port)}
          <li>
            <span
              ><b>{g.name}</b> · {g.map} · {g.players} 👤{g.started ? ` · ${t('lan.inProgress')}` : ''}</span
            >
            <button class="btn" onclick={() => join(`ws://${g.host}:${g.port}`, g.code)}
              >{g.started ? t('lan.spectate') : t('lan.join')}</button
            >
          </li>
        {:else}
          <li class="muted">{t('lan.none')}</li>
        {/each}
      </ul>
      <h3>{t('lan.manual')}</h3>
      <div class="manual">
        <input type="text" placeholder="192.168.1.20:41234" bind:value={manual} />
        <input type="text" placeholder={t('lan.code')} bind:value={code} maxlength="6" />
        <label><input type="checkbox" bind:checked={spectator} /> {t('lobby.spectator')}</label>
        <button class="btn" onclick={joinManual}>{t('lan.join')}</button>
      </div>
    </section>
  </div>
  {#if status}<p class="status">{status}</p>{/if}
</div>

<style>
  .lan {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 1rem;
    background: radial-gradient(ellipse at 80% 0%, #172947, var(--abyss) 60%);
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 1rem;
    align-content: start;
  }
  section {
    padding: 1.1rem;
    display: grid;
    gap: 0.6rem;
    align-content: start;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.4rem;
  }
  li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.6rem;
  }
  .manual {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .muted {
    color: var(--faint);
  }
  .warn {
    color: var(--brass);
  }
  .status {
    color: var(--aurora);
  }
</style>
