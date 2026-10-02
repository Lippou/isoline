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
  import ChartMap from '../components/ChartMap.svelte';
  import Isolines from '../components/Isolines.svelte';
  import { nationsOfMap, type MapNation } from '../components/chartRender';
  import { rangeFill } from '../components/rangeFill';
  import FlagPicker from '../components/FlagPicker.svelte';
  import { myFlag } from '../stores/profile.svelte';
  import { flagUrl } from '../../render/flags';
  import { hashString } from '../../core/rng';
  import type { PlayerFlag } from '../../core/data/flagSpec';

  interface MapEntry {
    id: string;
    name: { fr: string; en: string };
    category: MapCategory;
    width: number;
    height: number;
    nations: number;
    /** One-line flavour description (shipped maps). */
    desc?: { fr: string; en: string };
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
  let loadingMaps = $state(true);
  let category = $state<MapCategory>('continents');
  let customs: MapEntry[] = $state([]);
  let gen = $state(defaultGenParams(cfg.seed));
  let chat = $state<{ name: string; text: string }[]>([]);
  let chatText = $state('');
  let ready = $state(false);

  const CATS: MapCategory[] = [
    'continents',
    'regions',
    'fictional',
    'legends',
    'planets',
    'arcade',
    'procedural',
    'custom',
  ];
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
    loadingMaps = false;
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
  const mapLabel = $derived(
    cfg.procedural ? t('mapcat.procedural') : selected ? selected.name[i18n.lang] || selected.name.en : '—',
  );
  // The selected map's nations, in file order: the game places the first cfg.nations of them.
  let nations = $state<MapNation[]>([]);
  $effect(() => {
    const m = selected;
    if (!m || cfg.procedural) {
      nations = [];
      return;
    }
    if (m.custom) {
      try {
        nations = parseIsoMap(m.custom).meta.nations;
      } catch {
        nations = [];
      }
      return;
    }
    let live = true;
    nationsOfMap(m.id).then(
      (n) => live && (nations = n),
      () => live && (nations = []),
    );
    return () => {
      live = false;
    };
  });
  const playing = $derived(cfg.mode === 'tribes' ? 0 : Math.min(cfg.nations, nations.length));

  // Flags: the picker saves the choice in the profile; in LAN it is also sent to the host.
  let pickingFlag = $state(false);
  /** Seed of a LAN player's generated flag (the game's slot is its rank among the players). */
  function lanSeed(p: LobbyState['players'][number]): number {
    const k = lobby ? lobby.players.filter((x) => !x.spectator).indexOf(p) : 0;
    return hashString(p.name + Math.max(0, k));
  }
  function flagPicked(flag: PlayerFlag | undefined): void {
    if (client && me) client.send({ t: 'profile', team: me.team, general: me.general, flag: flag ?? null });
  }
</script>

{#if pickingFlag}
  <FlagPicker
    name={lan ? (me?.name ?? playerName()) : cfg.players[0]!.name}
    onclose={() => (pickingFlag = false)}
    onpick={flagPicked}
  />
{/if}

<div class="lobby page-shell" data-testid="lobby">
  <header class="top">
    <button class="btn ghost back" onclick={() => go('title')}
      ><Icon name="back" size={16} />{t('common.back')}</button
    >
    <div class="htitle">
      <h1>{lan ? t('lobby.titleLan') : t('lobby.titleSolo')}</h1>
      <p class="sub">{lan ? t('lobby.subtitleLan') : t('lobby.subtitleSolo')}</p>
    </div>
    {#if lobby || (client?.host && port)}
      <div class="invite">
        {#if lobby}<span class="chip big" data-testid="lobby-code"
            ><Icon name="key" size={14} />{t('lobby.code')} <b class="mono">{lobby.code}</b></span
          >{/if}
        {#if client?.host && port}<span
            class="chip big mono"
            data-testid="lobby-address"
            data-tip={t('lobby.addressTip')}
            ><Icon name="network" size={14} />{(hostAddresses[0] ?? '127.0.0.1') + ':' + port}</span
          >{/if}
      </div>
    {/if}
  </header>

  <div class="steps">
    <!-- 1. Map -->
    <section class="step maps" aria-labelledby="step-map">
      <header class="sh">
        <span class="num" aria-hidden="true">1</span>
        <div>
          <h2 id="step-map">{t('lobby.stepMap')}</h2>
          <p>{t('lobby.stepMapHint')}</p>
        </div>
      </header>
      <nav class="tabs" aria-label={t('lobby.stepMap')}>
        {#each CATS as c (c)}
          <button
            class="tab"
            class:on={category === c}
            aria-pressed={category === c}
            onclick={() => (category = c)}
            disabled={!isHost}>{t(`mapcat.${c}`)}</button
          >
        {/each}
      </nav>
      {#if category === 'procedural'}
        <div class="gen scroll">
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
              <option value="800x500">800 × 500, {t('gen.small')}</option>
              <option value="1200x800">1200 × 800, {t('gen.medium')}</option>
              <option value="1600x1000">1600 × 1000, {t('gen.large')}</option>
              <option value="2000x1000">2000 × 1000, {t('gen.huge')}</option>
            </select>
          </label>
          <label class="field"
            ><span>{t('gen.land')} <b class="mono">{Math.round(gen.landRatio * 100)} %</b></span>
            <input
              type="range"
              min="0.15"
              max="0.8"
              step="0.01"
              bind:value={gen.landRatio}
              use:rangeFill={gen.landRatio}
            /></label
          >
          <label class="field"
            ><span>{t('gen.islands')} <b class="mono">{Math.round(gen.islands * 100)} %</b></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={gen.islands}
              use:rangeFill={gen.islands}
            /></label
          >
          <label class="field"
            ><span>{t('gen.mountains')} <b class="mono">{Math.round(gen.mountains * 100)} %</b></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={gen.mountains}
              use:rangeFill={gen.mountains}
            /></label
          >
          <label class="field"
            ><span>{t('gen.rivers')} <b class="mono">{Math.round(gen.rivers * 100)} %</b></span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={gen.rivers}
              use:rangeFill={gen.rivers}
            /></label
          >
          <button class="btn primary" onclick={pickProcedural} disabled={!isHost}
            ><Icon name="check" size={15} />{t('gen.use')}</button
          >
        </div>
      {:else}
        <div class="grid scroll">
          {#each shown as m (m.id)}
            <button
              class="map"
              class:on={cfg.mapId === m.id}
              aria-pressed={cfg.mapId === m.id}
              onclick={() => pickMap(m)}
              disabled={!isHost}
              data-testid="map-{m.id}"
              title={m.desc?.[i18n.lang] ?? ''}
            >
              <span class="thumb">
                <ChartMap
                  mapId={m.id}
                  custom={m.custom ?? ''}
                  mapW={m.width}
                  mapH={m.height}
                  width={340}
                  fit={m.width / m.height >= 1.25 ? 'cover' : 'contain'}
                />
                {#if cfg.mapId === m.id}<span class="tick"><Icon name="check" size={13} stroke={3} /></span
                  >{/if}
              </span>
              <span class="mname">{m.name[i18n.lang] || m.name.en}</span>
              <span class="msize mono">{m.nations} {t('lobby.nationsShort')}</span>
            </button>
          {:else}
            {#if loadingMaps}
              <div class="loading">
                <Isolines mode="ripple" count={4} r0={14} step={12} duration={2.2} stagger={0.55} />
              </div>
            {:else if category === 'custom'}
              <div class="empty-state">
                <h3>{t('lobby.noCustomTitle')}</h3>
                <p>{t('lobby.noCustom')}</p>
                <div class="acts">
                  <button class="btn" onclick={() => go('editor')}
                    ><Icon name="edit" size={15} />{t('title.editor')}</button
                  >
                </div>
              </div>
            {:else}
              <p class="empty hint">{t('lobby.noMaps')}</p>
            {/if}
          {/each}
        </div>
      {/if}
    </section>

    <!-- 2. Settings -->
    <section class="step opts" aria-labelledby="step-rules">
      <header class="sh">
        <span class="num" aria-hidden="true">2</span>
        <div>
          <h2 id="step-rules">{t('lobby.stepRules')}</h2>
          <p>{t('lobby.stepRulesHint')}</p>
        </div>
      </header>
      <div class="groups scroll">
        <div class="group">
          <div class="gh">
            <h3>{t('lobby.gGame')}</h3>
            <p>{t('lobby.gGameDesc')}</p>
          </div>
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
          <div class="field" role="group" aria-labelledby="diff-label">
            <span id="diff-label">{t('lobby.difficulty')}</span>
            <div class="seg">
              {#each DIFFS as d (d)}
                <button
                  class:on={cfg.difficulty === d}
                  aria-pressed={cfg.difficulty === d}
                  disabled={!isHost}
                  onclick={() => {
                    cfg.difficulty = d;
                    push();
                  }}>{t(`difficulty.${d}`)}</button
                >
              {/each}
            </div>
            <small>{t(`difficultyDesc.${cfg.difficulty}`)}</small>
          </div>
        </div>

        <div class="group">
          <div class="gh">
            <h3>{t('lobby.gOpponents')}</h3>
            <p>{t('lobby.gOpponentsDesc')}</p>
          </div>
          <label class="field"
            ><span>{t('lobby.nations')} <b class="mono">{cfg.nations}</b></span><input
              type="range"
              min="0"
              max={Math.min(100, selected?.nations ?? 100)}
              bind:value={cfg.nations}
              onchange={push}
              disabled={!isHost}
              data-testid="opt-nations"
              use:rangeFill={[cfg.nations, selected?.nations]}
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
              use:rangeFill={cfg.tribes}
            /><small>{t('lobby.tribesHelp')}</small></label
          >
        </div>

        <div class="group">
          <div class="gh">
            <h3>{t('lobby.gVictory')}</h3>
            <p>{t('lobby.gVictoryDesc')}</p>
          </div>
          <label class="field"
            ><span>{t('lobby.victory')} <b class="mono">{cfg.victoryThreshold} %</b></span><input
              type="range"
              min="50"
              max="100"
              bind:value={cfg.victoryThreshold}
              onchange={push}
              disabled={!isHost}
              use:rangeFill={cfg.victoryThreshold}
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
              use:rangeFill={cfg.spawnSeconds}
            /><small>{t('lobby.spawnHelp')}</small></label
          >
        </div>

        <div class="group">
          <div class="gh">
            <h3>{t('lobby.gEconomy')}</h3>
            <p>{t('lobby.gEconomyDesc')}</p>
          </div>
          <label class="field"
            ><span>{t('lobby.gold')} <b class="mono">×{cfg.goldMultiplier}</b></span><input
              type="range"
              min="0.5"
              max="4"
              step="0.25"
              bind:value={cfg.goldMultiplier}
              onchange={push}
              disabled={!isHost}
              use:rangeFill={cfg.goldMultiplier}
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
              use:rangeFill={cfg.startGold}
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
              use:rangeFill={cfg.gameSpeed}
            /><small>{t('lobby.speedHelp')}</small></label
          >
        </div>

        <div class="group">
          <div class="gh">
            <h3>{t('lobby.toggles')}</h3>
            <p>{t('lobby.togglesDesc')}</p>
          </div>
          <div class="toggles">
            {#each RULES as r (r)}
              <label class="tog"
                ><input
                  class="switch"
                  type="checkbox"
                  bind:checked={cfg[r]}
                  onchange={push}
                  disabled={!isHost}
                />
                <span><b>{t(`rule.${r}`)}</b><small>{t(`ruleDesc.${r}`)}</small></span></label
              >
            {/each}
          </div>
        </div>

        <div class="group">
          <div class="gh">
            <h3>{t('lobby.features')} <span class="mono cnt">{featureCount} / {FEATURES.length}</span></h3>
            <p>{t('lobby.featuresDesc')}</p>
          </div>
          <div class="toggles">
            {#each FEATURES as f (f)}
              <label class="tog">
                <input
                  class="switch"
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
      </div>
    </section>

    <!-- 3. Summary & launch -->
    <section class="step side" aria-labelledby="step-launch">
      <header class="sh">
        <span class="num" aria-hidden="true">3</span>
        <div>
          <h2 id="step-launch">{t('lobby.stepLaunch')}</h2>
          <p>{t('lobby.stepLaunchHint')}</p>
        </div>
      </header>
      <div class="sbody scroll">
        <div class="preview">
          <div class="pbox">
            {#if cfg.procedural}
              <div class="proc">
                <Isolines
                  mode="static"
                  count={9}
                  r0={18}
                  step={15}
                  growth={1.1}
                  seed={cfg.procedural.seed}
                  wobble={1.6}
                  indexEvery={4}
                  color="var(--contour-ink)"
                  stroke={1.2}
                />
                <span>{t('lobby.procPreview', { seed: cfg.procedural.seed })}</span>
              </div>
            {:else if selected}
              <ChartMap
                mapId={selected.id}
                custom={selected.custom ?? ''}
                mapW={selected.width}
                mapH={selected.height}
                width={960}
                fit="contain"
                {nations}
                active={playing}
              />
            {/if}
          </div>
          <div class="cap">
            <span class="mapname">{mapLabel}</span>
            {#if selected && !cfg.procedural}<span class="dims mono"
                >{selected.width} × {selected.height}</span
              >{/if}
          </div>
          {#if selected?.desc && !cfg.procedural}
            <p class="mdesc">{selected.desc[i18n.lang] || selected.desc.en}</p>
          {/if}
          {#if nations.length && !cfg.procedural}
            <ul class="key">
              <li><span class="dot on"></span>{t('lobby.dotsActive', { n: playing })}</li>
              <li><span class="dot"></span>{t('lobby.dotsFree', { n: nations.length - playing })}</li>
            </ul>
          {/if}
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
            <div class="pair">
              <div class="field">
                <span>{t('lobby.name')}</span>
                <div class="namerow">
                  <button
                    class="flagpick"
                    title={t('flag.change')}
                    aria-label={t('flag.change')}
                    data-testid="lobby-flag"
                    onclick={() => (pickingFlag = true)}
                    ><img
                      src={flagUrl({ flagSeed: hashString(cfg.players[0]!.name + 0), flag: myFlag() })}
                      alt=""
                    /></button
                  >
                  <input
                    type="text"
                    aria-label={t('lobby.name')}
                    bind:value={cfg.players[0]!.name}
                    maxlength="24"
                    onchange={() => {
                      settings.playerName = cfg.players[0]!.name;
                      push();
                    }}
                  />
                </div>
              </div>
              <label class="field"
                ><span>{t('lobby.general')}</span>
                <select bind:value={cfg.players[0]!.general} onchange={push}>
                  {#each GENERALS as g (g)}<option value={g}>{t(`general.${g}.name`)}</option>{/each}
                </select>
              </label>
            </div>
            <small class="gdesc">{t(`general.${cfg.players[0]!.general}.desc`)}</small>
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
            <h3 class="ptitle">{t('lobby.players')} <span class="mono cnt">{lobby.players.length}</span></h3>
            <ul class="plist">
              {#each lobby.players as p (p.slot)}
                <li class:off={!p.connected}>
                  <img
                    class="pflag"
                    src={flagUrl({ flagSeed: lanSeed(p), flag: p.flag })}
                    alt=""
                    data-testid="lobby-pflag-{p.slot}"
                    data-custom={p.flag && 'spec' in p.flag ? '1' : undefined}
                  />
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
              {#if !me.spectator}
                <button
                  class="btn small flagbtn"
                  onclick={() => (pickingFlag = true)}
                  data-testid="lobby-flag"
                  ><img src={flagUrl({ flagSeed: lanSeed(me), flag: me.flag })} alt="" />{t(
                    'flag.change',
                  )}</button
                >
              {/if}
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
                class:selected={ready}
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
      </div>

      <div class="launch">
        <button class="btn primary start" onclick={start} disabled={!isHost} data-testid="lobby-start"
          ><Icon name="play" size={18} />{t('lobby.start')}</button
        >
        <p class="hint">{isHost ? t('lobby.startHint') : t('lobby.waitHost')}</p>
      </div>
    </section>
  </div>
</div>

<style>
  .lobby {
    gap: 18px;
  }
  .top {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 6px 22px;
  }
  .back {
    margin-top: 6px;
  }
  .htitle {
    display: grid;
    gap: 4px;
  }
  .htitle h1 {
    font-size: 2.15em;
    line-height: 1.1;
  }
  .sub {
    margin: 0;
    color: var(--muted);
  }
  .invite {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .chip.big {
    font-size: 0.98em;
    padding: 0.4em 0.75em;
    color: var(--parchment);
  }
  .chip.big b {
    letter-spacing: 0.06em;
  }

  /* Three steps, side by side: map → settings → launch. */
  .steps {
    display: grid;
    grid-template-columns: minmax(300px, 1fr) minmax(360px, 1.1fr) minmax(320px, 0.95fr);
    gap: 18px;
    min-height: 0;
  }
  .step {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--panel-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .maps {
    grid-template-rows: auto auto minmax(0, 1fr);
  }
  .side {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .sh {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: center;
    padding: 16px 18px 14px;
    border-bottom: 1px solid var(--line);
  }
  .num {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1.5px solid var(--parchment);
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.05em;
    line-height: 1;
  }
  .sh h2 {
    font-size: 1.2em;
  }
  .sh p {
    margin: 1px 0 0;
    color: var(--muted);
    font-size: 0.88em;
  }

  /* 1. Maps */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 4px;
    padding: 10px 14px 0;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    position: relative;
    background: none;
    border: 0;
    color: var(--muted);
    padding: 7px 8px 9px;
    cursor: var(--cursor-pointer, pointer);
    border-radius: 4px 4px 0 0;
    transition: color 0.14s;
  }
  .tab::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -1px;
    height: 2px;
    background: var(--aurora);
    transform: scaleX(0);
    transition: transform 0.22s var(--ease-out);
  }
  .tab:hover:not(:disabled) {
    color: var(--parchment);
  }
  .tab.on {
    color: var(--parchment);
    font-weight: 600;
  }
  .tab.on::after {
    transform: scaleX(1);
  }
  .tab:disabled {
    cursor: default;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px 12px;
    align-content: start;
    min-height: 0;
    padding: 14px;
  }
  .map {
    display: grid;
    gap: 2px;
    padding: 0;
    background: none;
    border: 0;
    cursor: var(--cursor-pointer, pointer);
    text-align: left;
    color: var(--parchment);
  }
  .map:disabled {
    cursor: default;
  }
  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 10;
    margin-bottom: 6px;
    border-radius: 4px;
    overflow: hidden;
    outline: 1px solid var(--line);
    outline-offset: 0;
    transition:
      outline-color 0.16s,
      transform 0.22s var(--ease-out),
      box-shadow 0.22s var(--ease-out);
  }
  .map:hover:not(:disabled) .thumb {
    outline-color: var(--line-strong);
    transform: translateY(-2px);
    box-shadow: 0 8px 18px -10px rgba(22, 50, 74, 0.45);
  }
  .map.on .thumb {
    outline: 2px solid var(--aurora);
    outline-offset: 2px;
  }
  .map:focus-visible {
    outline: none;
  }
  .map:focus-visible .thumb {
    outline: 2px dashed var(--parchment);
    outline-offset: 3px;
  }
  .tick {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--aurora);
    color: #fff;
    animation: tick-in 0.28s cubic-bezier(0.3, 1.5, 0.5, 1) both;
  }
  @keyframes tick-in {
    from {
      transform: scale(0);
    }
  }
  .mname {
    font-weight: 600;
    font-size: 0.95em;
  }
  .map.on .mname {
    color: var(--aurora);
  }
  .msize {
    font-size: 0.82em;
    color: var(--muted);
  }
  .loading {
    position: relative;
    grid-column: 1 / -1;
    height: 180px;
    color: var(--aurora);
  }
  .empty {
    grid-column: 1 / -1;
  }
  .grid .empty-state {
    grid-column: 1 / -1;
  }
  .gen {
    display: grid;
    gap: 12px;
    align-content: start;
    padding: 14px 18px;
    min-height: 0;
  }

  /* 2. Settings */
  .groups {
    min-height: 0;
    padding: 4px 18px 10px;
  }
  .group {
    display: grid;
    gap: 14px;
    padding: 16px 0 18px;
    border-bottom: 1px solid var(--line);
  }
  .group:last-child {
    border-bottom: 0;
  }
  .gh h3 {
    font-size: 1.05em;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .gh p {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 0.88em;
    line-height: 1.45;
  }
  .cnt {
    color: var(--muted);
    font-family: var(--text);
    font-weight: 500;
    font-size: 0.82em;
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .field > span {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-weight: 500;
    font-size: 0.93em;
  }
  .field > span b {
    color: var(--aurora);
    font-weight: 600;
  }
  .field small,
  .gdesc {
    color: var(--muted);
    font-size: 0.84em;
    line-height: 1.4;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .row input {
    flex: 1;
    min-width: 0;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding: 3px;
    gap: 3px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .seg button {
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--muted);
    padding: 6px 2px;
    cursor: var(--cursor-pointer, pointer);
    font-size: 0.9em;
    transition:
      background 0.16s,
      color 0.16s,
      border-color 0.16s;
  }
  .seg button:hover:not(:disabled) {
    color: var(--parchment);
  }
  .seg button.on {
    background: var(--panel-solid);
    border-color: var(--aurora);
    color: var(--aurora);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(22, 50, 74, 0.12);
  }
  .toggles {
    display: grid;
    gap: 2px;
  }
  .tog {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 12px;
    align-items: start;
    padding: 8px 8px;
    margin: 0 -8px;
    border-radius: 4px;
    cursor: var(--cursor-pointer, pointer);
    transition: background 0.14s;
  }
  .tog:hover {
    background: var(--panel-2);
  }
  .tog input {
    margin-top: 1px;
  }
  .tog span {
    display: grid;
    gap: 1px;
  }
  .tog b {
    font-weight: 500;
    font-size: 0.94em;
  }
  .tog small {
    color: var(--muted);
    font-size: 0.83em;
    line-height: 1.4;
  }

  /* 3. Launch */
  .sbody {
    min-height: 0;
    padding: 16px 18px 6px;
    display: grid;
    gap: 14px;
    align-content: start;
  }
  .preview {
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .pbox {
    position: relative;
    height: clamp(140px, 27vh, 330px);
    border: 1px solid var(--line);
    border-radius: 4px;
    overflow: hidden;
    background: #f7fafa;
  }
  .proc {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: end start;
    padding: 10px 12px;
    color: var(--muted);
    font-size: 0.86em;
  }
  .proc span {
    position: relative;
    background: color-mix(in srgb, var(--panel-solid) 85%, transparent);
    padding: 2px 6px;
    border-radius: 3px;
  }
  .cap {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
  .mapname {
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.45em;
    line-height: 1.15;
  }
  .mdesc {
    margin: -4px 0 0;
    font-family: var(--title);
    font-style: italic;
    color: var(--muted);
    font-size: 1.02em;
    line-height: 1.4;
  }
  .dims {
    color: var(--muted);
    font-size: 0.86em;
    white-space: nowrap;
  }
  .key {
    list-style: none;
    margin: -2px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    color: var(--muted);
    font-size: 0.86em;
  }
  .key li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1.5px solid var(--muted);
    opacity: 0.7;
  }
  .dot.on {
    background: var(--parchment);
    border-color: var(--parchment);
    opacity: 1;
  }
  .summary {
    margin: 0;
    line-height: 1.55;
    font-size: 0.95em;
  }
  .who {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .namerow {
    display: flex;
    gap: 8px;
    align-items: stretch;
    min-width: 0;
  }
  .namerow input {
    flex: 1;
    min-width: 0;
  }
  .flagpick {
    flex: none;
    padding: 3px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--input-bg);
    cursor: var(--cursor-pointer, pointer);
    display: grid;
    place-items: center;
    transition: border-color 0.14s;
  }
  .flagpick:hover,
  .flagpick:focus-visible {
    border-color: var(--aurora);
    outline: none;
  }
  .flagpick img {
    height: 26px;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(22, 50, 74, 0.22);
  }
  .pflag {
    height: 15px;
    border-radius: 1px;
    box-shadow: 0 0 0 1px rgba(22, 50, 74, 0.25);
  }
  .flagbtn img {
    height: 16px;
    border-radius: 1px;
    box-shadow: 0 0 0 1px rgba(22, 50, 74, 0.25);
  }
  .flagbtn {
    justify-self: start;
  }
  .gdesc {
    margin-top: -4px;
  }
  .launch {
    padding: 14px 18px 16px;
    border-top: 1px solid var(--line);
    background: var(--panel-2);
    display: grid;
    gap: 8px;
  }
  .start {
    font-size: 1.15em;
    padding: 0.8em 1em;
    width: 100%;
  }
  .start:not(:disabled):hover :global(svg) {
    transform: translateX(2px);
  }
  .start :global(svg) {
    transition: transform 0.2s var(--ease-out);
  }
  .launch .hint {
    margin: 0;
    text-align: center;
  }
  .ptitle {
    font-size: 1.05em;
    display: flex;
    gap: 8px;
    align-items: baseline;
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
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--panel-2);
  }
  .plist li.off {
    opacity: 0.5;
  }
  .pn {
    flex: 1;
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-weight: 500;
  }
  .x {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: var(--cursor-pointer, pointer);
  }
  .x:hover {
    color: var(--signal);
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
</style>
