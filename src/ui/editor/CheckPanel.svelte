<script lang="ts">
  // The validation before saving and testing: errors (the map cannot be played) and
  // warnings (it can, not at its best), each with a way to see it and, often, to fix it.
  import { ed, setTool, touched, viewCtl } from './editorSession.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { Issue } from './editorModel';
  import EdIcon from './EdIcon.svelte';

  let { issues }: { issues: Issue[] } = $props();
  const errors = $derived(issues.filter((i) => i.level === 'error').length);
  const warns = $derived(issues.length - errors);

  function show(i: Issue): void {
    if (!i.at) return;
    if (i.marker) {
      ed.selected = i.marker;
      setTool('markers');
      ed.markerKind = i.marker.kind;
    }
    viewCtl.focus(i.at[0], i.at[1]);
  }
  function fix(i: Issue): void {
    if (!ed.model || !i.fix) return;
    ed.model.applyFix(i.fix);
    ed.selected = null;
    touched();
  }
</script>

<section class="check" data-testid="editor-check">
  <h3 class="np-rule">{t('editor.checkTitle')}</h3>
  <p class="verdict" class:bad={errors > 0} class:ok={errors === 0} data-testid="editor-verdict">
    <EdIcon name={errors ? 'error' : warns ? 'warn' : 'ok'} size={18} />
    <span>
      {#if errors}{t('editor.verdictErrors', { n: errors, w: warns })}{:else if warns}{t(
          'editor.verdictWarns',
          {
            n: warns,
          },
        )}{:else}{t('editor.verdictOk')}{/if}
    </span>
  </p>
  {#if issues.length}
    <ul>
      {#each issues as i, k (k)}
        <li class={i.level}>
          <span class="lvl"
            ><EdIcon name={i.level === 'error' ? 'error' : 'warn'} size={14} />{t(
              `editor.level.${i.level}`,
            )}</span
          >
          <p>{t(`editor.issue.${i.code}`, i.params)}</p>
          <div class="acts">
            {#if i.at}<button class="np-btn quiet" onclick={() => show(i)}
                ><EdIcon name="locate" size={14} />{t('editor.show')}</button
              >{/if}
            {#if i.fix}<button class="np-btn" onclick={() => fix(i)}
                ><EdIcon name="fix" size={14} />{t(`editor.fix.${i.fix}`)}</button
              >{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="fine">{t('editor.checkHint')}</p>
</section>

<style>
  .check {
    display: grid;
    gap: 10px;
    align-content: start;
  }
  h3 {
    margin: 0;
  }
  .verdict {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--np-ink);
    background: var(--np-card);
    font-weight: 600;
    font-size: 0.9em;
  }
  .verdict.ok {
    color: var(--np-good);
    border-color: var(--np-good);
  }
  .verdict.bad {
    color: var(--np-spot);
    border-color: var(--np-spot);
    border-width: 2px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0;
    border-top: 1px solid var(--np-ink);
  }
  li {
    display: grid;
    gap: 4px;
    padding: 8px 0 8px 10px;
    border-bottom: 1px solid var(--np-rule);
    border-left: 3px solid var(--np-rule-2);
  }
  /* Errors carry a solid rule, warnings a dashed one: the level reads without colour. */
  li.error {
    border-left: 3px solid var(--np-spot);
  }
  li.warn {
    border-left: 3px dashed var(--np-warn);
  }
  .lvl {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    font-size: 0.72em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .error .lvl {
    color: var(--np-spot);
  }
  .warn .lvl {
    color: var(--np-warn);
  }
  li p {
    margin: 0;
    font-size: 0.86em;
    line-height: 1.4;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .acts .np-btn {
    padding: 3px 8px;
    font-size: 0.8em;
  }
  .fine {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.8em;
    color: var(--np-ink-2);
  }
</style>
