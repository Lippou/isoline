<script lang="ts" module>
  // The opening sequence plays once per session; later visits show the contours settled.
  const opening = { played: false };
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fly } from 'svelte/transition';
  import { app, go } from '../stores/app.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { bridge, mapsBase } from '../bridge';
  import { profile, ACHIEVEMENTS } from '../stores/profile.svelte';
  import { settings } from '../stores/settings.svelte';
  import { update, startUpdates, downloadUpdate, installUpdate } from '../stores/update.svelte';
  import Logo from '../Logo.svelte';
  import DemoBackground from './DemoBackground.svelte';
  import Isolines from '../components/Isolines.svelte';
  import { audio } from '../../audio/audio';
  import { MISSIONS } from '../campaign/missions';
  import { listSaves } from '../game/saves';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  type Entry = {
    id: string;
    icon: IconName;
    label: string;
    desc: string;
    /** Live note shown in the legend's inset while the entry is hovered or focused. */
    peek: string;
    run: () => void;
    primary?: boolean;
    badge?: string;
  };

  const first = !opening.played;
  opening.played = true;

  // Live facts for the notes (all local: profile, settings and storage listings).
  let counts = $state({ maps: -1, replays: -1, saves: -1 });
  let mapNames = $state<Record<string, { fr: string; en: string }>>({});
  const stars = $derived(MISSIONS.reduce((s, m) => s + (profile.campaign[m.id] ?? 0), 0));
  const nextMission = $derived(
    MISSIONS.find((m) => !(profile.campaign[m.id] ?? 0)) ?? MISSIONS[MISSIONS.length - 1]!,
  );
  const achieved = $derived(Object.keys(profile.achievements).length);
  const lastMap = $derived.by(() => {
    const id = app.lobby.config.mapId;
    const n = mapNames[id];
    return n ? n[i18n.lang] || n.en : '';
  });
  const countNote = (n: number, none: string, some: string, one = some) =>
    n < 0 ? '' : n === 0 ? t(none) : t(n === 1 ? one : some, { n });

  const mainEntries = $derived<Entry[]>([
    {
      id: 'menu-play',
      icon: 'play',
      label: t('title.play'),
      desc: t('title.playDesc'),
      peek: stars > 0 ? t('title.peekPlay', { stars, total: MISSIONS.length * 3 }) : t('title.peekNew'),
      run: () => openPlay(),
      primary: true,
    },
    {
      id: 'menu-editor',
      icon: 'edit',
      label: t('title.editor'),
      desc: t('title.editorDesc'),
      peek: countNote(counts.maps, 'title.peekMapsNone', 'title.peekMaps', 'title.peekMapsOne'),
      run: () => nav('editor'),
    },
    {
      id: 'menu-replays',
      icon: 'rewind',
      label: t('title.replays'),
      desc: t('title.replaysDesc'),
      peek: countNote(counts.replays, 'title.peekReplaysNone', 'title.peekReplays', 'title.peekReplaysOne'),
      run: () => nav('replays'),
    },
    {
      id: 'menu-profile',
      icon: 'user',
      label: t('title.profile'),
      desc: t('title.profileDesc'),
      peek: t('title.peekProfile', {
        games: profile.totals.games,
        wins: profile.totals.wins,
        ach: achieved,
        total: ACHIEVEMENTS.length,
      }),
      run: () => nav('profile'),
    },
    {
      id: 'menu-settings',
      icon: 'settings',
      label: t('title.settings'),
      desc: t('title.settingsDesc'),
      peek: t('title.peekSettings', {
        lang: settings.lang === 'fr' ? 'Français' : 'English',
        quality: t(`settings.q.${settings.graphics.quality}`).toLowerCase(),
      }),
      run: () => nav('settings'),
    },
    {
      id: 'menu-about',
      icon: 'info',
      label: t('title.about'),
      desc: t('title.aboutDesc'),
      peek: t('title.peekAbout', { version: app.version }),
      run: () => nav('about'),
    },
  ]);
  const playEntries = $derived<Entry[]>([
    {
      id: 'menu-solo',
      icon: 'globe',
      label: t('title.solo'),
      desc: t('title.soloDesc'),
      peek: lastMap ? t('title.peekSolo', { map: lastMap }) : t('title.soloDesc'),
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
      peek: t('title.peekCampaign', {
        stars,
        total: MISSIONS.length * 3,
        mission: t(`campaign.${nextMission.id}.title`),
      }),
      // The campaign is the tutorial: recommended until its first mission is won.
      badge: stars > 0 ? '' : t('title.recommended'),
      run: () => nav('campaign'),
    },
    {
      id: 'menu-lan',
      icon: 'network',
      label: t('title.lan'),
      desc: t('title.lanDesc'),
      peek: t('title.peekLan'),
      run: () => nav('lan'),
    },
    {
      id: 'menu-load',
      icon: 'save',
      label: t('title.load'),
      desc: t('title.loadDesc'),
      peek: countNote(counts.saves, 'title.peekSavesNone', 'title.peekSaves', 'title.peekSavesOne'),
      run: () => nav('load'),
    },
  ]);

  let sub = $state(app.screen === 'play');
  let hovered = $state('');
  const entries = $derived(sub ? playEntries : mainEntries);
  const note = $derived(entries.find((e) => e.id === hovered) ?? entries[0]!);
  const up = $derived(update.s);
  const smoke = new URLSearchParams(location.search).has('smoke');

  // The contours open out from the logo's summit diamond.
  let root: HTMLDivElement;
  let summit = $state<[number, number] | null>(null);
  function locateSummit(): void {
    const el = root?.querySelector('.cartouche .summit');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    summit = [(r.left + r.width / 2 - box.left) / box.width, (r.top + r.height / 2 - box.top) / box.height];
  }

  onMount(() => {
    audio.setScene('menu');
    void tick().then(locateSummit);
    window.addEventListener('resize', locateSummit);
    if (smoke) requestAnimationFrame(() => requestAnimationFrame(() => bridge.smokeReady()));
    // No network call unless the player opted in and configured a manifest URL.
    else startUpdates();
    void bridge.storage
      .list('maps')
      .then((l) => (counts.maps = l.filter((f) => f.name.endsWith('.isomap')).length))
      .catch(() => {});
    void bridge.storage
      .list('replays')
      .then((l) => (counts.replays = l.filter((f) => f.name.endsWith('.rpl')).length))
      .catch(() => {});
    void listSaves()
      .then((s) => (counts.saves = s.length))
      .catch(() => {});
    void fetch(`${mapsBase()}index.json`)
      .then((r) => r.json() as Promise<{ id: string; name: { fr: string; en: string } }[]>)
      .then((l) => (mapNames = Object.fromEntries(l.map((m) => [m.id, m.name]))))
      .catch(() => {});
    return () => window.removeEventListener('resize', locateSummit);
  });

  function nav(s: Parameters<typeof go>[0]): void {
    audio.ui('click');
    go(s);
  }
  function openPlay(): void {
    audio.ui('click');
    sub = true;
    hovered = '';
    void tick().then(() => focusEntry(0));
  }
  function closePlay(): void {
    sub = false;
    hovered = '';
    void tick().then(() => focusEntry(0));
  }

  let legend: HTMLElement;
  function focusEntry(k: number): void {
    const list = [...legend.querySelectorAll<HTMLButtonElement>('button.entry')];
    if (!list.length) return;
    list[(k + list.length) % list.length]!.focus();
  }
  function onKey(e: KeyboardEvent): void {
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const list = [...legend.querySelectorAll<HTMLButtonElement>('button.entry')];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusEntry(at < 0 ? 0 : at + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Escape' && sub) {
      e.preventDefault();
      closePlay();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="title" data-testid="title-screen" bind:this={root}>
  {#if !smoke}<DemoBackground />{/if}
  {#if summit}
    <Isolines
      mode={first ? 'draw' : 'static'}
      cx={summit[0]}
      cy={summit[1]}
      count={18}
      r0={92}
      step={40}
      growth={1.11}
      drift={[0.32, 0.16]}
      seed={11}
      color="var(--np-sea)"
      stroke={1.2}
      opacity={0.62}
      settle={0.3}
      delay={0.75}
      stagger={0.075}
      duration={1.35}
      indexEvery={5}
    />
  {/if}

  <section class="cartouche" class:first aria-label="Isoline">
    <div class="neat">
      <Logo tone="light" size={104} animated={first} row />
      <p class="slogan">{t('brand.slogan')}</p>
    </div>
  </section>

  <nav class="legend" class:first aria-label={t('menu.main')} bind:this={legend}>
    <header class="mast">
      {#if sub}
        <button class="back" onclick={closePlay} aria-label={t('common.back')}
          ><Icon name="back" size={16} /></button
        >
      {/if}
      <h2>{sub ? t('title.play') : t('title.mainMenu')}</h2>
    </header>
    {#key sub}
      <ul in:fly={{ x: sub ? 18 : -18, duration: 220, opacity: 0 }}>
        {#each entries as e, k (e.id)}
          <li style="--k:{k}">
            <button
              class="entry"
              class:primary={e.primary}
              onclick={e.run}
              onpointerenter={() => (hovered = e.id)}
              onfocus={() => (hovered = e.id)}
              data-testid={e.id}
            >
              <span class="key"><Icon name={e.icon} size={18} /></span>
              <span class="txt">
                <b
                  >{e.label}{#if e.badge}<span class="badge">{e.badge}</span>{/if}</b
                >
                <small>{e.desc}</small>
              </span>
            </button>
          </li>
        {/each}
        {#if !sub}
          <li class="quit-row">
            <button class="entry quit" onclick={() => bridge.quit()}>
              <span class="key"><Icon name="quit" size={16} /></span>
              <span class="txt"><b>{t('title.quit')}</b></span>
            </button>
          </li>
        {/if}
      </ul>
    {/key}
    <aside class="note" aria-live="polite">
      {#key note.id + note.peek}
        <p in:fly={{ y: 4, duration: 180 }}>
          <Icon name={note.icon} size={14} /><span>{note.peek || note.desc}</span>
        </p>
      {/key}
    </aside>
  </nav>

  {#if up.state === 'available' || up.state === 'downloading' || up.state === 'ready'}
    <div class="update panel" role="status" data-testid="update-banner">
      <Icon name="download" size={16} />
      <span>{t('title.updateAvailable', { version: up.version ?? '' })}</span>
      {#if up.state === 'available'}
        {#if up.installable && up.error !== 'no-asset'}
          <button class="btn small primary" onclick={downloadUpdate}>{t('update.download')}</button>
        {:else}
          <small>{t(up.installable ? 'update.err.no-asset' : 'update.err.dev')}</small>
        {/if}
      {:else if up.state === 'downloading'}
        <span class="bar" aria-hidden="true"
          ><i style="width:{Math.round((up.progress ?? 0) * 100)}%"></i></span
        >
        <span class="mono">{Math.round((up.progress ?? 0) * 100)} %</span>
      {:else}
        <button class="btn small primary" onclick={installUpdate}>{t('update.install')}</button>
      {/if}
    </div>
  {/if}
  <footer>
    <button class="who" onclick={() => nav('profile')}>
      <b>{profile.name || settings.playerName || t('profile.anonymous')}</b>
      <span>{t(`title.${profile.title}`)}</span>
    </button>
    <span class="mono ver">v{app.version}</span>
  </footer>
</div>

<style>
  .title {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: var(--abyss);
    color: var(--parchment);
  }

  /* Cartouche: the only decorative frame (BRAND §4.2) — a chart's neatline, thin + thick. */
  .cartouche {
    position: absolute;
    left: clamp(32px, 7vw, 140px);
    top: 46%;
    transform: translateY(-50%);
    padding: 7px;
    border: 1px solid var(--np-ink);
    background: color-mix(in srgb, var(--np-paper) 92%, transparent);
    box-shadow: 0 18px 40px -22px rgba(23, 42, 60, 0.4);
  }
  .neat {
    border: 3px solid var(--np-ink);
    padding: clamp(22px, 2.6vw, 34px) clamp(26px, 3vw, 44px) clamp(18px, 2.2vw, 28px);
    display: grid;
    justify-items: start;
    gap: 14px;
  }
  .slogan {
    margin: 0;
    font-family: var(--title);
    font-style: italic;
    font-size: clamp(1.15em, 1.5vw, 1.45em);
    color: var(--np-ink-2);
    letter-spacing: 0.01em;
  }
  .cartouche.first {
    animation: carto-in 0.7s 0.15s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .cartouche.first .slogan {
    animation: fade-up 0.6s 1.15s ease-out both;
  }
  @keyframes carto-in {
    from {
      opacity: 0;
      transform: translateY(calc(-50% + 10px));
    }
  }
  @keyframes fade-up {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  /* The menu: a sheet of the Courier laid on the chart, its actions printed as a legend —
     pictogram, name, one line of explanation, a fine rule between. */
  .legend {
    position: absolute;
    right: clamp(28px, 6vw, 120px);
    top: 50%;
    transform: translateY(-50%);
    width: clamp(360px, 25vw, 440px);
    background: var(--np-paper);
    border: 1px solid #d9d1c1;
    border-radius: 2px;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.4) inset,
      0 20px 46px -20px rgba(23, 42, 60, 0.45);
    display: grid;
    overflow: hidden;
  }
  .legend.first {
    animation: legend-in 0.6s 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes legend-in {
    from {
      opacity: 0;
      transform: translate(14px, -50%);
    }
  }
  /* Its masthead, as the windows': the title over a heavy rule. */
  .mast {
    position: relative;
    padding: 14px 20px 0;
  }
  .mast h2 {
    margin: 0;
    padding: 0 30px 8px;
    border-bottom: 3px solid var(--np-ink);
    font-weight: 700;
    font-size: 1.5em;
    line-height: 1;
    letter-spacing: -0.012em;
    text-align: center;
    color: var(--np-ink);
  }
  .back {
    position: absolute;
    left: 14px;
    top: 10px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
  }
  .back:hover,
  .back:focus-visible {
    color: var(--np-ink);
    border-color: var(--np-rule);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px 20px 6px;
    display: grid;
  }
  li + li {
    border-top: 1px solid var(--np-rule);
  }
  .legend.first li {
    animation: fade-up 0.4s calc(0.75s + var(--k) * 45ms) ease-out both;
  }
  .entry {
    position: relative;
    width: 100%;
    display: grid;
    grid-template-columns: 30px 1fr;
    align-items: center;
    gap: 12px;
    padding: 9px 8px 9px 6px;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    transition: background 0.16s;
  }
  .entry::before {
    content: '';
    position: absolute;
    left: -20px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    background: var(--np-ink);
    transform: scaleY(0);
    transition: transform 0.2s var(--ease-out);
  }
  .entry:hover,
  .entry:focus-visible {
    background: var(--np-card);
  }
  .entry:hover::before,
  .entry:focus-visible::before {
    transform: scaleY(1);
  }
  .entry:focus-visible {
    outline-offset: -2px;
  }
  .key {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    color: var(--np-ink-2);
    transition: color 0.16s;
  }
  .entry:hover .key,
  .entry:focus-visible .key {
    color: var(--np-ink);
  }
  /* The primary action wears the summit: a brass diamond. */
  .primary .key {
    position: relative;
    color: #fffdf6;
  }
  .primary .key::before {
    content: '';
    position: absolute;
    inset: 4px;
    background: var(--brass-fill);
    transform: rotate(45deg);
    border-radius: 2px;
    transition:
      transform 0.25s var(--ease-out),
      background 0.16s;
  }
  /* Centred on the diamond: no nudge (the play triangle carries its own optical offset,
     and a nudge pushed every other glyph — the Solo globe — off centre). */
  .primary .key :global(svg) {
    position: relative;
    width: 15px;
    height: 15px;
  }
  .primary:hover .key,
  .primary:focus-visible .key {
    color: #fffdf6;
  }
  .primary:hover .key::before,
  .primary:focus-visible .key::before {
    background: var(--brass-fill-hover);
    transform: rotate(135deg);
  }
  .txt {
    display: grid;
    gap: 1px;
    transition: transform 0.2s var(--ease-out);
  }
  .entry:hover .txt,
  .entry:focus-visible .txt {
    transform: translateX(2px);
  }
  .txt b {
    font-weight: 600;
    font-size: 1.04em;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .primary .txt b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.2em;
    letter-spacing: -0.005em;
  }
  .txt small {
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.84em;
    line-height: 1.35;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    min-height: 18px;
    padding: 0 6px;
    border: 1px solid color-mix(in srgb, var(--brass-text) 50%, transparent);
    border-radius: 2px;
    font-family: var(--text);
    font-size: 0.66em;
    font-weight: 600;
    letter-spacing: 0;
    color: var(--brass-text);
  }
  .quit-row {
    margin-top: 2px;
  }
  li.quit-row {
    border-top: 1px solid var(--np-ink);
  }
  .quit {
    padding-top: 7px;
    padding-bottom: 7px;
  }
  .quit .key {
    color: var(--np-ink-3);
  }
  .quit b {
    font-weight: 500;
    color: var(--np-ink-2);
  }
  .quit:hover b {
    color: var(--np-ink);
  }

  /* The note: what lies behind the hovered entry, from your own data, as a dateline. */
  .note {
    margin: 0 20px 14px;
    min-height: 46px;
    padding: 7px 0;
    border-top: 1px solid var(--np-ink);
    border-bottom: 1px solid var(--np-ink);
    display: grid;
    align-items: center;
  }
  .note p {
    margin: 0;
    display: flex;
    gap: 9px;
    align-items: baseline;
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
    font-size: 0.92em;
    line-height: 1.4;
  }
  .note p :global(svg) {
    flex: none;
    color: var(--np-ink);
    transform: translateY(2px);
  }

  .update .bar {
    width: 140px;
    height: 3px;
    background: var(--np-rule);
    overflow: hidden;
  }
  .update .bar i {
    display: block;
    height: 100%;
    background: var(--np-ink);
  }
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
    background: var(--np-paper);
    border: 1px solid var(--np-ink);
    border-radius: 2px;
    box-shadow: 3px 3px 0 var(--np-paper-2);
  }
  footer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    padding: 0 clamp(20px, 2vw, 32px) 18px;
    color: var(--np-ink-2);
    font-size: 0.88em;
    pointer-events: none;
  }
  .who {
    pointer-events: auto;
    display: grid;
    text-align: left;
    gap: 0;
    background: color-mix(in srgb, var(--np-paper) 88%, transparent);
    border: 1px solid var(--np-rule);
    border-radius: 2px;
    padding: 5px 10px;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
  }
  .who:hover,
  .who:focus-visible {
    border-color: var(--np-ink);
  }
  .who span {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
  }
  .ver {
    padding: 4px 9px;
    border: 1px solid var(--np-rule);
    border-radius: 2px;
    background: color-mix(in srgb, var(--np-paper) 88%, transparent);
  }
</style>
