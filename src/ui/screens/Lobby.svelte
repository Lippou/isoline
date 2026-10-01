<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { mapsBase, bridge, readText } from '../bridge';
  import { GENERALS, type GameConfig, type GameMode, type Difficulty } from '../../core/game/config';
  import { defaultGenParams } from '../../core/map/generator';
  import { parseIsoMap } from '../../core/map/format';
  import type { MapCategory } from '../../core/map/gamemap';
  import { startSolo, playerName } from './launch';
  import { currentLan, setCurrentLan } from '../../engine/lanClient';
  import type { LobbyState } from '../../server/protocol';
  import { settings } from '../stores/settings.svelte';
  import { audio } from '../../audio/audio';

  interface MapEntry {
    id: string;
    name: { fr: string; en: string };
    category: MapCategory;
    width: number;
    height: number;
    nations: number;
    custom?: string;
  }
  const lan = app.lobby.lan;
  const client = lan ? currentLan() : null;
  let lobby: LobbyState | null = $state(client?.lobby ?? null);
  const isHost = !client || client.host;
  let cfg: GameConfig = $state(lobby?.config ?? structuredClone($state.snapshot(app.lobby.config)));
  if (!lan)
    cfg.players = [
      { slot: 0, name: playerName(), kind: 'human', team: 1, general: cfg.players[0]?.general ?? 'blitz' },
    ];
  let maps: MapEntry[] = $state([]);
  let category = $state<MapCategory>('continents');
  let customs: MapEntry[] = $state([]);
  let gen = $state(defaultGenParams(cfg.seed));
  let chat = $state<{ name: string; text: string }[]>([]);
  let chatText = $state('');
  let ready = $state(false);

  const CATS: MapCategory[] = ['continents', 'regions', 'fictional', 'arcade', 'procedural', 'custom'];
  const MODES: GameMode[] = ['ffa', 'teams', 'humansVsNations', 'tribes', 'doomsday', 'battleRoyale'];
  const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'impossible'];
  const FEATURES = [
    'weather',
    'fog',
    'tech',
    'resources',
    'loyalty',
    'events',
    'generals',
    'air',
    'radar',
    'council',
  ] as const;
  const RULES = [
    'allowPorts',
    'allowNukes',
    'allowDonations',
    'allowFactories',
    'waterNukes',
    'decontamination',
    'allowSpectators',
  ] as const;

  onMount(async () => {
    try {
      maps = (await fetch(`${mapsBase()}index.json`).then((r) => r.json())) as MapEntry[];
    } catch {
      maps = [];
    }
    const list = await bridge.storage.list('maps');
    const out: MapEntry[] = [];
    for (const f of list) {
      if (!f.name.endsWith('.isomap')) continue;
      const text = await readText('maps', f.name);
      if (!text) continue;
      try {
        const m = parseIsoMap(text);
        out.push({
          id: `custom:${f.name}`,
          name: m.meta.name,
          category: 'custom',
          width: m.meta.width,
          height: m.meta.height,
          nations: m.meta.nations.length,
          custom: text,
        });
      } catch {
        /* skip broken files */
      }
    }
    customs = out;
    const current = [...maps, ...customs].find((m) => m.id === cfg.mapId);
    category = cfg.procedural ? 'procedural' : (current?.category ?? 'continents');
    if (client) {
      client.onLobby = (l) => {
        lobby = l;
        if (!isHost) cfg = l.config;
      };
      client.onChat = (m) => (chat = [...chat.slice(-60), { name: m.name, text: m.text }]);
      client.onStart = (config, playerId, _tick, snapshot) => {
        app.launch = { kind: 'lan', config, viewer: playerId, ...(snapshot ? { snapshot } : {}) };
        go('game');
      };
      client.onKicked = () => go('lan');
    }
  });

  onDestroy(() => {
    if (client && app.screen !== 'game') {
      client.close();
      setCurrentLan(null);
      if (client.host) void bridge.lan.stop();
    }
  });

  function pickMap(m: MapEntry): void {
    cfg.mapId = m.id;
    delete cfg.procedural;
    cfg.nations = Math.min(cfg.nations, Math.max(0, m.nations));
    push();
    audio.ui('click');
  }

  function pickProcedural(): void {
    cfg.mapId = `procedural-${gen.seed}`;
    cfg.procedural = { ...gen };
    push();
  }

  function push(): void {
    app.lobby.config = $state.snapshot(cfg) as GameConfig;
    if (client && isHost) client.send({ t: 'config', config: $state.snapshot(cfg) as GameConfig });
  }

  function start(): void {
    push();
    if (client) {
      client.send({ t: 'start' });
      return;
    }
    const custom = customs.find((m) => m.id === cfg.mapId)?.custom;
    startSolo($state.snapshot(cfg) as GameConfig, custom);
  }

  function sendChat(): void {
    const text = chatText.trim();
    chatText = '';
    if (text && client) client.send({ t: 'chat', channel: 'all', text });
  }

  const shown = $derived(category === 'custom' ? customs : maps.filter((m) => m.category === category));
  const me = $derived(lobby?.players.find((p) => p.slot === client?.slot));
</script>

<div class="lobby" data-testid="lobby">
  <header>
    <button class="btn ghost" onclick={() => go('title')}>← {t('common.back')}</button>
    <h1>{lan ? t('lobby.titleLan') : t('lobby.titleSolo')}</h1>
    {#if lobby}<span class="code chip">🔑 {t('lobby.code')} <b class="mono">{lobby.code}</b></span>{/if}
    <button class="btn primary start" onclick={start} disabled={!isHost} data-testid="lobby-start"
      >{t('lobby.start')}</button
    >
  </header>

  <div class="cols">
    <section class="maps glass">
      <nav class="cats">
        {#each CATS as c (c)}
          <button class="chip" class:on={category === c} onclick={() => (category = c)} disabled={!isHost}
            >{t(`mapcat.${c}`)}</button
          >
        {/each}
      </nav>
      {#if category === 'procedural'}
        <div class="gen">
          <label>{t('gen.seed')} <input type="number" bind:value={gen.seed} /></label>
          <label
            >{t('gen.size')}
            <select
              bind:value={
                () => `${gen.width}x${gen.height}`,
                (v) => {
                  const [w, h] = v.split('x').map(Number);
                  gen.width = w!;
                  gen.height = h!;
                }
              }
            >
              <option value="800x500">800 × 500</option>
              <option value="1200x800">1200 × 800</option>
              <option value="1600x1000">1600 × 1000</option>
              <option value="2000x1000">2000 × 1000</option>
            </select>
          </label>
          <label
            >{t('gen.land')}
            <input type="range" min="0.15" max="0.8" step="0.01" bind:value={gen.landRatio} /></label
          >
          <label
            >{t('gen.islands')}
            <input type="range" min="0" max="1" step="0.05" bind:value={gen.islands} /></label
          >
          <label
            >{t('gen.mountains')}
            <input type="range" min="0" max="1" step="0.05" bind:value={gen.mountains} /></label
          >
          <label
            >{t('gen.rivers')}
            <input type="range" min="0" max="1" step="0.05" bind:value={gen.rivers} /></label
          >
          <button class="btn" onclick={() => (gen.seed = (Math.random() * 1e9) >>> 0)}
            >🎲 {t('gen.reroll')}</button
          >
          <button class="btn primary" onclick={pickProcedural} disabled={!isHost}>{t('gen.use')}</button>
        </div>
      {:else}
        <div class="grid scroll">
          {#each shown as m (m.id)}
            <button
              class="map"
              class:on={cfg.mapId === m.id}
              onclick={() => pickMap(m)}
              disabled={!isHost}
              data-testid="map-{m.id}"
            >
              {#if !m.custom}<img src="{mapsBase()}{m.id}.thumb.png" alt="" loading="lazy" />{:else}<div
                  class="ph"
                >
                  ✎
                </div>{/if}
              <span class="mname">{m.name[i18n.lang] || m.name.en}</span>
              <span class="msize mono">{m.width}×{m.height} · {m.nations} {t('lobby.nationsShort')}</span>
            </button>
          {:else}
            <p class="empty">{t('lobby.noMaps')}</p>
          {/each}
        </div>
      {/if}
    </section>

    <section class="opts glass scroll">
      <h3>{t('lobby.rules')}</h3>
      <div class="form">
        <label
          >{t('lobby.mode')}
          <select bind:value={cfg.mode} onchange={push} disabled={!isHost} data-testid="opt-mode">
            {#each MODES as m (m)}<option value={m}>{t(`mode.${m}`)}</option>{/each}
          </select>
        </label>
        {#if cfg.mode === 'teams'}
          <label
            >{t('lobby.teams')}
            <input
              type="number"
              min="2"
              max="8"
              bind:value={cfg.teamCount}
              onchange={push}
              disabled={!isHost}
            /></label
          >
        {/if}
        <label
          >{t('lobby.difficulty')}
          <select bind:value={cfg.difficulty} onchange={push} disabled={!isHost}>
            {#each DIFFS as d (d)}<option value={d}>{t(`difficulty.${d}`)}</option>{/each}
          </select>
        </label>
        <label
          >{t('lobby.nations')} <b class="mono">{cfg.nations}</b><input
            type="range"
            min="0"
            max="100"
            bind:value={cfg.nations}
            onchange={push}
            disabled={!isHost}
            data-testid="opt-nations"
          /></label
        >
        <label
          >{t('lobby.tribes')} <b class="mono">{cfg.tribes}</b><input
            type="range"
            min="0"
            max="200"
            bind:value={cfg.tribes}
            onchange={push}
            disabled={!isHost}
          /></label
        >
        <label
          >{t('lobby.victory')} <b class="mono">{cfg.victoryThreshold}%</b><input
            type="range"
            min="50"
            max="100"
            bind:value={cfg.victoryThreshold}
            onchange={push}
            disabled={!isHost}
          /></label
        >
        <label
          >{t('lobby.spawn')} <b class="mono">{cfg.spawnSeconds}s</b><input
            type="range"
            min="15"
            max="60"
            bind:value={cfg.spawnSeconds}
            onchange={push}
            disabled={!isHost}
            data-testid="opt-spawn"
          /></label
        >
        <label
          >{t('lobby.gold')} <b class="mono">×{cfg.goldMultiplier}</b><input
            type="range"
            min="0.5"
            max="4"
            step="0.25"
            bind:value={cfg.goldMultiplier}
            onchange={push}
            disabled={!isHost}
          /></label
        >
        <label
          >{t('lobby.startGold')} <b class="mono">{(cfg.startGold ?? 0) / 1e6} M</b><input
            type="range"
            min="0"
            max="50000000"
            step="1000000"
            bind:value={cfg.startGold}
            onchange={push}
            disabled={!isHost}
          /></label
        >
        <label
          >{t('lobby.speed')} <b class="mono">×{cfg.gameSpeed}</b><input
            type="range"
            min="0.5"
            max="2"
            step="0.25"
            bind:value={cfg.gameSpeed}
            onchange={push}
            disabled={!isHost}
          /></label
        >
      </div>
      <h3>{t('lobby.toggles')}</h3>
      <div class="toggles">
        {#each RULES as r (r)}
          <label
            ><input type="checkbox" bind:checked={cfg[r]} onchange={push} disabled={!isHost} />
            {t(`rule.${r}`)}</label
          >
        {/each}
      </div>
      <h3>{t('lobby.features')}</h3>
      <div class="toggles">
        {#each FEATURES as f (f)}
          <label title={t(`feature.${f}.desc`)}
            ><input
              type="checkbox"
              bind:checked={cfg.features[f]}
              onchange={push}
              disabled={!isHost}
              data-testid="feat-{f}"
            />
            {t(`feature.${f}.name`)}</label
          >
        {/each}
      </div>
    </section>

    <section class="players glass">
      <h3>{t('lobby.players')}</h3>
      {#if !lan}
        <div class="me">
          <label
            >{t('lobby.name')}
            <input
              type="text"
              bind:value={cfg.players[0]!.name}
              maxlength="24"
              onchange={() => {
                settings.playerName = cfg.players[0]!.name;
                push();
              }}
            /></label
          >
          <label
            >{t('lobby.general')}
            <select bind:value={cfg.players[0]!.general} onchange={push}>
              {#each GENERALS as g (g)}<option value={g}>{t(`general.${g}.name`)}</option>{/each}
            </select>
          </label>
          <p class="gdesc">{t(`general.${cfg.players[0]!.general}.desc`)}</p>
          {#if cfg.mode === 'teams'}
            <label
              >{t('lobby.team')}
              <input
                type="number"
                min="1"
                max={cfg.teamCount}
                bind:value={cfg.players[0]!.team}
                onchange={push}
              /></label
            >
          {/if}
        </div>
      {:else if lobby}
        <ul class="plist">
          {#each lobby.players as p (p.slot)}
            <li class:off={!p.connected}>
              <span>{p.host ? '★ ' : ''}{p.name}{p.spectator ? ` (${t('lobby.spectator')})` : ''}</span>
              <span class="chip">{t('lobby.team')} {p.team || '—'}</span>
              <span class="chip">{t(`general.${p.general}.name`)}</span>
              <span class="chip" class:ok={p.ready}>{p.ready ? t('lobby.ready') : t('lobby.notReady')}</span>
              {#if isHost && !p.host}<button
                  class="x"
                  title={t('lobby.kick')}
                  onclick={() => client?.send({ t: 'kick', slot: p.slot })}>✕</button
                >{/if}
            </li>
          {/each}
        </ul>
        {#if me}
          <div class="me">
            <label
              >{t('lobby.general')}
              <select
                value={me.general}
                onchange={(e) =>
                  client?.send({
                    t: 'profile',
                    team: me.team,
                    general: (e.target as HTMLSelectElement).value as never,
                  })}
              >
                {#each GENERALS as g (g)}<option value={g}>{t(`general.${g}.name`)}</option>{/each}
              </select>
            </label>
            {#if cfg.mode === 'teams'}
              <label
                >{t('lobby.team')}
                <input
                  type="number"
                  min="1"
                  max={cfg.teamCount}
                  value={me.team}
                  onchange={(e) =>
                    client?.send({
                      t: 'profile',
                      team: Number((e.target as HTMLInputElement).value),
                      general: me.general,
                    })}
                /></label
              >
            {/if}
            <button
              class="btn"
              class:primary={ready}
              onclick={() => {
                ready = !ready;
                client?.send({ t: 'ready', ready });
              }}>{ready ? t('lobby.ready') : t('lobby.setReady')}</button
            >
          </div>
        {/if}
        <div class="chat">
          <ul class="scroll">
            {#each chat as c, k (k)}<li><b>{c.name}</b> {c.text}</li>{/each}
          </ul>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              sendChat();
            }}
          >
            <input type="text" bind:value={chatText} placeholder={t('chat.placeholder')} />
          </form>
        </div>
      {/if}
      <p class="summary">{t('lobby.summary', { nations: cfg.nations, tribes: cfg.tribes })}</p>
    </section>
  </div>
</div>

<style>
  .lobby {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    padding: 1.2rem 1.6rem;
    background: radial-gradient(ellipse at 20% 0%, #172947, var(--abyss) 60%);
  }
  header {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  header h1 {
    flex: 1;
    font-size: 1.7em;
  }
  .start {
    font-size: 1.1em;
    padding: 0.7em 1.6em;
  }
  .cols {
    display: grid;
    grid-template-columns: 1.4fr 1fr 0.9fr;
    gap: 1rem;
    min-height: 0;
  }
  .maps,
  .opts,
  .players {
    padding: 0.9rem;
    min-height: 0;
    display: grid;
    align-content: start;
    gap: 0.7rem;
  }
  .maps {
    grid-template-rows: auto 1fr;
  }
  .cats {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
  .chip {
    cursor: pointer;
    background: none;
  }
  .chip.on,
  .chip.ok {
    color: var(--aurora);
    border-color: var(--aurora);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 0.6rem;
    min-height: 0;
    align-content: start;
  }
  .map {
    display: grid;
    gap: 0.25rem;
    padding: 0.4rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 0.15s,
      transform 0.15s;
  }
  .map:hover {
    transform: translateY(-2px);
    border-color: var(--line-strong);
  }
  .map.on {
    border-color: var(--aurora);
    box-shadow: 0 0 0 2px rgba(79, 227, 193, 0.25);
  }
  .map img,
  .ph {
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    border-radius: 8px;
    background: #0e1a2e;
  }
  .ph {
    display: grid;
    place-items: center;
    font-size: 2em;
    color: var(--faint);
  }
  .mname {
    font-family: var(--title);
    font-weight: 600;
  }
  .msize {
    font-size: 0.75em;
    color: var(--faint);
  }
  .gen {
    display: grid;
    gap: 0.5rem;
  }
  .gen label,
  .form label {
    display: grid;
    gap: 0.2rem;
    font-size: 0.88em;
    color: var(--muted);
  }
  .form label b {
    color: var(--aurora);
  }
  .form {
    display: grid;
    gap: 0.55rem;
  }
  h3 {
    font-size: 1.02em;
  }
  .toggles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem 0.8rem;
    font-size: 0.86em;
  }
  .toggles label {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .me {
    display: grid;
    gap: 0.5rem;
  }
  .me label {
    display: grid;
    gap: 0.2rem;
    color: var(--muted);
    font-size: 0.88em;
  }
  .gdesc {
    margin: 0;
    color: var(--faint);
    font-size: 0.82em;
  }
  .plist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.35rem;
  }
  .plist li {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
    font-size: 0.86em;
  }
  .plist li.off {
    opacity: 0.5;
  }
  .x {
    background: none;
    border: 0;
    color: var(--signal);
    cursor: pointer;
  }
  .chat ul {
    list-style: none;
    padding: 0;
    margin: 0 0 0.3rem;
    max-height: 160px;
    font-size: 0.85em;
  }
  .chat input {
    width: 100%;
  }
  .summary {
    color: var(--faint);
    font-size: 0.82em;
  }
  .empty {
    color: var(--faint);
  }
</style>
