<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import Logo from '../Logo.svelte';
  import credits from '../../../CREDITS.md?raw';
  import PageHeader from '../PageHeader.svelte';

  const lines = credits
    .split('\n')
    .filter(
      (l) => l.startsWith('|') && !l.includes('---') && !l.includes('Asset') && !l.includes('Bibliothèque'),
    );
</script>

<div class="page" data-testid="about">
  <PageHeader title={t('title.about')} />
  <div class="body panel">
    <Logo size={110} />
    <p class="slogan">{t('brand.slogan')}</p>
    <p class="mono ver">v{app.version} · {app.platform}</p>
    <p>{t('about.text')}</p>
    <h3>{t('about.credits')}</h3>
    <ul>
      {#each lines as l, k (k)}
        {@const cells = l
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean)}
        <li><b>{cells[0]}</b> — {cells.slice(1, 3).join(' · ')}</li>
      {/each}
      <li><b>Natural Earth</b> — {t('about.naturalEarth')}</li>
    </ul>
    <p class="muted">{t('about.license')}</p>
  </div>
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    display: grid;
    grid-template-rows: auto 1fr;
    justify-items: center;
    background: radial-gradient(ellipse at 50% 30%, #172947, var(--abyss) 60%);
    overflow-y: auto;
  }
  header {
    justify-self: start;
  }
  .body {
    width: min(760px, 92vw);
    padding: 1.6rem;
    display: grid;
    justify-items: center;
    gap: 0.6rem;
    text-align: center;
    align-self: start;
  }
  .slogan {
    font-family: var(--title);
    font-style: italic;
    color: var(--aurora);
  }
  .ver {
    color: var(--faint);
  }
  ul {
    list-style: none;
    padding: 0;
    text-align: left;
    font-size: 0.88em;
    display: grid;
    gap: 0.25rem;
  }
  .muted {
    color: var(--faint);
    font-size: 0.85em;
  }
</style>
