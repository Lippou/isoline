<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, clock, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { currentSession } from '../stores/app.svelte';
  import Icon from '../icons/Icon.svelte';
  import { keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  const solo = ctl.session.kind === 'solo';
  const SPEEDS = [0.5, 1, 2, 4];

  const shares = $derived.by(() => {
    const total = hud.world?.usefulLand ?? 1;
    const ps = hud.players.filter((p) => p.alive && p.tiles > 0 && p.kind !== 'tribe');
    const teams = new Map<string, { key: string; share: number; color: string; name: string; me: boolean }>();
    for (const p of ps) {
      const key = p.team > 0 ? `t${p.team}` : `p${p.id}`;
      const e = teams.get(key) ?? {
        key,
        share: 0,
        color: inkHex(p.color, settings.access.vision),
        name: p.team > 0 ? `${t('lobby.team')} ${p.team}` : p.name[i18n.lang] || p.name.en,
        me: false,
      };
      e.share += p.usefulTiles / total;
      if (p.id === hud.viewer) e.me = true;
      teams.set(key, e);
    }
    return [...teams.values()].sort((a, b) => b.share - a.share).slice(0, 14);
  });
  const myShare = $derived(shares.find((s) => s.me)?.share ?? 0);

  const elapsed = $derived(hud.world ? Math.max(0, hud.tick - hud.world.startTick) : 0);
  const spawnLeft = $derived(hud.world ? Math.max(0, hud.world.spawnEndTick - hud.tick) : 0);
  const mode = $derived(currentSession()?.config.mode ?? 'ffa');
  const threshold = $derived(hud.world?.threshold ?? 80);
  const secs = (ticks: number) => Math.ceil(ticks / 10);
</script>

<header class="top">
  {#if hud.phase === 'spawn'}
    <div class="spawn panel" data-testid="spawn-countdown">
      <Icon name="pin" size={20} />
      <div>
        <b>{t('hud.chooseSpawn')}</b>
        <span class="hint">{hud.viewer > 0 ? t('hud.spawnHelp') : t('hud.spawnWait')}</span>
      </div>
      <span class="mono left" data-tip={t('hud.spawnTimerTip')}>{secs(spawnLeft)} s</span>
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
            data-tip="{t(hud.paused ? 'hud.resume' : 'hud.pause')} ({keyLabel(settings.keys.pause ?? '')})"
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
      <span class="item">{t(`mode.${mode}`)}</span>
      <span class="item goal-txt" data-tip={t('hud.victoryThresholdTip', { pct: threshold })}>
        <Icon name="target" size={15} />
        {#if mode === 'campaign'}{t('hud.goalMission')}{:else if threshold > 100}{t(
            'hud.noVictory',
          )}{:else}{t('hud.goal', { pct: threshold })}{/if}
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
      {#if threshold <= 100 && mode !== 'campaign'}<div class="goal" style="left:{threshold}%"></div>{/if}
    </div>
    <div class="status">
      {#if (hud.world?.doomsday ?? -1) > 0}
        <span class="chip warn"
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
      {#if (hud.world?.nukeBanUntil ?? 0) > hud.tick}<span class="chip warn"
          ><Icon name="embargo" size={13} />{t('hud.nukeBan')}</span
        >{/if}
      {#if hud.local && hud.local.immuneFor > 0}<span class="chip good" data-tip={t('hud.immuneTip')}
          ><Icon name="immune" size={13} />{t('hud.immune', { s: secs(hud.local.immuneFor) })}</span
        >{/if}
      {#if hud.local && hud.local.traitorFor > 0}<span class="chip bad" data-tip={t('hud.traitorTip')}
          ><Icon name="traitor" size={13} />{t('hud.traitor')}</span
        >{/if}
      {#if hud.paused}<span class="chip warn"><Icon name="pause" size={13} />{t('hud.paused')}</span>{/if}
      {#if hud.desync}<span class="chip bad"><Icon name="refresh" size={13} />{t('hud.resyncing')}</span>{/if}
    </div>
  {/if}
</header>

<style>
  .top {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: min(760px, 56vw);
    display: grid;
    justify-items: center;
    gap: 5px;
    pointer-events: none;
    z-index: 5;
  }
  .spawn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    pointer-events: auto;
    color: var(--brass);
  }
  .spawn div {
    display: grid;
  }
  .spawn b {
    color: var(--parchment);
    font-family: var(--title);
    font-size: 1.05em;
  }
  .spawn .left {
    font-size: 1.1em;
    color: var(--muted);
    padding-left: 12px;
    border-left: 1px solid var(--line);
  }
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
    color: var(--muted);
  }
  .item + .item {
    border-left: 1px solid var(--line);
  }
  .clock {
    color: var(--parchment);
    font-size: 1.05em;
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
    border-radius: 4px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    font-size: 0.92em;
    transition:
      background 0.12s,
      color 0.12s;
  }
  .tbtn:hover {
    background: var(--panel-3);
    color: var(--parchment);
  }
  .tbtn.on {
    background: var(--select-bg);
    border-color: var(--aurora);
    color: var(--parchment);
  }
  .mine {
    color: var(--parchment);
    margin-left: 4px;
  }
  .bar {
    position: relative;
    width: 100%;
    height: 8px;
    display: flex;
    background: var(--glass);
    border: 1px solid var(--line);
    border-radius: 2px;
    overflow: hidden;
    pointer-events: auto;
  }
  .seg {
    height: 100%;
    transition: width 0.6s ease;
  }
  .seg.me {
    box-shadow: inset 0 0 0 1px #fff;
  }
  .goal {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--parchment);
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    justify-content: center;
    pointer-events: auto;
  }
  .status .chip {
    background: var(--glass);
  }
  /* At the top of the window: explanations open below the chips, above the toasts. */
  .top:has(.status [data-tip]:hover) {
    z-index: 31;
  }
  .status .chip[data-tip]:hover::after {
    top: calc(100% + 6px);
    bottom: auto;
  }
</style>
