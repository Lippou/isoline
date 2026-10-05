<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, clock, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { currentSession } from '../stores/app.svelte';
  import Icon from '../icons/Icon.svelte';
  import { keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { hudSize } from '../stores/hudBox.svelte';
  import ModeBanner from './ModeBanner.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const solo = ctl.session.kind === 'solo';
  const SPEEDS = [0.5, 1, 2, 4];

  const allShares = $derived.by(() => {
    const total = hud.world?.usefulLand ?? 1;
    const ps = hud.players.filter((p) => p.alive && p.tiles > 0 && p.kind !== 'tribe');
    const teams = new Map<string, { key: string; share: number; color: string; name: string; me: boolean }>();
    for (const p of ps) {
      const key = p.team > 0 ? `t${p.team}` : `p${p.id}`;
      const e = teams.get(key) ?? {
        key,
        share: 0,
        color: inkHex(p.color, settings.access.vision),
        name:
          p.team > 0
            ? mode === 'humansVsNations'
              ? t(`front.team.${p.team === 1 ? 'humans' : 'nations'}`)
              : `${t('lobby.team')} ${p.team}`
            : p.name[i18n.lang] || p.name.en,
        me: false,
      };
      e.share += p.usefulTiles / total;
      if (p.id === hud.viewer) e.me = true;
      teams.set(key, e);
    }
    return [...teams.values()].sort((a, b) => b.share - a.share);
  });
  const shares = $derived(allShares.slice(0, 14));
  // From every country, not just the 14 drawn: outside them "you" read 0.0 %.
  const myShare = $derived(allShares.find((s) => s.me)?.share ?? 0);

  const elapsed = $derived(hud.world ? Math.max(0, hud.tick - hud.world.startTick) : 0);
  const spawnLeft = $derived(hud.world ? Math.max(0, hud.world.spawnEndTick - hud.tick) : 0);
  const mode = $derived(currentSession()?.config.mode ?? 'ffa');
  /** Humans vs nations with a single human: the player alone against the nations' coalition. */
  const hvnSolo = $derived(
    mode === 'humansVsNations' && hud.players.filter((p) => p.kind === 'human').length <= 1,
  );
  const modeName = $derived(hvnSolo ? t('hud.modeHvnSolo') : t(`mode.${mode}`));
  const modeTip = $derived(
    mode === 'humansVsNations' ? t(hvnSolo ? 'hud.modeHvnSoloTip' : 'hud.modeHvnTip') : '',
  );
  const threshold = $derived(hud.world?.threshold ?? 80);
  const secs = (ticks: number) => Math.ceil(ticks / 10);
  /** The World Council's nuclear ban: time left (0: none). */
  const banLeft = $derived(Math.max(0, (hud.world?.nukeBanUntil ?? 0) - hud.tick));
</script>

<!-- The top strip (zones.ts): centred over the band between the columns; its status line
     keeps its height when empty, so that the stage under it never jumps. -->
<header class="top" use:hudSize={'top'}>
  {#if hud.phase === 'spawn'}
    <div class="spawn panel" data-testid="spawn-countdown">
      <span class="pin"><Icon name="pin" size={18} /></span>
      <div>
        <b>{t('hud.chooseSpawn')}</b>
        <span class="help">{hud.viewer > 0 ? t('hud.spawnHelp') : t('hud.spawnWait')}</span>
      </div>
      <span class="left" data-tip={t('hud.spawnTimerTip')}>{secs(spawnLeft)}<small> s</small></span>
    </div>
  {:else}
    <div class="strip panel">
      <span class="item mono clock" data-testid="clock" data-tip={t('hud.elapsed')}>
        <Icon name="time" size={15} />{clock(elapsed)}
      </span>
      {#if solo}
        <span class="item time" data-testid="time-controls">
          <button
            class="tbtn"
            class:on={hud.paused}
            aria-pressed={hud.paused}
            data-tip="{t(hud.paused ? 'hud.resume' : 'hud.pause')} ({[
              settings.keys.pause,
              settings.keys.pauseAlt,
            ]
              .filter((k) => !!k)
              .map((k) => keyLabel(k ?? ''))
              .join(' / ')})"
            aria-label={t(hud.paused ? 'hud.resume' : 'hud.pause')}
            onclick={() => ctl.togglePause()}><Icon name={hud.paused ? 'play' : 'pause'} size={14} /></button
          >
          {#each SPEEDS as v (v)}
            <button
              class="tbtn mono"
              class:on={!hud.paused && hud.speed === v}
              aria-pressed={hud.speed === v}
              data-tip={t('hud.speedTip', {
                down: keyLabel(settings.keys.speedDown ?? ''),
                up: keyLabel(settings.keys.speedUp ?? ''),
              })}
              onclick={() => {
                if (hud.paused) ctl.togglePause();
                ctl.setSpeed(v);
              }}>×{v === 0.5 ? '½' : v}</button
            >
          {/each}
        </span>
      {/if}
      <span class="item mode" data-tip={modeTip || null} data-testid="topbar-mode">{modeName}</span>
      <span
        class="item goal-txt"
        data-tip={mode === 'battleRoyale'
          ? t('hud.goalRoyaleTip')
          : t('hud.victoryThresholdTip', { pct: threshold })}
      >
        <Icon name="target" size={15} />
        <!-- Narrow windows: the short form (the full one is in the tooltip). -->
        <span class="full"
          >{#if mode === 'campaign'}{t('hud.goalMission')}{:else if mode === 'battleRoyale'}{t(
              'hud.goalRoyale',
            )}{:else if threshold > 100}{t('hud.noVictory')}{:else}{t('hud.goal', {
              pct: threshold,
            })}{/if}</span
        >
        <span class="short"
          >{#if mode === 'campaign'}{t('hud.goalMissionShort')}{:else if mode === 'battleRoyale'}{t(
              'hud.goalRoyaleShort',
            )}{:else if threshold > 100}{t('hud.noVictory')}{:else}{t('hud.goalShort', {
              pct: threshold,
            })}{/if}</span
        >
        {#if hud.viewer > 0}<span class="mine mono"
            >{t('hud.youHold', { pct: (myShare * 100).toFixed(1) })}</span
          >{/if}
      </span>
    </div>
    <div class="bar" data-testid="territory-bar" aria-hidden="true">
      {#each shares as s (s.key)}
        <div
          class="seg"
          class:me={s.me}
          style="width:{Math.max(0.3, s.share * 100)}%; background:{s.color}"
          title="{s.name} — {(s.share * 100).toFixed(1)} %"
        ></div>
      {/each}
      {#if threshold <= 100 && mode !== 'campaign' && mode !== 'battleRoyale'}<div
          class="goal"
          style="left:{threshold}%"
        ></div>{/if}
    </div>
    <ModeBanner {mode} playerName={(id) => ctl.session.state.name(id, i18n.lang)} />
    <div class="status">
      <!-- Doomsday, survival of the strongest: only when we are under the bar (the banner tells the rule). -->
      {#if (hud.world?.doomsday ?? -1) > 0 && hud.viewer > 0 && myShare * 100 < (hud.world?.doomsday ?? 0)}
        <span class="chip bad"
          ><Icon name="nuke" size={13} />{t('hud.doomsday', { pct: hud.world?.doomsday ?? 0 })}</span
        >
      {/if}
      {#if hud.world?.event && hud.world.event.until > hud.tick}
        {@const ev = hud.world.event}
        <span class="chip event" data-testid="event-chip" data-tip={t(`worldEvent.${ev.id}.desc`)}
          ><Icon name="event" size={13} />{t(`worldEvent.${ev.id}.short`)}
          <span class="mono">{clock(ev.until - hud.tick)}</span></span
        >
      {/if}
      {#if (hud.world?.ceasefireUntil ?? 0) > hud.tick}<span class="chip good"
          ><Icon name="ceasefire" size={13} />{t('hud.ceasefire')}</span
        >{/if}
      {#if banLeft > 0}<span
          class="chip bad"
          data-testid="nuke-ban-chip"
          data-tip={t('ban.tip', { clock: clock(banLeft) })}
          ><Icon name="embargo" size={13} />{t('hud.nukeBan')}
          <span class="mono">{clock(banLeft)}</span></span
        >{/if}
      {#if hud.local && hud.local.immuneFor > 0}<span class="chip good" data-tip={t('hud.immuneTip')}
          ><Icon name="immune" size={13} />{t('hud.immune', { s: secs(hud.local.immuneFor) })}</span
        >{/if}
      {#if hud.local && hud.local.traitorFor > 0}<span class="chip bad" data-tip={t('hud.traitorTip')}
          ><Icon name="traitor" size={13} />{t('hud.traitor')}</span
        >{/if}
      {#if hud.paused}<span class="chip warn"><Icon name="pause" size={13} />{t('hud.paused')}</span>{/if}
      {#if hud.desync}<span class="chip bad"><Icon name="refresh" size={13} />{t('hud.resyncing')}</span>{/if}
      <!-- The words just spoken (sirens, a pact, an explosion…), as a caption. -->
      {#each hud.subtitles.slice(-1) as s (s.id)}
        <span class="caption fade-in" aria-hidden="true" data-testid="subtitle">{s.text}</span>
      {/each}
    </div>
  {/if}
</header>

<style>
  /* Centred over the band between the columns (the top strip, zones.ts). */
  .top {
    position: absolute;
    top: 10px;
    left: var(--zone-band-c, 50%);
    transform: translateX(-50%);
    width: min(760px, var(--zone-band-w, calc(100vw - 680px)));
    display: grid;
    justify-items: center;
    gap: 5px;
    pointer-events: none;
    z-index: 5;
    container-type: inline-size;
  }
  /* Before the start: a notice under the ink rule, the seconds left in the margin. */
  .spawn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 16px 10px;
    border-top: 3px solid var(--np-ink);
    pointer-events: auto;
  }
  .pin {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1.5px solid var(--np-ink);
    border-radius: 50%;
    color: var(--np-ink);
    flex: none;
  }
  .spawn div {
    display: grid;
    gap: 1px;
  }
  .spawn b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.15em;
    line-height: 1.1;
    color: var(--np-ink);
  }
  .help {
    font-family: var(--np-serif);
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .spawn .left {
    padding-left: 14px;
    border-left: 1px solid var(--np-rule);
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.7em;
    line-height: 1;
    font-variant-numeric: tabular-nums lining-nums;
    color: var(--np-ink);
  }
  .left small {
    font-family: var(--text);
    font-size: 0.5em;
    font-weight: 500;
    color: var(--np-ink-2);
  }
  /* The strip: clock, speed, mode and goal, separated by fine rules. */
  .strip {
    display: flex;
    align-items: stretch;
    pointer-events: auto;
    font-size: 0.9em;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    color: var(--np-ink-2);
    white-space: nowrap;
  }
  .item + .item {
    border-left: 1px solid var(--np-rule);
  }
  .clock {
    font-weight: 600;
    font-size: 1.05em;
    color: var(--np-ink);
  }
  .time {
    gap: 2px;
    padding: 3px 6px;
  }
  .tbtn {
    appearance: none;
    display: inline-grid;
    place-items: center;
    min-width: 28px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: transparent;
    color: var(--np-ink-2);
    cursor: pointer;
    font-size: 0.92em;
    font-weight: 500;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .tbtn:hover {
    background: var(--np-paper-2);
    color: var(--np-ink);
  }
  /* The speed in use: reversed, as the journal prints what is current. */
  .tbtn.on {
    background: var(--np-ink);
    border-color: var(--np-ink);
    color: var(--np-paper);
  }
  .mine {
    margin-left: 4px;
    font-weight: 600;
    color: var(--np-ink);
  }
  /* The shares of the land: each country in its ink, the goal as a rule. */
  .bar {
    position: relative;
    width: 100%;
    height: 8px;
    display: flex;
    background: var(--np-paper-2);
    border: 1px solid var(--np-edge);
    border-radius: 1px;
    box-shadow: 0 1px 3px rgba(3, 10, 16, 0.25);
    overflow: hidden;
    pointer-events: auto;
  }
  .seg {
    height: 100%;
    box-sizing: border-box;
    transition: width 0.6s ease;
  }
  /* A hairline of paper between shares: neighbours of close inks never merge. */
  .seg + .seg {
    border-left: 1px solid var(--np-paper);
  }
  .seg.me {
    box-shadow:
      inset 0 0 0 1px var(--np-ink),
      inset 0 0 0 2px var(--np-paper);
  }
  .goal {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--np-ink);
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    justify-content: center;
    min-height: 24px;
    max-width: 100%;
    pointer-events: none;
  }
  .status > * {
    pointer-events: auto;
  }
  /* A caption: one line in italics, cut short rather than spilling over the map. */
  .caption {
    max-width: 100%;
    padding: 2px 10px;
    border: 1px solid var(--np-edge);
    border-radius: 1px;
    background: var(--np-paper);
    box-shadow: 0 1px 3px rgba(3, 10, 16, 0.22);
    font-family: var(--title);
    font-style: italic;
    font-size: 0.86em;
    line-height: 1.35;
    color: var(--np-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status .chip {
    background: var(--np-paper);
    border-color: var(--np-edge);
    box-shadow: 0 1px 3px rgba(3, 10, 16, 0.22);
  }
  .status .chip.bad {
    border-color: color-mix(in srgb, var(--np-spot) 70%, transparent);
  }
  .status .chip.good {
    border-color: color-mix(in srgb, var(--np-good) 60%, transparent);
  }
  .status .chip.warn {
    border-color: color-mix(in srgb, var(--np-warn) 60%, transparent);
  }
  .status .chip .mono {
    font-weight: 600;
  }
  /* At the top of the window: explanations open below the chips, above the dispatches. */
  .top:has(.status [data-tip]:hover) {
    z-index: 31;
  }
  .status .chip[data-tip]:hover::after,
  .strip .item[data-tip]:hover::after {
    top: calc(100% + 6px);
    bottom: auto;
  }
  .top:has(.strip .item[data-tip]:hover) {
    z-index: 31;
  }
  .short {
    display: none;
  }
  /* Narrow (after the base rules, which it overrides): the game mode goes (it is in the menu), then the goal takes its short form. */
  @container (max-width: 700px) {
    .mode {
      display: none;
    }
  }
  @container (max-width: 600px) {
    .full {
      display: none;
    }
    .short {
      display: inline;
    }
    .item {
      padding: 5px 9px;
    }
  }
</style>
