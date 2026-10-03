<script lang="ts">
  // Confirmation dialog. Rendered outside the screens, so it picks its look itself: chart
  // paper in the menus (theme tokens only), and over the game the Courier's newsprint, as
  // the windows and the pause menu: a slip under a magenta rule (every confirmation asked
  // in a game is a grave order: betrayal, a strike on our own land, surrender, leaving).
  import './hud/paper.css';
  import { app } from './stores/app.svelte';

  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (app.modal && box) box.focus();
  });
  const paper = $derived(app.screen === 'game');
</script>

{#if app.modal}
  <div
    class="back fade-in"
    class:chart={!paper}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
  >
    <div
      class="box"
      class:glass={!paper}
      class:newsprint={paper}
      class:np-sheet={paper}
      tabindex="-1"
      bind:this={box}
    >
      <h3 id="modal-title">{app.modal.title}</h3>
      <p>{app.modal.body}</p>
      <div class="actions">
        {#each app.modal.actions as a (a.label)}
          {#if paper}
            <button class="np-btn {a.kind ?? ''}" class:ink={a.kind === 'primary'} onclick={a.run}
              >{a.label}</button
            >
          {:else}
            <button class="btn {a.kind ?? ''}" onclick={a.run}>{a.label}</button>
          {/if}
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
  }
  .box.glass {
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

  /* Over the game: a slip of the Courier's paper. */
  .box.newsprint {
    width: min(440px, calc(100vw - 32px));
    padding: 14px 20px 14px;
    gap: 0;
    border-top: 4px solid var(--np-spot);
  }
  .newsprint h3 {
    padding-bottom: 7px;
    border-bottom: 2px solid var(--np-ink);
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.6em;
    line-height: 1.08;
    letter-spacing: -0.012em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  .newsprint p {
    margin: 9px 0 0;
    font-family: var(--np-serif);
    font-size: 0.92em;
    line-height: 1.5;
    color: var(--np-ink-2);
    text-wrap: pretty;
  }
  .newsprint .actions {
    gap: 8px;
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--np-rule);
  }
</style>
