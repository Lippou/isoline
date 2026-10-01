<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import type { GameController } from '../game/controller';
  let { ctl }: { ctl: GameController } = $props();

  function go(tile?: number): void {
    if (tile === undefined) return;
    const w = ctl.session.state.width;
    ctl.renderer.camera.goTo((tile % w) + 0.5, ((tile / w) | 0) + 0.5, Math.max(ctl.renderer.camera.zoom, 3));
  }
</script>

<div class="toasts" aria-live="polite">
  {#each hud.toasts as tst (tst.id)}
    <button
      class="toast glass rise-in {tst.level}"
      onclick={() => go(tst.tile)}
      class:link={tst.tile !== undefined}>{tst.text}</button
    >
  {/each}
  {#each hud.subtitles as s (s.id)}
    <div class="subtitle fade-in">[{s.text}]</div>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    top: 86px;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    gap: 6px;
    justify-items: center;
    z-index: 30;
    pointer-events: none;
    width: min(560px, 60vw);
  }
  .toast {
    pointer-events: auto;
    padding: 0.5rem 0.9rem;
    font-size: 0.9em;
    border-left: 3px solid var(--aurora);
    cursor: default;
    text-align: center;
  }
  .toast.link {
    cursor: pointer;
  }
  .toast.good {
    border-left-color: var(--verdant);
  }
  .toast.warn {
    border-left-color: var(--brass);
  }
  .toast.danger {
    border-left-color: var(--signal);
    background: rgba(60, 14, 20, 0.82);
  }
  .subtitle {
    background: rgba(0, 0, 0, 0.75);
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    font-size: 0.85em;
  }
</style>
