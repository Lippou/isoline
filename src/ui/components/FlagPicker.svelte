<script lang="ts">
  // Flag picker (profile, lobby): a real country's flag, a custom design, or the flag
  // generated from the player's name. Previews the flag at the sizes used in game,
  // then saves the choice in the profile.
  import { onMount } from 'svelte';
  import { t, i18n, short, num } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import { profile, setMyFlag, myFlag, type FlagChoice } from '../stores/profile.svelte';
  import {
    defaultFlagSpec,
    sanitizeFlagSpec,
    type FlagSpec,
    type PlayerFlag,
  } from '../../core/data/flagSpec';
  import { hashString } from '../../core/rng';
  import { REAL_FLAG_CODES, flagUrl, flagDataUrl, realFlagUrl } from '../../render/flags';
  import { flagSvgUrl } from '../../render/flagSvg';
  import { flagName, foldSearch } from './flagNames';
  import FlagEditor from './FlagEditor.svelte';

  let {
    name,
    onclose,
    onpick,
  }: { name: string; onclose: () => void; onpick?: (flag: PlayerFlag | undefined) => void } = $props();

  let tab = $state<FlagChoice>(profile.flagChoice);
  let iso = $state(profile.flagIso || 'fr');
  let spec = $state<FlagSpec>(sanitizeFlagSpec($state.snapshot(profile.customFlag)) ?? defaultFlagSpec());
  let query = $state('');
  let box: HTMLDivElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();

  const seed = $derived(hashString(name + 0));
  const all = $derived(
    REAL_FLAG_CODES.map((code) => {
      const n = flagName(code, i18n.lang);
      return { code, name: n, key: foldSearch(`${n} ${code}`) };
    }).sort((a, b) => a.name.localeCompare(b.name, i18n.lang)),
  );
  const shown = $derived.by(() => {
    const q = foldSearch(query.trim());
    return q ? all.filter((c) => c.key.includes(q)) : all;
  });
  const previewUrl = $derived(
    tab === 'iso'
      ? (realFlagUrl(iso) ?? flagDataUrl(seed, 240))
      : tab === 'custom'
        ? flagSvgUrl($state.snapshot(spec) as FlagSpec, 240)
        : flagDataUrl(seed, 240),
  );
  const caption = $derived(
    tab === 'iso' ? flagName(iso, i18n.lang) : tab === 'custom' ? t('flag.tabCustom') : t('flag.tabAuto'),
  );

  onMount(() => {
    box?.focus();
    if (tab === 'iso')
      requestAnimationFrame(() =>
        box?.querySelector('.cell.on')?.scrollIntoView({ block: 'center', behavior: 'instant' }),
      );
  });

  function confirm(): void {
    setMyFlag(
      tab,
      tab === 'iso' ? { iso } : tab === 'custom' ? { spec: $state.snapshot(spec) as FlagSpec } : {},
    );
    onpick?.(myFlag());
    onclose();
  }
  function onkey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
  const TABS: { id: FlagChoice; icon: 'globe' | 'edit' | 'dice'; label: string }[] = [
    { id: 'iso', icon: 'globe', label: 'flag.tabWorld' },
    { id: 'custom', icon: 'edit', label: 'flag.tabCustom' },
    { id: 'generated', icon: 'dice', label: 'flag.tabAuto' },
  ];
</script>

<div class="back fade-in" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div
    class="dlg"
    role="dialog"
    aria-modal="true"
    aria-labelledby="flag-title"
    tabindex="-1"
    bind:this={box}
    onkeydown={onkey}
    data-testid="flag-picker"
  >
    <header class="top">
      <div>
        <h2 id="flag-title">{t('flag.pickerTitle')}</h2>
        <p>{t('flag.pickerSub')}</p>
      </div>
      <button class="btn ghost icon-only" aria-label={t('common.close')} onclick={onclose}
        ><Icon name="close" size={18} /></button
      >
    </header>

    <div class="tabs" role="tablist">
      {#each TABS as tb (tb.id)}
        <button
          role="tab"
          aria-selected={tab === tb.id}
          class:on={tab === tb.id}
          data-testid="flag-tab-{tb.id}"
          onclick={() => {
            tab = tb.id;
            if (tb.id === 'iso') requestAnimationFrame(() => search?.focus());
          }}><Icon name={tb.icon} size={15} />{t(tb.label)}</button
        >
      {/each}
    </div>

    <div class="body">
      <div class="main">
        {#if tab === 'iso'}
          <div class="searchrow">
            <Icon name="search" size={16} />
            <input
              type="text"
              bind:this={search}
              bind:value={query}
              placeholder={t('flag.search')}
              aria-label={t('flag.search')}
              data-testid="flag-search"
            />
            <span class="mono count">{t('flag.count', { n: shown.length })}</span>
          </div>
          <div class="grid scroll" role="listbox" aria-label={t('flag.tabWorld')}>
            {#each shown as c (c.code)}
              <button
                class="cell"
                class:on={iso === c.code}
                role="option"
                aria-selected={iso === c.code}
                data-testid="flag-iso-{c.code}"
                onclick={() => (iso = c.code)}
                ondblclick={confirm}
              >
                <img src={realFlagUrl(c.code)} alt="" loading="lazy" decoding="async" />
                <span>{c.name}</span>
              </button>
            {:else}
              <p class="none">{t('flag.noMatch', { q: query })}</p>
            {/each}
          </div>
        {:else if tab === 'custom'}
          <div class="scroll edwrap"><FlagEditor bind:spec /></div>
        {:else}
          <div class="auto">
            <img src={flagDataUrl(seed, 240)} alt="" />
            <p>{t('flag.autoHint')}</p>
          </div>
        {/if}
      </div>

      <aside class="side">
        <h3>{t('flag.preview')}</h3>
        <figure class="big" class:wide={tab === 'iso'}>
          <img src={previewUrl} alt={caption} data-testid="flag-preview" />
          <figcaption>{caption}</figcaption>
        </figure>
        <h3>{t('flag.inGame')}</h3>
        <div class="ink">
          <div class="maplabel">
            <img src={previewUrl} alt="" />
            <span class="nm">{name}</span>
          </div>
          <div class="troops mono">{short(48_200)}</div>
          <div class="row">
            <span class="rk mono">1</span>
            <img src={previewUrl} alt="" />
            <span class="rn">{name}</span>
            <span class="mono pc">{num(23.4, 1)} %</span>
          </div>
          <div class="row sm">
            <img src={previewUrl} alt="" />
            <span class="rn">{t('flag.sampleLog', { name })}</span>
          </div>
        </div>
      </aside>
    </div>

    <footer class="foot">
      <span class="cur"
        >{t('flag.current')}
        <img src={flagUrl({ flagSeed: seed, flag: myFlag() })} alt="" /></span
      >
      <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
      <button class="btn primary" onclick={confirm} data-testid="flag-use"
        ><Icon name="check" size={15} />{t('flag.use')}</button
      >
    </footer>
  </div>
</div>

<style>
  .back {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--tip-bg) 34%, transparent);
  }
  .dlg {
    width: min(1120px, 94vw);
    height: min(760px, 92vh);
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    background: var(--panel-solid);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(22, 50, 74, 0.28);
    outline: none;
    color: var(--parchment);
    animation: dlg-in 0.22s var(--ease-out) both;
  }
  @keyframes dlg-in {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.985);
    }
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 24px 10px;
  }
  .top h2 {
    font-family: var(--title);
    font-size: 1.6em;
    font-weight: 600;
    margin: 0;
  }
  .top p {
    margin: 4px 0 0;
    color: var(--muted);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 24px;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px 9px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font-weight: 500;
    cursor: var(--cursor-pointer, pointer);
    margin-bottom: -1px;
  }
  .tabs button:hover {
    color: var(--parchment);
  }
  .tabs button.on {
    color: var(--parchment);
    border-bottom-color: var(--aurora);
    font-weight: 600;
  }
  .body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
  }
  .main {
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    padding: 16px 20px 0 24px;
    gap: 12px;
  }
  .searchrow {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--muted);
  }
  .searchrow input {
    flex: 1;
    font-size: 1.02em;
  }
  .count {
    font-size: 0.85em;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 6px;
    align-content: start;
    padding: 2px 6px 16px 2px;
  }
  .cell {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 9px 6px 7px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--parchment);
    cursor: var(--cursor-pointer, pointer);
    font-size: 0.82em;
    line-height: 1.2;
    text-align: center;
  }
  .cell:hover {
    background: var(--select-bg);
  }
  .cell.on {
    border-color: var(--aurora);
    background: var(--select-bg);
    font-weight: 600;
  }
  .cell img {
    width: 56px;
    height: 42px;
    object-fit: cover;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(22, 50, 74, 0.22);
  }
  .none {
    grid-column: 1 / -1;
    color: var(--muted);
    padding: 20px 0;
  }
  .edwrap {
    grid-row: 1 / -1;
    padding: 0 8px 18px 0;
  }
  .auto {
    grid-row: 1 / -1;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 16px;
    color: var(--muted);
    text-align: center;
  }
  .auto img {
    width: 240px;
    border-radius: 3px;
    box-shadow:
      0 0 0 1px rgba(22, 50, 74, 0.22),
      0 8px 22px rgba(22, 50, 74, 0.16);
  }
  .auto p {
    max-width: 34ch;
    margin: 0;
  }
  .side {
    border-left: 1px solid var(--line);
    padding: 16px 22px;
    display: grid;
    align-content: start;
    gap: 10px;
    background: color-mix(in srgb, var(--slate) 45%, var(--panel-solid));
    overflow-y: auto;
  }
  .side h3 {
    font-size: 0.82em;
    font-weight: 600;
    color: var(--muted);
    margin: 4px 0 0;
  }
  .big {
    margin: 0;
    display: grid;
    gap: 8px;
    justify-items: center;
  }
  .big img {
    width: 100%;
    aspect-ratio: 3 / 2;
    object-fit: fill;
    border-radius: 3px;
    box-shadow:
      0 0 0 1px rgba(22, 50, 74, 0.22),
      0 8px 22px rgba(22, 50, 74, 0.16);
  }
  .big.wide img {
    aspect-ratio: 4 / 3;
  }
  figcaption {
    font-family: var(--title);
    font-size: 1.1em;
    font-weight: 600;
    text-align: center;
  }
  /* In-game sizes, on the game's ink. */
  .ink {
    background: #10212f;
    border-radius: 8px;
    padding: 14px 14px 10px;
    display: grid;
    gap: 8px;
    color: #eef3f2;
    background-image: radial-gradient(circle at 30% 30%, rgba(90, 140, 120, 0.35), transparent 60%);
  }
  .maplabel {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .maplabel img {
    height: 15px;
    border-radius: 1px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
  }
  .nm {
    font-family: 'IBM Plex Serif', Georgia, serif;
    font-weight: 600;
    font-size: 21px;
    color: #fff;
    paint-order: stroke;
    -webkit-text-stroke: 4px #0b0e12;
  }
  .troops {
    text-align: center;
    font-size: 13px;
    margin-top: -8px;
    paint-order: stroke;
    -webkit-text-stroke: 3px #0b0e12;
    color: #e8e3d6;
  }
  .row {
    display: grid;
    grid-template-columns: 16px 24px 1fr auto;
    gap: 8px;
    align-items: center;
    font-size: 13px;
    padding: 6px 8px;
    border-radius: 4px;
    background: rgba(14, 29, 42, 0.96);
    border: 1px solid #253d52;
  }
  .row.sm {
    grid-template-columns: 24px 1fr;
    color: #9fb3c2;
  }
  .row img {
    width: 24px;
    height: 16px;
    object-fit: cover;
    border-radius: 2px;
  }
  .rk {
    color: #9fb3c2;
  }
  .rn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pc {
    color: #9fb3c2;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    padding: 14px 24px;
    border-top: 1px solid var(--line);
  }
  .cur {
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .cur img {
    height: 20px;
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(22, 50, 74, 0.22);
  }
</style>
