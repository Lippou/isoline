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
  import Icon from '../icons/Icon.svelte';

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
  // Address other players type in "manual join" (the host's LAN IPs + game port).
  const port = client ? (client.url.match(/:(\d+)\/?$/)?.[1] ?? '') : '';
  let hostAddresses = $state<string[]>([]);
  if (client?.host) void bridge.lan.localAddresses().then((a) => (hostAddresses = a));
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
  const selected = $derived([...maps, ...customs].find((m) => m.id === cfg.mapId));
  const featureCount = $derived(FEATURES.filter((f) => cfg.features[f]).length);
  const me = $derived(lobby?.players.find((p) => p.slot === client?.slot));
</script>

<div class="lobby" data-testid="lobby">
  <header>
    <button class="btn ghost" onclick={() => go('title')}
      ><Icon name="back" size={16} />{t('common.back')}</button
    >
    <div class="htitle">
      <h1>{lan ? t('lobby.titleLan') : t('lobby.titleSolo')}</h1>
      <span class="hint">{lan ? t('lobby.subtitleLan') : t('lobby.subtitleSolo')}</span>
    </div>
    {#if lobby}<span class="chip big" data-testid="lobby-code"
        ><Icon name="key" size={14} />{t('lobby.code')} <b class="mono">{lobby.code}</b></span
      >{/if}
    {#if client?.host && port}<span
        class="chip big mono"
        data-testid="lobby-address"
        data-tip={t('lobby.addressTip')}
        ><Icon name="network" size={14} />{(hostAddresses[0] ?? '127.0.0.1') + ':' + port}</span
      >{/if}
  </header>

  <div class="cols">
    <!-- 1. Map -->
    <section class="maps panel">
      <h3 class="section-title"><Icon name="territory" size={14} />{t('lobby.stepMap')}</h3>
      <nav class="tabs">
        {#each CATS as c (c)}
          <button class="tab" class:on={category === c} onclick={() => (category = c)} disabled={!isHost}
            >{t(`mapcat.${c}`)}</button
          >
        {/each}
      </nav>
      {#if category === 'procedural'}
        <div class="gen">
          <p class="hint">{t('gen.intro')}</p>
          <label class="field"
            ><span>{t('gen.seed')}</span>
            <span class="row"
              ><input type="number" bind:value={gen.seed} /><button
                class="btn small"
                onclick={() => (gen.seed = (Math.random() * 1e9) >>> 0)}
                ><Icon name="dice" size={14} />{t('gen.reroll')}</button
              ></span
            ></label
          >
          <label class="field"
            ><span>{t('gen.size')}</span>
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
              <option value="800x500">800 × 500 — {t('gen.small')}</option>
              <option value="1200x800">1200 × 800 — {t('gen.medium')}</option>
              <option value="1600x1000">1600 × 1000 — {t('gen.large')}</option>
              <option value="2000x1000">2000 × 1000 — {t('gen.huge')}</option>
            </select>
          </label>
          <label class="field"
            ><span>{t('gen.land')} <b class="mono">{Math.round(gen.landRatio * 100)} %</b></span>
            <input type="range" min="0.15" max="0.8" step="0.01" bind:value={gen.landRatio} /></label
          >
          <label class="field"
            ><span>{t('gen.islands')} <b class="mono">{Math.round(gen.islands * 100)} %</b></span>
            <input type="range" min="0" max="1" step="0.05" bind:value={gen.islands} /></label
          >
          <label class="field"
            ><span>{t('gen.mountains')} <b class="mono">{Math.round(gen.mountains * 100)} %</b></span>
            <input type="range" min="0" max="1" step="0.05" bind:value={gen.mountains} /></label
          >
          <label class="field"
            ><span>{t('gen.rivers')} <b class="mono">{Math.round(gen.rivers * 100)} %</b></span>
            <input type="range" min="0" max="1" step="0.05" bind:value={gen.rivers} /></label
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
                  <Icon name="edit" size={22} />
                </div>{/if}
              <span class="mname">{m.name[i18n.lang] || m.name.en}</span>
              <span class="msize">{m.nations} {t('lobby.nationsShort')}</span>
            </button>
          {:else}
            <p class="empty hint">{t('lobby.noMaps')}</p>
          {/each}
        </div>
      {/if}
    </section>

    <!-- 2. Settings -->
    <section class="opts panel scroll">
      <h3 class="section-title"><Icon name="settings" size={14} />{t('lobby.stepRules')}</h3>

      <div class="group">
        <h4>{t('lobby.gGame')}</h4>
        <label class="field"
          ><span>{t('lobby.mode')}</span>
          <select bind:value={cfg.mode} onchange={push} disabled={!isHost} data-testid="opt-mode">
            {#each MODES as m (m)}<option value={m}>{t(`mode.${m}`)}</option>{/each}
          </select>
          <small>{t(`modeDesc.${cfg.mode}`)}</small>
        </label>
        {#if cfg.mode === 'teams'}
          <label class="field"
            ><span>{t('lobby.teams')}</span>
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
        <label class="field"
          ><span>{t('lobby.difficulty')}</span>
          <div class="seg">
            {#each DIFFS as d (d)}
              <button
                class:on={cfg.difficulty === d}
                disabled={!isHost}
                onclick={() => {
                  cfg.difficulty = d;
                  push();
                }}>{t(`difficulty.${d}`)}</button
              >
            {/each}
          </div>
          <small>{t(`difficultyDesc.${cfg.difficulty}`)}</small>
        </label>
      </div>

      <div class="group">
        <h4>{t('lobby.gOpponents')}</h4>
        <label class="field"
          ><span>{t('lobby.nations')} <b class="mono">{cfg.nations}</b></span><input
            type="range"
            min="0"
            max={Math.min(100, selected?.nations ?? 100)}
            bind:value={cfg.nations}
            onchange={push}
            disabled={!isHost}
            data-testid="opt-nations"
          /><small>{t('lobby.nationsHelp')}</small></label
        >
        <label class="field"
          ><span>{t('lobby.tribes')} <b class="mono">{cfg.tribes}</b></span><input
            type="range"
            min="0"
            max="200"
            bind:value={cfg.tribes}
            onchange={push}
            disabled={!isHost}
          /><small>{t('lobby.tribesHelp')}</small></label
        >
      </div>

      <div class="group">
        <h4>{t('lobby.gVictory')}</h4>
        <label class="field"
          ><span>{t('lobby.victory')} <b class="mono">{cfg.victoryThreshold} %</b></span><input
            type="range"
            min="50"
            max="100"
            bind:value={cfg.victoryThreshold}
            onchange={push}
            disabled={!isHost}
          /><small>{t('lobby.victoryHelp')}</small></label
        >
        <label class="field"
          ><span>{t('lobby.spawn')} <b class="mono">{cfg.spawnSeconds} s</b></span><input
            type="range"
            min="15"
            max="90"
            bind:value={cfg.spawnSeconds}
            onchange={push}
            disabled={!isHost}
            data-testid="opt-spawn"
          /><small>{t('lobby.spawnHelp')}</small></label
        >
      </div>

      <div class="group">
        <h4>{t('lobby.gEconomy')}</h4>
        <label class="field"
          ><span>{t('lobby.gold')} <b class="mono">×{cfg.goldMultiplier}</b></span><input
            type="range"
            min="0.5"
            max="4"
            step="0.25"
            bind:value={cfg.goldMultiplier}
            onchange={push}
            disabled={!isHost}
          /></label
        >
        <label class="field"
          ><span>{t('lobby.startGold')} <b class="mono">{(cfg.startGold ?? 0) / 1e6} M</b></span><input
            type="range"
            min="0"
            max="50000000"
            step="1000000"
            bind:value={cfg.startGold}
            onchange={push}
            disabled={!isHost}
          /></label
        >
        <label class="field"
          ><span>{t('lobby.speed')} <b class="mono">×{cfg.gameSpeed}</b></span><input
            type="range"
            min="0.5"
            max="2"
            step="0.25"
            bind:value={cfg.gameSpeed}
            onchange={push}
            disabled={!isHost}
          /><small>{t('lobby.speedHelp')}</small></label
        >
      </div>

      <div class="group">
        <h4>{t('lobby.toggles')}</h4>
        <div class="toggles">
          {#each RULES as r (r)}
            <label class="tog" data-tip={t(`ruleDesc.${r}`)}
              ><input type="checkbox" bind:checked={cfg[r]} onchange={push} disabled={!isHost} />
              <span>{t(`rule.${r}`)}</span></label
            >
          {/each}
        </div>
      </div>

      <div class="group">
        <h4>{t('lobby.features')} <span class="mono cnt">{featureCount}/{FEATURES.length}</span></h4>
        <div class="toggles feats">
          {#each FEATURES as f (f)}
            <label class="tog feat">
              <input
                type="checkbox"
                bind:checked={cfg.features[f]}
                onchange={push}
                disabled={!isHost}
                data-testid="feat-{f}"
              />
              <span><b>{t(`feature.${f}.name`)}</b><small>{t(`feature.${f}.desc`)}</small></span>
            </label>
          {/each}
        </div>
      </div>
    </section>

    <!-- 3. Summary & players -->
    <section class="side panel">
      <h3 class="section-title"><Icon name="surrender" size={14} />{t('lobby.stepLaunch')}</h3>
      {#if selected && !selected.custom}
        <img class="preview" src="{mapsBase()}{selected.id}.thumb.png" alt="" />
      {/if}
      <div class="mapname">
        <b
          >{cfg.procedural
            ? t('mapcat.procedural')
            : selected
              ? selected.name[i18n.lang] || selected.name.en
              : '—'}</b
        >
        {#if selected}<span class="mono">{selected.width} × {selected.height}</span>{/if}
      </div>
      <p class="summary">
        {t('lobby.summaryLong', {
          mode: t(`mode.${cfg.mode}`),
          diff: t(`difficulty.${cfg.difficulty}`),
          nations: cfg.nations,
          tribes: cfg.tribes,
          pct: cfg.victoryThreshold,
        })}
      </p>

      <div class="who">
        {#if !lan}
          <label class="field"
            ><span>{t('lobby.name')}</span>
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
          <label class="field"
            ><span>{t('lobby.general')}</span>
            <select bind:value={cfg.players[0]!.general} onchange={push}>
              {#each GENERALS as g (g)}<option value={g}>{t(`general.${g}.name`)}</option>{/each}
            </select>
            <small>{t(`general.${cfg.players[0]!.general}.desc`)}</small>
          </label>
          {#if cfg.mode === 'teams'}
            <label class="field"
              ><span>{t('lobby.team')}</span>
              <input
                type="number"
                min="1"
                max={cfg.teamCount}
                bind:value={cfg.players[0]!.team}
                onchange={push}
              /></label
            >
          {/if}
        {:else if lobby}
          <ul class="plist">
            {#each lobby.players as p (p.slot)}
              <li class:off={!p.connected}>
                <span class="pn"
                  >{#if p.host}<Icon name="leader" size={13} />{/if}{p.name}{p.spectator
                    ? ` (${t('lobby.spectator')})`
                    : ''}</span
                >
                <span class="chip">{t('lobby.team')} {p.team || '—'}</span>
                <span class="chip" class:good={p.ready}
                  >{p.ready ? t('lobby.ready') : t('lobby.notReady')}</span
                >
                {#if isHost && !p.host}<button
                    class="x"
                    title={t('lobby.kick')}
                    aria-label={t('lobby.kick')}
                    onclick={() => client?.send({ t: 'kick', slot: p.slot })}
                    ><Icon name="close" size={13} /></button
                  >{/if}
              </li>
            {/each}
          </ul>
          {#if me}
            <label class="field"
              ><span>{t('lobby.general')}</span>
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
              <label class="field"
                ><span>{t('lobby.team')}</span>
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
              }}><Icon name="check" size={14} />{ready ? t('lobby.ready') : t('lobby.setReady')}</button
            >
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
      </div>

      <button class="btn primary start" onclick={start} disabled={!isHost} data-testid="lobby-start"
        ><Icon name="play" size={18} />{t('lobby.start')}</button
      >
      {#if !isHost}<p class="hint">{t('lobby.waitHost')}</p>{/if}
    </section>
  </div>
</div>

<style>
  .lobby {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 14px;
    padding: 18px 22px;
    background: var(--abyss);
  }
  header {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .htitle {
    flex: 1;
    display: grid;
  }
  .chip.big {
    font-size: 0.95em;
    padding: 0.35em 0.7em;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(360px, 1.15fr) minmax(300px, 0.9fr);
    gap: 14px;
    min-height: 0;
  }
  .cols > section {
    padding: 14px 16px;
    min-height: 0;
  }
  .maps {
    display: grid;
    grid-template-rows: auto auto 1fr;
    gap: 10px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    background: none;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    padding: 6px 10px;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--parchment);
  }
  .tab.on {
    color: var(--parchment);
    border-bottom-color: var(--brass);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
    align-content: start;
    min-height: 0;
    padding-right: 4px;
  }
  .map {
    display: grid;
    gap: 3px;
    padding: 6px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    color: var(--parchment);
  }
  .map:hover {
    border-color: var(--line-strong);
  }
  .map.on {
    border-color: var(--brass);
    box-shadow: inset 0 0 0 1px var(--brass);
  }
  .map img,
  .ph {
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    border-radius: 2px;
    background: #0b1016;
  }
  .ph {
    display: grid;
    place-items: center;
    color: var(--faint);
  }
  .mname {
    font-weight: 600;
    font-size: 0.92em;
  }
  .msize {
    font-size: 0.78em;
    color: var(--faint);
  }
  .gen {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .opts {
    display: grid;
    align-content: start;
    gap: 6px;
  }
  .group {
    display: grid;
    gap: 10px;
    padding: 10px 0 12px;
    border-bottom: 1px solid var(--line);
  }
  .group:last-child {
    border-bottom: 0;
  }
  .group h4 {
    margin: 0;
    font-family: var(--title);
    font-size: 1em;
    display: flex;
    justify-content: space-between;
  }
  .cnt {
    color: var(--faint);
    font-size: 0.85em;
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field > span {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
    font-size: 0.9em;
  }
  .field > span b {
    color: var(--parchment);
  }
  .field small {
    color: var(--faint);
    font-size: 0.8em;
    line-height: 1.35;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row input {
    flex: 1;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    overflow: hidden;
  }
  .seg button {
    background: var(--panel-2);
    border: 0;
    border-right: 1px solid var(--line);
    color: var(--muted);
    padding: 6px 2px;
    cursor: pointer;
    font-size: 0.88em;
  }
  .seg button:last-child {
    border-right: 0;
  }
  .seg button.on {
    background: rgba(209, 166, 74, 0.2);
    color: var(--parchment);
  }
  .toggles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 12px;
  }
  .feats {
    grid-template-columns: 1fr;
  }
  .tog {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 0.9em;
    cursor: pointer;
  }
  .tog input {
    margin-top: 2px;
  }
  .feat span {
    display: grid;
  }
  .feat small {
    color: var(--faint);
    font-size: 0.82em;
    line-height: 1.35;
  }
  .side {
    display: grid;
    grid-template-rows: auto auto auto auto 1fr auto auto;
    gap: 10px;
  }
  .preview {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 3px;
    border: 1px solid var(--line);
  }
  .mapname {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .mapname b {
    font-family: var(--title);
    font-size: 1.15em;
  }
  .mapname span {
    color: var(--faint);
    font-size: 0.85em;
  }
  .summary {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
    font-size: 0.92em;
  }
  .who {
    display: grid;
    gap: 10px;
    align-content: start;
    min-height: 0;
    overflow-y: auto;
  }
  .start {
    font-size: 1.15em;
    padding: 0.8em 1em;
  }
  .plist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .plist li {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .plist li.off {
    opacity: 0.5;
  }
  .pn {
    flex: 1;
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .x {
    background: none;
    border: 0;
    color: var(--faint);
    cursor: pointer;
  }
  .chat ul {
    list-style: none;
    padding: 0;
    margin: 0 0 6px;
    max-height: 140px;
    font-size: 0.88em;
  }
  .chat input {
    width: 100%;
  }
  .empty {
    grid-column: 1 / -1;
  }
</style>
