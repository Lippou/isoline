<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, clock, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { currentSession } from '../stores/app.svelte';

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
    return [...teams.values()].sort((a, b) => b.share - a.share).slice(0, 12);
  });

  const elapsed = $derived(hud.world ? Math.max(0, hud.tick - hud.world.startTick) : 0);
  const spawnLeft = $derived(hud.world ? Math.max(0, hud.world.spawnEndTick - hud.tick) : 0);
  const mode = $derived(currentSession()?.config.mode ?? 'ffa');
  const threshold = $derived(hud.world?.threshold ?? 80);
</script>

<header class="top">
  <div class="bar glass" data-testid="territory-bar">
    {#each shares as s (s.key)}
      <div
        class="seg"
        class:me={s.me}
        style="width:{Math.max(0.4, s.share * 100)}%; background:{s.color}"
        title="{s.name} — {(s.share * 100).toFixed(1)}%"
      ></div>
    {/each}
    <div class="goal" style="left:{threshold}%" title={t('hud.victoryAt', { pct: threshold })}></div>
  </div>
  <div class="info glass">
    {#if hud.phase === 'spawn'}
      <span class="spawn" data-testid="spawn-countdown"
        >{t('hud.chooseSpawn')} · <b class="mono">{Math.ceil(spawnLeft / 10)}s</b></span
      >
    {:else}
      <span class="mono clock" data-testid="clock">{clock(elapsed)}</span>
      <span class="sep"></span>
      <span>{t(`mode.${mode}`)}</span>
      <span class="sep"></span>
      <span title={t('hud.victoryThreshold')}>🎯 {threshold}%</span>
      {#if (hud.world?.doomsday ?? -1) > 0}
        <span class="chip warn">☢ {t('hud.doomsday', { pct: hud.world?.doomsday ?? 0 })}</span>
      {/if}
      {#if hud.world?.event}
        <span class="chip event"
          >{t(`worldEvent.${hud.world.event.id}.short`)} · {Math.ceil(
            (hud.world.event.until - hud.tick) / 10,
          )}s</span
        >
      {/if}
      {#if (hud.world?.ceasefireUntil ?? 0) > hud.tick}<span class="chip good">🕊 {t('hud.ceasefire')}</span
        >{/if}
      {#if (hud.world?.nukeBanUntil ?? 0) > hud.tick}<span class="chip warn">🚫☢ {t('hud.nukeBan')}</span
        >{/if}
      {#if hud.local && hud.local.immuneFor > 0}<span class="chip good"
          >🛡 {t('hud.immune', { s: Math.ceil(hud.local.immuneFor / 10) })}</span
        >{/if}
      {#if hud.local && hud.local.traitorFor > 0}<span class="chip bad">💔 {t('hud.traitor')}</span>{/if}
    {/if}
    {#if hud.paused}<span class="chip warn">⏸ {t('hud.paused')}</span>{/if}
    {#if hud.desync}<span class="chip bad">{t('hud.resyncing')}</span>{/if}
  </div>
</header>

<style>
  .top {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    width: min(820px, 62vw);
    display: grid;
    gap: 6px;
    pointer-events: none;
    z-index: 5;
  }
  .bar {
    position: relative;
    height: 14px;
    display: flex;
    overflow: hidden;
    border-radius: 8px;
    padding: 0;
    pointer-events: auto;
  }
  .seg {
    height: 100%;
    opacity: 0.85;
    transition: width 0.6s ease;
  }
  .seg.me {
    opacity: 1;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.7);
  }
  .goal {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    background: var(--parchment);
    box-shadow: 0 0 6px var(--parchment);
  }
  .info {
    justify-self: center;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.32rem 0.9rem;
    font-size: 0.86em;
    pointer-events: auto;
    flex-wrap: wrap;
    justify-content: center;
  }
  .clock {
    font-size: 1.05em;
    color: var(--parchment);
  }
  .sep {
    width: 1px;
    height: 12px;
    background: var(--line);
  }
  .spawn b {
    color: var(--aurora);
  }
  .chip.warn {
    color: var(--brass);
    border-color: rgba(242, 184, 75, 0.5);
  }
  .chip.bad {
    color: var(--signal);
    border-color: rgba(255, 90, 95, 0.5);
  }
  .chip.good {
    color: var(--verdant);
    border-color: rgba(123, 216, 143, 0.5);
  }
  .chip.event {
    color: var(--aurora);
  }
</style>
