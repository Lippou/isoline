<script lang="ts">
  import { onMount } from 'svelte';
  onMount(() => {
    (window as unknown as { isoline?: { smokeReady(): void } }).isoline?.smokeReady();
  });
</script>

<main><h1>Isoline</h1></main>

<style>
  main {
    color: #eae6da;
    background: #0b1220;
    height: 100vh;
    display: grid;
    place-items: center;
  }
</style>
