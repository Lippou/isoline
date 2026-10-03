<script lang="ts">
  // Photo mode: the only thing left over the map — what the picture shows, the time of
  // day, the shot and the way out. The camera stays free (drag, wheel, keys).
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';
  import { photo } from '../stores/photo.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { audio } from '../../audio/audio';

  let { ctl }: { ctl: GameController } = $props();
  const fogLocked = !ctl.canLiftFog();
  const canFreeze = ctl.canFreeze();
  const toggles: { k: 'labels' | 'borders' | 'fog' | 'weather' | 'routes'; icon: IconName }[] = [
    { k: 'labels', icon: 'labels' },
    { k: 'borders', icon: 'borders' },
    { k: 'fog', icon: 'fog' },
    { k: 'weather', icon: 'storm' },
    { k: 'routes', icon: 'tradeRoutes' },
  ];
  function flip(k: (typeof toggles)[number]['k']): void {
    if (k === 'fog' && fogLocked) return;
    audio.ui('click');
    photo[k] = !photo[k];
  }
  /** The path shortened to the folder and file (the full one is in the tooltip). */
  const shortPath = $derived(photo.saved.split(/[\\/]/).slice(-2).join('/'));
</script>

{#if !photo.capturing}
  <div class="photo-bar" data-testid="photo-bar">
    {#if photo.saved || photo.failed}
      <p class="saved" class:failed={photo.failed} role="status" title={photo.saved}>
        {#if photo.failed}<Icon name="warning" size={13} />{t('photo.failed')}
        {:else}<Icon name="check" size={13} />{t('photo.saved')} <span class="mono">…/{shortPath}</span>{/if}
      </p>
    {/if}
    <div class="bar glass">
      <span class="title"><Icon name="camera" size={15} />{t('photo.title')}</span>
      <span class="sep" aria-hidden="true"></span>
      {#each toggles as g (g.k)}
        <button
          class="tg"
          class:off={!photo[g.k] || (g.k === 'fog' && fogLocked)}
          aria-pressed={photo[g.k] && !(g.k === 'fog' && fogLocked) ? 'true' : 'false'}
          disabled={g.k === 'fog' && fogLocked}
          data-tip={g.k === 'fog' && fogLocked ? t('photo.fogLocked') : t(`photo.tip.${g.k}`)}
          onclick={() => flip(g.k)}
          data-testid="photo-{g.k}"
          ><Icon name={g.icon} size={15} /><span class="lbl">{t(`photo.${g.k}`)}</span></button
        >
      {/each}
      <span class="sep" aria-hidden="true"></span>
      <span class="time" data-tip={t('photo.tip.time')}>
        <button
          class="tg"
          class:off={!photo.autoTime}
          aria-pressed={photo.autoTime ? 'true' : 'false'}
          onclick={() => (photo.autoTime = !photo.autoTime)}
          data-testid="photo-autotime"
          ><Icon name="dayNight" size={15} /><span class="lbl">{t('photo.auto')}</span></button
        >
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          aria-label={t('photo.timeOfDay')}
          value={photo.night}
          oninput={(e) => {
            photo.night = Number((e.target as HTMLInputElement).value);
            photo.autoTime = false;
          }}
          class:dim={photo.autoTime}
          data-testid="photo-night"
        />
      </span>
      {#if canFreeze}
        <button
          class="tg"
          class:off={!photo.freeze}
          aria-pressed={photo.freeze ? 'true' : 'false'}
          data-tip={t('photo.tip.freeze')}
          onclick={() => ctl.setFreeze(!photo.freeze)}
          data-testid="photo-freeze"
          ><Icon name="pause" size={15} /><span class="lbl">{t('photo.freeze')}</span></button
        >
      {/if}
      <span class="sep" aria-hidden="true"></span>
      <button
        class="btn primary shot"
        onclick={() => void ctl.photoShot()}
        data-tip={t('photo.tip.shot', { key: keyLabel(settings.keys.screenshot ?? '') })}
        data-testid="photo-shot"><Icon name="camera" size={15} />{t('photo.shot')}</button
      >
      <button
        class="btn ghost"
        onclick={() => ctl.exitPhoto()}
        aria-label={t('photo.exit')}
        data-tip={t('photo.exitTip')}
        data-testid="photo-exit"><Icon name="close" size={15} /></button
      >
    </div>
  </div>
{/if}

<style>
  .photo-bar {
    position: absolute;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    z-index: 60;
    display: grid;
    justify-items: center;
    gap: 6px;
    max-width: calc(100vw - 24px);
  }
  /* A strip of paper at the foot of the picture, faded until the pointer comes. */
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    font-size: calc(13px * var(--ui-scale));
    opacity: 0.9;
    transition: opacity 0.2s;
  }
  .bar:hover,
  .bar:focus-within {
    opacity: 1;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 2px;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.05em;
    white-space: nowrap;
    color: var(--np-ink);
  }
  .sep {
    width: 1px;
    align-self: stretch;
    margin: 2px 4px;
    background: var(--np-rule);
  }
  .tg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 7px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    color: var(--np-ink);
    white-space: nowrap;
    cursor: var(--cursor-pointer, pointer);
  }
  .tg:hover:not(:disabled) {
    border-color: var(--np-rule-2);
    background: var(--np-card);
  }
  /* Shown in the picture: shaded, ruled in ink. */
  .tg[aria-pressed='true'] {
    background: var(--np-paper-2);
    border-color: var(--np-ink-2);
  }
  .tg.off {
    color: var(--np-ink-3);
  }
  .tg.off .lbl {
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--np-ink-3) 70%, transparent);
  }
  .tg:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .time {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .time input {
    width: 96px;
    accent-color: var(--np-ink);
  }
  .time input.dim {
    opacity: 0.45;
  }
  .shot {
    white-space: nowrap;
  }
  .saved {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--np-edge);
    border-left: 3px solid var(--np-good);
    border-radius: 1px;
    background: var(--np-paper);
    box-shadow: 0 2px 8px rgba(3, 10, 16, 0.25);
    color: var(--np-good);
    font-size: 0.82em;
    font-weight: 600;
    max-width: 100%;
  }
  .saved .mono {
    font-weight: 400;
    color: var(--np-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .saved.failed {
    color: var(--np-warn);
    border-left-color: var(--np-gold);
  }
  @media (max-width: 1240px) {
    .lbl {
      display: none;
    }
  }
</style>
