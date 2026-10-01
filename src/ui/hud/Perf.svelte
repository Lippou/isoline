<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import type { GameController } from '../game/controller';
  let { ctl }: { ctl: GameController } = $props();
  const mem = $derived(
    (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
  );
</script>

<div class="perf mono" data-testid="perf">
  <div>FPS <b>{hud.fps}</b></div>
  <div>tick <b>{hud.tickMs.toFixed(2)} ms</b></div>
  <div>#{hud.tick}</div>
  <div>units {ctl.session.state.unitCount}</div>
  <div>zoom {ctl.renderer.camera.zoom.toFixed(2)}</div>
  {#if mem}<div>heap {(mem / 1048576).toFixed(0)} MB</div>{/if}
  <div>hash {ctl.session.state.lastHash.toString(16)}</div>
</div>

<style>
  .perf {
    position: absolute;
    left: 50%;
    top: 74px;
    transform: translateX(-50%);
    display: flex;
    gap: 0.8rem;
    font-size: 0.75em;
    background: rgba(0, 0, 0, 0.6);
    padding: 0.2rem 0.6rem;
    border-radius: 6px;
    z-index: 50;
    color: var(--muted);
  }
  b {
    color: var(--aurora);
  }
</style>
