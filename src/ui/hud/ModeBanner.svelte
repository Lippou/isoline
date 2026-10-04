<script lang="ts">
  // The game mode's banner, under the top bar (zones.ts: part of the top strip, measured with
  // it): what happens next and when. Battle royale: the zone's step, the countdown to its
  // closing and how much of our land lies outside the next zone. Doomsday clock: the time
  // left to midnight on a dial, the milestones, the next one with its effect and when, and
  // the last push of the clock (GAME_DESIGN.md §14.1, §14.2).
  import { hud } from '../stores/game.svelte';
  import { t, clock } from '../i18n/i18n.svelte';
  import { audio } from '../../audio/audio';
  import {
    DOOM_MIDNIGHT,
    DOOM_STAGES,
    DOOM_SURVIVAL_FFA,
    DOOM_SURVIVAL_TEAMS,
    DOOM_UNIT,
    ROYALE_CLOSE,
    ROYALE_FINAL,
    ROYALE_FIRST,
    ROYALE_SWEEP,
    ROYALE_WAIT,
  } from '../../core/game/constants';

  let { mode, playerName }: { mode: string; playerName: (id: number) => string } = $props();

  const tick = $derived(hud.tick);
  const teams = $derived(hud.players.some((p) => p.team > 0));

  // ------------------------------------------------------------- doomsday
  const doom = $derived(hud.world?.doom ?? null);
  const MID = DOOM_MIDNIGHT * DOOM_UNIT;
  /** Clock seconds left to midnight. */
  const leftSecs = $derived(doom ? Math.max(0, Math.ceil((MID - doom.units) / DOOM_UNIT)) : DOOM_MIDNIGHT);
  const leftText = $derived.by(() => {
    const m = Math.floor(leftSecs / 60);
    const s = leftSecs % 60;
    if (m === 0) return t('hud.doom.secs', { s });
    return s === 0 ? t('hud.doom.mins', { m }) : t('hud.doom.minSecs', { m, s: String(s).padStart(2, '0') });
  });
  const stage = $derived(doom?.stage ?? 0);
  /** The bar of the survival stage (%), for the texts. */
  const survival = (k: number) => (teams ? DOOM_SURVIVAL_TEAMS : DOOM_SURVIVAL_FFA)[k >= 4 ? 1 : 0];
  const stageEffect = (k: number) => t(`doom.stage${k}.effect`, { share: survival(k) });
  /** Next milestone (5: midnight) and the time to it at the present pace (one unit per tick). */
  const next = $derived(stage < DOOM_STAGES.length ? stage + 1 : 5);
  const nextAt = $derived(next <= DOOM_STAGES.length ? DOOM_STAGES[next - 1]! * DOOM_UNIT : MID);
  const eta = $derived(doom ? Math.max(0, nextAt - doom.units) : nextAt);
  /** Dial: the minute hand (12 minutes to go at the start), and the wedge left to midnight. */
  const minuteAngle = $derived(360 - (leftSecs / 3600) * 360);
  const wedge = $derived.by(() => {
    const a = ((minuteAngle - 90) * Math.PI) / 180;
    const x = 18 + Math.cos(a) * 15;
    const y = 18 + Math.sin(a) * 15;
    const large = 360 - minuteAngle > 180 ? 1 : 0;
    return `M18 18 L${x.toFixed(2)} ${y.toFixed(2)} A15 15 0 ${large} 1 18 3 Z`;
  });
  /** The last push of the clock, shown for 8 seconds. */
  const push = $derived.by(() => {
    const p = doom?.pushes.at(-1);
    if (!p || tick - p.tick > 80) return null;
    const why = t(`doom.why.${p.why}`);
    return {
      up: p.secs > 0,
      text: t(p.secs > 0 ? 'hud.doom.pushUp' : 'hud.doom.pushDown', {
        secs: Math.abs(Math.round(p.secs)),
        why: p.by > 0 ? `${why} (${playerName(p.by)})` : why,
      }),
    };
  });
  const doomTip = $derived(
    [
      t('hud.doom.tip'),
      ...[1, 2, 3, 4].map(
        (k) =>
          `${k <= stage ? '■' : '□'} ${t('hud.doom.at', { m: (DOOM_MIDNIGHT - DOOM_STAGES[k - 1]!) / 60 })} — ${t(`doom.stage${k}.name`)} : ${stageEffect(k)}`,
      ),
      `□ ${t('doom.midnight.name')} — ${t('doom.midnight.effect')}`,
    ].join('\n'),
  );

  // A dry tick at each minute of the clock; the bells are rung with the dispatches (controller).
  let lastMinute = -1;
  $effect(() => {
    if (!doom) return;
    const m = Math.floor(doom.units / (60 * DOOM_UNIT));
    if (lastMinute >= 0 && m > lastMinute && doom.units < MID) audio.chime('tick', 0.8);
    lastMinute = m;
  });

  // -------------------------------------------------------- battle royale
  const ring = $derived(hud.world?.ring ?? null);
  const zone = $derived.by(() => {
    if (!ring) return null;
    if (ring.endAt >= 0)
      return { phase: 'final' as const, left: Math.max(0, ring.endAt - tick), span: ROYALE_FINAL };
    if (tick < ring.closeAt) {
      const span = ring.step === 0 ? ROYALE_FIRST : ROYALE_WAIT;
      return { phase: 'wait' as const, left: ring.closeAt - tick, span };
    }
    const end = ring.closeAt + ROYALE_CLOSE;
    return { phase: 'closing' as const, left: Math.max(0, end - tick), span: ROYALE_CLOSE + ROYALE_SWEEP };
  });
  const progress = $derived(zone ? Math.max(0, Math.min(1, 1 - zone.left / Math.max(1, zone.span))) : 0);
  const outPct = $derived(ring && ring.mineOut > 0 ? Math.max(1, Math.round(ring.mineOut * 100)) : 0);
  // The last five seconds before the zone closes: a soft tick each second.
  let lastSec = -1;
  $effect(() => {
    if (!zone || zone.phase !== 'wait') return;
    const s = Math.ceil(zone.left / 10);
    if (s !== lastSec && s >= 1 && s <= 5) audio.chime('tick', 0.7);
    lastSec = s;
  });
</script>

{#if mode === 'doomsday' && doom}
  <div
    class="banner panel doom"
    class:late={stage >= 3}
    data-testid="mode-banner"
    data-tip={doomTip}
    aria-label={t('hud.doom.toMidnight', { left: leftText })}
  >
    <svg class="dial" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16.5" class="face" />
      <path d={wedge} class="wedge" />
      {#each Array.from({ length: 12 }, (_, k) => k) as k (k)}
        <line
          x1="18"
          y1="3.2"
          x2="18"
          y2={k === 0 ? 7 : 5.2}
          class="mark"
          class:noon={k === 0}
          transform="rotate({k * 30} 18 18)"
        />
      {/each}
      <line x1="18" y1="18" x2="18" y2="9" class="hour" transform="rotate({minuteAngle / 12} 18 18)" />
      <line x1="18" y1="18" x2="18" y2="5" class="minute" transform="rotate({minuteAngle} 18 18)" />
      <circle cx="18" cy="18" r="1.6" class="pin" />
    </svg>
    <div class="body">
      <div class="head">
        <b class="title"
          >{leftSecs > 0 ? t('hud.doom.toMidnight', { left: leftText }) : t('doom.midnight.name')}</b
        >
        {#if push}
          <span class="push mono" class:down={!push.up} data-testid="doom-push">{push.text}</span>
        {:else if stage > 0}
          <span class="now">{t(`doom.stage${stage}.name`)}</span>
        {/if}
      </div>
      <div class="track" aria-hidden="true">
        <div class="fill" style:width="{Math.min(100, (doom.units / MID) * 100).toFixed(2)}%"></div>
        {#each DOOM_STAGES as s, k (k)}
          <span class="mile" class:passed={k < stage} style:left="{((s / DOOM_MIDNIGHT) * 100).toFixed(2)}%"
          ></span>
        {/each}
      </div>
      <div class="next">
        {#if leftSecs > 0}
          <span class="label">{next <= 4 ? t('hud.doom.next') : t('hud.doom.end')}</span>
          <b>{next <= 4 ? t(`doom.stage${next}.name`) : t('doom.midnight.name')}</b>
          <span class="effect">— {next <= 4 ? stageEffect(next) : t('doom.midnight.effect')}</span>
        {:else}
          <span class="effect">{t('doom.midnight.effect')}</span>
        {/if}
      </div>
    </div>
    {#if leftSecs > 0}
      <div class="count" data-tip={t('hud.doom.etaTip')}>
        <small>{t('hud.doom.in')}</small>
        <span class="mono">≈ {clock(eta)}</span>
      </div>
    {/if}
  </div>
{:else if mode === 'battleRoyale' && ring && zone}
  <div
    class="banner panel zone"
    class:closing={zone.phase === 'closing'}
    data-testid="mode-banner"
    data-tip={t('hud.zone.tip')}
  >
    <svg class="dial" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="15.5" class="safe" />
      <circle
        cx={18 + ((ring.nx - ring.cx) / ring.r) * 15.5}
        cy={18 + ((ring.ny - ring.cy) / ring.r) * 15.5}
        r={(ring.nr / ring.r) * 15.5}
        class="nextc"
      />
    </svg>
    <div class="body">
      <div class="head">
        <b class="title"
          >{zone.phase === 'final'
            ? t('hud.zone.final')
            : t('hud.zone.title', { n: Math.min(ring.step + 1, ring.steps), steps: ring.steps })}</b
        >
        <span class="now">
          {zone.phase === 'wait'
            ? t('hud.zone.closesIn')
            : zone.phase === 'closing'
              ? t('hud.zone.closing')
              : t('hud.zone.finalIn')}
        </span>
      </div>
      <div class="track" aria-hidden="true">
        <div class="fill" style:width="{(progress * 100).toFixed(1)}%"></div>
      </div>
      <div class="next">
        {#if zone.phase === 'final'}
          <span class="effect">{t('hud.zone.finalSub')}</span>
        {:else if ring.mineOut < 0}
          <span class="effect">{t('hud.zone.spect')}</span>
        {:else if outPct > 0}
          <b class="bad">{t('hud.zone.out', { pct: outPct })}</b>
        {:else}
          <span class="effect">{t('hud.zone.safe')}</span>
        {/if}
      </div>
    </div>
    <div class="count">
      <span class="mono">{clock(zone.left)}</span>
    </div>
  </div>
{/if}

<style>
  /* A slip of paper under the top bar: an ink rule at the top, the countdown in the margin. */
  .banner {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    padding: 5px 12px 6px 8px;
    border-top: 2px solid var(--np-ink);
    pointer-events: auto;
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .banner.late,
  .banner.closing {
    border-top-color: var(--np-spot);
  }
  .dial {
    width: 36px;
    height: 36px;
    flex: none;
  }
  .face {
    fill: var(--np-card);
    stroke: var(--np-ink);
    stroke-width: 1.2;
  }
  .wedge {
    fill: color-mix(in srgb, var(--np-spot) 22%, transparent);
  }
  .mark {
    stroke: var(--np-ink-3);
    stroke-width: 1;
  }
  .mark.noon {
    stroke: var(--np-spot);
    stroke-width: 1.6;
  }
  .hour,
  .minute {
    stroke: var(--np-ink);
    stroke-linecap: round;
  }
  .hour {
    stroke-width: 2;
  }
  .minute {
    stroke-width: 1.3;
  }
  .pin {
    fill: var(--np-ink);
  }
  .safe {
    fill: color-mix(in srgb, var(--np-spot) 14%, var(--np-card));
    stroke: var(--np-spot);
    stroke-width: 1.4;
  }
  .nextc {
    fill: var(--np-card);
    stroke: var(--np-ink);
    stroke-width: 1.2;
    stroke-dasharray: 2.6 1.8;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    white-space: nowrap;
  }
  .title {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.12em;
    line-height: 1.1;
    color: var(--np-ink);
  }
  .now {
    font-family: var(--np-serif);
    font-style: italic;
    color: var(--np-ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .push {
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, var(--np-spot) 60%, transparent);
    border-radius: 2px;
    color: var(--np-spot);
    font-size: 0.92em;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    animation: flash 0.6s ease-out;
  }
  .push.down {
    border-color: color-mix(in srgb, var(--np-good) 60%, transparent);
    color: var(--np-good);
  }
  @keyframes flash {
    from {
      background: color-mix(in srgb, var(--np-spot) 25%, transparent);
    }
  }
  /* The time line: the clock's progress to midnight with its milestones, or the zone's countdown. */
  .track {
    position: relative;
    height: 5px;
    background: var(--np-paper-2);
    border: 1px solid var(--np-rule);
    border-radius: 1px;
  }
  .fill {
    height: 100%;
    background: var(--np-ink);
    transition: width 0.5s linear;
  }
  .late .fill,
  .closing .fill {
    background: var(--np-spot);
  }
  .mile {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 9px;
    margin-left: -1px;
    background: var(--np-ink-3);
  }
  .mile.passed {
    background: var(--np-spot);
  }
  .next {
    display: flex;
    gap: 5px;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    font-family: var(--np-serif);
  }
  .next b {
    color: var(--np-ink);
    font-family: var(--text);
    font-weight: 600;
  }
  .next b.bad {
    color: var(--np-spot);
  }
  .label {
    color: var(--np-ink-3);
  }
  .effect {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .count {
    flex: none;
    display: grid;
    justify-items: end;
    padding-left: 10px;
    border-left: 1px solid var(--np-rule);
    line-height: 1;
  }
  .count small {
    font-size: 0.78em;
    color: var(--np-ink-3);
  }
  .count .mono {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.5em;
    font-variant-numeric: tabular-nums lining-nums;
    color: var(--np-ink);
  }
  .closing .count .mono,
  .late .count .mono {
    color: var(--np-spot);
  }
  /* The rules open below the banner (the top of the window), above the dispatches. */
  .banner[data-tip]:hover::after {
    top: calc(100% + 6px);
    bottom: auto;
    white-space: pre-line;
    width: min(440px, 90vw);
    text-align: left;
  }
  @container (max-width: 600px) {
    .now,
    .push {
      display: none;
    }
    .dial {
      width: 30px;
      height: 30px;
    }
  }
</style>
