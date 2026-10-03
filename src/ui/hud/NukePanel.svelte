<script lang="ts">
  // Missile launch panel (shown while aiming): salvo size, arc direction (flip with U to
  // fly around SAMs), and what the preview predicts for the hovered target.
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import Icon from '../icons/Icon.svelte';
  import { N } from '../../core/game/constants';
  import type { GameController } from '../game/controller';
  import { lockFor, nukeUnlock, techKey } from '../../core/rules/tech';

  let { ctl }: { ctl: GameController } = $props();
  const NAMES = ['nukeA', 'nukeH', 'nukeMirv'];
  const tool = $derived(hud.tool.k === 'nuke' ? hud.tool : null);
  const max = $derived(tool ? (hud.local?.maxLaunch[tool.kind] ?? 0) : 0);
  const cost = $derived(tool ? (hud.local?.nukeCosts[tool.kind] ?? 0) : 0);
  const counts = $derived(tool?.kind === N.Mirv ? [] : [1, 2, 5]);
  const banned = $derived((hud.world?.nukeBanUntil ?? 0) > hud.tick);
  const broke = $derived((hud.local?.gold ?? 0) < cost);
  const name = (id: number) => ctl.session.state.name(id, i18n.lang);
  /** Tech tree: the technology this bomb still needs (-1: researched, or no tech tree). */
  const lock = $derived(
    tool && hud.local && ctl.session.config.features.tech
      ? lockFor(hud.local.tech, nukeUnlock(tool.kind))
      : -1,
  );

  function setCount(n: number): void {
    if (hud.tool.k === 'nuke') hud.tool = { ...hud.tool, count: Math.max(1, n) };
  }
  function setArc(up: boolean): void {
    if (hud.nukeArcUp !== up) ctl.flipArc();
  }
</script>

{#if tool}
  <section class="launch panel rise-in" data-testid="launch-panel" aria-label={t('launch.title')}>
    <header>
      <span class="ico"><Icon name="nuke" size={18} /></span>
      <b>{t(`nuke.${NAMES[tool.kind]}.name`)}</b>
      <span class="cost mono">{short(cost * tool.count)}</span>
      <span class="avail">{t('launch.available', { n: max })}</span>
    </header>

    {#if counts.length}
      <div class="row">
        <span class="lbl">{t('launch.count')}</span>
        <div class="seg">
          {#each counts as c (c)}
            <button
              class="btn small"
              class:selected={tool.count === c}
              disabled={c > max}
              onclick={() => setCount(c)}>×{c}</button
            >
          {/each}
          <button
            class="btn small"
            class:selected={max > 5 && tool.count === max}
            disabled={max <= 5}
            onclick={() => setCount(max)}>{t('launch.max')}</button
          >
        </div>
      </div>
      <div class="row">
        <span class="lbl">{t('launch.arc')}</span>
        <div class="seg">
          <button
            class="btn small"
            class:selected={hud.nukeArcUp}
            data-testid="arc-up"
            onclick={() => setArc(true)}><Icon name="arcUp" size={15} />{t('launch.arcUp')}</button
          >
          <button
            class="btn small"
            class:selected={!hud.nukeArcUp}
            data-testid="arc-down"
            onclick={() => setArc(false)}><Icon name="arcDown" size={15} />{t('launch.arcDown')}</button
          >
          <button class="btn small ghost" data-tip={t('launch.flipTip')} onclick={() => ctl.flipArc()}
            ><Icon name="flip" size={15} /><kbd>{keyLabel(settings.keys.flipArc ?? '')}</kbd></button
          >
        </div>
      </div>
    {:else}
      <p class="note">{t('launch.mirvNote')}</p>
    {/if}

    <div class="verdict" aria-live="polite">
      {#if lock >= 0}
        <span class="chip bad" data-testid="launch-locked"
          ><Icon name="lock" size={13} />{t('launch.locked', { tech: t(`${techKey(lock)}.name`) })}</span
        >
      {:else if !hud.launch}
        <span class="chip">{t('launch.aim')}</span>
      {:else if hud.launch.teammate}
        <span class="chip bad"><Icon name="close" size={13} />{t('launch.teammate')}</span>
      {:else if banned}
        <span class="chip bad"><Icon name="nuke" size={13} />{t('launch.banned')}</span>
      {:else if hud.launch.silo === 'none'}
        <span class="chip bad"><Icon name="silo" size={13} />{t('launch.noSilo')}</span>
      {:else}
        {#if hud.launch.silo === 'reloading'}
          <span class="chip warn"><Icon name="silo" size={13} />{t('launch.reloading')}</span>
        {:else if broke}
          <span class="chip warn"><Icon name="gold" size={13} />{t('launch.gold')}</span>
        {/if}
        {#if tool.kind === N.Mirv}
          <span class="chip good"><Icon name="check" size={13} />{t('launch.mirvClear')}</span>
        {:else if hud.launch.intercepted}
          <span class="chip bad" data-testid="launch-intercepted"
            ><Icon name="sam" size={13} />{t('launch.intercepted', {
              key: keyLabel(settings.keys.flipArc ?? ''),
            })}</span
          >
        {:else}
          <span class="chip good" data-testid="launch-clear"
            ><Icon name="check" size={13} />{t('launch.clear')}</span
          >
        {/if}
        {#if hud.launch.betrays.length}
          <span class="chip warn"
            ><Icon name="brokenShield" size={13} />{t('launch.betray', {
              list: hud.launch.betrays.map(name).join(', '),
            })}</span
          >
        {/if}
      {/if}
    </div>

    <footer>
      <span class="key"><i class="dot own"></i>{t('launch.legendOwn')}</span>
      <span class="key"><i class="dot friend"></i>{t('launch.legendAlly')}</span>
      <span class="key"><i class="dot foe"></i>{t('launch.legendEnemy')}</span>
      <span class="key dots">{t('launch.legendDots')}</span>
      <span class="help">{t('launch.hint')}</span>
    </footer>
  </section>
{/if}

<style>
  /* Right edge, between the leaderboard and the minimap: never over the target. */
  .launch {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    transform-origin: right center;
    z-index: 7;
    width: min(410px, calc(100vw - 32px));
    padding: 10px 12px 9px;
    display: grid;
    gap: 7px;
    border-color: rgba(210, 84, 75, 0.55);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .ico {
    color: var(--signal);
    display: inline-flex;
  }
  .cost {
    color: var(--brass);
  }
  .avail {
    margin-left: auto;
    font-size: 0.82em;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .lbl {
    width: 82px;
    font-size: 0.82em;
    color: var(--faint);
  }
  .seg {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.85em;
    padding: 0 0.3em;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
  }
  .note {
    margin: 0;
    font-size: 0.85em;
    color: var(--muted);
  }
  .verdict {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.9rem;
    font-size: 0.74em;
    color: var(--muted);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px dashed currentColor;
  }
  .own {
    color: #4ade80;
  }
  .friend {
    color: #facc15;
  }
  .foe {
    color: #ef4444;
  }
  .help {
    margin-left: auto;
    color: var(--faint);
  }
</style>
