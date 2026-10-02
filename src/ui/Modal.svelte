<script lang="ts">
  // Confirmation dialog. Rendered outside the screens, so it picks its theme itself:
  // chart paper in the menus, ink over the game. Colours come from the theme tokens only.
  import { app } from './stores/app.svelte';

  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (app.modal && box) box.focus();
  });
</script>

{#if app.modal}
  <div
    class="back fade-in"
    class:chart={app.screen !== 'game'}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
  >
    <div class="box glass" tabindex="-1" bind:this={box}>
      <h3 id="modal-title">{app.modal.title}</h3>
      <p>{app.modal.body}</p>
      <div class="actions">
        {#each app.modal.actions as a (a.label)}
          <button class="btn {a.kind ?? ''}" onclick={a.run}>{a.label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .back {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--tip-bg) 52%, transparent);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .back.chart {
    background: color-mix(in srgb, var(--tip-bg) 30%, transparent);
    color: var(--parchment);
  }
  .box {
    width: min(460px, 90vw);
    padding: 1.4rem 1.5rem 1.2rem;
    display: grid;
    gap: 0.6rem;
    outline: none;
    animation: modal-in 0.22s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  h3 {
    font-size: 1.3em;
  }
  p {
    margin: 0;
    color: var(--muted);
    line-height: 1.55;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  @keyframes modal-in {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
</style>
