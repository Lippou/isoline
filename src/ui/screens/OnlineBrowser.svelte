<script lang="ts">
  // Browser version (the Binotech server, server/online.ts): playing together online instead
  // of on a local network. The name I play under, open a room, the rooms open, a code.
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { i18n, t } from '../i18n/i18n.svelte';
  import { mapsBase } from '../bridge';
  import { LanClient, setCurrentLan } from '../../engine/lanClient';
  import { myFlag } from '../stores/profile.svelte';
  import { onlineApi, onlineWs, webBuild, type RoomInfo } from './online';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import Isolines from '../components/Isolines.svelte';

  let pseudo = $state('');
  let saved = $state('');
  let rooms: RoomInfo[] = $state([]);
  let loaded = $state(false);
  let code = $state('');
  let status = $state('');
  let busy = $state(false);
  let mapNames: Record<string, { fr: string; en: string }> = $state({});
  let timer: ReturnType<typeof setInterval> | null = null;

  const err = (e: string) => t(`online.error.${e}`);
  // A message stays a few seconds, then leaves the buttons under it free.
  $effect(() => {
    if (!status) return;
    const id = setTimeout(() => (status = ''), 6000);
    return () => clearTimeout(id);
  });

  async function scan(): Promise<void> {
    const r = await onlineApi<{ rooms: RoomInfo[] }>('rooms');
    if ('error' in r) {
      if (!loaded) status = err(r.error);
      return;
    }
    rooms = r.rooms;
    loaded = true;
  }

  onMount(async () => {
    const me = await onlineApi<{ pseudo: string }>('me');
    if ('error' in me) status = err(me.error);
    else pseudo = saved = me.pseudo;
    await scan();
    timer = setInterval(scan, 3000);
    try {
      const idx = (await fetch(`${mapsBase()}index.json`).then((r) => r.json())) as {
        id: string;
        name: { fr: string; en: string };
      }[];
      mapNames = Object.fromEntries(idx.map((m) => [m.id, m.name]));
    } catch {
      /* the ids, then */
    }
  });
  onDestroy(() => timer && clearInterval(timer));

  async function rename(): Promise<void> {
    const r = await onlineApi<{ pseudo: string }>('me', { pseudo });
    if ('error' in r) status = r.error === 'pseudo' ? t('online.badPseudo') : err(r.error);
    else {
      pseudo = saved = r.pseudo;
      status = t('online.saved');
    }
  }

  function join(room: string, spectator = false): void {
    status = t('lan.connecting');
    const c = new LanClient(onlineWs(room));
    c.onReject = (r) => {
      busy = false;
      status = t(`lan.reject.${r}`, { host: '?', mine: app.version });
    };
    c.onLobby = () => {
      setCurrentLan(c);
      app.lobby.lan = true;
      go('lobby');
    };
    // A game already under way (my nation again, or a spectator's seat) starts at once, before
    // the room's screen is there to hear it.
    c.onStart = (config, playerId, _tick, snapshot) => {
      setCurrentLan(c);
      app.lobby.lan = true;
      app.launch = { kind: 'lan', config, viewer: playerId, ...(snapshot ? { snapshot } : {}) };
      go('game');
    };
    c.connect(saved || pseudo, room.trim().toUpperCase(), spectator, myFlag(), webBuild());
  }

  async function open(): Promise<void> {
    if (pseudo !== saved && pseudo.trim()) await rename();
    busy = true;
    status = t('online.opening');
    const config = $state.snapshot(app.lobby.config);
    // A map of my own (saved in this browser) cannot be played on the server: the world, then.
    if (config.mapId.startsWith('custom:')) config.mapId = 'world';
    const r = await onlineApi<{ code: string }>('rooms', { config });
    if ('error' in r) {
      busy = false;
      status = err(r.error);
      return;
    }
    join(r.code);
  }

  const mapName = (r: RoomInfo) =>
    r.procedural ? t('online.generated') : (mapNames[r.map]?.[i18n.lang] ?? mapNames[r.map]?.en ?? r.map);
</script>

<div class="page-shell" data-testid="online-browser">
  <PageHeader title={t('online.title')} subtitle={t('online.subtitle')} back="play" />
  <div class="page-body body">
    <div class="cols">
      <section class="card">
        <header>
          <span class="key"><Icon name="users" size={18} /></span>
          <div>
            <h2>{t('online.you')}</h2>
            <p>{t('online.youHelp')}</p>
          </div>
        </header>
        <form
          class="row"
          onsubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <input
            type="text"
            bind:value={pseudo}
            maxlength="24"
            autocomplete="nickname"
            aria-label={t('online.you')}
            data-testid="online-pseudo"
          />
          <button class="btn" disabled={!pseudo.trim() || pseudo === saved} data-testid="online-save"
            ><Icon name="check" size={14} />{t('online.save')}</button
          >
        </form>

        <header class="next">
          <span class="key"><Icon name="play" size={18} /></span>
          <div>
            <h2>{t('online.open')}</h2>
            <p>{t('online.openDesc')}</p>
          </div>
        </header>
        <button class="btn primary big" onclick={open} disabled={busy} data-testid="online-open"
          ><Icon name="play" size={16} />{t('online.openButton')}</button
        >
      </section>

      <section class="card">
        <header>
          <span class="key"><Icon name="globe" size={18} /></span>
          <div>
            <h2>{t('online.rooms')}</h2>
            <p>{t('online.roomsDesc')}</p>
          </div>
        </header>
        {#if rooms.length}
          <ul class="games" data-testid="online-rooms">
            {#each rooms as r (r.code)}
              <li>
                <div>
                  <b>{t('online.roomOf', { name: r.host || r.name })}</b>
                  <small
                    >{mapName(r)}, <Icon name="users" size={12} />
                    {r.players === 1 ? t('online.playersOne') : t('online.players', { n: r.players })}, {r.started
                      ? t('online.playing')
                      : t('online.waiting')}</small
                  >
                </div>
                {#if !r.started}
                  <button class="btn small" onclick={() => join(r.code)} data-testid="online-join"
                    >{t('online.join')}</button
                  >
                {:else if r.seat}
                  <button class="btn small primary" onclick={() => join(r.code)} data-testid="online-resume"
                    >{t('online.resume')}</button
                  >
                {:else if r.spectate}
                  <button class="btn small" onclick={() => join(r.code, true)}>{t('online.watch')}</button>
                {:else}
                  <button class="btn small" disabled>{t('online.closed')}</button>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="scan" role="status">
            <div class="sonar">
              <Isolines mode="ripple" count={4} r0={5} step={5} duration={2.4} stagger={0.6} />
            </div>
            <span>{t('online.none')}</span>
          </div>
        {/if}

        <h3>{t('online.byCode')}</h3>
        <p class="hint">{t('online.byCodeHelp')}</p>
        <form
          class="row"
          onsubmit={(e) => {
            e.preventDefault();
            if (code.trim()) join(code);
          }}
        >
          <input
            class="mono"
            type="text"
            placeholder="ABC123"
            bind:value={code}
            maxlength="6"
            autocapitalize="characters"
            autocomplete="off"
            aria-label={t('lan.code')}
            data-testid="online-code"
          />
          <button class="btn" disabled={code.trim().length !== 6}
            ><Icon name="next" size={14} />{t('online.join')}</button
          >
        </form>
      </section>
    </div>
  </div>
  {#if status}<p class="status" role="status">{status}</p>{/if}
</div>

<style>
  .body {
    overflow-y: auto;
  }
  /* Two columns of the page, a fine rule between: me and my room, then the others'. */
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: start;
  }
  .card {
    padding: 2px 26px 12px 0;
    display: grid;
    gap: 14px;
    align-content: start;
  }
  .card + .card {
    padding: 2px 0 12px 26px;
    border-left: 1px solid var(--np-rule);
  }
  .card header {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 2px 10px;
    align-items: baseline;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--np-ink);
  }
  .card header.next {
    margin-top: 12px;
  }
  .key {
    display: grid;
    place-items: center;
    color: var(--np-ink);
    transform: translateY(3px);
  }
  .card h2 {
    font-weight: 700;
    font-size: 1.4em;
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  .card header p {
    margin: 3px 0 0;
    font-family: var(--np-serif);
    font-style: italic;
    font-size: 0.9em;
    color: var(--np-ink-2);
    line-height: 1.5;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
  }
  .row input {
    min-width: 0;
  }
  .big {
    justify-self: start;
    font-size: 1.05em;
    padding: 0.7em 1.3em;
  }
  .games {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
  }
  .games li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--np-rule);
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
    min-width: 0;
  }
  .games b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.06em;
  }
  .games small {
    color: var(--np-ink-2);
  }
  .games .btn {
    flex: none;
  }
  .scan {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 4px 0 8px;
    border-bottom: 1px solid var(--np-rule);
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .sonar {
    position: relative;
    flex: none;
    width: 52px;
    height: 52px;
    color: var(--np-sea);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    font-size: 1.05em;
  }
  h3::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--np-rule);
  }
  .hint {
    margin: -8px 0 0;
    font-family: var(--np-serif);
  }
  .status {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 32px);
    margin: 0;
    padding: 0.55em 1.1em;
    background: var(--np-ink);
    color: var(--np-paper);
    border-radius: 2px;
    box-shadow: 3px 3px 0 var(--np-paper-2);
    animation: toast 0.25s ease-out both;
  }
  @keyframes toast {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }

  /* ——— Téléphone (html.phone) : moi et mon salon, puis les salons des autres, l'un sous l'autre. */
  :global(html.phone) .cols {
    grid-template-columns: minmax(0, 1fr);
    gap: 22px;
  }
  :global(html.phone) .card,
  :global(html.phone) .card + .card {
    padding: 0;
    border-left: none;
  }
  :global(html.phone) .card + .card {
    padding-top: 18px;
    border-top: 1px solid var(--np-rule);
  }
  :global(html.phone) .big {
    justify-self: stretch;
    justify-content: center;
  }
</style>
