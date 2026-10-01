<script lang="ts">
  import { onMount } from 'svelte';
  import { go } from '../stores/app.svelte';
  import Logo from '../Logo.svelte';

  onMount(() => {
    const t = setTimeout(() => go('title'), 1700);
    const skip = () => go('title');
    window.addEventListener('pointerdown', skip, { once: true });
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', skip);
      window.removeEventListener('keydown', skip);
    };
  });
</script>

<div class="splash" data-testid="splash">
  <Logo animated size={220} />
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 50% 50%, #142441, var(--abyss) 70%);
  }
</style>
