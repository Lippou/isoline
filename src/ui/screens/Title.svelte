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
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  type Entry = {
    id: string;
    icon: IconName;
    label: string;
    desc: string;
    run: () => void;
    primary?: boolean;
    badge?: string;
  };
  const mainEntries = $derived<Entry[]>([
    {
      id: 'menu-play',
      icon: 'play',
      label: t('title.play'),
      desc: t('title.playDesc'),
      run: () => (sub = true),
      primary: true,
    },
    {
      id: 'menu-editor',
      icon: 'edit',
      label: t('title.editor'),
      desc: t('title.editorDesc'),
      run: () => nav('editor'),
    },
    {
      id: 'menu-replays',
      icon: 'rewind',
      label: t('title.replays'),
      desc: t('title.replaysDesc'),
      run: () => nav('replays'),
    },
    {
      id: 'menu-profile',
      icon: 'user',
      label: t('title.profile'),
      desc: t('title.profileDesc'),
      run: () => nav('profile'),
    },
    {
      id: 'menu-settings',
      icon: 'settings',
      label: t('title.settings'),
      desc: t('title.settingsDesc'),
      run: () => nav('settings'),
    },
    {
      id: 'menu-about',
      icon: 'info',
      label: t('title.about'),
      desc: t('title.aboutDesc'),
      run: () => nav('about'),
    },
  ]);
  const playEntries = $derived<Entry[]>([
    {
      id: 'menu-solo',
      icon: 'globe',
      label: t('title.solo'),
      desc: t('title.soloDesc'),
      primary: true,
      run: () => {
        app.lobby.lan = false;
        nav('lobby');
      },
    },
    {
      id: 'menu-campaign',
      icon: 'book',
      label: t('title.campaign'),
      desc: t('title.campaignDesc'),
      run: () => nav('campaign'),
    },
    {
      id: 'menu-tutorial',
      icon: 'help',
      label: t('title.tutorial'),
      desc: t('title.tutorialDesc'),
      badge: settings.game.tutorialDone ? '' : t('title.recommended'),
      run: () => startTutorial(),
    },
    {
      id: 'menu-lan',
      icon: 'network',
      label: t('title.lan'),
      desc: t('title.lanDesc'),
      run: () => nav('lan'),
    },
    {
      id: 'menu-load',
      icon: 'save',
      label: t('title.load'),
      desc: t('title.loadDesc'),
      run: () => nav('load'),
    },
  ]);

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
  <nav class="menu panel rise-in" aria-label={t('menu.main')}>
    <header>
      {#if sub}
        <button class="back" onclick={() => (sub = false)} aria-label={t('common.back')}
          ><Icon name="back" size={16} /></button
        >
        <h2>{t('title.play')}</h2>
      {:else}
        <h2>{t('title.mainMenu')}</h2>
      {/if}
    </header>
    {#each sub ? playEntries : mainEntries as e (e.id)}
      <button class="entry" class:primary={e.primary} onclick={e.run} data-testid={e.id}>
        <span class="ic"><Icon name={e.icon} size={20} /></span>
        <span class="txt">
          <b
            >{e.label}{#if e.badge}<span class="badge">{e.badge}</span>{/if}</b
          >
          <small>{e.desc}</small>
        </span>
      </button>
    {/each}
    {#if !sub}
      <button class="entry quit" onclick={() => bridge.quit()}>
        <span class="ic"><Icon name="quit" size={18} /></span>
        <span class="txt"><b>{t('title.quit')}</b></span>
      </button>
    {/if}
  </nav>
  {#if update}
    <div class="update panel" role="status" data-testid="update-banner">
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
      linear-gradient(
        90deg,
        rgba(10, 12, 16, 0.7),
        rgba(10, 12, 16, 0.15) 40%,
        rgba(10, 12, 16, 0.25) 60%,
        rgba(10, 12, 16, 0.75)
      ),
      linear-gradient(0deg, rgba(10, 12, 16, 0.6), transparent 30%);
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
    color: var(--parchment);
    opacity: 0.85;
    font-size: 1.25em;
    letter-spacing: 0.03em;
  }
  .menu {
    position: absolute;
    right: 7vw;
    top: 50%;
    transform: translateY(-50%);
    width: 380px;
    padding: 8px;
    display: grid;
    gap: 2px;
  }
  .menu header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 10px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 4px;
  }
  .back {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    padding: 2px;
  }
  .back:hover {
    color: var(--parchment);
  }
  .entry {
    display: grid;
    grid-template-columns: 40px 1fr;
    align-items: center;
    gap: 10px;
    padding: 10px;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--parchment);
    cursor: pointer;
  }
  .entry:hover,
  .entry:focus-visible {
    background: var(--panel-3);
    border-color: var(--line-strong);
    outline: none;
  }
  .entry.primary {
    background: rgba(209, 166, 74, 0.12);
    border-color: rgba(209, 166, 74, 0.45);
  }
  .entry.primary .ic {
    background: var(--brass);
    color: #1b1408;
  }
  .entry.primary:hover {
    background: rgba(209, 166, 74, 0.2);
  }
  .ic {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    background: var(--panel-3);
    color: var(--parchment);
  }
  .txt {
    display: grid;
    gap: 1px;
  }
  .txt b {
    font-weight: 600;
    font-size: 1.02em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .txt small {
    color: var(--muted);
    font-size: 0.84em;
    line-height: 1.35;
  }
  .badge {
    font-size: 0.68em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--brass);
    border: 1px solid rgba(209, 166, 74, 0.5);
    border-radius: 3px;
    padding: 0 5px;
  }
  .quit {
    margin-top: 4px;
    border-top: 1px solid var(--line);
    border-radius: 0;
    padding-top: 12px;
  }
  .quit .ic {
    background: none;
    color: var(--muted);
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
