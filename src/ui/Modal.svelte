<script lang="ts">
  // Confirmation dialog. Rendered outside the screens, so it picks its look itself: always a
  // slip of the Courier's newsprint, as the windows and the pause menu. Over the game it
  // sits under a magenta rule (every confirmation asked in a game is a grave order:
  // betrayal, a strike on our own land, surrender, leaving); in the menus, under an ink one.
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
    <div class="box newsprint np-sheet" class:menus={!paper} tabindex="-1" bind:this={box}>
      <h3 id="modal-title">{app.modal.title}</h3>
      <p>{app.modal.body}</p>
      <div class="actions">
        {#each app.modal.actions as a (a.label)}
          {#if paper}
            <button class="np-btn {a.kind ?? ''}" class:ink={a.kind === 'primary'} onclick={a.run}
              >{a.label}</button
            >
          {:else}
            <button
              class="np-btn {a.kind ?? ''}"
              class:ink={a.kind === 'primary'}
              class:spot={a.kind === 'danger'}
              class:quiet={a.kind === 'ghost'}
              onclick={a.run}>{a.label}</button
            >
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
  /* In the menus: the paper dimmed by a wash of its own ink. */
  .back.chart {
    background: rgba(23, 42, 60, 0.32);
    color: var(--np-ink);
  }
  .box {
    display: grid;
    outline: none;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
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
  /* In the menus: under an ink rule, laid on the paper with a lighter shadow. */
  .box.menus {
    border-top-color: var(--np-ink);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.4) inset,
      0 18px 44px -12px rgba(23, 42, 60, 0.45);
  }
  .menus .np-btn {
    padding: 7px 14px;
    font-size: 0.9em;
  }
</style>
