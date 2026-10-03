<script lang="ts">
  // The technology pointed at (else the goal, else the first one open), boxed at the foot of
  // the window: its effect, what it needs and unlocks, the cost of its path, the orders.
  // Its height is fixed (set by the window's width only, never by what it shows): pointing
  // at another card must not move the tree above it.
  import { t, num } from '../../i18n/i18n.svelte';
  import Icon from '../../icons/Icon.svelte';
  import { NODES, isResearched } from '../../../core/rules/tech';
  import {
    ROMAN,
    UNLOCK_ICON,
    branchName,
    descOf,
    iconOf,
    nameOf,
    prereqs,
    type TechModel,
  } from './model.svelte';

  let { m }: { m: TechModel } = $props();

  const focus = $derived(m.focus);
  const fnode = $derived(NODES[focus]!);
  const fst = $derived(m.stateOf(focus));
  const fpath = $derived(m.path(focus));
  const fcost = $derived(m.pathCost(focus));
</script>

<div class="inspect b-{branchName(fnode)}" data-testid="tech-inspect">
  <div class="ihead">
    <span class="iico"><Icon name={iconOf(fnode)} size={18} /></span>
    <b class="iname"
      >{nameOf(focus)}{#if fnode.repeat && m.reps(fnode) > 0}
        · {t('tech.repeatLevel', { n: m.reps(fnode) })}{/if}</b
    >
    <small class="iwhere"
      >{t(`tech.${branchName(fnode)}.title`)} · {fnode.repeat
        ? t('tech.tierRepeat')
        : t('tech.tier', { n: ROMAN[fnode.tier - 1]! })}</small
    >
    {#each fnode.unlocks as u (u)}
      <span class="np-tag unl"><Icon name={UNLOCK_ICON[u]} size={12} />{t(`tech.unlock.${u}`)}</span>
    {/each}
    <span class="np-tag state {fst}">{t(`tech.state.${fst}`)}</span>
  </div>
  <p class="effect">
    {descOf(focus)}{#if fnode.repeat}<span class="hint"
        >&nbsp;— {fst === 'done' ? t('tech.repeatMax') : t('tech.repeatHint')}</span
      >{/if}
  </p>
  <span class="reqs">
    <span class="lbl">{t('tech.requires')}</span>
    {#each prereqs(fnode) as r (r)}
      {@const ok = isResearched(m.levels, r)}
      <span class="req" class:ok title={t(`tech.${branchName(NODES[r]!)}.title`)}
        ><Icon name={ok ? 'check' : 'lock'} size={11} />{nameOf(r)}</span
      >
    {:else}
      <span class="req ok">{t('tech.requiresNone')}</span>
    {/each}
  </span>
  <span class="acts">
    {#if fst === 'done'}
      <span class="hint end">{fnode.repeat ? t('tech.repeatMax') : t('tech.doneHint')}</span>
    {:else}
      <span class="sum mono"
        >{fpath.length > 1 ? t('tech.pathSteps', { n: fpath.length }) + ' · ' : ''}{t('tech.points', {
          n: num(fcost),
        })} · {m.eta(fcost - m.bank)}</span
      >
      {#if focus === m.target}
        <span class="np-tag state current">{t('tech.goal')}</span>
      {:else if m.inQueue(focus)}
        <button class="np-btn small quiet" onclick={() => m.unqueue(focus)} data-testid="tech-unqueue"
          >{t('tech.queueRemove')}</button
        >
      {:else}
        {#if m.target >= 0}<button
            class="np-btn small"
            onclick={() => m.enqueue(focus)}
            data-testid="tech-queue-add">{t('tech.queueAdd')}</button
          >{/if}
        <button class="np-btn small ink" onclick={() => m.research(focus)} data-testid="tech-research"
          >{fpath.length > 1 ? t('tech.researchPath', { n: fpath.length }) : t('tech.research')}</button
        >
      {/if}
    {/if}
  </span>
</div>

<style>
  /* A boxed item under the tree, of a fixed height (set by the window's width only): its
     lines are each on one line, cut with an ellipsis rather than wrapped. Three lines;
     two in a wide window (the orders beside the name), four in a narrow one. */
  .inspect {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 22px 20px 25px;
    grid-template-areas:
      'head head'
      'eff eff'
      'reqs acts';
    column-gap: 14px;
    row-gap: 3px;
    height: 88px;
    box-sizing: border-box;
    margin: 0 18px 12px;
    padding: 6px 12px 7px;
    border: 1px solid var(--np-ink);
    box-shadow: 3px 3px 0 var(--np-paper-2);
    background: var(--np-paper);
    overflow: hidden;
  }
  .ihead {
    grid-area: head;
  }
  .effect {
    grid-area: eff;
  }
  .reqs {
    grid-area: reqs;
  }
  .acts {
    grid-area: acts;
  }
  @container (min-width: 1000px) {
    .inspect {
      grid-template-rows: 25px 21px;
      grid-template-areas:
        'head acts'
        'eff reqs';
      row-gap: 2px;
      height: 64px;
    }
    .reqs,
    .acts {
      border-top: 0;
      padding-top: 0;
    }
    .reqs {
      justify-content: flex-end;
    }
  }
  .ihead {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .iico {
    display: inline-flex;
    align-self: center;
    color: var(--acc);
  }
  .iname {
    flex: none;
    font-family: var(--title);
    font-size: 1.1em;
    font-weight: 600;
    color: var(--np-ink);
  }
  .iwhere {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
    color: var(--np-ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .np-tag {
    flex: none;
    align-self: center;
  }
  .np-tag.state {
    margin-left: auto;
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
  .np-tag.unl {
    font-size: 0.72em;
    color: var(--acc);
    border-color: color-mix(in srgb, var(--acc) 45%, transparent);
  }
  .effect {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.9em;
    line-height: 20px;
    color: var(--np-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    font-size: 0.92em;
    color: var(--np-ink-2);
  }
  .hint.end {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
  }
  .reqs {
    display: flex;
    align-items: center;
    gap: 4px 10px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 0.8em;
    border-top: 1px solid var(--np-rule);
    padding-top: 4px;
  }
  .lbl {
    color: var(--np-ink-3);
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
  .acts {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    white-space: nowrap;
    border-top: 1px solid var(--np-rule);
    padding-top: 4px;
  }
  .sum {
    font-size: 0.8em;
    font-weight: 500;
    color: var(--np-warn);
  }
  /* Narrow: the orders on a line of their own. */
  @container (max-width: 640px) {
    .inspect {
      grid-template-rows: 22px 20px 21px 25px;
      grid-template-areas:
        'head head'
        'eff eff'
        'reqs reqs'
        'acts acts';
      height: 112px;
    }
    .acts {
      border-top: 0;
      padding-top: 0;
    }
  }
</style>
