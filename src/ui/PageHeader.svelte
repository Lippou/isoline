<script lang="ts">
  import type { Snippet } from 'svelte';
  import { go, type Screen } from './stores/app.svelte';
  import { t } from './i18n/i18n.svelte';
  import Icon from './icons/Icon.svelte';

  let {
    title,
    subtitle = '',
    back = 'title',
    actions,
  }: { title: string; subtitle?: string; back?: Screen; actions?: Snippet } = $props();
</script>

<header class="ph">
  <button class="btn ghost" onclick={() => go(back)}><Icon name="back" size={16} />{t('common.back')}</button>
  <div class="tt">
    <h1>{title}</h1>
    {#if subtitle}<span class="hint">{subtitle}</span>{/if}
  </div>
  {#if actions}<div class="acts">{@render actions()}</div>{/if}
</header>

<style>
  .ph {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 14px;
  }
  .tt {
    flex: 1;
    display: grid;
  }
  .acts {
    display: flex;
    gap: 8px;
  }
</style>
