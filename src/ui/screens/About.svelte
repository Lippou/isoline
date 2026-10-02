<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import Logo from '../Logo.svelte';
  import credits from '../../../CREDITS.md?raw';
  import PageHeader from '../PageHeader.svelte';

  // CREDITS.md → sections of table rows (each table's header and separator are skipped).
  const sections: { title: string; rows: string[][] }[] = [];
  let header = false;
  for (const line of credits.split('\n')) {
    if (line.startsWith('## ')) {
      sections.push({ title: line.slice(3).trim(), rows: [] });
      header = true;
    } else if (line.startsWith('|') && !line.includes('---') && sections.length) {
      if (header) {
        header = false;
        continue;
      }
      sections[sections.length - 1]!.rows.push(
        line
          .split('|')
          .map((c) => c.trim())
          .filter(Boolean),
      );
    }
  }
  const shown = sections.filter((x) => x.rows.length);
</script>

<div class="page" data-testid="about">
  <PageHeader title={t('title.about')} />
  <div class="body panel">
    <Logo size={110} />
    <p class="slogan">{t('brand.slogan')}</p>
    <p class="mono ver">v{app.version} · {app.platform}</p>
    <p>{t('about.text')}</p>
    <h3>{t('about.credits')}</h3>
    {#each shown as sec (sec.title)}
      <h4>{sec.title}</h4>
      <ul>
        {#each sec.rows as cells, k (k)}
          <li><b>{cells[0]}</b> — {cells.slice(1, 3).join(' · ')}</li>
        {/each}
      </ul>
    {/each}
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
    background: var(--abyss);
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
    color: var(--muted);
  }
  h4 {
    justify-self: start;
    margin: 12px 0 2px;
    font-family: var(--title);
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
