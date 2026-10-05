<script lang="ts">
  import { edIconMarkup, type EdIconName } from './editorIcons';

  let { name, size = 18, stroke = 2 }: { name: EdIconName; size?: number; stroke?: number } = $props();
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
  aria-hidden="true"
>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- static, trusted icon data -->
  {@html edIconMarkup(name)}
</svg>

<style>
  .icon {
    display: inline-block;
    vertical-align: -0.18em;
    flex-shrink: 0;
  }
</style>
