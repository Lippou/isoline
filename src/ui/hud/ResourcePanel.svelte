<script lang="ts">
  import { activeEvent, attackCapOf } from './worldEvents';
  import { hud } from '../stores/game.svelte';
  import { t, short, num, clock } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import Icon from '../icons/Icon.svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { hudSize } from '../stores/hudBox.svelte';
  import { folds, setFold } from '../stores/folds.svelte';
  import FoldButton from './FoldButton.svelte';

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
  // The whole ceiling (1.20): the army in ink, the troops locked on front lines greyed after it.
  const fullCap = $derived(L ? L.popCap + L.lineTroops : 0);
  const capPct = $derived(L && fullCap > 0 ? Math.min(100, (L.troops / fullCap) * 100) : 0);
  const linePct = $derived(L && fullCap > 0 ? Math.min(100 - capPct, (L.lineTroops / fullCap) * 100) : 0);
  // Trade and train payouts are decaying sums (×0.8 every 5 s ≈ the last 25 s): per second.
  const tradePs = $derived(L ? L.incomeBreakdown.trade / 25 : 0);
  const trainsPs = $derived(L ? L.incomeBreakdown.trains / 25 : 0);
  const incomePs = $derived(L ? L.income * 10 + tradePs + trainsPs : 0);
  let showIncome = $state(false);
  const generalReady = $derived(L ? L.generalReadyIn === 0 : false);
  // Short windows: the lists of our attacks and boats fold into badges that open them, so
  // the panel does not climb into the dock and the column of cards (incoming attacks stay
  // listed: they call for an answer).
  const folded = new MediaQuery('max-height: 900px');
  let unfolded = $state<'' | 'attacks' | 'boats'>('');
  const shows = (k: 'attacks' | 'boats') => !folded.current || unfolded === k;
  const unfold = (k: 'attacks' | 'boats') => (unfolded = unfolded === k ? '' : k);
  // Folded by the player (remembered, folds.svelte.ts): one line of essentials — troops,
  // gold, the attack ratio — and the attacks coming at us, in magenta, when there are.
  const strip = $derived(folds.res);
  /** Mutinies (world event): the share of the army an order may commit (1: no limit). */
  const cap = $derived(attackCapOf(hud.world, hud.tick));
  const mutinyLeft = $derived(cap < 1 ? (activeEvent(hud.world, hud.tick)?.left ?? 0) : 0);
</script>

{#if L && strip}
  <section class="res panel folded" data-testid="resource-panel" data-folded="true" use:hudSize={'res'}>
    <button
      class="fstrip fold-in"
      onclick={() => setFold('res', false)}
      aria-expanded="false"
      aria-label={t('fold.unfold', { name: t('fold.res') })}
      title={t('fold.unfold', { name: t('fold.res') })}
      data-testid="resource-strip"
    >
      <FoldButton glyph folded name={t('fold.res')} dir="down" />
      <span class="fig"
        ><Icon name="troops" size={13} /><b class="mono">{short(L.troops)}</b><small class="mono"
          >/{short(L.popCap + L.lineTroops)}</small
        ></span
      >
      <span class="fig"><Icon name="gold" size={13} /><b class="mono brass">{short(L.gold)}</b></span>
      <span class="fig"
        ><Icon name="war" size={13} /><b class="mono">{Math.round(hud.attackRatio * 100)} %</b></span
      >
      {#if incoming.length}<span class="alarm mono" data-testid="resource-strip-incoming"
          ><Icon name="sword" size={12} />{incoming.length}</span
        >{/if}
    </button>
  </section>
{:else if L}
  <section class="res panel" data-testid="resource-panel" use:hudSize={'res'}>
    <div class="block">
      <div class="head">
        <span class="section-title" data-tip={t('hud.armyTip')}
          ><Icon name="troops" size={14} />{t('hud.army')}</span
        >
        <span class="headr">
          <svg viewBox="0 0 100 24" class="spark" aria-hidden="true"><polyline points={spark} /></svg>
          <FoldButton
            folded={false}
            name={t('fold.res')}
            dir="down"
            tip="above-start"
            onclick={() => setFold('res', true)}
            testid="fold-res"
          />
        </span>
      </div>
      <div class="troops-row">
        <span class="value mono" data-tip={t('hud.troopsTip')}
          >{short(L.troops)}<small> / {short(L.popCap + L.lineTroops)}</small></span
        >
        <span class="growth mono" class:neg={L.growth < 0} data-tip={t('hud.growthTip')}
          >{L.growth >= 0 ? '+' : ''}{short(L.growth * 10)}/s</span
        >
      </div>
      <div class="cap" data-tip={t('hud.capTip')}>
        <div style="width:{capPct}%"></div>
        {#if linePct > 0}<div
            class="locked"
            style="width:{linePct}%"
            data-testid="troops-locked-bar"
          ></div>{/if}
      </div>
      <!-- Troops standing on front lines: locked out of the army and of its ceiling (1.17). -->
      {#if L.lineTroops >= 1}
        <p
          class="on-lines mono"
          data-testid="troops-on-lines"
          data-tip={t('hud.onLinesTip', {
            n: short(L.lineTroops),
            cap: short(L.popCap + L.lineTroops),
            left: short(L.popCap),
          })}
        >
          <Icon name="lineDefense" size={13} />{t('hud.onLines', { n: short(L.lineTroops) })}
          <small>{t('hud.onLinesCap')}</small>
        </p>
      {/if}
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
        <div class="tip newsprint rise-in">
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
          <kbd class="np-kbd">{keyLabel(settings.keys.ratioDown ?? '')}</kbd><kbd class="np-kbd"
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
          >{Math.round(hud.attackRatio * 100)} % · {short(L.troops * Math.min(hud.attackRatio, cap))}</span
        >
      </label>
      <!-- Mutinies (world event): an order commits at most this much, whatever the slider says. -->
      {#if cap < 1}
        <p
          class="capped"
          data-testid="attack-cap"
          data-tip={t('hud.attackCapTip', {
            pct: Math.round(cap * 100),
            clock: clock(mutinyLeft),
          })}
        >
          <Icon name="mutiny" size={13} />{t('hud.attackCap', { pct: Math.round(cap * 100) })}
          {#if hud.attackRatio > cap}<s class="mono">{Math.round(hud.attackRatio * 100)} %</s>{/if}
        </p>
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

    {#if folded.current && (L.attacks.length || L.transports.length)}
      <div class="badges" data-testid="res-badges">
        {#if L.attacks.length}<button
            class="badge"
            class:on={unfolded === 'attacks'}
            aria-expanded={unfolded === 'attacks'}
            onclick={() => unfold('attacks')}
            ><Icon name="war" size={13} />{t('hud.attacksShort')}<b class="mono">{L.attacks.length}</b><Icon
              name={unfolded === 'attacks' ? 'chevronDown' : 'chevronRight'}
              size={12}
            /></button
          >{/if}
        {#if L.transports.length}<button
            class="badge"
            class:on={unfolded === 'boats'}
            aria-expanded={unfolded === 'boats'}
            onclick={() => unfold('boats')}
            ><Icon name="transport" size={13} />{t('hud.boatsShort')}<b class="mono">{L.transports.length}</b
            ><Icon name={unfolded === 'boats' ? 'chevronDown' : 'chevronRight'} size={12} /></button
          >{/if}
      </div>
    {/if}
    {#if L.attacks.length && shows('attacks')}
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
    {#if L.transports.length && shows('boats')}
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
  /* Bottom left: the army, the treasury and the orders, on the paper. */
  .res {
    position: absolute;
    left: 12px;
    bottom: 12px;
    width: var(--res-w, 290px);
    padding: 0;
    display: grid;
    z-index: 6;
    font-size: 0.92em;
  }
  .block {
    position: relative;
    padding: 9px 12px 10px;
    display: grid;
    gap: 5px;
  }
  .block + .block,
  .actions {
    border-top: 1px solid var(--np-rule);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .head .section-title {
    margin: 0;
  }
  .headr {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  /* Folded (the player's choice): one line of essentials; a click unfolds the panel. */
  .res.folded {
    width: auto;
    max-width: var(--res-w, 290px);
  }
  .fstrip {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px 0 6px;
    border: 0;
    border-top: 3px solid var(--np-ink);
    background: transparent;
    color: var(--np-ink);
    white-space: nowrap;
    cursor: var(--cursor-pointer, pointer);
    transition: background 0.12s;
  }
  .fstrip:hover,
  .fstrip:focus-visible {
    background: var(--np-card);
  }
  .fstrip :global(.fold) {
    border-color: transparent;
    background: transparent;
  }
  .fig {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .fig :global(svg) {
    align-self: center;
    color: var(--np-ink-2);
  }
  .fig b {
    font-weight: 600;
  }
  .fig small {
    font-size: 0.8em;
    color: var(--np-ink-3);
  }
  .alarm {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 5px;
    border-radius: 1px;
    background: var(--np-spot);
    color: #fff7f9;
    font-weight: 700;
  }
  .section-title {
    margin: 0;
  }
  .value {
    font-size: 1.45em;
    font-weight: 600;
    line-height: 1.1;
    color: var(--np-ink);
  }
  .value small {
    font-size: 0.55em;
    color: var(--np-ink-3);
    font-weight: 400;
  }
  .spark {
    width: 90px;
    height: 22px;
  }
  .spark polyline {
    fill: none;
    stroke: var(--np-sea);
    stroke-width: 1.5;
  }
  /* Troops against the population cap: a printed gauge. */
  .cap {
    display: flex;
    height: 5px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .cap div {
    height: 100%;
    background: var(--np-ink);
  }
  /* Locked on front lines: grey, hatched (not a colour alone). */
  .cap div.locked {
    background: repeating-linear-gradient(135deg, #8c939b 0 3px, #b9bec4 3px 5px);
  }
  .on-lines {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 5px 0 0;
    font-size: 0.78em;
    color: var(--np-ink-2);
  }
  .on-lines small {
    margin-left: auto;
    opacity: 0.8;
  }
  .troops-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .growth {
    color: var(--np-good);
    font-size: 0.92em;
    font-weight: 500;
  }
  .growth.neg {
    color: var(--np-spot);
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
    color: var(--np-brass);
  }
  .inc {
    color: var(--np-ink-2);
    font-weight: 500;
  }
  /* The income, line by line: a card laid beside the panel. */
  .tip {
    position: absolute;
    left: calc(100% + 8px);
    bottom: 0;
    width: 230px;
    padding: 9px 12px 10px;
    display: grid;
    gap: 4px;
    z-index: 10;
    border: 1px solid var(--np-edge);
    border-radius: 1px;
    box-shadow: var(--np-lift);
    pointer-events: none;
  }
  .tip div:not(.section-title) {
    display: flex;
    justify-content: space-between;
    font-size: 0.94em;
    color: var(--np-ink-2);
  }
  .tip .section-title {
    padding-bottom: 3px;
    border-bottom: 1px solid var(--np-ink);
    color: var(--np-ink);
  }
  .tip b {
    color: var(--np-ink);
    font-weight: 600;
  }
  .tip small {
    color: var(--np-ink-3);
    font-weight: 400;
  }
  .exact {
    border-top: 1px solid var(--np-rule);
    padding-top: 4px;
    font-weight: 600;
    color: var(--np-brass) !important;
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
    gap: 5px;
  }
  .slider .np-kbd {
    font-size: 0.82em;
  }
  .slider .np-kbd:first-of-type {
    margin-left: 2px;
  }
  .pct {
    color: var(--np-ink-2);
    font-size: 0.9em;
    min-width: 90px;
    text-align: right;
  }
  .actions {
    padding: 8px 12px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  /* Folded lists (short windows): one row of badges that open them. */
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--np-rule);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border: 1px solid var(--np-rule-2);
    border-radius: 2px;
    background: transparent;
    color: var(--np-ink-2);
    font-size: 0.9em;
    cursor: var(--cursor-pointer, pointer);
  }
  .badge b {
    color: var(--np-ink);
  }
  .badge:hover,
  .badge.on {
    color: var(--np-ink);
    border-color: var(--np-ink);
    background: var(--np-paper-2);
  }
  @media (max-height: 900px) {
    .attacks {
      max-height: 76px;
    }
  }
  /* The general's order, ready: brass, the main action of the moment. */
  .general.ready {
    border-color: var(--np-brass-fill);
    color: var(--np-brass);
    font-weight: 600;
  }
  .attacks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
    max-height: 120px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--np-rule-2) transparent;
  }
  .attacks li {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--np-ink-2);
  }
  .attacks .mono {
    font-weight: 500;
    color: var(--np-ink);
  }
  .tgt {
    flex: 1;
    color: var(--np-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li.back {
    opacity: 0.65;
  }
  .state {
    color: var(--np-ink-3);
    font-style: italic;
    font-size: 0.8em;
  }
  .counter {
    padding: 0.15em 0.5em;
    border-color: color-mix(in srgb, var(--np-spot) 60%, transparent);
    color: var(--np-spot);
  }
  .counter:hover,
  .counter:focus-visible {
    border-color: var(--np-spot);
    background: color-mix(in srgb, var(--np-spot) 8%, transparent);
  }
  .section-title.in {
    color: var(--np-spot);
  }
  li.in .mono {
    color: var(--np-spot);
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
    text-decoration: underline;
    text-decoration-color: var(--np-rule-2);
    text-underline-offset: 2px;
  }
  .x {
    display: inline-grid;
    place-items: center;
    background: none;
    border: 0;
    color: var(--np-ink-3);
    cursor: var(--cursor-pointer, pointer);
    padding: 2px;
  }
  .x:hover {
    color: var(--np-spot);
  }
  .capped {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 3px 0 0;
    font-size: 0.78em;
    font-weight: 600;
    color: var(--np-spot);
  }
  .capped s {
    margin-left: auto;
    font-weight: 400;
    color: var(--np-ink-3);
  }
</style>
