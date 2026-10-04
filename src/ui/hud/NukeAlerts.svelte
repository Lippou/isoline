<script lang="ts">
  // Nukes heading for our land: a dispatch each at the head of the left column, printed
  // in the chart's magenta (the danger colour), with the time to impact. A click shows
  // where it falls.
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { zonePiece } from '../stores/layout.svelte';
  let { ctl }: { ctl: GameController } = $props();
  const names = ['nukeA', 'nukeH', 'nukeMirv', 'nukeMirv'];
</script>

{#if hud.nukeAlerts.length}
  <div class="alerts" role="alert" use:zonePiece={{ id: 'nukeAlerts' }}>
    {#each hud.nukeAlerts as a (a.id)}
      <button
        class="alert newsprint"
        onclick={() => ctl.renderer.camera.goTo(a.tx, a.ty, Math.max(ctl.renderer.camera.zoom, 2))}
      >
        <span class="icon"><Icon name="nuke" size={17} /></span>
        <span class="copy">
          <small>{t('nuke.incoming')}</small>
          <span class="what"
            >{t(`nuke.${names[a.kind]}.name`)} — {ctl.session.state.name(a.by, i18n.lang)}</span
          >
        </span>
        <b class="mono">{Math.max(0, (a.impact - hud.tick) / 10).toFixed(1)} s</b>
      </button>
    {/each}
  </div>
{/if}

<style>
  .alerts {
    display: grid;
    gap: 6px;
  }
  .alert {
    appearance: none;
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 7px 12px 7px 10px;
    border: 1px solid var(--np-spot);
    border-left: 4px solid var(--np-spot);
    border-radius: 1px;
    box-shadow: var(--np-lift);
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
    animation: pulse 0.9s ease-in-out infinite alternate;
  }
  .alert:hover,
  .alert:focus-visible {
    background: var(--np-card);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1.5px solid var(--np-spot);
    color: var(--np-spot);
  }
  .copy {
    display: grid;
    min-width: 0;
  }
  small {
    font-family: var(--text);
    font-size: 0.74em;
    font-weight: 600;
    color: var(--np-spot);
  }
  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.98em;
    color: var(--np-ink);
  }
  b {
    font-size: 1.15em;
    font-weight: 700;
    color: var(--np-spot);
  }
  @keyframes pulse {
    to {
      box-shadow:
        0 1px 2px rgba(3, 10, 16, 0.22),
        0 0 0 3px color-mix(in srgb, var(--np-spot) 30%, transparent),
        0 6px 18px rgba(3, 10, 16, 0.3);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .alert {
      animation: none;
    }
  }
  :global(.reduced-motion) .alert {
    animation: none;
  }
</style>
