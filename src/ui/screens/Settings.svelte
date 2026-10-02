<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import SettingsBody from './SettingsBody.svelte';
  import PageHeader from '../PageHeader.svelte';
</script>

<div class="page">
  <PageHeader title={t('title.settings')} subtitle={t('settings.subtitle')} />
  <div class="panel body scroll"><SettingsBody /></div>
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    padding: 18px 22px;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    background: var(--abyss);
  }
  .body {
    padding: 0;
    min-height: 0;
    max-width: 1100px;
    width: 100%;
    justify-self: center;
  }
</style>
