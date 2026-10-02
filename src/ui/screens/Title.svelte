<script lang="ts">
  import { onMount } from 'svelte';
  import { app, go } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { bridge } from '../bridge';
  import { profile } from '../stores/profile.svelte';
  import { settings } from '../stores/settings.svelte';
  import Logo from '../Logo.svelte';
  import DemoBackground from './DemoBackground.svelte';
  import { audio } from '../../audio/audio';
  import { startTutorial } from './launch';

  let sub = $state(app.screen === 'play');
  let update = $state<{ latest: string; url: string; notes: string } | null>(null);
  const smoke = new URLSearchParams(location.search).has('smoke');

  onMount(() => {
    audio.setScene('menu');
    if (smoke) requestAnimationFrame(() => requestAnimationFrame(() => bridge.smokeReady()));
    // No network call unless the player opted in and configured a manifest URL.
    else if (settings.game.checkUpdates && settings.game.updateUrl) {
      void bridge.checkUpdate(settings.game.updateUrl).then((r) => {
        if ('newer' in r && r.newer) update = r;
      });
    }
  });

  function nav(s: Parameters<typeof go>[0]): void {
    audio.ui('click');
    go(s);
  }
</script>

<div class="title" data-testid="title-screen">
  {#if !smoke}<DemoBackground />{/if}
  <div class="veil"></div>
  <div class="brand rise-in">
    <Logo size={150} />
    <p class="slogan">{t('brand.slogan')}</p>
  </div>
  <nav class="menu glass rise-in" aria-label={t('menu.main')}>
    {#if !sub}
      <button class="btn primary big" onclick={() => (sub = true)} data-testid="menu-play"
        >{t('title.play')}</button
      >
      <button class="btn" onclick={() => nav('editor')} data-testid="menu-editor">{t('title.editor')}</button>
      <button class="btn" onclick={() => nav('replays')} data-testid="menu-replays"
        >{t('title.replays')}</button
      >
      <button class="btn" onclick={() => nav('profile')}>{t('title.profile')}</button>
      <button class="btn" onclick={() => nav('settings')} data-testid="menu-settings"
        >{t('title.settings')}</button
      >
      <button class="btn" onclick={() => nav('about')}>{t('title.about')}</button>
      <button class="btn ghost" onclick={() => bridge.quit()}>{t('title.quit')}</button>
    {:else}
      <button
        class="btn primary big"
        onclick={() => {
          app.lobby.lan = false;
          nav('lobby');
        }}
        data-testid="menu-solo">{t('title.solo')}</button
      >
      <button class="btn" onclick={() => nav('lan')} data-testid="menu-lan">{t('title.lan')}</button>
      <button class="btn" onclick={() => nav('campaign')} data-testid="menu-campaign"
        >{t('title.campaign')}</button
      >
      <button class="btn" onclick={() => startTutorial()} data-testid="menu-tutorial"
        >{t('title.tutorial')}{#if !settings.game.tutorialDone}<span class="new">●</span>{/if}</button
      >
      <button class="btn" onclick={() => nav('load')}>{t('title.load')}</button>
      <button class="btn ghost" onclick={() => (sub = false)}>← {t('common.back')}</button>
    {/if}
  </nav>
  {#if update}
    <div class="update glass" role="status" data-testid="update-banner">
      {t('title.updateAvailable', { version: update.latest })}
      {#if update.url}<button class="btn small" onclick={() => bridge.openExternal(update!.url)}
          >{t('title.updateOpen')}</button
        >{/if}
    </div>
  {/if}
  <footer>
    <span
      >{profile.name || settings.playerName || t('profile.anonymous')} · {t(`title.${profile.title}`)}</span
    >
    <span class="mono">v{app.version}</span>
  </footer>
</div>

<style>
  .update {
    position: fixed;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 14px;
    display: flex;
    gap: 12px;
    align-items: center;
    z-index: 3;
  }
  .title {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--abyss);
  }
  .veil {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 30% 50%, rgba(11, 18, 32, 0.15), rgba(11, 18, 32, 0.85) 75%),
      linear-gradient(90deg, rgba(11, 18, 32, 0.75), rgba(11, 18, 32, 0.1) 45%, rgba(11, 18, 32, 0.6));
    pointer-events: none;
  }
  .brand {
    position: absolute;
    left: 8vw;
    top: 50%;
    transform: translateY(-62%);
    display: grid;
    justify-items: start;
  }
  .slogan {
    margin: 0.8rem 0 0;
    font-family: var(--title);
    font-style: italic;
    color: var(--aurora);
    font-size: 1.25em;
    letter-spacing: 0.04em;
  }
  .menu {
    position: absolute;
    right: 8vw;
    top: 50%;
    transform: translateY(-50%);
    width: 300px;
    padding: 1.2rem;
    display: grid;
    gap: 0.55rem;
  }
  .menu .btn {
    text-align: left;
    font-size: 1.02em;
    position: relative;
  }
  .big {
    font-size: 1.2em !important;
    padding: 0.85em 1.1em;
  }
  .new {
    color: var(--brass);
    margin-left: 0.5em;
    font-size: 0.7em;
  }
  footer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    padding: 0.8rem 1.4rem;
    color: var(--faint);
    font-size: 0.85em;
  }
</style>
