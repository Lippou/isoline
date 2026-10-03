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
          .map((c) =>
            c
              .trim()
              .replace(/`/g, '')
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'),
          )
          .filter(Boolean),
      );
    }
  }
  const shown = sections.filter((x) => x.rows.length);
  const platform = $derived(
    ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[app.platform] ??
      app.platform,
  );
</script>

<div class="page-shell" data-testid="about">
  <PageHeader title={t('title.about')} />
  <div class="page-body cols">
    <section class="brand">
      <Logo tone="light" size={96} row />
      <p class="slogan">{t('brand.slogan')}</p>
      <p class="text">{t('about.text')}</p>
      <dl>
        <dt>{t('about.version')}</dt>
        <dd class="mono">{app.version}</dd>
        {#if platform}
          <dt>{t('about.platform')}</dt>
          <dd>{platform}</dd>
        {/if}
        <dt>{t('about.licenses')}</dt>
        <dd>{t('about.license')}</dd>
      </dl>
    </section>
    <section class="credits scroll">
      <h2>{t('about.credits')}</h2>
      {#each shown as sec (sec.title)}
        <h3>{sec.title}</h3>
        <ul>
          {#each sec.rows as cells, k (k)}
            <li>
              <b>{cells[0]}</b>
              {#if cells[1]}<span>{cells[1]}</span>{/if}
              {#if cells[2]}<small>{cells[2]}</small>{/if}
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  </div>
</div>

<style>
  /* Two columns of the page, a fine rule between: the colophon, then the credits. */
  .cols {
    display: grid;
    grid-template-columns: minmax(320px, 0.85fr) minmax(0, 1.4fr);
  }
  .brand {
    align-self: start;
    display: grid;
    justify-items: start;
    gap: 14px;
    padding: 10px 30px 10px 0;
  }
  .slogan {
    margin: 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.25em;
    color: var(--np-ink-2);
  }
  .text {
    margin: 4px 0 0;
    font-family: var(--np-serif);
    line-height: 1.6;
    text-wrap: pretty;
  }
  dl {
    margin: 6px 0 0;
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 7px 18px;
    padding-top: 12px;
    border-top: 2px solid var(--np-ink);
  }
  dt {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  dd {
    margin: 0;
  }
  .credits {
    min-height: 0;
    overflow-y: auto;
    padding: 2px 4px 16px 28px;
    border-left: 1px solid var(--np-rule);
  }
  .credits h2 {
    font-weight: 700;
    font-size: 1.5em;
    line-height: 1.1;
    letter-spacing: -0.01em;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--np-ink);
  }
  /* Section heads: a title on a rule, as the Courier's. */
  h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 18px 0 4px;
    font-size: 1.02em;
    color: var(--np-ink-2);
  }
  h3::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--np-rule);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
  }
  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 2px 16px;
    padding: 6px 0;
    border-bottom: 1px solid var(--np-rule);
    font-size: 0.92em;
  }
  li:last-child {
    border-bottom: 0;
  }
  li b {
    font-weight: 600;
  }
  li span {
    color: var(--np-ink-2);
  }
  li small {
    grid-column: 2;
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.88em;
  }
</style>
