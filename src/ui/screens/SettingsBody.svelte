<script lang="ts">
  import { settings, saveSettings, keyLabel, DEFAULT_KEYS } from '../stores/settings.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { bridge } from '../bridge';
  import { audio } from '../../audio/audio';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';
  const TAB_ICONS: Record<string, IconName> = {
    graphics: 'eye',
    audio: 'sound',
    game: 'play',
    controls: 'key',
    access: 'users',
    lang: 'globe',
  };

  let tab = $state<'graphics' | 'audio' | 'game' | 'controls' | 'access' | 'lang'>('graphics');
  let listening = $state<string | null>(null);

  function change(): void {
    saveSettings();
    audio.setVolumes(settings.audio);
    audio.voiceLang = settings.lang;
  }
  function capture(e: KeyboardEvent): void {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      // Swap with any action already using this key.
      const other = Object.keys(settings.keys).find((k) => settings.keys[k] === e.code);
      if (other && other !== listening) settings.keys[other] = settings.keys[listening] ?? '';
      settings.keys[listening] = e.code;
      saveSettings();
    }
    listening = null;
  }
  const tabs = ['graphics', 'audio', 'game', 'controls', 'access', 'lang'] as const;
</script>

<svelte:window onkeydowncapture={capture} />

<div class="settings" data-testid="settings">
  <nav>
    {#each tabs as tb (tb)}
      <button class="tab" class:on={tab === tb} onclick={() => (tab = tb)} data-testid="settings-tab-{tb}"
        ><Icon name={TAB_ICONS[tb] ?? 'settings'} size={16} />{t(`settings.tab.${tb}`)}</button
      >
    {/each}
  </nav>
  <div class="content">
    <h2>{t(`settings.tab.${tab}`)}</h2>

    {#if tab === 'graphics'}
      <div class="form">
        <label
          >{t('settings.quality')}
          <select bind:value={settings.graphics.quality} onchange={change}>
            <option value="high">{t('settings.q.high')}</option>
            <option value="balanced">{t('settings.q.balanced')}</option>
            <option value="performance">{t('settings.q.performance')}</option>
          </select>
        </label>
        <label
          >{t('settings.particles')}
          <b class="mono">{Math.round(settings.graphics.particles * 100)}%</b><input
            type="range"
            min="0"
            max="1"
            step="0.1"
            bind:value={settings.graphics.particles}
            onchange={change}
          /></label
        >
        <label class="row"
          ><input type="checkbox" bind:checked={settings.graphics.shaders} onchange={change} />
          {t('settings.shaders')}</label
        >
        <label class="row"
          ><input
            type="checkbox"
            bind:checked={settings.graphics.vsync}
            onchange={() => {
              if (settings.graphics.vsync) settings.graphics.maxFps = 0;
              change();
            }}
          />
          {t('settings.vsync')}</label
        >
        <label
          >{t('settings.maxFps')} <b class="mono">{settings.graphics.maxFps || '∞'}</b><input
            type="range"
            min="0"
            max="240"
            step="30"
            bind:value={settings.graphics.maxFps}
            onchange={() => {
              settings.graphics.vsync = settings.graphics.maxFps === 0;
              change();
            }}
          /></label
        >
        <label
          >{t('settings.uiScale')} <b class="mono">{Math.round(settings.graphics.uiScale * 100)}%</b><input
            type="range"
            min="0.8"
            max="1.5"
            step="0.05"
            bind:value={settings.graphics.uiScale}
            onchange={change}
          /></label
        >
        <label class="row"
          ><input
            type="checkbox"
            bind:checked={settings.graphics.fullscreen}
            onchange={() => {
              bridge.setFullscreen(settings.graphics.fullscreen);
              change();
            }}
          />
          {t('settings.fullscreen')}</label
        >
        <label class="row"
          ><input type="checkbox" bind:checked={settings.graphics.autoPerformance} onchange={change} />
          {t('settings.autoPerf')}</label
        >
      </div>
    {:else if tab === 'audio'}
      <div class="form">
        {#each ['master', 'music', 'sfx', 'ui', 'voice'] as k (k)}
          <label
            >{t(`settings.vol.${k}`)}
            <b class="mono">{Math.round(settings.audio[k as 'master'] * 100)}%</b><input
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={settings.audio[k as 'master']}
              onchange={change}
            /></label
          >
        {/each}
        <label class="row"
          ><input type="checkbox" bind:checked={settings.audio.voiceOn} onchange={change} />
          {t('settings.voiceOn')}</label
        >
        <label class="row"
          ><input type="checkbox" bind:checked={settings.audio.muteUnfocused} onchange={change} />
          {t('settings.muteUnfocused')}</label
        >
        <button
          class="btn"
          onclick={() => {
            audio.ensure();
            audio.sfx('alliance');
          }}>{t('settings.testSound')}</button
        >
      </div>
    {:else if tab === 'game'}
      <div class="form">
        <label class="row"
          ><input type="checkbox" bind:checked={settings.game.confirmations} onchange={change} />
          {t('settings.confirmations')}</label
        >
        <label class="row"
          ><input type="checkbox" bind:checked={settings.game.simpleMode} onchange={change} />
          {t('settings.simpleMode')}</label
        >
        <label
          >{t('settings.fontSize')} <b class="mono">{Math.round(settings.game.fontSize * 100)}%</b><input
            type="range"
            min="0.85"
            max="1.4"
            step="0.05"
            bind:value={settings.game.fontSize}
            onchange={change}
          /></label
        >
        <label
          >{t('settings.wheel')}
          <select bind:value={settings.game.wheel} onchange={change}>
            <option value="zoom">{t('settings.wheel.zoom')}</option>
            <option value="trackpad">{t('settings.wheel.trackpad')}</option>
          </select>
        </label>
        <label class="row"
          ><input type="checkbox" bind:checked={settings.game.checkUpdates} onchange={change} />
          {t('settings.checkUpdates')}</label
        >
        {#if settings.game.checkUpdates}
          <label
            >{t('settings.updateUrl')}
            <input
              type="url"
              placeholder="https://…/isoline-latest.json"
              bind:value={settings.game.updateUrl}
              onchange={change}
            /></label
          >
        {/if}
        <label
          >{t('settings.playerName')}
          <input type="text" bind:value={settings.playerName} maxlength="24" onchange={change} /></label
        >
      </div>
    {:else if tab === 'controls'}
      <table>
        <tbody>
          {#each Object.keys(DEFAULT_KEYS) as k (k)}
            <tr>
              <td>{t(`keys.${k}`)}</td>
              <td
                ><button class="key" class:listen={listening === k} onclick={() => (listening = k)}
                  >{listening === k ? t('settings.pressKey') : keyLabel(settings.keys[k] ?? '')}</button
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
      <button
        class="btn"
        onclick={() => {
          settings.keys = { ...DEFAULT_KEYS };
          saveSettings();
        }}>{t('settings.resetKeys')}</button
      >
    {:else if tab === 'access'}
      <div class="form">
        <label
          >{t('settings.vision')}
          <select bind:value={settings.access.vision} onchange={change} data-testid="opt-vision">
            <option value="none">{t('settings.vision.none')}</option>
            <option value="protanopia">{t('settings.vision.protanopia')}</option>
            <option value="deuteranopia">{t('settings.vision.deuteranopia')}</option>
            <option value="tritanopia">{t('settings.vision.tritanopia')}</option>
          </select>
        </label>
        <label class="row"
          ><input type="checkbox" bind:checked={settings.access.highContrast} onchange={change} />
          {t('settings.highContrast')}</label
        >
        <label class="row"
          ><input type="checkbox" bind:checked={settings.access.reducedMotion} onchange={change} />
          {t('settings.reducedMotion')}</label
        >
        <label class="row"
          ><input type="checkbox" bind:checked={settings.access.subtitles} onchange={change} />
          {t('settings.subtitles')}</label
        >
        <p class="muted">{t('settings.accessNote')}</p>
      </div>
    {:else}
      <div class="form">
        <label
          >{t('settings.language')}
          <select bind:value={settings.lang} onchange={change} data-testid="opt-lang">
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    {/if}
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: 220px 1fr;
    min-height: 100%;
  }
  nav {
    display: grid;
    align-content: start;
    gap: 2px;
    padding: 10px;
    border-right: 1px solid var(--line);
    background: var(--panel-2);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    text-align: left;
  }
  .tab:hover {
    color: var(--parchment);
    background: var(--panel-3);
  }
  .tab.on {
    color: var(--parchment);
    background: var(--panel-3);
    box-shadow: inset 3px 0 0 var(--brass);
  }
  .content {
    padding: 18px 24px;
    display: grid;
    align-content: start;
    gap: 14px;
  }
  .content h2 {
    font-size: 1.25em;
  }
  .form {
    display: grid;
    gap: 14px;
    max-width: 560px;
  }
  .form label {
    display: grid;
    gap: 5px;
    color: var(--muted);
  }
  .form label.row {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--parchment);
  }
  .form b {
    color: var(--parchment);
    float: right;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    max-width: 680px;
  }
  td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
  }
  .key {
    min-width: 7em;
    font-family: var(--mono);
    background: var(--panel-2);
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    cursor: pointer;
    color: var(--parchment);
  }
  .key.listen {
    border-color: var(--brass);
    color: var(--brass);
  }
  .muted {
    color: var(--faint);
    font-size: 0.85em;
  }
</style>
