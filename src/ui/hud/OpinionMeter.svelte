<script lang="ts">
  // What a nation thinks of you: a centred −100 … +100 gauge, its band and value.
  import type { Opinion } from '../../core/rules/opinion';
  import { t } from '../i18n/i18n.svelte';

  let { o, compact = false }: { o: Opinion; compact?: boolean } = $props();
  /** Half-track filled from the centre, towards the right (goodwill) or the left (resentment). */
  const fill = $derived(Math.min(50, (Math.abs(o.value) / 100) * 50));
</script>

<span class="op {o.level}" class:compact data-testid="opinion">
  <span class="track" aria-hidden="true">
    <i style:left="{o.value < 0 ? 50 - fill : 50}%" style:width="{fill}%"></i>
  </span>
  <b>{t(`opinion.level.${o.level}`)}</b>
  <span class="mono">{o.value > 0 ? '+' : ''}{o.value}</span>
</span>

<style>
  .op {
    --c: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82em;
    color: var(--c);
    white-space: nowrap;
  }
  .hostile {
    --c: var(--bad-text);
  }
  .wary {
    --c: var(--warn-text);
  }
  .cordial {
    --c: #b8dccb;
  }
  .friendly {
    --c: var(--good-text);
  }
  .track {
    position: relative;
    width: 54px;
    height: 6px;
    border-radius: 3px;
    background: var(--input-bg);
    border: 1px solid var(--line);
    flex: none;
  }
  /* The neutral mark. */
  .track::after {
    content: '';
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--line-strong);
  }
  .track i {
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 2px;
    background: var(--c);
  }
  b {
    font-weight: 600;
  }
  .mono {
    color: var(--faint);
  }
  .compact {
    font-size: 0.96em;
  }
  .compact .track {
    width: 40px;
    height: 5px;
  }
</style>
