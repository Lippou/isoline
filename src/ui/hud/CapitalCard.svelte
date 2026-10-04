<script lang="ts">
  // Our capital fell: a dispatch in the news column. While the country has no seat of
  // government it asks the player to choose one — on the map (a tool: click one of
  // your tiles) or at once on the safest spot (largest inland city, or the heart of the
  // country). The minute of disorganisation drains away on a printed bar.
  import { hud } from '../stores/game.svelte';
  import { note } from '../stores/note.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { GameController } from '../game/controller';
  import { CAPITAL_DISORG_TICKS } from '../../core/game/constants';
  import { audio } from '../../audio/audio';
  import { layout, zonePiece } from '../stores/layout.svelte';

  let { ctl }: { ctl: GameController } = $props();

  const L = $derived(hud.local);
  const show = $derived(
    !!L &&
      L.alive &&
      hud.phase === 'playing' &&
      !hud.spectating &&
      hud.replay === null &&
      (L.capital < 0 || L.disorgFor > 0),
  );
  const lost = $derived(!!L && L.capital < 0);
  const picking = $derived(hud.tool.k === 'capital');
  /** Short of room (zones.ts): the kicker and the actions only. */
  const compact = $derived(layout.levelOf('capital') !== 'full');

  function pick(): void {
    if (picking) {
      hud.tool = { k: 'none' };
      return;
    }
    hud.tool = { k: 'capital' };
    audio.ui('open');
    note(t('capital.toolHint'), 'info');
  }

  function safest(): void {
    const tile = L?.capitalHint ?? -1;
    if (tile < 0) return;
    ctl.session.cmd({ t: 'moveCapital', tile });
    audio.ui('confirm');
    const w = ctl.session.state.width;
    ctl.renderer.camera.goTo(
      (tile % w) + 0.5,
      ((tile / w) | 0) + 0.5,
      Math.max(ctl.renderer.camera.zoom, 2.5),
    );
  }
</script>

{#if show && L}
  <section
    class="dispatch newsprint rise-in"
    class:compact
    data-testid="capital-card"
    aria-live="polite"
    use:zonePiece={{ id: 'capital', level: compact ? 'compact' : 'full' }}
  >
    <header class="kicker" class:calm={!lost}>
      <span
        ><Icon name="capital" size={13} stroke={2.4} />{lost
          ? t('capital.kickerLost')
          : t('capital.kickerDisorg')}</span
      >
      {#if L.disorgFor > 0}<time data-tip={t('capital.leftTip')}>{clock(L.disorgFor)}</time>{/if}
    </header>
    {#if !compact}<h3>{lost ? t('capital.titleLost') : t('capital.titleMoved')}</h3>{/if}
    {#if !compact && lost && (L.capitalLostBy > 0 || L.disorgFor > 0)}
      <p class="by">
        {L.capitalLostBy > 0
          ? t('capital.takenBy', { by: ctl.session.state.name(L.capitalLostBy, i18n.lang) })
          : t('capital.razed')}
      </p>
    {/if}
    {#if L.disorgFor > 0 && !compact}
      <p class="fx"><Icon name="crisis" size={14} />{t('capital.disorg')}</p>
      <span class="bar" aria-hidden="true"
        ><i style="width:{(L.disorgFor / CAPITAL_DISORG_TICKS) * 100}%"></i></span
      >
    {/if}
    {#if lost}
      {#if !compact}
        <p class="fx dim"><Icon name="gold" size={14} />{t('capital.none')}</p>
        <p class="how">{t('capital.how')}</p>
      {/if}
      <div class="acts">
        <button class="act ink" class:on={picking} onclick={pick} data-testid="capital-pick"
          ><Icon name={picking ? 'close' : 'target'} size={14} />{picking
            ? t('common.cancel')
            : t('capital.pick')}</button
        >
        <button
          class="act"
          onclick={safest}
          disabled={L.capitalHint < 0}
          data-tip={t('capital.safestTip')}
          data-testid="capital-safest"><Icon name="capital" size={14} />{t('capital.safest')}</button
        >
      </div>
    {/if}
  </section>
{/if}

<style>
  .dispatch {
    width: 100%;
    padding: 0 14px 11px;
    border-radius: 1px;
    font-family: var(--np-serif);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 10px 24px rgba(3, 10, 16, 0.5);
  }
  /* The magenta band of a breaking story; navy once a new capital is set. */
  .kicker {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 0 -14px;
    padding: 5px 14px 4px;
    background: var(--np-spot);
    font-family: var(--text);
    font-size: 0.78em;
    font-weight: 600;
    color: #fff7f9;
  }
  .kicker.calm {
    background: var(--np-ink);
  }
  .kicker span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .kicker time {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  h3 {
    margin: 8px 0 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.32em;
    line-height: 1.06;
    letter-spacing: -0.012em;
    color: var(--np-ink);
    text-wrap: balance;
  }
  .by {
    margin: 3px 0 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.92em;
    color: var(--np-ink-2);
  }
  .fx {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 7px 0 0;
    font-family: var(--text);
    font-size: 0.82em;
    font-weight: 600;
    color: var(--np-ink);
  }
  .fx :global(svg) {
    flex: none;
    color: var(--np-spot);
  }
  .fx.dim {
    font-weight: 500;
    color: var(--np-ink-2);
  }
  .fx.dim :global(svg) {
    color: var(--np-warn);
  }
  /* Time left: a printed bar that drains. */
  .bar {
    display: block;
    height: 4px;
    margin-top: 5px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--np-spot);
    transition: width 0.5s linear;
  }
  .how {
    margin: 7px 0 0;
    padding-top: 6px;
    border-top: 1px solid var(--np-rule);
    font-size: 0.78em;
    line-height: 1.45;
    color: var(--np-ink-2);
  }
  .acts {
    display: flex;
    gap: 8px;
    margin-top: 9px;
  }
  /* Printed buttons: navy ink on paper. */
  .act {
    appearance: none;
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1.5px solid var(--np-ink);
    border-radius: 2px;
    background: transparent;
    color: var(--np-ink);
    font-family: var(--text);
    font-size: 0.82em;
    font-weight: 600;
    cursor: var(--cursor-pointer, pointer);
  }
  .act:hover:not(:disabled) {
    background: var(--np-paper-2);
  }
  .act.ink {
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .act.ink:hover {
    background: #22405a;
  }
  .act.ink.on {
    background: var(--np-spot);
    border-color: var(--np-spot);
  }
  .act:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
