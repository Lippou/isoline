<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import SettingsBody from './SettingsBody.svelte';
  import PageHeader from '../PageHeader.svelte';
</script>

<div class="page-shell">
  <PageHeader title={t('title.settings')} subtitle={t('settings.subtitle')} />
  <div class="page-body body scroll"><SettingsBody /></div>
</div>

<style>
  .body {
    background: var(--panel-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow-y: auto;
  }
</style>
