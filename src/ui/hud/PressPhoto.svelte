<script lang="ts">
  // A world event's press photo as the Courier prints it: the picture in the paper's inks
  // (its frame reserved before it loads: no jump), the caption and the credit line.
  // "full" keeps the 3:2 frame (the Journal's lead); "banner" shows a wide strip of it
  // (the Flash info card, the front page), where a click can open the full article.
  import { t } from '../i18n/i18n.svelte';
  import { PRESS_H, PRESS_PHOTOS, PRESS_W, pressPhotoUrl } from './pressPhotos';
  import type { WorldEventId } from '../../core/rules/features';

  let {
    id,
    size = 'full',
    caption = true,
    onopen,
    openLabel = '',
  }: {
    id: WorldEventId;
    size?: 'full' | 'banner';
    caption?: boolean;
    onopen?: () => void;
    openLabel?: string;
  } = $props();

  const p = $derived(PRESS_PHOTOS[id]);
  const credit = $derived(
    t('pressPhoto.credit', {
      author: p.author,
      licence: p.licence === 'Public domain' ? t('pressPhoto.publicDomain') : p.licence,
    }),
  );
  const src = $derived(pressPhotoUrl(id));
  /** The picture fades in once loaded; a missing file leaves no empty frame behind. */
  let loadedSrc = $state('');
  let brokenSrc = $state('');
</script>

{#if brokenSrc !== src}
  <figure class="press {size}" data-testid="press-photo" data-event={id}>
    {#snippet picture()}
      <img
        {src}
        alt={t(`pressPhoto.alt.${id}`)}
        width={PRESS_W}
        height={PRESS_H}
        decoding="async"
        class:loaded={loadedSrc === src}
        onload={() => (loadedSrc = src)}
        onerror={() => (brokenSrc = src)}
      />
    {/snippet}
    {#if onopen}
      <button class="frame" onclick={onopen} aria-label={openLabel} data-tip={openLabel}
        >{@render picture()}</button
      >
    {:else}
      <span class="frame">{@render picture()}</span>
    {/if}
    <figcaption>
      {#if caption}<span class="cap">{t(`pressPhoto.caption.${id}`)}</span>{/if}
      <span class="credit">{credit}</span>
    </figcaption>
  </figure>
{/if}

<style>
  .press {
    margin: 0;
    min-width: 0;
  }
  /* The frame is laid out before the picture arrives (aspect ratio), on a paper tint. */
  .frame {
    appearance: none;
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
    aspect-ratio: 3 / 2;
    overflow: hidden;
  }
  .banner .frame {
    aspect-ratio: 2 / 1;
  }
  button.frame {
    cursor: pointer;
  }
  button.frame:focus-visible {
    outline: 2px solid var(--np-ink);
    outline-offset: 2px;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* Printed on the sheet: the photo's paper takes the paper's tint. */
    mix-blend-mode: multiply;
    opacity: 0;
    transition: opacity 0.25s ease-out;
  }
  img.loaded {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    img {
      transition: none;
    }
  }
  figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 6px;
    margin-top: 3px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--np-rule);
    font-size: 0.74em;
    line-height: 1.35;
  }
  .cap {
    font-family: var(--np-serif);
    font-style: italic;
    color: var(--np-ink);
  }
  /* The photographer's credit, as papers print it: small, after the caption. */
  .credit {
    margin-left: auto;
    text-align: right;
    font-family: var(--text);
    font-size: 0.86em;
    color: var(--np-ink-3);
    overflow-wrap: anywhere;
  }
</style>
