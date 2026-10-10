<script lang="ts">
  // Settings, shared by the Settings page (chart paper) and the in-game menu (ink): colours
  // come from the theme tokens only, and the layout folds its tabs on top when narrow.
  import { settings, saveSettings, keyLabel, DEFAULT_KEYS } from '../stores/settings.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { bridge } from '../bridge';
  import { audio } from '../../audio/audio';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';
  import { rangeFill } from '../components/rangeFill';
  import { isDesktop, type UpdateStatus } from '../bridge';
  import { app } from '../stores/app.svelte';
  import { update, checkUpdate, saveUpdateToken, clearUpdateToken } from '../stores/update.svelte';
  import { view } from '../stores/viewport.svelte';
  import { MANUAL_MIN, MANUAL_MAX } from '../stores/uiScale';
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
  let token = $state('');

  /** One line on the update state: up to date, new version, progress or what went wrong. */
  function updateLine(u: UpdateStatus): string {
    if (u.state === 'checking') return t('update.checking');
    if (u.state === 'none') return t('update.upToDate');
    if (u.state === 'available' || u.state === 'ready')
      return t('title.updateAvailable', { version: u.version ?? '' });
    if (u.state === 'downloading')
      return t('update.downloading', { pct: Math.round((u.progress ?? 0) * 100) });
    if (u.state === 'error')
      return t(`update.err.${u.error ?? 'network'}`) + (u.detail ? ` (${u.detail})` : '');
    return '';
  }

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

  // Interface scale: automatic (0, from the window's size) or the player's. The page zoom
  // follows on release only, so the slider does not move under the pointer while dragged.
  let uiDraft = $state<number | null>(null);
  const uiAuto = $derived(!(settings.graphics.uiScale > 0));
  function setUiAuto(on: boolean): void {
    settings.graphics.uiScale = on ? 0 : Math.round(view.scale * 20) / 20;
    change();
  }
</script>

<svelte:window onkeydowncapture={capture} />

<div class="settings" data-testid="settings">
  <div class="layout">
    <nav aria-label={t('title.settings')}>
      {#each tabs as tb (tb)}
        <button
          class="tab"
          class:on={tab === tb}
          aria-pressed={tab === tb}
          onclick={() => (tab = tb)}
          data-testid="settings-tab-{tb}"
        >
          <span class="key"><Icon name={TAB_ICONS[tb] ?? 'settings'} size={16} /></span>
          <span class="tt"><b>{t(`settings.tab.${tb}`)}</b><small>{t(`settings.tabDesc.${tb}`)}</small></span>
        </button>
      {/each}
    </nav>
    <div class="content">
      {#key tab}
        <div class="pane">
          <header>
            <h2>{t(`settings.tab.${tab}`)}</h2>
            <p>{t(`settings.tabDesc.${tab}`)}</p>
          </header>

          {#if tab === 'graphics'}
            <div class="rows">
              <div class="srow">
                <div class="sl">
                  <label for="set-quality">{t('settings.quality')}</label><small
                    >{t('settings.d.quality')}</small
                  >
                </div>
                <select id="set-quality" bind:value={settings.graphics.quality} onchange={change}>
                  <option value="high">{t('settings.q.high')}</option>
                  <option value="balanced">{t('settings.q.balanced')}</option>
                  <option value="performance">{t('settings.q.performance')}</option>
                </select>
              </div>
              <div class="srow">
                <div class="sl">
                  <label for="set-particles">{t('settings.particles')}</label><small
                    >{t('settings.d.particles')}</small
                  >
                </div>
                <div class="rng">
                  <b class="mono">{Math.round(settings.graphics.particles * 100)} %</b><input
                    id="set-particles"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    bind:value={settings.graphics.particles}
                    onchange={change}
                    use:rangeFill={settings.graphics.particles}
                  />
                </div>
              </div>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.shaders')}</span><small>{t('settings.d.shaders')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.graphics.shaders}
                  onchange={change}
                />
              </label>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.vsync')}</span><small>{t('settings.d.vsync')}</small></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.graphics.vsync}
                  onchange={() => {
                    if (settings.graphics.vsync) settings.graphics.maxFps = 0;
                    change();
                  }}
                />
              </label>
              <div class="srow">
                <div class="sl">
                  <label for="set-fps">{t('settings.maxFps')}</label><small>{t('settings.d.maxFps')}</small>
                </div>
                <div class="rng">
                  <b class="mono">{settings.graphics.maxFps || '∞'}</b><input
                    id="set-fps"
                    type="range"
                    min="0"
                    max="240"
                    step="30"
                    bind:value={settings.graphics.maxFps}
                    onchange={() => {
                      settings.graphics.vsync = settings.graphics.maxFps === 0;
                      change();
                    }}
                    use:rangeFill={settings.graphics.maxFps}
                  />
                </div>
              </div>
              <div class="srow">
                <div class="sl">
                  <label for="set-ui">{t('settings.uiScale')}</label><small>{t('settings.d.uiScale')}</small>
                </div>
                <div class="rng ui">
                  <button
                    class="btn small auto"
                    class:selected={uiAuto}
                    aria-pressed={uiAuto}
                    data-tip={t('settings.uiScaleAutoTip', { pct: Math.round(view.auto * 100) })}
                    data-testid="ui-scale-auto"
                    onclick={() => setUiAuto(!uiAuto)}>{t('settings.uiScaleAuto')}</button
                  >
                  <b class="mono" data-testid="ui-scale-value"
                    >{Math.round((uiDraft ?? view.scale) * 100)} %</b
                  ><input
                    id="set-ui"
                    type="range"
                    min={MANUAL_MIN}
                    max={MANUAL_MAX}
                    step="0.05"
                    value={uiDraft ?? (uiAuto ? view.auto : settings.graphics.uiScale)}
                    oninput={(e) => (uiDraft = Number(e.currentTarget.value))}
                    onchange={(e) => {
                      settings.graphics.uiScale = Number(e.currentTarget.value);
                      uiDraft = null;
                      change();
                    }}
                    use:rangeFill={uiDraft ?? (uiAuto ? view.auto : settings.graphics.uiScale)}
                  />
                </div>
              </div>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.fullscreen')}</span><small
                    >{t('settings.d.fullscreen')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.graphics.fullscreen}
                  onchange={() => {
                    bridge.setFullscreen(settings.graphics.fullscreen);
                    change();
                  }}
                />
              </label>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.autoPerf')}</span><small>{t('settings.d.autoPerf')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.graphics.autoPerformance}
                  onchange={change}
                />
              </label>
            </div>
          {:else if tab === 'audio'}
            <div class="rows">
              {#each ['master', 'music', 'sfx', 'ui', 'voice'] as k (k)}
                <div class="srow">
                  <div class="sl"><label for="vol-{k}">{t(`settings.vol.${k}`)}</label></div>
                  <div class="rng">
                    <b class="mono">{Math.round(settings.audio[k as 'master'] * 100)} %</b><input
                      id="vol-{k}"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      bind:value={settings.audio[k as 'master']}
                      onchange={change}
                      use:rangeFill={settings.audio[k as 'master']}
                    />
                  </div>
                </div>
              {/each}
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.voiceOn')}</span><small>{t('settings.d.voiceOn')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.audio.voiceOn}
                  onchange={change}
                />
              </label>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.muteUnfocused')}</span><small
                    >{t('settings.d.muteUnfocused')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.audio.muteUnfocused}
                  onchange={change}
                />
              </label>
            </div>
            <div class="foot">
              <button
                class="btn"
                onclick={() => {
                  audio.ensure();
                  audio.sfx('alliance');
                }}><Icon name="sound" size={15} />{t('settings.testSound')}</button
              >
            </div>
          {:else if tab === 'game'}
            <div class="rows">
              <div class="srow">
                <div class="sl">
                  <label for="set-name">{t('settings.playerName')}</label><small
                    >{t('settings.d.playerName')}</small
                  >
                </div>
                <input
                  id="set-name"
                  type="text"
                  bind:value={settings.playerName}
                  maxlength="24"
                  onchange={change}
                />
              </div>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.confirmations')}</span><small
                    >{t('settings.d.confirmations')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.game.confirmations}
                  onchange={change}
                />
              </label>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.defenceZones')}</span><small
                    >{t('settings.d.defenceZones')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  data-testid="settings-defence-zones"
                  bind:checked={settings.game.defenceZones}
                  onchange={change}
                />
              </label>
              <div class="srow">
                <div class="sl">
                  <label for="set-font">{t('settings.fontSize')}</label><small
                    >{t('settings.d.fontSize')}</small
                  >
                </div>
                <div class="rng">
                  <b class="mono">{Math.round(settings.game.fontSize * 100)} %</b><input
                    id="set-font"
                    type="range"
                    min="0.85"
                    max="1.4"
                    step="0.05"
                    bind:value={settings.game.fontSize}
                    onchange={change}
                    use:rangeFill={settings.game.fontSize}
                  />
                </div>
              </div>
              <div class="srow">
                <div class="sl">
                  <label for="set-wheel">{t('settings.wheel')}</label><small>{t('settings.d.wheel')}</small>
                </div>
                <select id="set-wheel" bind:value={settings.game.wheel} onchange={change}>
                  <option value="zoom">{t('settings.wheel.zoom')}</option>
                  <option value="trackpad">{t('settings.wheel.trackpad')}</option>
                </select>
              </div>
              {#if isDesktop}
                <div class="srow updates" data-testid="settings-updates">
                  <div class="sl">
                    <span class="lb">{t('update.title')}</span>
                    <small
                      >{t('update.desc', { version: app.version })} · {t(
                        `update.access.${update.s.access}`,
                      )}</small
                    >
                    <small class="ustate" class:err={update.s.state === 'error'}>{updateLine(update.s)}</small
                    >
                  </div>
                  <div class="uact">
                    <button
                      class="btn small"
                      onclick={() => void checkUpdate()}
                      disabled={update.s.state === 'checking'}>{t('update.checkNow')}</button
                    >
                  </div>
                </div>
                <label class="srow">
                  <span class="sl"
                    ><span class="lb">{t('update.auto')}</span><small>{t('update.d.auto')}</small></span
                  >
                  <input
                    class="switch"
                    type="checkbox"
                    bind:checked={settings.game.autoUpdate}
                    onchange={change}
                  />
                </label>
                <div class="srow">
                  <div class="sl">
                    <label for="set-token">{t('update.token')}</label><small>{t('update.d.token')}</small>
                  </div>
                  <div class="uact">
                    <input
                      id="set-token"
                      type="password"
                      autocomplete="off"
                      placeholder={update.s.access === 'saved' ? '••••••••' : 'github_pat_…'}
                      bind:value={token}
                    />
                    <button
                      class="btn small"
                      disabled={!token.trim()}
                      onclick={() => void saveUpdateToken(token).then(() => (token = ''))}
                      >{t('update.save')}</button
                    >
                    {#if update.s.access === 'saved'}
                      <button class="btn small ghost" onclick={() => void clearUpdateToken()}
                        >{t('update.forget')}</button
                      >
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {:else if tab === 'controls'}
            <table>
              <tbody>
                {#each Object.keys(DEFAULT_KEYS) as k (k)}
                  <tr>
                    <td>{t(`keys.${k}`)}</td>
                    <td
                      ><button class="kbd" class:listen={listening === k} onclick={() => (listening = k)}
                        >{listening === k ? t('settings.pressKey') : keyLabel(settings.keys[k] ?? '')}</button
                      ></td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
            <div class="foot">
              <button
                class="btn"
                onclick={() => {
                  settings.keys = { ...DEFAULT_KEYS };
                  saveSettings();
                }}><Icon name="undo" size={15} />{t('settings.resetKeys')}</button
              >
            </div>
          {:else if tab === 'access'}
            <div class="rows">
              <div class="srow">
                <div class="sl">
                  <label for="set-vision">{t('settings.vision')}</label><small
                    >{t('settings.accessNote')}</small
                  >
                </div>
                <select
                  id="set-vision"
                  bind:value={settings.access.vision}
                  onchange={change}
                  data-testid="opt-vision"
                >
                  <option value="none">{t('settings.vision.none')}</option>
                  <option value="protanopia">{t('settings.vision.protanopia')}</option>
                  <option value="deuteranopia">{t('settings.vision.deuteranopia')}</option>
                  <option value="tritanopia">{t('settings.vision.tritanopia')}</option>
                </select>
              </div>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.highContrast')}</span><small
                    >{t('settings.d.highContrast')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.access.highContrast}
                  onchange={change}
                />
              </label>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.reducedMotion')}</span><small
                    >{t('settings.d.reducedMotion')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.access.reducedMotion}
                  onchange={change}
                />
              </label>
              <label class="srow">
                <span class="sl"
                  ><span class="lb">{t('settings.subtitles')}</span><small>{t('settings.d.subtitles')}</small
                  ></span
                >
                <input
                  class="switch"
                  type="checkbox"
                  bind:checked={settings.access.subtitles}
                  onchange={change}
                />
              </label>
            </div>
          {:else}
            <div class="rows">
              <div class="srow">
                <div class="sl">
                  <label for="set-lang">{t('settings.language')}</label><small
                    >{t('settings.d.language')}</small
                  >
                </div>
                <select id="set-lang" bind:value={settings.lang} onchange={change} data-testid="opt-lang">
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
          {/if}
        </div>
      {/key}
    </div>
  </div>
</div>

<style>
  .settings {
    container-type: inline-size;
    min-height: 100%;
    display: grid;
  }
  .layout {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr);
  }
  /* Sections, as a legend: pictogram, name and a line, a fine rule between; the chosen one
     marked by an ink bar in the margin. */
  nav {
    display: grid;
    align-content: start;
    padding: 14px 0 14px 16px;
    border-right: 1px solid var(--np-rule);
  }
  .tab {
    position: relative;
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 11px;
    align-items: start;
    padding: 10px 14px 10px 10px;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--np-rule);
    border-radius: 0;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    text-align: left;
    transition: background 0.14s;
  }
  .tab:last-child {
    border-bottom: 0;
  }
  .tab::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    background: var(--np-ink);
    transform: scaleY(0);
    transition: transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .tab:hover {
    background: var(--np-card);
  }
  .tab.on::before {
    transform: scaleY(1);
  }
  .key {
    display: grid;
    place-items: center;
    height: 1.35em;
    color: var(--np-ink-2);
    transition: color 0.14s;
  }
  .tab.on .key,
  .tab:hover .key {
    color: var(--np-ink);
  }
  .tt {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .tt b {
    font-weight: 500;
  }
  .tab.on .tt b {
    font-weight: 600;
  }
  .tt small {
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.8em;
    line-height: 1.35;
  }
  .content {
    padding: 20px 28px 26px;
    min-width: 0;
  }
  .pane {
    display: grid;
    gap: 6px;
    animation: pane-in 0.24s ease-out both;
  }
  @keyframes pane-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  /* The section's head: its name over an ink rule, then its line in italics. */
  .pane header {
    max-width: 760px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--np-ink);
  }
  .pane header h2 {
    font-weight: 700;
    font-size: 1.5em;
    line-height: 1.1;
    letter-spacing: -0.01em;
  }
  .pane header p {
    margin: 3px 0 0;
    font-family: var(--np-serif);
    font-style: italic;
    font-size: 0.92em;
    color: var(--np-ink-2);
  }
  .rows {
    display: grid;
    max-width: 760px;
  }
  /* One setting per row: what it is and what it does on the left, the control on the right. */
  .srow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(200px, 280px);
    gap: 8px 28px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--np-rule);
  }
  label.srow {
    grid-template-columns: minmax(0, 1fr) auto;
    cursor: var(--cursor-pointer, pointer);
  }
  .sl {
    display: grid;
    gap: 2px;
  }
  .sl label,
  .sl .lb {
    font-weight: 600;
  }
  .sl label {
    cursor: var(--cursor-pointer, pointer);
  }
  .sl small {
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.84em;
    line-height: 1.4;
  }
  .rng {
    display: grid;
    grid-template-columns: 4.2em 1fr;
    align-items: center;
    gap: 10px;
  }
  .rng b {
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
  }
  .rng.ui {
    grid-template-columns: auto 4.2em 1fr;
  }
  .srow select,
  .srow input[type='text'],
  .srow input[type='url'] {
    width: 100%;
    min-width: 0;
  }
  .foot {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    max-width: 760px;
  }
  td {
    padding: 6px 4px;
    border-bottom: 1px solid var(--np-rule);
  }
  td:last-child {
    text-align: right;
  }
  /* A key of the keyboard, printed as a figure in a fine box (the windows' np-key). */
  .kbd {
    min-width: 7.5em;
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    background: var(--np-card);
    border: 1px solid var(--np-rule-2);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 0.2rem 0.7rem;
    cursor: var(--cursor-pointer, pointer);
    color: var(--np-ink);
    transition: border-color 0.14s;
  }
  .kbd:hover {
    border-color: var(--np-ink);
  }
  .kbd.listen {
    border-color: var(--np-ink);
    font-family: var(--title);
    font-style: italic;
    font-weight: 400;
    animation: listen 1s ease-in-out infinite alternate;
  }
  @keyframes listen {
    to {
      background: var(--np-paper-2);
    }
  }

  /* Narrow (the in-game menu): sections fold into a row of words over a rule. */
  /* Touch web version (tactile.ts) on a phone: the section tabs slide sideways instead of overlapping. */
  @container (max-width: 560px) {
    :global(html.tactile) nav {
      grid-auto-columns: max-content;
      overflow-x: auto;
      scrollbar-width: none;
      gap: 4px;
    }
    :global(html.tactile) .tab {
      padding-inline: 10px;
    }
  }
  @container (max-width: 820px) {
    .layout {
      grid-template-columns: 1fr;
    }
    nav {
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      border-right: 0;
      border-bottom: 1px solid var(--np-rule);
      padding: 6px 6px 0;
    }
    .tab {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 4px;
      padding: 6px 4px 8px;
      border-bottom: 0;
      text-align: center;
    }
    .tab:hover {
      background: none;
    }
    .tt small {
      display: none;
    }
    .tab::before {
      left: 10px;
      right: 10px;
      top: auto;
      bottom: -1px;
      width: auto;
      height: 2px;
      transform: scaleX(0);
    }
    .tab.on::before {
      transform: scaleX(1);
    }
    .content {
      padding: 14px 4px;
    }
    .srow {
      grid-template-columns: 1fr;
    }
    label.srow {
      grid-template-columns: 1fr auto;
    }
  }
  .uact {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .uact input {
    width: 220px;
  }
  .ustate {
    color: var(--np-ink-2);
  }
  .ustate.err {
    color: var(--np-spot);
  }
</style>
