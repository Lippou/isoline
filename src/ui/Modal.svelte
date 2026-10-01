<script lang="ts">
  import { app } from './stores/app.svelte';
</script>

{#if app.modal}
  <div class="back fade-in" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="box glass rise-in">
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
    background: rgba(3, 6, 12, 0.6);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .box {
    width: min(460px, 90vw);
    padding: 1.3rem 1.4rem;
    display: grid;
    gap: 0.6rem;
  }
  p {
    margin: 0;
    color: var(--muted);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
</style>
