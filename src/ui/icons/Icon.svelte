<script lang="ts">
  import { iconMarkup, type IconName } from './icons';

  let {
    name,
    size = 18,
    stroke = 2,
    label = '',
  }: { name: IconName; size?: number; stroke?: number; label?: string } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  {#if label}<title>{label}</title>{/if}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- static, trusted icon data -->
  {@html iconMarkup(name)}
</svg>

<style>
  .icon {
    display: inline-block;
    vertical-align: -0.18em;
    flex-shrink: 0;
  }
</style>
