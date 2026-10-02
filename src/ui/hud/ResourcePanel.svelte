<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short, num } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { currentSession } from '../stores/app.svelte';
  import Icon from '../icons/Icon.svelte';

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
    return history.map((v, k) => `${(k / 59) * 100},${22 - (v / max) * 20}`).join(' ');
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
  <section class="res panel" data-testid="resource-panel">
    <div class="block">
      <div class="head">
        <span class="section-title" data-tip={t('hud.populationTip')}
          ><Icon name="population" size={14} />{t('hud.population')}</span
        >
        <svg viewBox="0 0 100 24" class="spark" aria-hidden="true"><polyline points={spark} /></svg>
      </div>
      <div class="value mono">{short(L.troops + L.workers)}<small> / {short(L.popCap)}</small></div>
      <div class="cap" data-tip={t('hud.capTip')}><div style="width:{capPct}%"></div></div>
      <div class="split">
        <span data-tip={t('hud.troopsTip')}
          ><Icon name="troops" size={14} /><b class="mono">{short(L.troops)}</b> {t('hud.troops')}</span
        >
        <span data-tip={t('hud.workersTip')}
          ><Icon name="workers" size={14} /><b class="mono">{short(L.workers)}</b> {t('hud.workers')}</span
        >
        <span class="growth mono" class:neg={L.growth < 0} data-tip={t('hud.growthTip')}
          >{L.growth >= 0 ? '+' : ''}{short(L.growth * 10)}/s</span
        >
      </div>
    </div>

    <div
      class="block gold"
      role="button"
      tabindex="0"
      onmouseenter={() => (showIncome = true)}
      onmouseleave={() => (showIncome = false)}
      onfocus={() => (showIncome = true)}
      onblur={() => (showIncome = false)}
    >
      <span class="section-title"><Icon name="gold" size={14} />{t('hud.gold')}</span>
      <div class="goldrow">
        <span class="value mono brass">{short(L.gold)}</span>
        <span class="mono inc">+{short(L.income * 10)}/s</span>
      </div>
      {#if showIncome}
        <div class="tip panel rise-in">
          <div class="section-title">{t('hud.incomeTitle')}</div>
          <div><span>{t('hud.income.base')}</span><b class="mono">{short(L.incomeBreakdown.base)}/s</b></div>
          <div>
            <span>{t('hud.income.workers')}</span><b class="mono">{short(L.incomeBreakdown.workers)}/s</b>
          </div>
          <div>
            <span>{t('hud.income.resources')}</span><b class="mono">{short(L.incomeBreakdown.resources)}/s</b>
          </div>
          <div><span>{t('hud.income.trade')}</span><b class="mono">{short(L.stats.tradeGold)}</b></div>
          <div><span>{t('hud.income.trains')}</span><b class="mono">{short(L.stats.trainGold)}</b></div>
          <div class="exact mono">{num(L.gold)}</div>
        </div>
      {/if}
    </div>

    <div class="block">
      <label class="slider">
        <span class="section-title" data-tip={t('hud.attackRatioTip')}
          ><Icon name="war" size={14} />{t('hud.attackRatio')}
          <kbd>{keyLabel(settings.keys.ratioDown ?? '')}</kbd><kbd
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
        <span class="mono pct"
          >{Math.round(hud.attackRatio * 100)} % · {short(L.troops * hud.attackRatio)}</span
        >
      </label>
      {#if !settings.game.simpleMode}
        <label class="slider">
          <span class="section-title" data-tip={t('hud.troopShareTip')}
            ><Icon name="workers" size={14} />{t('hud.troopShare')}</span
          >
          <input
            type="range"
            min="5"
            max="100"
            value={troopPct}
            onchange={(e) => setTroops(Number((e.target as HTMLInputElement).value))}
          />
          <span class="mono pct">{troopPct} %</span>
        </label>
      {/if}
    </div>

    <div class="actions">
      <button
        class="btn small general"
        class:ready={generalReady}
        disabled={!generalReady}
        onclick={() => (hud.tool = { k: 'general' })}
        data-tip={t(`general.${L.general}.desc`)}
      >
        <Icon name="general" size={14} />{t(`general.${L.general}.name`)}
        {#if !generalReady}<span class="mono">{Math.ceil(L.generalReadyIn / 10)} s</span>{/if}
      </button>
      {#if L.boats > 0}<span class="chip" data-tip={t('hud.boatsTip')}
          ><Icon name="transport" size={13} />{L.boats}</span
        >{/if}
    </div>

    {#if L.attacks.length}
      <div class="block">
        <span class="section-title"><Icon name="war" size={14} />{t('hud.ongoingAttacks')}</span>
        <ul class="attacks">
          {#each L.attacks as a (a.id)}
            <li>
              <Icon name="next" size={13} />
              <span class="tgt">{ctl.session.state.name(a.target, settings.lang)}</span>
              <span class="mono">{short(a.troops)}</span>
              <button
                class="x"
                title={t('hud.cancelAttack')}
                aria-label={t('hud.cancelAttack')}
                onclick={() => ctl.session.cmd({ t: 'cancelAttack', id: a.id })}
                ><Icon name="close" size={13} /></button
              >
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>
{/if}

<style>
  .res {
    position: absolute;
    left: 12px;
    bottom: 12px;
    width: calc(290px * var(--ui-scale));
    padding: 0;
    display: grid;
    z-index: 6;
    font-size: 0.92em;
  }
  .block {
    position: relative;
    padding: 10px 12px;
    display: grid;
    gap: 6px;
  }
  .block + .block,
  .actions {
    border-top: 1px solid var(--line);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .head .section-title {
    margin: 0;
  }
  .section-title {
    margin: 0;
  }
  .value {
    font-size: 1.45em;
    font-weight: 600;
    line-height: 1.1;
  }
  .value small {
    font-size: 0.55em;
    color: var(--faint);
    font-weight: 400;
  }
  .spark {
    width: 90px;
    height: 22px;
  }
  .spark polyline {
    fill: none;
    stroke: var(--aurora);
    stroke-width: 1.5;
  }
  .cap {
    height: 4px;
    background: var(--panel-3);
    border-radius: 2px;
    overflow: hidden;
  }
  .cap div {
    height: 100%;
    background: linear-gradient(90deg, var(--aurora), var(--brass));
  }
  .split {
    display: flex;
    gap: 10px;
    align-items: center;
    color: var(--muted);
    font-size: 0.92em;
  }
  .split span {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .split b {
    color: var(--parchment);
  }
  .growth {
    margin-left: auto;
    color: var(--verdant);
  }
  .growth.neg {
    color: var(--signal);
  }
  .gold {
    cursor: default;
  }
  .goldrow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .brass {
    color: var(--brass);
  }
  .inc {
    color: var(--muted);
  }
  .tip {
    position: absolute;
    left: calc(100% + 8px);
    bottom: 0;
    width: 230px;
    padding: 10px 12px;
    display: grid;
    gap: 4px;
    z-index: 10;
  }
  .tip div:not(.section-title) {
    display: flex;
    justify-content: space-between;
    color: var(--muted);
  }
  .tip b {
    color: var(--parchment);
  }
  .exact {
    border-top: 1px solid var(--line);
    padding-top: 4px;
    color: var(--brass) !important;
    justify-content: flex-end !important;
  }
  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    align-items: center;
  }
  .slider .section-title {
    grid-column: 1 / -1;
  }
  .pct {
    color: var(--muted);
    font-size: 0.9em;
    min-width: 90px;
    text-align: right;
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.9em;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    padding: 0 4px;
    color: var(--muted);
    letter-spacing: 0;
  }
  .actions {
    padding: 8px 12px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .general.ready {
    border-color: var(--brass);
    color: var(--brass);
  }
  .attacks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 3px;
    max-height: 120px;
    overflow-y: auto;
  }
  .attacks li {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .tgt {
    flex: 1;
    color: var(--parchment);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x {
    background: none;
    border: 0;
    color: var(--faint);
    cursor: pointer;
    padding: 2px;
  }
  .x:hover {
    color: var(--signal);
  }
</style>
