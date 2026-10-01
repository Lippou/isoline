<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { BRANCHES, TECH_COST } from '../../core/rules/tech';

  let { ctl }: { ctl: GameController } = $props();
  const L = $derived(hud.local);
  const icons = ['🪙', '⚔', '⚓', '☢', '🛡'];
</script>

{#if L}
  <p class="rate">{t('tech.rate', { rp: L.researchRate.toFixed(1) })}</p>
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
          <span class="ico">{icons[b]}</span>
          <span>{t(`tech.${br}.title`)}</span>
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
  .rate {
    margin: 0 0 0.5rem;
    color: var(--muted);
  }
  .progress {
    display: grid;
    gap: 0.25rem;
    margin-bottom: 0.6rem;
  }
  .bar {
    height: 6px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    overflow: hidden;
  }
  .bar div {
    height: 100%;
    background: var(--aurora);
    transition: width 0.3s;
  }
  .tree {
    display: grid;
    gap: 0.6rem;
  }
  .branch {
    display: grid;
    grid-template-columns: 92px repeat(4, 1fr);
    gap: 4px;
    align-items: stretch;
  }
  .branch.active .head {
    border-color: var(--aurora);
    color: var(--aurora);
  }
  .head {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.03);
    cursor: pointer;
    font-size: 0.8em;
  }
  .head:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ico {
    font-size: 1.3em;
  }
  .node {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.3rem;
    display: grid;
    gap: 2px;
    font-size: 0.72em;
    opacity: 0.55;
  }
  .node b {
    font-size: 1.05em;
  }
  .node small {
    color: var(--muted);
  }
  .node.done {
    opacity: 1;
    border-color: rgba(123, 216, 143, 0.6);
    background: rgba(123, 216, 143, 0.08);
  }
  .node.next {
    opacity: 0.9;
    border-color: var(--line-strong);
  }
  .cost {
    color: var(--brass);
  }
</style>
