<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { hud, openPaper, toast } from '../stores/game.svelte';
  import { t, clock, i18n, short } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { flagUrl } from '../../render/flags';
  import { audio } from '../../audio/audio';
  let { ctl }: { ctl: GameController } = $props();
  const rp = ctl.session.replay!;
  const speeds = [0.5, 1, 2, 4, 8];
  let seeking = $state(false);
  let viewer = $state(-1);

  // « Reprendre d'ici »: the countries that can be played from this moment, largest first.
  const playable = $derived(
    hud.players.filter((p) => p.kind !== 'tribe' && p.alive && p.spawned).sort((a, b) => b.tiles - a.tiles),
  );
  let pick = $state(-1);
  let starting = $state(false);
  const canTakeOver = $derived(hud.phase === 'playing' && !seeking);
  function openTakeover(): void {
    audio.ui('click');
    rp.setPaused(true);
    hud.paused = true;
    hud.takeover = !hud.takeover;
  }
  // The recorded player by default (or the view followed), else the largest country.
  $effect(() => {
    if (!hud.takeover || playable.some((p) => p.id === pick)) return;
    const pref = [viewer, rp.file.viewer].find((id) => playable.some((p) => p.id === id));
    pick = pref ?? playable[0]?.id ?? -1;
  });
  async function takeOver(): Promise<void> {
    if (pick < 0 || starting) return;
    starting = true;
    const ok = await ctl.takeOver(pick);
    starting = false;
    if (!ok) toast(t('takeover.failed'), 'warn');
  }

  async function seek(target: number): Promise<void> {
    hud.replaySeek = -1;
    if (target >= rp.tick) {
      rp.seekForward(target);
      return;
    }
    // Backwards: restart the simulation from the beginning and fast-forward.
    seeking = true;
    await ctl.restartReplayAt(target);
    seeking = false;
  }
  function setViewer(id: number): void {
    viewer = id;
    ctl.session.sim.setViewer(id, ctl.session.config.features.fog && id > 0);
    ctl.session.viewer = id;
    ctl.session.state.viewer = id;
    hud.viewer = id;
  }
</script>

<div class="rb glass" data-testid="replay-bar">
  <button
    class="btn"
    onclick={() => {
      rp.setPaused(!rp.paused);
      hud.paused = rp.paused;
    }}><Icon name={hud.paused ? 'play' : 'pause'} size={16} /></button
  >
  <span class="mono at">{clock(hud.replay?.tick ?? 0)}<small> / {clock(hud.replay?.end ?? 0)}</small></span>
  <input
    type="range"
    min={rp.startTick}
    max={hud.replay?.end ?? 1}
    value={hud.replay?.tick ?? 0}
    onchange={(e) => seek(Number((e.target as HTMLInputElement).value))}
    disabled={seeking}
  />
  <div class="speeds">
    {#each speeds as s (s)}
      <button
        class="chip"
        class:on={(hud.replay?.speed ?? rp.speed) === s}
        aria-pressed={(hud.replay?.speed ?? rp.speed) === s}
        onclick={() => {
          rp.setSpeed(s);
          // (The replay source is not reactive: the bar follows the store.)
          if (hud.replay) hud.replay.speed = rp.speed;
        }}>×{s}</button
      >
    {/each}
  </div>
  <select
    value={viewer}
    onchange={(e) => setViewer(Number((e.target as HTMLSelectElement).value))}
    title={t('replay.viewpoint')}
  >
    <option value={-1}>{t('replay.freeCamera')}</option>
    {#each hud.players.filter((p) => p.kind !== 'tribe') as p (p.id)}
      <option value={p.id}>{p.name[i18n.lang] || p.name.en}</option>
    {/each}
  </select>
  <button
    class="btn takeover-btn"
    class:on={hud.takeover}
    disabled={!canTakeOver}
    onclick={openTakeover}
    aria-expanded={hud.takeover}
    data-tip={canTakeOver ? t('takeover.tip') : t('takeover.notNow')}
    data-testid="replay-takeover"
    ><Icon name="takeover" size={16} /><span class="lbl">{t('takeover.button')}</span></button
  >
  {#if ctl.edition}
    <button
      class="btn"
      onclick={() => openPaper('front')}
      aria-label={t('front.open')}
      data-tip={t('front.open')}
      data-testid="replay-paper"><Icon name="news" size={16} /></button
    >
  {/if}
  {#if seeking}<span class="chip">{t('replay.seeking')}</span>
  {:else if hud.replaySeek > (hud.replay?.tick ?? 0)}<span class="chip" role="status"
      >{t('front.seeking', {
        clock: clock(hud.replaySeek - (ctl.edition?.startTick ?? hud.world?.startTick ?? 0)),
      })}</span
    >{/if}
  {#if hud.takeover}
    <div class="pop newsprint" role="dialog" aria-labelledby="tk-title" data-testid="takeover-pop">
      <h3 id="tk-title">
        <Icon name="takeover" size={16} />{t('takeover.title', {
          clock: clock(hud.replay?.tick ?? 0),
        })}
      </h3>
      <p class="hint">{t('takeover.hint')}</p>
      <ul class="who scroll" role="radiogroup" aria-label={t('takeover.choose')}>
        {#each playable as p (p.id)}
          <li>
            <button
              role="radio"
              aria-checked={pick === p.id}
              class:on={pick === p.id}
              onclick={() => (pick = p.id)}
              ondblclick={takeOver}
              ><img src={flagUrl(p, 32)} alt="" /><span class="pn">{p.name[i18n.lang] || p.name.en}</span>
              {#if p.id === rp.file.viewer}<small class="chip">{t('takeover.recorded')}</small>{/if}
              <span class="num mono"><Icon name="territory" size={12} />{short(p.tiles)}</span></button
            >
          </li>
        {/each}
      </ul>
      <div class="acts">
        <button class="btn ghost" onclick={() => (hud.takeover = false)}>{t('common.cancel')}</button>
        <button
          class="btn primary"
          disabled={pick < 0 || starting || !canTakeOver}
          onclick={takeOver}
          data-testid="takeover-go"><Icon name="play" size={14} />{t('takeover.go')}</button
        >
      </div>
    </div>
  {/if}
</div>

<style>
  /* The replay's bar: a strip of paper at the foot of the map. */
  .rb {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    width: min(860px, 80vw);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.8rem;
    border-top: 3px solid var(--np-ink);
    z-index: 20;
  }
  .rb > .btn {
    padding: 0.4em 0.6em;
  }
  .at {
    font-weight: 600;
    white-space: nowrap;
    color: var(--np-ink);
  }
  .at small {
    margin-left: 0.25em;
    font-size: 1em;
    font-weight: 400;
    color: var(--np-ink-2);
  }
  input[type='range'] {
    flex: 1;
  }
  .speeds {
    display: flex;
    gap: 0.2rem;
  }
  .chip {
    background: none;
    cursor: var(--cursor-pointer, pointer);
  }
  .chip:hover {
    border-color: var(--np-ink);
    color: var(--np-ink);
  }
  /* The speed in use: reversed. */
  .chip.on {
    background: var(--np-ink);
    border-color: var(--np-ink);
    color: var(--np-paper);
  }
  select {
    padding: 0.35em 0.5em;
  }
  .takeover-btn {
    white-space: nowrap;
  }
  .takeover-btn.on {
    background: var(--np-ink);
    border-color: var(--np-ink);
    color: var(--np-paper);
  }
  @media (max-width: 1180px) {
    .lbl {
      display: none;
    }
  }
  /* The chooser opens above the bar, on its right (where the button is): a card of paper. */
  .pop {
    position: absolute;
    right: 0;
    bottom: calc(100% + 8px);
    width: min(360px, 90vw);
    padding: 10px 12px 12px;
    display: grid;
    gap: 8px;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-ink);
    border-radius: 1px;
    box-shadow: var(--np-lift);
  }
  .pop h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.1em;
    color: var(--np-ink);
  }
  .hint {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.84em;
    color: var(--np-ink-2);
    line-height: 1.4;
  }
  .who {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0;
    max-height: min(300px, 40vh);
    overflow-y: auto;
    overflow-x: hidden;
    border-top: 1px solid var(--np-rule);
  }
  .who button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 0;
    border-bottom: 1px solid var(--np-rule);
    border-radius: 0;
    background: transparent;
    color: var(--np-ink);
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
  }
  .who button:hover {
    background: var(--np-card);
  }
  .who button.on {
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .who button.on .num,
  .who button.on .chip {
    color: color-mix(in srgb, var(--np-paper) 85%, transparent);
  }
  .who button.on .chip {
    background: transparent;
    border-color: color-mix(in srgb, var(--np-paper) 45%, transparent);
  }
  .who img {
    width: 24px;
    height: 16px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
  }
  .pn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 600;
  }
  .num {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--np-ink-2);
    font-size: 0.86em;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
