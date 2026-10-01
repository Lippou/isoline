<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
</script>

{#if hud.objectives.length}
  <aside class="obj glass" data-testid="objectives">
    <h4>{t('campaign.objectives')}</h4>
    <ul>
      {#each hud.objectives as o, k (k)}
        <li class:done={o.done}>{o.done ? '✔' : '○'} {o.text}</li>
      {/each}
    </ul>
  </aside>
{/if}
{#if hud.dialogue}
  <div class="dlg glass rise-in" data-testid="dialogue">
    <div class="avatar">
      <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"
        ><circle cx="16" cy="16" r="14" fill="none" stroke="#4fe3c1" stroke-width="2" /><circle
          cx="16"
          cy="16"
          r="8"
          fill="none"
          stroke="#4fe3c1"
          stroke-width="2"
        /><path d="M16 11 19 16 16 21 13 16Z" fill="#f2b84b" /></svg
      >
    </div>
    <div>
      <b>{hud.dialogue.speaker}</b>
      <p>{hud.dialogue.text}</p>
    </div>
    <button class="x" onclick={() => (hud.dialogue = null)}>✕</button>
  </div>
{/if}

<style>
  .obj {
    position: absolute;
    left: 62px;
    top: 90px;
    width: 300px;
    padding: 0.6rem 0.8rem;
    z-index: 7;
    font-size: 0.86em;
  }
  .obj h4 {
    margin: 0 0 0.3rem;
    font-family: var(--title);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.2rem;
  }
  li.done {
    color: var(--verdant);
  }
  .dlg {
    position: absolute;
    left: 50%;
    bottom: 120px;
    transform: translateX(-50%);
    width: min(640px, 70vw);
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    z-index: 29;
    align-items: start;
  }
  .dlg p {
    margin: 0.2rem 0 0;
    line-height: 1.45;
  }
  .dlg b {
    color: var(--aurora);
    font-family: var(--title);
  }
  .x {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
  }
</style>
