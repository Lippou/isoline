<script lang="ts">
  // Missile launch panel (shown while aiming): salvo size, arc direction (flip with U to
  // fly around SAMs), and what the preview predicts for the hovered target.
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import Icon from '../icons/Icon.svelte';
  import { N } from '../../core/game/constants';
  import type { GameController } from '../game/controller';
  import { lockFor, nukeUnlock, techKey } from '../../core/rules/tech';
  import { zonePiece } from '../stores/layout.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const NAMES = ['nukeA', 'nukeH', 'nukeMirv'];
  const tool = $derived(hud.tool.k === 'nuke' ? hud.tool : null);
  const max = $derived(tool ? (hud.local?.maxLaunch[tool.kind] ?? 0) : 0);
  const cost = $derived(tool ? (hud.local?.nukeCosts[tool.kind] ?? 0) : 0);
  const counts = $derived(tool?.kind === N.Mirv ? [] : [1, 2, 5]);
  const banLeft = $derived(Math.max(0, (hud.world?.nukeBanUntil ?? 0) - hud.tick));
  const banned = $derived(banLeft > 0);
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
  <section
    class="launch newsprint rise-in"
    class:banned
    data-testid="launch-panel"
    aria-label={t('launch.title')}
    use:zonePiece={{ id: 'launch' }}
  >
    {#if banned}
      <p class="ban" data-testid="launch-ban" data-tip={t('ban.tip', { clock: clock(banLeft) })}>
        <Icon name="embargo" size={14} />{t('ban.kicker')}<span class="mono"
          >{t('ban.left', { clock: clock(banLeft) })}</span
        >
      </p>
    {/if}
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
            ><Icon name="flip" size={15} /><kbd class="np-kbd">{keyLabel(settings.keys.flipArc ?? '')}</kbd
            ></button
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
  /* Top of the right column (GameScreen.svelte), under the leaderboard: never over the target. */
  .launch {
    width: 100%;
    padding: 8px 12px 9px;
    display: grid;
    gap: 7px;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-spot);
    border-radius: 1px;
    box-shadow: var(--np-lift);
    font-family: var(--text);
  }
  /* Nuclear ban (World Council): a magenta band across the head of the panel. */
  .ban {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -8px -12px 0;
    padding: 5px 12px 4px;
    background: var(--np-spot);
    font-size: 0.82em;
    font-weight: 600;
    color: #fff7f9;
  }
  .ban .mono {
    margin-left: auto;
  }
  .ban[data-tip]:hover::after {
    top: calc(100% + 6px);
    bottom: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  header b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.12em;
    color: var(--np-ink);
  }
  .ico {
    color: var(--np-spot);
    display: inline-flex;
  }
  .cost {
    font-weight: 600;
    color: var(--np-brass);
  }
  .banned .cost {
    color: var(--np-ink-3);
    text-decoration: line-through;
  }
  .avail {
    margin-left: auto;
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .lbl {
    width: 82px;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
    color: var(--np-ink-2);
  }
  .seg {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .note {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.84em;
    color: var(--np-ink-2);
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
    padding-top: 6px;
    border-top: 1px solid var(--np-rule);
    font-size: 0.74em;
    color: var(--np-ink-2);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
  }
  /* The map's own marks for the blast preview (render/overlay). */
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 2px dashed currentColor;
  }
  .own {
    color: #2f9e5b;
  }
  .friend {
    color: #c99a06;
  }
  .foe {
    color: #d6343a;
  }
  .help {
    margin-left: auto;
    font-style: italic;
    color: var(--np-ink-3);
  }
</style>
