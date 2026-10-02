<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short, num } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import Icon from '../icons/Icon.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  /** Where a boat is heading: the country (or empty land) of its landing point. */
  function boatLabel(b: { tx: number; ty: number; retreating: boolean }): string {
    if (b.retreating) return t('hud.boatHome');
    const st = ctl.session.state;
    const o = st.owner[Math.floor(b.ty) * st.width + Math.floor(b.tx)] ?? 0;
    return o > 0 ? st.name(o, settings.lang) : t('hud.wilderness');
  }
  /** A riposte sized to cancel the incoming attack in the clash, plus a margin (OpenFront). */
  const counterTroops = (incoming: number) => Math.min(L?.troops ?? 0, Math.ceil(incoming * 1.1));
  function counter(attacker: number, at: [number, number] | undefined, incoming: number): void {
    const troops = L?.troops ?? 0;
    if (troops < 1) return;
    const ratio = Math.max(0.01, Math.min(1, counterTroops(incoming) / troops));
    // Aim at the attacker's land next to the front (any of its tiles works: the attack takes the shared border).
    const st = ctl.session.state;
    let tile = -1;
    if (at) {
      const w = st.width;
      for (let r = 1; r < 12 && tile < 0; r++)
        for (let dy = -r; dy <= r && tile < 0; dy++)
          for (let dx = -r; dx <= r && tile < 0; dx++) {
            const x = Math.floor(at[0]) + dx;
            const y = Math.floor(at[1]) + dy;
            if (x >= 0 && y >= 0 && x < w && y < st.height && st.owner[y * w + x] === attacker)
              tile = y * w + x;
          }
    }
    if (tile >= 0) ctl.session.cmd({ t: 'attack', tile, ratio });
  }
  /** Land attacks coming at us, with their strength. */
  const incoming = $derived((L?.fronts ?? []).filter((f) => f.target === hud.viewer));
  let history: number[] = $state([]);
  let lastTick = 0;
  $effect(() => {
    const l = hud.local;
    if (!l || hud.tick - lastTick < 10) return;
    lastTick = hud.tick;
    history = [...history.slice(-59), l.troops];
  });
  const spark = $derived.by(() => {
    if (history.length < 2) return '';
    const max = Math.max(...history, 1);
    return history.map((v, k) => `${(k / 59) * 100},${22 - (v / max) * 20}`).join(' ');
  });
  const capPct = $derived(L && L.popCap > 0 ? Math.min(100, (L.troops / L.popCap) * 100) : 0);
  // Trade and train payouts are decaying sums (×0.8 every 5 s ≈ the last 25 s): per second.
  const tradePs = $derived(L ? L.incomeBreakdown.trade / 25 : 0);
  const trainsPs = $derived(L ? L.incomeBreakdown.trains / 25 : 0);
  const incomePs = $derived(L ? L.income * 10 + tradePs + trainsPs : 0);
  let showIncome = $state(false);
  const generalReady = $derived(L ? L.generalReadyIn === 0 : false);
</script>

{#if L}
  <section class="res panel" data-testid="resource-panel">
    <div class="block">
      <div class="head">
        <span class="section-title" data-tip={t('hud.armyTip')}
          ><Icon name="troops" size={14} />{t('hud.army')}</span
        >
        <svg viewBox="0 0 100 24" class="spark" aria-hidden="true"><polyline points={spark} /></svg>
      </div>
      <div class="troops-row">
        <span class="value mono" data-tip={t('hud.troopsTip')}
          >{short(L.troops)}<small> / {short(L.popCap)}</small></span
        >
        <span class="growth mono" class:neg={L.growth < 0} data-tip={t('hud.growthTip')}
          >{L.growth >= 0 ? '+' : ''}{short(L.growth * 10)}/s</span
        >
      </div>
      <div class="cap" data-tip={t('hud.capTip')}><div style="width:{capPct}%"></div></div>
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
        <span class="mono inc">+{short(incomePs)}/s</span>
      </div>
      {#if showIncome}
        <div class="tip panel rise-in">
          <div class="section-title">{t('hud.incomeTitle')}</div>
          <div><span>{t('hud.income.base')}</span><b class="mono">{short(L.incomeBreakdown.base)}/s</b></div>
          <div>
            <span>{t('hud.income.resources')}</span><b class="mono">{short(L.incomeBreakdown.resources)}/s</b>
          </div>
          <div>
            <span>{t('hud.income.trade')}</span><b class="mono"
              >{short(tradePs)}/s <small>Σ {short(L.stats.tradeGold)}</small></b
            >
          </div>
          <div>
            <span>{t('hud.income.trains')}</span><b class="mono"
              >{short(trainsPs)}/s <small>Σ {short(L.stats.trainGold)}</small></b
            >
          </div>
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
            <li class:back={a.retreating}>
              <Icon name={a.retreating ? 'undo' : 'next'} size={13} />
              <span class="tgt"
                >{a.target > 0 ? ctl.session.state.name(a.target, settings.lang) : t('hud.wilderness')}</span
              >
              <span class="mono">{short(a.troops)}</span>
              {#if a.retreating}<small class="state">{t('hud.retreating')}</small>{:else}<button
                  class="x"
                  title={t('hud.cancelAttack')}
                  aria-label={t('hud.cancelAttack')}
                  onclick={() => ctl.session.cmd({ t: 'cancelAttack', id: a.id })}
                  ><Icon name="close" size={13} /></button
                >{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if L.transports.length}
      <div class="block">
        <span class="section-title"
          ><Icon name="transport" size={14} />{t('hud.boatsAtSea', { n: L.transports.length })}</span
        >
        <ul class="attacks">
          {#each L.transports as b (b.id)}
            <li class:back={b.retreating}>
              <Icon name={b.retreating ? 'undo' : 'transport'} size={13} />
              <button
                class="tgt link"
                onclick={() => ctl.renderer.camera.goTo(b.x, b.y, Math.max(2, ctl.renderer.camera.zoom))}
                >{boatLabel(b)}</button
              >
              <span class="mono">{short(b.troops)}</span>
              {#if b.retreating}<small class="state">{t('hud.retreating')}</small>{:else}<button
                  class="x"
                  title={t('hud.recallBoat')}
                  aria-label={t('hud.recallBoat')}
                  onclick={() => ctl.session.cmd({ t: 'boatRetreat', id: b.id })}
                  ><Icon name="undo" size={13} /></button
                >{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
    {#if incoming.length}
      <div class="block">
        <span class="section-title in"><Icon name="sword" size={14} />{t('hud.incomingAttacks')}</span>
        <ul class="attacks">
          {#each incoming as a (a.id)}
            <li class="in">
              <Icon name="back" size={13} />
              <button
                class="tgt link"
                onclick={() => {
                  const [x, y] = a.points[0] ?? [0, 0];
                  ctl.renderer.camera.goTo(x, y, Math.max(2, ctl.renderer.camera.zoom));
                }}>{ctl.session.state.name(a.attacker, settings.lang)}</button
              >
              <span class="mono">{short(a.troops)}</span>
              <button
                class="btn small counter"
                data-tip={t('hud.counterTip', { n: short(counterTroops(a.troops)) })}
                onclick={() => counter(a.attacker, a.points[0], a.troops)}
                ><Icon name="sword" size={12} />{t('hud.counter')}</button
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
  .troops-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .growth {
    color: var(--verdant);
    font-size: 0.92em;
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
  .tip small {
    color: var(--faint);
    font-weight: 400;
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
  li.back {
    opacity: 0.7;
  }
  .state {
    color: var(--faint);
    font-size: 0.8em;
  }
  .counter {
    padding: 0.15em 0.5em;
    border-color: color-mix(in srgb, var(--signal) 60%, transparent);
    color: var(--bad-text);
  }
  .section-title.in {
    color: var(--signal);
  }
  li.in .mono {
    color: var(--bad-text);
  }
  .link {
    appearance: none;
    border: 0;
    padding: 0;
    background: none;
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .link:hover {
    color: var(--bad-text);
  }
  .x {
    background: none;
    border: 0;
    color: var(--faint);
    cursor: var(--cursor-pointer, pointer);
    padding: 2px;
  }
  .x:hover {
    color: var(--signal);
  }
</style>
