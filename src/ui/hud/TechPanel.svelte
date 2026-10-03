<script lang="ts">
  // Technology tree: six branches (columns) over six tiers (rows), then one endless
  // technology per branch. Economy and industry come first; the war branches need them.
  // Clicking a technology aims research at it (its missing prerequisites come first, in
  // order, numbered on the cards); Shift+click queues it after the current goal. The
  // panel is self-contained: it fits a narrow window as well as a wide one. It is printed
  // on the journal's paper: the research figures as its dateline, the inspector as a box.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { t, num } from '../i18n/i18n.svelte';
  import { settings, saveSettings } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import {
    BRANCHES,
    BRANCH_ROWS,
    LEVELS,
    MAX_REPEAT,
    NODES,
    TIERS,
    costOf,
    isAvailable,
    isResearched,
    nodeId,
    repeatCount,
    researchPath,
    techKey,
    type TechNode,
    type Unlock,
  } from '../../core/rules/tech';
  import { B } from '../../core/game/constants';
  import { researchPlan, etaSeconds } from './research';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';
  import PaperMast from './PaperMast.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);

  const BRANCH_ICON: Record<string, IconName> = {
    economy: 'gold',
    industry: 'factory',
    military: 'war',
    naval: 'warship',
    defense: 'immune',
    nuclear: 'nuke',
  };
  /** Icons of each branch's technologies, the endless one last. */
  const NODE_ICON: Record<string, IconName[]> = {
    economy: ['gold', 'council', 'book', 'globe', 'income', 'trade', 'sparkles'],
    industry: ['train', 'factory', 'airfield', 'settings', 'city', 'network', 'upgrade'],
    military: ['terrain', 'forward', 'sword', 'event', 'users', 'target', 'troops'],
    naval: ['warship', 'target', 'transport', 'port', 'factory', 'tradeRoutes', 'income'],
    defense: ['sam', 'radar', 'upgrade', 'immune', 'siren', 'target', 'eye'],
    nuclear: ['uranium', 'silo', 'nuke', 'collapse', 'bomb', 'factory', 'refresh'],
  };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
  const UNLOCK_ICON: Record<Unlock, IconName> = {
    silo: 'silo',
    atom: 'nuke',
    hydrogen: 'nuke',
    mirv: 'bomb',
    sam: 'sam',
    radar: 'radar',
    airfield: 'airfield',
  };

  // Layout (px): tier labels on the left, branch headers on top, gutters for the links.
  let gw = $state(600);
  // A narrow window (a small screen, or the window resized): the compact tree, with
  // tighter gutters and smaller print (the inspector below keeps the details).
  const compact = $derived(gw < 520);
  const TL = $derived(compact ? 16 : 24);
  const G = $derived(compact ? 6 : 10);
  const RH = 50;
  const V = 12;
  const HEAD = 30;
  const ROWS = TIERS + 1;
  const COLS = BRANCH_ROWS.length;
  const W = $derived(Math.max(40, (gw - TL - G * (COLS - 1)) / COLS));
  const H = HEAD + ROWS * (RH + V) - V;
  const colOf = (n: TechNode): number => BRANCH_ROWS.indexOf(n.branch);
  const colX = (c: number): number => TL + c * (W + G);
  const rowY = (tier: number): number => HEAD + (tier - 1) * (RH + V);

  const levels = $derived(L?.tech ?? []);
  const target = $derived(L?.researching ?? -1);
  const queue = $derived(L?.researchQueue ?? []);
  const goals = $derived(target >= 0 ? [target, ...queue] : [...queue]);
  /** Everything planned, in order: current goal's path, then each queued goal's. */
  const plan = $derived(researchPlan(levels, goals));
  const current = $derived(target >= 0 ? (plan[0]?.id ?? -1) : -1);
  const rate = $derived(L?.researchRate ?? 0);
  const bank = $derived(L?.researchPoints ?? 0);
  const src = $derived(L?.research ?? { base: 0, labs: 0, labLevels: 0, mult: 1 });
  /** Where the points come from: the base rate, the research centres, the bonuses. */
  const sources = $derived(
    [
      t('tech.srcBase', { n: num(src.base, 1) }),
      src.labLevels > 0 ? t('tech.srcLabs', { lv: src.labLevels, n: num(src.labs, 1) }) : '',
      src.mult > 1 ? t('tech.srcBonus', { n: Math.round((src.mult - 1) * 100) }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );

  let hovered = $state(-1);
  const firstOpen = $derived(NODES.find((n) => isAvailable(levels, n.id))?.id ?? 0);
  const focus = $derived(
    hovered >= 0 ? hovered : hud.techFocus >= 0 ? hud.techFocus : target >= 0 ? target : firstOpen,
  );
  const fnode = $derived(NODES[focus]!);
  const fpath = $derived(researchPath(levels, focus));
  const fcost = $derived(
    fpath.reduce((s, id) => s + (NODES[id]!.repeat ? costOf(levels, id) : NODES[id]!.cost), 0),
  );
  const planIds = $derived(plan.map((s) => s.id));
  /** Order numbers on the cards: the hovered technology's path, else the plan. */
  const preview = $derived(hovered >= 0 && !planIds.includes(hovered));
  const shown = $derived(preview ? fpath : planIds);

  // The tech panel was opened on a technology (a locked tool): forget it on close.
  $effect(() => () => {
    hud.techFocus = -1;
  });

  type State = 'done' | 'current' | 'queued' | 'available' | 'locked';
  const fst = $derived(stateOf(focus));
  function stateOf(id: number): State {
    const n = NODES[id]!;
    if (n.repeat ? repeatCount(levels, n.branch) >= MAX_REPEAT : isResearched(levels, id)) return 'done';
    if (id === current) return 'current';
    if (planIds.includes(id)) return 'queued';
    return isAvailable(levels, id) ? 'available' : 'locked';
  }
  const nameOf = (id: number): string => t(`${techKey(id)}.name`);
  const iconOf = (n: TechNode): IconName => NODE_ICON[BRANCHES[n.branch]]![n.level - 1] ?? 'tech';
  /** What a technology needs: the previous level of its branch (the last one for the endless technology) and its other prerequisites. */
  const prereqs = (n: TechNode): number[] =>
    n.repeat ? [nodeId(n.branch, LEVELS)] : [...(n.level > 1 ? [n.id - 1] : []), ...n.requires];
  const reps = (n: TechNode): number => (n.repeat ? repeatCount(levels, n.branch) : 0);
  const inQueue = (id: number): boolean => queue.includes(id);

  /** Game time to gather `points` more at the current rate. */
  function eta(points: number): string {
    const s = etaSeconds(points, rate);
    if (s === 0) return t('tech.etaNow');
    if (!Number.isFinite(s)) return '—';
    if (s < 60) return t('tech.etaS', { s });
    const m = Math.floor(s / 60);
    return m >= 10 ? t('tech.etaM', { m }) : t('tech.etaMS', { m, s: String(s % 60).padStart(2, '0') });
  }
  /** Points still needed (bank deducted) to finish the plan up to the end of `goal`. */
  const goalEta = (goal: number): string => {
    const last = plan.filter((s) => s.goal === goal).at(-1);
    return last ? eta(last.cum - bank) : '—';
  };

  /** A prerequisite link from another branch: out of its side, along the gutters, into the top of the dependent card. */
  function route(a: TechNode, b: TechNode): string {
    const ca = colOf(a);
    const cb = colOf(b);
    const dir = cb > ca ? 1 : -1;
    const sx = dir > 0 ? colX(ca) + W : colX(ca);
    const sy = rowY(a.tier) + RH / 2;
    const gx = sx + (dir * G) / 2;
    const gy = rowY(b.tier) - V / 2;
    const ex = colX(cb) + (dir > 0 ? W * 0.3 : W * 0.7);
    return `M${sx},${sy} H${gx} V${gy} H${ex} V${rowY(b.tier)}`;
  }
  const links = NODES.flatMap((n) => n.requires.map((r) => ({ a: NODES[r]!, b: n })));
  const chains = NODES.filter((n) => n.level > 1).map((n) => ({
    a: NODES[n.repeat ? nodeId(n.branch, LEVELS) : n.id - 1]!,
    b: n,
  }));

  function research(id: number, e?: MouseEvent): void {
    if (stateOf(id) === 'done') return;
    hud.techFocus = -1;
    if (e?.shiftKey) ctl.session.cmd({ t: 'research', tech: id, op: 'queue' });
    else ctl.session.cmd({ t: 'research', tech: id });
  }
  const enqueue = (id: number): void => ctl.session.cmd({ t: 'research', tech: id, op: 'queue' });
  const unqueue = (id: number): void => ctl.session.cmd({ t: 'research', tech: id, op: 'unqueue' });
  const stop = (): void => ctl.session.cmd({ t: 'research', tech: -1 });
  function buildLab(): void {
    hud.tool = { k: 'build', kind: B.Lab };
  }
  function toggleAuto(): void {
    settings.game.autoResearch = !settings.game.autoResearch;
    saveSettings();
  }
</script>

<div class="paper newsprint np-window tech" class:compact>
  <PaperMast title={t('panel.tech')} onclose={() => (hud.panels.tech = false)}>
    {#if L}
      <div class="status" data-testid="tech-status">
        <p class="np-dateline">
          <span class="rate"
            ><Icon name="tech" size={13} /><b>+{num(rate, 1)}</b>&nbsp;{t('tech.perSecond')}</span
          >
          <span class="src" data-testid="tech-sources">{sources}</span>
          <span class="bank">{t('tech.bank', { n: num(Math.floor(bank)) })}</span>
        </p>
        {#if src.labLevels === 0}
          <div class="nolab" data-testid="tech-nolab">
            <Icon name="lab" size={14} /><span>{t('tech.noLab')}</span>
            <button class="np-btn small" onclick={buildLab}>{t('tech.buildLab')}</button>
          </div>
        {/if}
        {#if target >= 0 && current >= 0}
          {@const step = plan[0]!}
          <div class="now">
            <span class="what"
              >{t('tech.studying')} <b>{nameOf(current)}</b>{#if current !== target}<span class="to"
                  >&nbsp;→ {nameOf(target)}</span
                >{/if}</span
            >
            <span class="eta mono"
              >{num(Math.min(bank, step.cost))} / {num(step.cost)} · {goalEta(target)}</span
            >
            <button class="np-btn small quiet" onclick={stop} data-testid="tech-stop">{t('tech.stop')}</button
            >
          </div>
          <div class="bar" aria-hidden="true">
            <div style="width:{Math.min(100, (bank / step.cost) * 100)}%"></div>
          </div>
        {:else}
          <p class="idle">{t('tech.intro')}</p>
        {/if}
        <div class="queue" data-testid="tech-queue">
          <span class="lbl">{t('tech.queueTitle')}</span>
          {#each queue as q, k (q)}
            <span class="qchip">
              <span class="qn mono">{k + 1}</span>
              <span class="qname">{nameOf(q)}</span>
              <span class="qeta mono">{goalEta(q)}</span>
              <button
                class="qx"
                onclick={() => unqueue(q)}
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
    {/if}
  </PaperMast>

  {#if L}
    <div class="treebox scroll">
      <div class="tree" bind:clientWidth={gw} style="height:{H}px" data-testid="tech-tree">
        <!-- The branches' lanes: every other column lightly shaded, as a table's. -->
        {#each BRANCH_ROWS as b, c (b)}
          {#if c % 2 === 1}<span
              class="lane"
              style="left:{colX(c) - G / 2}px; width:{W + G}px; top:{HEAD - 6}px; height:{H - HEAD + 10}px"
              aria-hidden="true"
            ></span>{/if}
        {/each}
        {#each BRANCH_ROWS as b, c (b)}
          {@const br = BRANCHES[b]!}
          <div
            class="branch b-{br}"
            title={t(`tech.${br}.title`)}
            style="left:{colX(c)}px; width:{W}px; height:{HEAD - 6}px"
          >
            <Icon name={BRANCH_ICON[br]!} size={14} />
            {#if W >= 76}<span class="bname">{t(`tech.${br}.title`)}</span>{/if}
            {#if W >= 118}<span class="blv mono">{Math.min(LEVELS, levels[b] ?? 0)}/{LEVELS}</span>{/if}
          </div>
        {/each}
        {#each { length: ROWS } as _, k (k)}
          <span class="tier" class:endless={k === TIERS} style="top:{rowY(k + 1)}px; height:{RH}px"
            >{k < TIERS ? ROMAN[k] : '∞'}</span
          >
        {/each}
        <span class="endline" style="top:{rowY(ROWS) - V / 2 - 2}px; left:0" aria-hidden="true"></span>

        <svg class="links" width={gw} height={H} aria-hidden="true">
          {#each chains as k (k.b.id)}
            <line
              class="chain"
              class:done={k.b.repeat ? (levels[k.b.branch] ?? 0) >= LEVELS : isResearched(levels, k.b.id)}
              class:hot={k.b.id === focus}
              x1={colX(colOf(k.b)) + W / 2}
              y1={rowY(k.a.tier) + RH}
              x2={colX(colOf(k.b)) + W / 2}
              y2={rowY(k.b.tier)}
            />
          {/each}
          {#each links as k (`${k.a.id}-${k.b.id}`)}
            <path
              class="req"
              class:done={isResearched(levels, k.a.id)}
              class:hot={k.b.id === focus}
              d={route(k.a, k.b)}
            />
          {/each}
        </svg>

        {#each NODES as n (n.id)}
          {@const st = stateOf(n.id)}
          {@const order = shown.indexOf(n.id)}
          <button
            class="node {st} b-{BRANCHES[n.branch]}"
            class:focus={n.id === focus}
            class:need={preview && order >= 0}
            class:unlock={n.unlocks.length > 0}
            class:endless={n.repeat}
            style="left:{colX(colOf(n))}px; top:{rowY(n.tier)}px; width:{W}px; height:{RH}px"
            onclick={(e) => research(n.id, e)}
            onmouseenter={() => (hovered = n.id)}
            onmouseleave={() => (hovered = -1)}
            onfocus={() => (hovered = n.id)}
            onblur={() => (hovered = -1)}
            aria-label="{nameOf(n.id)} — {t(`tech.state.${st}`)}"
            data-testid="tech-{techKey(n.id).slice(5)}"
          >
            <span class="top">
              <span class="ico"><Icon name={iconOf(n)} size={13} /></span>
              {#if order >= 0 && st !== 'done'}<span class="ord mono" class:pre={preview}>{order + 1}</span
                >{/if}
              <span class="right">
                {#if n.repeat && reps(n) > 0}<span class="lvl mono">×{reps(n)}</span>{/if}
                {#if st === 'done'}<Icon name="check" size={12} />
                {:else}
                  {#if st === 'locked'}<Icon name="lock" size={10} />{/if}
                  <span class="cost mono">{num(costOf(levels, n.id))}</span>
                {/if}
              </span>
            </span>
            <span class="nm">{nameOf(n.id)}</span>
            {#if st === 'current'}<span
                class="prog"
                style="width:{Math.min(100, (bank / costOf(levels, n.id)) * 100)}%"
              ></span>{/if}
          </button>
        {/each}
      </div>
    </div>

    <div class="inspect b-{BRANCHES[fnode.branch]}" data-testid="tech-inspect">
      <div class="ihead">
        <span class="iico"><Icon name={iconOf(fnode)} size={18} /></span>
        <b class="iname"
          >{nameOf(focus)}{#if fnode.repeat && reps(fnode) > 0}
            · {t('tech.repeatLevel', { n: reps(fnode) })}{/if}</b
        >
        <small class="iwhere"
          >{t(`tech.${BRANCHES[fnode.branch]}.title`)} · {fnode.repeat
            ? t('tech.tierRepeat')
            : t('tech.tier', { n: ROMAN[fnode.tier - 1]! })}</small
        >
        <span class="np-tag state {fst}">{t(`tech.state.${fst}`)}</span>
      </div>
      <p class="effect">
        {t(`${techKey(focus)}.desc`)}{#if fnode.repeat}<span class="hint"
            >&nbsp;— {fst === 'done' ? t('tech.repeatMax') : t('tech.repeatHint')}</span
          >{/if}
      </p>
      {#if fnode.unlocks.length}
        <div class="row unlocks">
          <span class="lbl">{t('tech.unlocks')}</span>
          {#each fnode.unlocks as u (u)}
            <span class="np-tag unl"><Icon name={UNLOCK_ICON[u]} size={12} />{t(`tech.unlock.${u}`)}</span>
          {/each}
        </div>
      {/if}
      <div class="foot">
        <span class="row reqs">
          <span class="lbl">{t('tech.requires')}</span>
          {#each prereqs(fnode) as r (r)}
            {@const ok = isResearched(levels, r)}
            <span class="req" class:ok title={t(`tech.${BRANCHES[NODES[r]!.branch]}.title`)}
              ><Icon name={ok ? 'check' : 'lock'} size={11} />{nameOf(r)}</span
            >
          {:else}
            <span class="req ok">{t('tech.requiresNone')}</span>
          {/each}
        </span>
        {#if fst === 'done'}
          <span class="hint end">{fnode.repeat ? t('tech.repeatMax') : t('tech.doneHint')}</span>
        {:else}
          <span class="acts">
            <span class="sum mono"
              >{fpath.length > 1 ? t('tech.pathSteps', { n: fpath.length }) + ' · ' : ''}{t('tech.points', {
                n: num(fcost),
              })} · {eta(fcost - bank)}</span
            >
            {#if focus === target}
              <span class="np-tag state current">{t('tech.goal')}</span>
            {:else if inQueue(focus)}
              <button class="np-btn small quiet" onclick={() => unqueue(focus)} data-testid="tech-unqueue"
                >{t('tech.queueRemove')}</button
              >
            {:else}
              {#if target >= 0}<button
                  class="np-btn small"
                  onclick={() => enqueue(focus)}
                  data-testid="tech-queue-add">{t('tech.queueAdd')}</button
                >{/if}
              <button class="np-btn small ink" onclick={() => research(focus)} data-testid="tech-research"
                >{fpath.length > 1 ? t('tech.researchPath', { n: fpath.length }) : t('tech.research')}</button
              >
            {/if}
          </span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .tech {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  /* Compact tree (narrow window): the cost and the level count go to the inspector, the
     branch names to the headers' tooltips when the columns are too narrow for them. */
  .compact .nm {
    font-size: 0.6em;
    hyphens: auto;
  }
  .compact .bname {
    font-size: 0.74em;
  }
  .compact .blv,
  .compact .node .cost {
    display: none;
  }
  .compact .node {
    padding: 3px 3px 4px;
  }
  .compact .branch {
    justify-content: center;
  }
  .compact .src {
    order: 3;
    flex-basis: 100%;
  }
  /* Branch inks, the chart's (BRAND.md §4.1): brass for the economy, magenta for the bomb. */
  .b-economy,
  .b-industry {
    --acc: var(--np-warn);
  }
  .b-military {
    --acc: var(--np-ink);
  }
  .b-naval {
    --acc: #2c6e91;
  }
  .b-defense {
    --acc: var(--np-good);
  }
  .b-nuclear {
    --acc: var(--np-spot);
  }

  /* ---- status: the research figures as the dateline, what is studied, the queue */
  .status {
    display: grid;
    gap: 5px;
    padding-bottom: 7px;
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
  .now {
    display: flex;
    align-items: baseline;
    gap: 10px;
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
    height: 2px;
    margin-top: -3px;
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

  /* ---- tree */
  .treebox {
    min-height: 0;
    padding: 10px 14px 10px 12px;
    scrollbar-color: var(--np-rule) transparent;
  }
  .tree {
    position: relative;
  }
  .lane {
    position: absolute;
    background: rgba(23, 42, 60, 0.035);
  }
  .tier {
    position: absolute;
    left: 0;
    width: 18px;
    display: grid;
    place-items: center;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.74em;
    color: var(--np-ink-3);
  }
  .tier.endless {
    font-size: 1.15em;
    font-weight: 400;
    color: var(--np-ink-2);
  }
  /* The endless technologies under a double rule, as a paper's last column. */
  .endline {
    position: absolute;
    right: 0;
    border-top: 3px double var(--np-rule-2);
  }
  .branch {
    position: absolute;
    top: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 2px;
    color: var(--acc);
    border-bottom: 2px solid var(--acc);
    min-width: 0;
  }
  .bname {
    font-family: var(--title);
    font-size: 0.86em;
    font-weight: 600;
    color: var(--np-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .blv {
    margin-left: auto;
    font-size: 0.7em;
    color: var(--np-ink-3);
  }
  .links {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  .links .chain,
  .links .req {
    fill: none;
    stroke: var(--np-rule-2);
    stroke-width: 1.2;
  }
  .links .req {
    stroke-dasharray: 3 3;
  }
  .links .done {
    stroke: color-mix(in srgb, var(--np-good) 60%, transparent);
    stroke-dasharray: none;
  }
  .links .req.done {
    stroke: color-mix(in srgb, var(--np-good) 40%, transparent);
  }
  .links .hot {
    stroke: var(--np-ink);
    stroke-width: 1.6;
    stroke-dasharray: none;
  }

  /* Cards. Available: printed on a card in ink. Done: shaded, ticked. Current: reversed
     (paper on ink), its progress in gold. Planned: a dashed rule and its order. Locked:
     a dotted outline in grey. */
  .node {
    position: absolute;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1px;
    padding: 4px 6px 4px;
    text-align: left;
    border: 1px solid var(--np-ink-2);
    border-radius: 2px;
    background: var(--np-card);
    color: var(--np-ink);
    font-family: var(--text);
    cursor: pointer;
    overflow: hidden;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .node:hover,
  .node:focus-visible {
    background: #fffdf8;
    border-color: var(--np-ink);
    outline: none;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .ico {
    display: inline-flex;
    color: var(--acc);
  }
  .right {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--np-ink-3);
  }
  .cost {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--np-warn);
  }
  .lvl {
    font-size: 0.7em;
    font-weight: 600;
    color: var(--np-ink);
  }
  .ord {
    display: inline-grid;
    place-items: center;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    font-size: 0.64em;
    font-weight: 600;
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .ord.pre {
    background: transparent;
    color: var(--np-ink);
    box-shadow: inset 0 0 0 1px var(--np-ink);
  }
  .nm {
    font-size: 0.72em;
    font-weight: 500;
    line-height: 1.18;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .prog {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: #d6a53f;
    transition: width 0.3s;
  }
  .node.done {
    border-color: var(--np-paper-2);
    background: var(--np-paper-2);
    color: var(--np-ink-2);
  }
  .node.done .right {
    color: var(--np-good);
  }
  .node.done:hover,
  .node.done:focus-visible {
    border-color: var(--np-rule-2);
  }
  .node.current {
    border-color: var(--np-ink);
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .node.current .ico,
  .node.current .right,
  .node.current .lvl {
    color: inherit;
  }
  .node.current .cost {
    color: #e7c77f;
  }
  .node.current .ord {
    background: var(--np-paper);
    color: var(--np-ink);
  }
  .node.queued,
  .node.need {
    border-style: dashed;
    border-color: var(--np-ink);
  }
  .node.locked {
    border-style: dotted;
    border-color: var(--np-rule-2);
    background: transparent;
    color: var(--np-ink-3);
  }
  .node.locked .ico {
    opacity: 0.7;
  }
  .node.locked:hover,
  .node.locked:focus-visible {
    border-color: var(--np-ink-2);
    background: var(--np-card);
  }
  /* The technology shown in the inspector: an ink ring around the card. */
  .node.focus {
    box-shadow:
      0 0 0 1px var(--np-paper),
      0 0 0 2.5px var(--np-ink);
  }
  /* What unlocks a building or a bomb: a notch in the branch ink. */
  .node.unlock::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: var(--acc);
  }
  .node.current.unlock::before {
    background: var(--np-paper);
  }

  /* ---- inspector: a boxed item under the tree */
  .inspect {
    display: grid;
    gap: 4px;
    margin: 0 18px 14px;
    padding: 8px 12px 9px;
    border: 1px solid var(--np-ink);
    box-shadow: 3px 3px 0 var(--np-paper-2);
    background: var(--np-paper);
  }
  .ihead {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .iico {
    display: inline-flex;
    align-self: center;
    color: var(--acc);
  }
  .iname {
    font-family: var(--title);
    font-size: 1.1em;
    font-weight: 600;
    color: var(--np-ink);
    white-space: nowrap;
  }
  .iwhere {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
    color: var(--np-ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .np-tag.state {
    margin-left: auto;
    align-self: center;
  }
  .np-tag.done {
    color: var(--np-good);
    border-color: color-mix(in srgb, var(--np-good) 45%, transparent);
  }
  .np-tag.current {
    color: var(--np-paper);
    background: var(--np-ink);
    border-color: var(--np-ink);
  }
  .np-tag.queued {
    color: var(--np-ink);
    border-style: dashed;
    border-color: var(--np-ink);
  }
  .np-tag.available {
    color: var(--np-ink);
    border-color: var(--np-ink-2);
  }
  .np-tag.locked {
    color: var(--np-ink-3);
    border-style: dotted;
    border-color: var(--np-rule-2);
  }
  .effect {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.9em;
    line-height: 1.4;
    color: var(--np-ink);
  }
  .hint {
    margin: 0;
    font-size: 0.92em;
    color: var(--np-ink-2);
  }
  .hint.end {
    margin-left: auto;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 0.8em;
  }
  .lbl {
    color: var(--np-ink-3);
  }
  .np-tag.unl {
    font-size: 0.94em;
    color: var(--acc);
    border-color: color-mix(in srgb, var(--acc) 45%, transparent);
  }
  .req {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--np-ink-2);
  }
  .req.ok {
    color: var(--np-good);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    min-height: 24px;
    padding-top: 5px;
    border-top: 1px solid var(--np-rule);
  }
  .sum {
    font-size: 0.8em;
    font-weight: 500;
    color: var(--np-warn);
  }
  .acts {
    margin-left: auto;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 6px 8px;
  }
</style>
