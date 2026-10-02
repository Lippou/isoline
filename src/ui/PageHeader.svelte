<script lang="ts">
  import type { Snippet } from 'svelte';
  import { go, type Screen } from './stores/app.svelte';
  import { t } from './i18n/i18n.svelte';
  import Icon from './icons/Icon.svelte';

  let {
    title,
    subtitle = '',
    back = 'title',
    onback,
    actions,
  }: { title: string; subtitle?: string; back?: Screen; onback?: () => void; actions?: Snippet } = $props();
</script>

<header class="ph">
  <button class="btn ghost back" onclick={() => (onback ? onback() : go(back))}
    ><Icon name="back" size={16} />{t('common.back')}</button
  >
  <div class="tt">
    <h1>{title}</h1>
    {#if subtitle}<p class="sub">{subtitle}</p>{/if}
  </div>
  {#if actions}<div class="acts">{@render actions()}</div>{/if}
</header>

<style>
  .ph {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 6px 22px;
    width: min(100%, 1200px);
    justify-self: center;
  }
  .back {
    margin-top: 6px;
    padding-left: 0.6em;
  }
  .tt {
    display: grid;
    gap: 4px;
  }
  h1 {
    font-size: 2.15em;
    line-height: 1.1;
    letter-spacing: -0.005em;
  }
  .sub {
    margin: 0;
    color: var(--muted);
    max-width: 72ch;
    line-height: 1.5;
  }
  .acts {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
</style>
