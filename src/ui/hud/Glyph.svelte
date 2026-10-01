<script lang="ts">
  // Inline SVG versions of the map legend glyphs.
  let { kind, size = 22 }: { kind: string; size?: number } = $props();
</script>

<svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" class="g">
  {#if kind === 'city'}
    <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.6" />
    <path d="M16 10 21 16 16 22 11 16Z" fill="currentColor" />
  {:else if kind === 'port'}
    <path d="M16 6v20M10 11h12" stroke="currentColor" stroke-width="2.6" fill="none" />
    <circle cx="16" cy="5" r="2.4" stroke="currentColor" stroke-width="2" fill="none" />
    <path d="M7.5 18a9 9 0 0 0 17 0" stroke="currentColor" stroke-width="2.6" fill="none" />
  {:else if kind === 'factory'}
    <path
      d="M5 25V15l6-5v5l6-5v5h10v10Z"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linejoin="round"
    />
    <rect x="21" y="5" width="4" height="10" fill="currentColor" />
  {:else if kind === 'defensePost'}
    <path
      d="M7 7h18v10l-9 10-9-10Z"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linejoin="round"
    />
    <path d="M16 11v10" stroke="currentColor" stroke-width="2.6" />
  {:else if kind === 'silo'}
    <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="2.6" />
    <path
      d="M16 16 12.5 8.6A8 8 0 0 1 19.5 8.6Z M16 16 23.8 17.6A8 8 0 0 1 20.4 22.6Z M16 16 11.6 22.6A8 8 0 0 1 8.2 17.6Z"
      fill="currentColor"
    />
  {:else if kind === 'sam'}
    <path
      d="M6 20 16 10 26 20M6 27 16 17 26 27"
      fill="none"
      stroke="currentColor"
      stroke-width="2.8"
      stroke-linejoin="round"
    />
  {:else if kind === 'radar'}
    <circle cx="10" cy="22" r="2.6" fill="currentColor" />
    <path
      d="M10 15a7 7 0 0 1 7 7M10 10a12 12 0 0 1 12 12M10 5a17 17 0 0 1 17 17"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    />
  {:else if kind === 'airfield'}
    <rect x="13.5" y="4" width="5" height="24" fill="currentColor" />
    <rect x="5" y="13.5" width="22" height="5" fill="currentColor" />
  {:else if kind === 'warship'}
    <path d="M2 17l5-4h18l5 4-5 4H7Z" fill="currentColor" />
  {:else if kind === 'nukeA' || kind === 'nukeH' || kind === 'nukeMirv'}
    <circle cx="16" cy="16" r="3" fill="currentColor" />
    {#each [0, 1, 2] as k}
      <path
        d="M16 16 L{16 + 11 * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 3 - 0.5)} {16 +
          11 * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 3 - 0.5)} A11 11 0 0 1 {16 +
          11 * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 3 + 0.5)} {16 +
          11 * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 3 + 0.5)}Z"
        fill="currentColor"
        opacity="0.9"
      />
    {/each}
    {#if kind === 'nukeH'}<circle
        cx="16"
        cy="16"
        r="13.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
      />{/if}
    {#if kind === 'nukeMirv'}<circle cx="27" cy="6" r="3" fill="currentColor" /><circle
        cx="5"
        cy="6"
        r="3"
        fill="currentColor"
      />{/if}
  {:else if kind === 'fighter' || kind === 'bomber' || kind === 'recon'}
    <path d="M27 16 5 7l5 9-5 9Z" fill="currentColor" />
    {#if kind === 'bomber'}<circle cx="16" cy="25" r="3" fill="currentColor" />{/if}
    {#if kind === 'recon'}<circle
        cx="24"
        cy="7"
        r="3"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      />{/if}
  {:else if kind === 'terrain'}
    <path
      d="M3 25 12 10l5 8 4-5 8 12Z"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linejoin="round"
    />
  {:else if kind === 'fog'}
    <path d="M5 12h16M8 17h20M4 22h15" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
  {:else if kind === 'resources'}
    <path
      d="M16 4 22 12 16 28 10 12Z"
      fill="none"
      stroke="currentColor"
      stroke-width="2.4"
      stroke-linejoin="round"
    />
  {:else}
    <circle cx="16" cy="16" r="6" fill="currentColor" />
  {/if}
</svg>

<style>
  .g {
    display: block;
  }
</style>
