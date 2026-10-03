<script lang="ts">
  // Technology tree: six branches of six technologies on six tiers, then one endless
  // technology per branch. Economy and industry come first; the war branches need them.
  // Clicking a technology aims research at it (its missing prerequisites come first, in
  // order, numbered on the cards); Shift+click queues it after the current goal.
  // It is printed on the journal's paper: the research figures as its dateline, the
  // technology pointed at in a box at the foot. Wide, the tree is a planche (a branch per
  // row, a tier per column, every card with its effect); narrow, a ladder (a branch at a
  // time, its technologies one under another). Pointing at a card never moves anything:
  // the box at the foot has a fixed height, the cards a fixed size.
  import './paper.css';
  import './tech/tech.css';
  import { hud } from '../stores/game.svelte';
  import { t, num } from '../i18n/i18n.svelte';
  import { settings, saveSettings } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { B } from '../../core/game/constants';
  import Icon from '../icons/Icon.svelte';
  import PaperMast from './PaperMast.svelte';
  import { TechModel, nameOf } from './tech/model.svelte';
  import TechPlanche from './tech/TechPlanche.svelte';
  import TechLadder from './tech/TechLadder.svelte';
  import TechInspect from './tech/TechInspect.svelte';

  let { ctl }: { ctl: GameController } = $props();
  // svelte-ignore state_referenced_locally
  const m = new TechModel(ctl);
  const L = $derived(m.L);

  /** The window's width: the planche needs room for its seven columns, a narrower window gets the ladder. */
  let ww = $state(1200);
  const planche = $derived(ww >= 1120);

  // The tech panel was opened on a technology (a locked tool): forget it on close.
  $effect(() => () => {
    hud.techFocus = -1;
  });

  function buildLab(): void {
    hud.tool = { k: 'build', kind: B.Lab };
  }
  function toggleAuto(): void {
    settings.game.autoResearch = !settings.game.autoResearch;
    saveSettings();
  }
</script>

<div class="paper newsprint np-window tech" bind:clientWidth={ww}>
  <PaperMast title={t('panel.tech')} onclose={() => (hud.panels.tech = false)}>
    {#if L}
      <div class="status" data-testid="tech-status">
        <p class="np-dateline">
          <span class="rate"
            ><Icon name="tech" size={13} /><b>+{num(m.rate, 1)}</b>&nbsp;{t('tech.perSecond')}</span
          >
          <span class="src" data-testid="tech-sources">{m.sources}</span>
          <span class="bank">{t('tech.bank', { n: num(Math.floor(m.bank)) })}</span>
        </p>
        {#if m.src.labLevels === 0}
          <div class="nolab" data-testid="tech-nolab">
            <Icon name="lab" size={14} /><span>{t('tech.noLab')}</span>
            <button class="np-btn small" onclick={buildLab}>{t('tech.buildLab')}</button>
          </div>
        {/if}
        <div class="lines">
          {#if m.target >= 0 && m.current >= 0}
            {@const step = m.plan[0]!}
            <div class="now">
              <span class="what"
                >{t('tech.studying')} <b>{nameOf(m.current)}</b>{#if m.current !== m.target}<span class="to"
                    >&nbsp;→ {nameOf(m.target)}</span
                  >{/if}</span
              >
              <span class="eta mono"
                >{num(Math.min(m.bank, step.cost))} / {num(step.cost)} · {m.goalEta(m.target)}</span
              >
              <button class="np-btn small quiet" onclick={m.stop} data-testid="tech-stop"
                >{t('tech.stop')}</button
              >
              <div class="bar" aria-hidden="true">
                <div style="width:{Math.min(100, (m.bank / step.cost) * 100)}%"></div>
              </div>
            </div>
          {:else}
            <p class="idle">{t('tech.intro')}</p>
          {/if}
          <div class="queue" data-testid="tech-queue">
            <span class="lbl">{t('tech.queueTitle')}</span>
            {#each m.queue as q, k (q)}
              <span class="qchip">
                <span class="qn mono">{k + 1}</span>
                <span class="qname">{nameOf(q)}</span>
                <span class="qeta mono">{m.goalEta(q)}</span>
                <button
                  class="qx"
                  onclick={() => m.unqueue(q)}
                  aria-label={t('tech.queueRemove')}
                  title={t('tech.queueRemove')}><Icon name="close" size={11} /></button
                >
              </span>
            {:else}
              <span class="qhint">{t('tech.queueEmpty')}</span>
            {/each}
            <label class="auto" title={t('tech.autoHint')}>
              <input
                type="checkbox"
                checked={settings.game.autoResearch}
                onchange={toggleAuto}
                data-testid="tech-auto"
              />
              {t('tech.auto')}
            </label>
          </div>
        </div>
      </div>
    {/if}
  </PaperMast>

  {#if L}
    {#if planche}
      <TechPlanche {m} />
    {:else}
      <TechLadder {m} />
    {/if}
    <TechInspect {m} />
  {/if}
</div>

<style>
  .tech {
    grid-template-rows: auto minmax(0, 1fr) auto;
    container-type: inline-size;
  }
  /* ---- status: the research figures as the dateline, what is studied, the queue */
  .status {
    display: grid;
    gap: 4px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--np-rule);
  }
  .rate {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: center;
  }
  .src {
    color: var(--np-ink-3);
  }
  .bank {
    margin-left: auto;
  }
  .nolab {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.82em;
    color: var(--np-warn);
  }
  .nolab .np-btn {
    margin-left: auto;
  }
  .lines {
    display: grid;
    gap: 5px;
  }
  /* Wide: what is studied and the queue side by side, under the dateline. */
  @container (min-width: 1000px) {
    .lines {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
      column-gap: 24px;
      align-items: start;
    }
  }
  .now {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 10px;
    min-height: 24px;
    padding-top: 2px;
  }
  .what {
    flex: 1;
    min-width: 0;
    font-family: var(--np-serif);
    font-size: 0.86em;
    color: var(--np-ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .what b {
    font-family: var(--title);
    font-size: 1.12em;
    font-weight: 600;
    color: var(--np-ink);
  }
  .to {
    color: var(--np-ink-2);
  }
  .eta {
    font-size: 0.78em;
    color: var(--np-ink-2);
    white-space: nowrap;
  }
  /* Progress of the technology being studied: an ink hairline on the rule. */
  .bar {
    flex-basis: 100%;
    height: 2px;
    margin-top: 1px;
    background: var(--np-rule);
  }
  .bar div {
    height: 100%;
    background: var(--np-ink);
    transition: width 0.3s;
  }
  .idle {
    margin: 2px 0 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.88em;
    line-height: 1.35;
    color: var(--np-ink-2);
  }
  .queue {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    min-height: 24px;
    font-size: 0.8em;
  }
  .queue .lbl {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .qchip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 2px 1px 3px;
    border: 1px dashed var(--np-ink-2);
    border-radius: 2px;
    color: var(--np-ink);
  }
  .qn {
    display: inline-grid;
    place-items: center;
    min-width: 15px;
    height: 15px;
    border-radius: 8px;
    font-size: 0.82em;
    font-weight: 600;
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .qeta {
    color: var(--np-ink-3);
    font-size: 0.9em;
  }
  .qx {
    display: inline-flex;
    padding: 1px;
    border: 0;
    background: none;
    color: var(--np-ink-3);
    cursor: pointer;
  }
  .qx:hover {
    color: var(--np-ink);
  }
  .qhint {
    color: var(--np-ink-3);
  }
  .auto {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--np-ink-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .auto input {
    margin: 0;
  }
</style>
