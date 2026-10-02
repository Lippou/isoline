<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { BRANCHES, TECH_COST } from '../../core/rules/tech';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  const icons: IconName[] = ['gold', 'war', 'warship', 'nuke', 'immune'];
</script>

{#if L}
  <p class="hint intro">{t('tech.intro')}</p>
  <p class="rate"><Icon name="tech" size={14} /> {t('tech.rate', { rp: L.researchRate.toFixed(1) })}</p>
  {#if L.researching >= 0}
    <div class="progress">
      <span>{t(`tech.${BRANCHES[L.researching]}.${(L.tech[L.researching] ?? 0) + 1}.name`)}</span>
      <div class="bar">
        <div style="width:{Math.min(100, (L.researchPoints / Math.max(1, L.researchCost)) * 100)}%"></div>
      </div>
    </div>
  {/if}
  <div class="tree">
    {#each BRANCHES as br, b (br)}
      {@const lvl = L.tech[b] ?? 0}
      <div class="branch" class:active={L.researching === b}>
        <button
          class="head"
          disabled={lvl >= 4}
          onclick={() => ctl.session.cmd({ t: 'research', tech: b })}
          data-testid="tech-{br}"
        >
          <Icon name={icons[b]!} size={17} />
          <span>{t(`tech.${br}.title`)}</span>
          <span class="lv mono">{lvl}/4</span>
        </button>
        {#each [1, 2, 3, 4] as level (level)}
          <div
            class="node"
            class:done={lvl >= level}
            class:next={lvl + 1 === level}
            title={t(`tech.${br}.${level}.desc`)}
          >
            <b>{t(`tech.${br}.${level}.name`)}</b>
            <small>{t(`tech.${br}.${level}.desc`)}</small>
            <span class="cost mono">{TECH_COST[level - 1]} RP</span>
          </div>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .intro {
    margin: 0 0 8px;
  }
  .rate {
    margin: 0 0 8px;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .progress {
    display: grid;
    gap: 4px;
    margin-bottom: 10px;
  }
  .bar {
    height: 6px;
    background: var(--panel-3);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--aurora);
    transition: width 0.3s;
  }
  .tree {
    display: grid;
    gap: 6px;
  }
  .branch {
    display: grid;
    grid-template-columns: 104px repeat(4, 1fr);
    gap: 4px;
    align-items: stretch;
  }
  .branch.active .head {
    border-color: var(--aurora);
    background: rgba(127, 169, 214, 0.14);
  }
  .head {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 3px;
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    background: var(--panel-2);
    cursor: pointer;
    font-size: 0.82em;
    color: var(--parchment);
    padding: 6px 4px;
  }
  .head:hover:not(:disabled) {
    background: var(--panel-3);
  }
  .head:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .lv {
    font-size: 0.85em;
    color: var(--faint);
  }
  .node {
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 5px 6px;
    display: grid;
    align-content: start;
    gap: 2px;
    font-size: 0.74em;
    opacity: 0.55;
    background: var(--panel-2);
  }
  .node b {
    font-size: 1.05em;
  }
  .node small {
    color: var(--muted);
    line-height: 1.3;
  }
  .node.done {
    opacity: 1;
    border-color: rgba(111, 174, 116, 0.65);
    background: rgba(111, 174, 116, 0.1);
  }
  .node.next {
    opacity: 1;
    border-color: var(--line-strong);
  }
  .cost {
    color: var(--brass);
  }
</style>
