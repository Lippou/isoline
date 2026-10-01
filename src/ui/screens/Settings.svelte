<script lang="ts">
  import { go, app } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import SettingsBody from './SettingsBody.svelte';
</script>

<div class="page">
  <header>
    <button class="btn ghost" onclick={() => go(app.previous === 'settings' ? 'title' : 'title')}
      >← {t('common.back')}</button
    >
    <h1>{t('title.settings')}</h1>
  </header>
  <div class="glass body scroll"><SettingsBody /></div>
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    background: radial-gradient(ellipse at 70% 0%, #172947, var(--abyss) 60%);
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .body {
    padding: 1.2rem 1.4rem;
    min-height: 0;
  }
</style>
