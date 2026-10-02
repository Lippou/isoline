<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { bridge, isDesktop } from '../bridge';
  import { LanClient, setCurrentLan } from '../../engine/lanClient';
  import { playerName } from './launch';
  import { myFlag } from '../stores/profile.svelte';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import Isolines from '../components/Isolines.svelte';

  let games: Awaited<ReturnType<typeof bridge.lan.discover>> = $state([]);
  let addresses: string[] = $state([]);
  let manual = $state('');
  let code = $state('');
  let spectator = $state(false);
  let status = $state('');
  let busy = $state(false);
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
    c.connect(playerName(), invite.trim().toUpperCase(), spectator, myFlag());
  }

  async function host(): Promise<void> {
    status = t('lan.starting');
    busy = true;
    const res = await bridge.lan
      .host({
        name: `${playerName()} — Isoline`,
        config: $state.snapshot(app.lobby.config),
      })
      .finally(() => (busy = false));
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

<div class="page-shell" data-testid="lan-browser">
  <PageHeader title={t('lan.title')} subtitle={t('lan.subtitle')} back="play" />
  <div class="page-body body">
    {#if !isDesktop}<p class="warn chip warn">{t('lan.desktopOnly')}</p>{/if}
    <div class="cols">
      <section class="card">
        <header>
          <span class="key"><Icon name="network" size={18} /></span>
          <div>
            <h2>{t('lan.host')}</h2>
            <p>{t('lan.hostDesc')}</p>
          </div>
        </header>
        <ol class="steps">
          <li><span class="n">1</span>{t('lan.hostStep1')}</li>
          <li><span class="n">2</span>{t('lan.hostStep2')}</li>
          <li><span class="n">3</span>{t('lan.hostStep3')}</li>
        </ol>
        <button class="btn primary big" onclick={host} disabled={busy} data-testid="lan-host"
          ><Icon name="play" size={16} />{t('lan.hostButton')}</button
        >
        {#if addresses.length}
          <p class="ips"><span>{t('lan.yourIp')}</span><b class="mono">{addresses.join(', ')}</b></p>
        {/if}
      </section>

      <section class="card">
        <header>
          <span class="key"><Icon name="globe" size={18} /></span>
          <div>
            <h2>{t('lan.found')}</h2>
            <p>{t('lan.foundDesc')}</p>
          </div>
        </header>
        {#if games.length}
          <ul class="games">
            {#each games as g (g.host + g.port)}
              <li>
                <div>
                  <b>{g.name}</b>
                  <small
                    >{g.map}, <Icon name="users" size={12} />
                    {g.players}{g.started ? `, ${t('lan.inProgress')}` : ''}</small
                  >
                </div>
                <button class="btn small" onclick={() => join(`ws://${g.host}:${g.port}`, g.code)}
                  >{g.started ? t('lan.spectate') : t('lan.join')}</button
                >
              </li>
            {/each}
          </ul>
        {:else}
          <div class="scan" role="status">
            <div class="sonar">
              <Isolines mode="ripple" count={4} r0={5} step={5} duration={2.4} stagger={0.6} />
            </div>
            <span>{t('lan.none')}</span>
          </div>
        {/if}

        <h3>{t('lan.manual')}</h3>
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
          <label class="tog"
            ><input class="switch" type="checkbox" bind:checked={spectator} />
            {t('lan.asSpectator')}</label
          >
          <button class="btn" onclick={joinManual}><Icon name="next" size={14} />{t('lan.join')}</button>
        </div>
      </section>
    </div>
  </div>
  {#if status}<p class="status" role="status">{status}</p>{/if}
</div>

<style>
  .body {
    overflow-y: auto;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    align-items: start;
  }
  .card {
    padding: 22px 24px;
    display: grid;
    gap: 14px;
    align-content: start;
    background: var(--panel-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .card header {
    display: grid;
    grid-template-columns: 38px 1fr;
    gap: 14px;
    align-items: start;
  }
  .key {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    color: var(--aurora);
  }
  .card h2 {
    font-size: 1.3em;
  }
  .card header p {
    margin: 3px 0 0;
    color: var(--muted);
    line-height: 1.5;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 26px 1fr;
    gap: 12px;
    align-items: baseline;
    line-height: 1.45;
  }
  .n {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 1.5px solid var(--parchment);
    border-radius: 50%;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.9em;
    transform: translateY(-1px);
  }
  .big {
    justify-self: start;
    font-size: 1.05em;
    padding: 0.7em 1.3em;
  }
  .ips {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    color: var(--muted);
    font-size: 0.92em;
  }
  .ips b {
    color: var(--parchment);
    font-weight: 600;
  }
  .games {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  .games li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    animation: found 0.3s ease-out both;
  }
  @keyframes found {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .games li div {
    display: grid;
  }
  .games small {
    color: var(--muted);
  }
  .scan {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 10px 12px;
    border: 1px dashed var(--line-strong);
    border-radius: 4px;
    color: var(--muted);
  }
  .sonar {
    position: relative;
    flex: none;
    width: 52px;
    height: 52px;
    color: var(--aurora);
  }
  h3 {
    font-size: 1.05em;
    margin-top: 8px;
  }
  .hint {
    margin: -8px 0 0;
  }
  .manual {
    display: grid;
    grid-template-columns: 1fr 140px;
    gap: 12px;
    align-items: end;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .field span {
    font-weight: 500;
    font-size: 0.93em;
  }
  .field input {
    min-width: 0;
  }
  .tog {
    display: flex;
    gap: 10px;
    align-items: center;
    cursor: var(--cursor-pointer, pointer);
  }
  .status {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.6em 1.1em;
    background: var(--tip-bg);
    color: #eef3f2;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    animation: toast 0.25s ease-out both;
  }
  @keyframes toast {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }
  .warn {
    margin: 0 0 14px;
    display: inline-flex;
  }
</style>
