<script lang="ts">
  // "How it works", at the foot of a window (Front, Trade, Diplomacy). On a phone (html.phone)
  // it starts closed, one line to open it: the window shows what can be done first.
  import type { Snippet } from 'svelte';
  import { phone } from '../tactile';
  import Icon from '../icons/Icon.svelte';

  let { title, children }: { title: string; children: Snippet } = $props();
</script>

{#if phone}
  <details class="np-box np-rules phone-rules" data-testid="rules">
    <summary><Icon name="help" size={15} /><span>{title}</span></summary>
    {@render children()}
  </details>
{:else}
  <aside class="np-box np-rules">
    <h3>{title}</h3>
    {@render children()}
  </aside>
{/if}

<style>
  .phone-rules {
    padding: 0;
  }
  summary {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 40px;
    padding: 0 12px;
    font-family: var(--title);
    font-weight: 600;
    color: var(--np-ink-2);
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .phone-rules[open] summary {
    color: var(--np-ink);
  }
  .phone-rules > :global(p) {
    padding: 0 12px 10px;
  }
</style>
