<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  let { ctl }: { ctl: GameController } = $props();
  const names = ['nukeA', 'nukeH', 'nukeMirv', 'nukeMirv'];
</script>

{#if hud.nukeAlerts.length}
  <div class="alerts" role="alert">
    {#each hud.nukeAlerts as a (a.id)}
      <button
        class="alert"
        onclick={() => ctl.renderer.camera.goTo(a.tx, a.ty, Math.max(ctl.renderer.camera.zoom, 2))}
      >
        <span class="icon"><Icon name="nuke" size={18} /></span>
        <span>{t(`nuke.${names[a.kind]}.name`)} — {ctl.session.state.name(a.by, i18n.lang)}</span>
        <b class="mono">{Math.max(0, (a.impact - hud.tick) / 10).toFixed(1)} s</b>
      </button>
    {/each}
  </div>
{/if}

<style>
  .alerts {
    position: absolute;
    top: 110px;
    left: 14px;
    display: grid;
    gap: 6px;
    z-index: 28;
  }
  .alert {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--signal);
    background: rgba(70, 10, 16, 0.85);
    color: var(--parchment);
    cursor: pointer;
    animation: pulse 0.8s ease-in-out infinite alternate;
  }
  .icon {
    font-size: 1.3em;
    color: var(--signal);
  }
  b {
    color: var(--signal);
    font-size: 1.1em;
  }
  @keyframes pulse {
    to {
      box-shadow: 0 0 22px rgba(255, 90, 95, 0.55);
    }
  }
</style>
