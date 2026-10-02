<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { hud, openPaper } from '../stores/game.svelte';
  import { t, clock, i18n } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  let { ctl }: { ctl: GameController } = $props();
  const rp = ctl.session.replay!;
  const speeds = [0.5, 1, 2, 4, 8];
  let seeking = $state(false);
  let viewer = $state(-1);

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
  <span class="mono">{clock(hud.replay?.tick ?? 0)} / {clock(hud.replay?.end ?? 0)}</span>
  <input
    type="range"
    min="0"
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
</div>

<style>
  .rb {
    position: absolute;
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    width: min(860px, 80vw);
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.8rem;
    z-index: 20;
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
  .chip.on {
    color: var(--aurora);
    border-color: var(--aurora);
  }
</style>
