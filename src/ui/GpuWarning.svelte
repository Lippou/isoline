<script lang="ts">
  // A note over the menus when the browser draws the map without the graphics card (gpu.ts):
  // the game would crawl, and the cure is a switch in the browser's settings. Once read, it
  // stays away for the session.
  import { t } from './i18n/i18n.svelte';
  import { isDesktop } from './bridge';
  import { accelerationPage, softwareRenderer } from './gpu';
  import Icon from './icons/Icon.svelte';

  const KEY = 'isoline.gpuWarningSeen';
  let seen = $state(false);
  try {
    seen = sessionStorage.getItem(KEY) === '1';
  } catch {
    // (Storage blocked: shown each time.)
  }
  const renderer = seen ? null : softwareRenderer();
  const page = accelerationPage();

  function close(): void {
    seen = true;
    try {
      sessionStorage.setItem(KEY, '1');
    } catch {
      // (Storage blocked.)
    }
  }
</script>

{#if renderer && !seen}
  <div class="gpu panel" role="alert" data-testid="gpu-warning">
    <Icon name="info" size={18} />
    <div>
      <b>{t('gpu.title')}</b>
      <p>
        {#if isDesktop}{t('gpu.app')}{:else}{t('gpu.browser', { page })}{/if}
      </p>
      <small>{t('gpu.renderer', { name: renderer })}</small>
    </div>
    <button class="np-btn ink" onclick={close} data-testid="gpu-warning-close">{t('gpu.ok')}</button>
  </div>
{/if}

<style>
  .gpu {
    position: fixed;
    top: calc(12px + var(--safe-t, 0px));
    left: 50%;
    translate: -50% 0;
    z-index: 90;
    width: min(560px, calc(100vw - 24px));
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: start;
    gap: 10px;
    padding: 12px 14px;
    background: var(--np-paper, #f4efe2);
    color: var(--np-ink, #172a3c);
    border-left: 4px solid var(--np-spot, #c0392b);
  }
  b {
    font-family: var(--title);
  }
  p {
    margin: 4px 0;
    font-size: 0.9em;
  }
  small {
    opacity: 0.7;
    font-size: 0.75em;
  }
</style>
