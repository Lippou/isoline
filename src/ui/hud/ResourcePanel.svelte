<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short, num } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { currentSession } from '../stores/app.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  let history: number[] = $state([]);
  let lastTick = 0;
  $effect(() => {
    const l = hud.local;
    if (!l || hud.tick - lastTick < 10) return;
    lastTick = hud.tick;
    history = [...history.slice(-59), l.troops + l.workers];
  });
  const spark = $derived.by(() => {
    if (history.length < 2) return '';
    const max = Math.max(...history, 1);
    return history.map((v, k) => `${(k / 59) * 100},${28 - (v / max) * 26}`).join(' ');
  });
  const troopPct = $derived(L ? Math.round((L.troopRatio || 0) * 100) : 60);
  const capPct = $derived(L && L.popCap > 0 ? Math.min(100, ((L.troops + L.workers) / L.popCap) * 100) : 0);
  let showIncome = $state(false);

  function setTroops(v: number): void {
    currentSession()?.cmd({ t: 'troopRatio', ratio: v / 100 });
  }
  const generalReady = $derived(L ? L.generalReadyIn === 0 : false);
</script>

{#if L}
  <section class="panel glass" data-testid="resource-panel">
    <div class="row pop">
      <div class="big">
        <span class="label">{t('hud.population')}</span>
        <span class="mono value">{short(L.troops + L.workers)}<small> / {short(L.popCap)}</small></span>
      </div>
      <svg viewBox="0 0 100 30" class="spark" aria-hidden="true"><polyline points={spark} /></svg>
    </div>
    <div class="cap"><div style="width:{capPct}%"></div></div>
    <div class="row split">
      <span>⚔ <b class="mono">{short(L.troops)}</b> <small>{t('hud.troops')}</small></span>
      <span>⚒ <b class="mono">{short(L.workers)}</b> <small>{t('hud.workers')}</small></span>
      <span class="growth mono" class:neg={L.growth < 0}
        >{L.growth >= 0 ? '+' : ''}{short(L.growth * 10)}/s</span
      >
    </div>
    <div
      class="row gold"
      role="button"
      tabindex="0"
      onmouseenter={() => (showIncome = true)}
      onmouseleave={() => (showIncome = false)}
      onfocus={() => (showIncome = true)}
      onblur={() => (showIncome = false)}
    >
      <span class="label">{t('hud.gold')}</span>
      <span class="mono value brass" title={num(L.gold)}>{short(L.gold)}</span>
      <span class="mono inc">+{short(L.income * 10)}/s</span>
      {#if showIncome}
        <div class="tip glass rise-in">
          <div>{t('hud.income.base')} <b class="mono">{short(L.incomeBreakdown.base)}/s</b></div>
          <div>{t('hud.income.workers')} <b class="mono">{short(L.incomeBreakdown.workers)}/s</b></div>
          <div>{t('hud.income.resources')} <b class="mono">{short(L.incomeBreakdown.resources)}/s</b></div>
          <div>{t('hud.income.trade')} <b class="mono">{short(L.stats.tradeGold)}</b></div>
          <div>{t('hud.income.trains')} <b class="mono">{short(L.stats.trainGold)}</b></div>
          <div class="exact">{num(L.gold)} 🪙</div>
        </div>
      {/if}
    </div>
    <label class="slider">
      <span class="label"
        >{t('hud.attackRatio')} <kbd>{keyLabel(settings.keys.ratioDown ?? '')}</kbd>/<kbd
          >{keyLabel(settings.keys.ratioUp ?? '')}</kbd
        ></span
      >
      <input
        type="range"
        min="1"
        max="100"
        bind:value={() => Math.round(hud.attackRatio * 100), (v) => (hud.attackRatio = v / 100)}
        data-testid="attack-ratio"
      />
      <span class="mono pct">{Math.round(hud.attackRatio * 100)}% · {short(L.troops * hud.attackRatio)}</span>
    </label>
    {#if !settings.game.simpleMode}
      <label class="slider">
        <span class="label">{t('hud.troopShare')}</span>
        <input
          type="range"
          min="5"
          max="100"
          value={troopPct}
          onchange={(e) => setTroops(Number((e.target as HTMLInputElement).value))}
        />
        <span class="mono pct">{troopPct}%</span>
      </label>
    {/if}
    <div class="row actions">
      <button
        class="btn general"
        class:ready={generalReady}
        disabled={!generalReady}
        onclick={() => (hud.tool = { k: 'general' })}
        title={t(`general.${L.general}.desc`)}
      >
        ⭐ {t(`general.${L.general}.name`)}
        {#if !generalReady}<span class="mono"> {Math.ceil(L.generalReadyIn / 10)}s</span>{/if}
      </button>
      {#if L.boats > 0}<span class="chip">⛵ {L.boats}</span>{/if}
    </div>
    {#if L.attacks.length}
      <ul class="attacks">
        {#each L.attacks as a (a.id)}
          <li>
            <span>→ {ctl.session.state.name(a.target, settings.lang)}</span>
            <span class="mono">{short(a.troops)}</span>
            <button
              class="x"
              title={t('hud.cancelAttack')}
              onclick={() => ctl.session.cmd({ t: 'cancelAttack', id: a.id })}>✕</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .panel {
    position: absolute;
    left: 12px;
    bottom: 12px;
    width: calc(300px * var(--ui-scale));
    padding: 0.8rem 0.9rem;
    display: grid;
    gap: 0.5rem;
    z-index: 6;
    font-size: calc(0.92em * var(--ui-scale));
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    position: relative;
  }
  .big {
    display: grid;
  }
  .value {
    font-size: 1.35em;
    font-weight: 600;
  }
  .value small {
    font-size: 0.6em;
    color: var(--faint);
  }
  .brass {
    color: var(--brass);
  }
  .spark {
    flex: 1;
    height: 30px;
  }
  .spark polyline {
    fill: none;
    stroke: var(--aurora);
    stroke-width: 1.4;
    vector-effect: non-scaling-stroke;
  }
  .cap {
    height: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    overflow: hidden;
  }
  .cap div {
    height: 100%;
    background: linear-gradient(90deg, var(--aurora), var(--brass));
    transition: width 0.4s;
  }
  .split {
    justify-content: space-between;
    font-size: 0.92em;
  }
  .split small {
    color: var(--faint);
  }
  .growth {
    color: var(--verdant);
  }
  .growth.neg {
    color: var(--signal);
  }
  .gold {
    cursor: help;
  }
  .inc {
    color: var(--faint);
    margin-left: auto;
  }
  .tip {
    position: absolute;
    bottom: 120%;
    left: 0;
    padding: 0.6rem 0.8rem;
    display: grid;
    gap: 0.2rem;
    font-size: 0.86em;
    min-width: 210px;
    z-index: 10;
  }
  .tip div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .exact {
    color: var(--brass);
    border-top: 1px solid var(--line);
    padding-top: 0.2rem;
  }
  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.15rem 0.6rem;
    align-items: center;
  }
  .slider .label {
    grid-column: 1 / -1;
  }
  .pct {
    font-size: 0.85em;
    color: var(--muted);
    min-width: 6.5em;
    text-align: right;
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.9em;
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 0.3em;
  }
  .general {
    padding: 0.35em 0.7em;
    font-size: 0.9em;
  }
  .general.ready {
    border-color: var(--brass);
    box-shadow: 0 0 12px rgba(242, 184, 75, 0.35);
  }
  .attacks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.2rem;
    font-size: 0.86em;
    max-height: 110px;
    overflow-y: auto;
  }
  .attacks li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.4rem;
  }
  .attacks .x {
    background: none;
    border: 0;
    color: var(--signal);
    cursor: pointer;
  }
</style>
