<script lang="ts">
  // The tree as a ladder, for a narrow window: a branch at a time (its tabs over it), its
  // technologies one under another from tier I to the endless one, each with its effect
  // and what it needs written out. The tabs show every branch's progress and where the
  // plan goes, so the other branches are one click away.
  import { t, num } from '../../i18n/i18n.svelte';
  import { hud } from '../../stores/game.svelte';
  import Icon from '../../icons/Icon.svelte';
  import { BRANCHES, BRANCH_ROWS, LEVELS, MAX_REPEAT, NODES, techKey } from '../../../core/rules/tech';
  import {
    BRANCH_ICON,
    ROMAN,
    UNLOCK_ICON,
    branchName,
    descOf,
    iconOf,
    nameOf,
    tierName,
    type TechModel,
  } from './model.svelte';

  let { m }: { m: TechModel } = $props();

  /** The branch shown: the one chosen, else the one of the technology the panel was opened on, of the goal, or the first. */
  let chosen = $state(-1);
  // svelte-ignore state_referenced_locally
  const start = hud.techFocus >= 0 ? hud.techFocus : m.target >= 0 ? m.current : -1;
  const branch = $derived(chosen >= 0 ? chosen : start >= 0 ? NODES[start]!.branch : BRANCH_ROWS[0]!);
  const nodes = $derived(NODES.filter((n) => n.branch === branch).sort((a, z) => a.level - z.level));
  const planned = (b: number): number => m.planIds.filter((id) => NODES[id]!.branch === b).length;

  /** Another branch: the card pointed at goes away with the old one. */
  function choose(b: number): void {
    chosen = b;
    m.hovered = -1;
  }
  function enter(id: number): void {
    m.hovered = id;
  }
  function leave(id: number): void {
    if (m.hovered === id) m.hovered = -1;
  }
</script>

<div class="ladder">
  <div class="side">
    <div class="tabs" role="tablist">
      {#each BRANCH_ROWS as b (b)}
        {@const br = BRANCHES[b]!}
        <button
          class="tab b-{br}"
          class:on={b === branch}
          role="tab"
          aria-selected={b === branch}
          onclick={() => choose(b)}
          data-testid="tech-tab-{br}"
        >
          <Icon name={BRANCH_ICON[br]!} size={14} />
          <span class="tname">{t(`tech.${br}.title`)}</span>
          <span class="tlv mono">{Math.min(LEVELS, m.levels[b] ?? 0)}/{LEVELS}</span>
          {#if planned(b)}<span class="tplan mono" title={t('tech.queued')}>{planned(b)}</span>{/if}
        </button>
      {/each}
    </div>
    <ol class="rungs scroll" data-testid="tech-tree">
      {#each nodes as n (n.id)}
        {@const st = m.stateOf(n.id)}
        {@const order = m.order(n.id)}
        <li class="rung">
          <span class="tier" class:inf={n.repeat}>{n.repeat ? '∞' : ROMAN[n.tier - 1]}</span>
          <button
            class="tk entry {st} b-{branchName(n)}"
            class:focus={n.id === m.focus}
            class:need={m.preview && order >= 0}
            onclick={(e) => m.research(n.id, e)}
            onmouseenter={() => enter(n.id)}
            onmouseleave={() => leave(n.id)}
            onfocus={() => enter(n.id)}
            onblur={() => leave(n.id)}
            aria-label="{nameOf(n.id)} — {t(`tech.state.${st}`)}"
            data-testid="tech-{techKey(n.id).slice(5)}"
          >
            <span class="tk-ico"><Icon name={iconOf(n)} size={17} /></span>
            <span class="e-name">{nameOf(n.id)}</span>
            <span class="tk-state">
              {#if n.repeat && m.reps(n) > 0}<span class="mono reps">×{m.reps(n)}/{MAX_REPEAT}</span>{/if}
              {#if st === 'done'}<Icon name="check" size={13} />{t('tech.state.done')}
              {:else}
                {#if st === 'locked'}<Icon name="lock" size={11} />{/if}
                <span class="tk-cost">{t('tech.points', { n: num(m.cost(n.id)) })}</span>
              {/if}
            </span>
            <span class="e-eff">{descOf(n.id)}</span>
            {#if n.requires.length || n.unlocks.length}
              <span class="e-more">
                {#each n.requires as q (q)}
                  {@const qn = NODES[q]!}
                  <span class="tk-req b-{branchName(qn)}" class:ok={m.researched(q)}
                    ><Icon
                      name={m.researched(q) ? 'check' : BRANCH_ICON[branchName(qn)]!}
                      size={11}
                    />{tierName(qn)}</span
                  >
                {/each}
                {#each n.unlocks as u (u)}
                  <span class="unl"><Icon name={UNLOCK_ICON[u]} size={11} />{t(`tech.unlock.${u}`)}</span>
                {/each}
              </span>
            {/if}
            {#if order >= 0 && st !== 'done'}<span class="tk-ord" class:pre={m.preview}>{order + 1}</span
              >{/if}
            {#if st === 'current'}<span class="tk-prog" style="width:{m.progress(n.id) * 100}%"></span>{/if}
          </button>
        </li>
      {/each}
    </ol>
  </div>
</div>

<style>
  .ladder {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    padding: 0 18px;
  }
  .side {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0 14px;
    padding-top: 8px;
    border-bottom: 1px solid var(--np-rule);
  }
  .tab {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 0 6px;
    margin-bottom: -1px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    font-family: var(--text);
    font-size: 0.82em;
    font-weight: 500;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .tab :global(svg) {
    color: var(--acc);
  }
  .tab:hover {
    color: var(--np-ink);
  }
  .tab.on {
    color: var(--np-ink);
    border-bottom-color: var(--acc);
  }
  .tlv {
    font-size: 0.86em;
    color: var(--np-ink-3);
  }
  .tplan {
    display: inline-grid;
    place-items: center;
    min-width: 15px;
    height: 15px;
    border-radius: 8px;
    font-size: 0.78em;
    font-weight: 600;
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .rungs {
    list-style: none;
    margin: 0;
    padding: 12px 4px 12px 0;
    min-height: 0;
    display: grid;
    align-content: start;
    gap: 10px;
    scrollbar-color: var(--np-rule) transparent;
  }
  .rung {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    align-items: stretch;
    position: relative;
  }
  /* The branch's thread: a rule down the tier figures. */
  .rung + .rung::before {
    content: '';
    position: absolute;
    left: 12px;
    top: -10px;
    height: 10px;
    border-left: 1px solid var(--np-rule-2);
  }
  .tier {
    display: grid;
    place-items: center;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.8em;
    color: var(--np-ink-3);
  }
  .tier.inf {
    font-weight: 400;
    font-size: 1.2em;
  }
  .entry {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    column-gap: 9px;
    row-gap: 3px;
    padding: 8px 12px 9px;
  }
  .entry .tk-ico {
    align-self: center;
  }
  .e-name {
    font-family: var(--title);
    font-weight: 600;
    font-size: 1em;
    line-height: 1.2;
  }
  .tk-state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.78em;
    color: var(--np-ink-3);
    white-space: nowrap;
  }
  .reps {
    font-weight: 600;
    color: var(--np-ink);
  }
  .e-eff,
  .e-more {
    grid-column: 2 / -1;
  }
  .e-eff {
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.35;
    color: var(--np-ink-2);
  }
  .tk.current .e-eff,
  .tk.current .reps {
    color: rgba(241, 236, 226, 0.85);
  }
  .e-more {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    font-size: 0.74em;
  }
  .unl {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--acc);
    font-weight: 500;
  }
  .tk.current .unl {
    color: inherit;
  }
</style>
