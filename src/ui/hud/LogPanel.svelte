<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { clock, t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  let { ctl }: { ctl: GameController } = $props();
  let filter = $state<'all' | 'danger' | 'good' | 'warn'>('all');
  const start = $derived(hud.world?.startTick ?? 0);
  function go(tile?: number): void {
    if (tile === undefined) return;
    const w = ctl.session.state.width;
    ctl.renderer.camera.goTo((tile % w) + 0.5, ((tile / w) | 0) + 0.5, Math.max(3, ctl.renderer.camera.zoom));
  }
</script>

<div class="filters">
  {#each ['all', 'danger', 'warn', 'good'] as f (f)}
    <button class="chip" class:on={filter === f} onclick={() => (filter = f as typeof filter)}
      >{t(`log.${f}`)}</button
    >
  {/each}
</div>
<ul>
  {#each hud.log
    .filter((l) => filter === 'all' || l.level === filter)
    .slice()
    .reverse() as l, k (k)}
    <li class={l.level}>
      <button onclick={() => go(l.tile)} class:link={l.tile !== undefined}>
        <span class="mono time">{clock(Math.max(0, l.tick - start))}</span>
        <span>{l.text}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .filters {
    display: flex;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
  }
  .chip {
    background: none;
    cursor: pointer;
  }
  .chip.on {
    color: var(--aurora);
    border-color: var(--aurora);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 2px;
  }
  li button {
    display: grid;
    grid-template-columns: 3.4em 1fr;
    gap: 0.4rem;
    width: 100%;
    background: none;
    border: 0;
    text-align: left;
    padding: 0.2rem 0.3rem;
    border-left: 2px solid var(--line);
    cursor: default;
  }
  li button.link {
    cursor: pointer;
  }
  li button.link:hover {
    background: rgba(79, 227, 193, 0.06);
  }
  li.danger button {
    border-left-color: var(--signal);
  }
  li.warn button {
    border-left-color: var(--brass);
  }
  li.good button {
    border-left-color: var(--verdant);
  }
  .time {
    color: var(--faint);
  }
</style>
