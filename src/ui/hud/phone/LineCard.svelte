<script lang="ts">
  // Phone only (html.phone): one of my front lines, touched on the map — a small card at the
  // foot of the screen instead of the whole Front window, so the line stays in view. Its
  // state, troops and strength; a slider for its troops; its one main order (organise the
  // defence, give the direction, launch the assault); take it down. The rules and the other
  // lines are in the Front window, one tap away.
  import { hud, openPanel } from '../../stores/game.svelte';
  import { i18n, t, short, clock } from '../../i18n/i18n.svelte';
  import Icon from '../../icons/Icon.svelte';
  import { audio } from '../../../audio/audio';
  import type { GameController } from '../../game/controller';
  import type { LineView } from '../../../engine/protocol';
  import { LINE_DEFENSE_PREP, LINE_OFFENSE_SETUP } from '../../../core/game/constants';
  import { lineCard } from './lineFocus.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;

  const lines = $derived.by((): LineView[] => {
    void hud.tick;
    return s.state.lines.filter((l) => l.owner === s.viewer);
  });
  const sel = $derived(
    lineCard.open && !hud.panels.front ? (lines.find((l) => l.id === hud.frontSel) ?? null) : null,
  );

  // (The same readings as the Front window's sheet.)
  const leftOf = (l: LineView) =>
    l.attack >= 0
      ? 0
      : l.kind === 0
        ? Math.max(0, l.organizeTick - hud.tick)
        : Math.max(0, l.readyTick - hud.tick);
  const chargeOf = (l: LineView) => Math.max(0, Math.min(1, (hud.tick - l.laidTick) / LINE_OFFENSE_SETUP));
  const stateOf = (l: LineView): { key: string; icon: 'hourglass' | 'warning' | 'check' | 'lineOffense' } => {
    if (l.attack >= 0) return { key: 'front.state.attacking', icon: 'lineOffense' };
    if (l.troops < 1) return { key: 'front.state.empty', icon: 'warning' };
    if (l.kind === 1 && leftOf(l) > 0 && l.aim >= 0) return { key: 'front.state.ordered', icon: 'hourglass' };
    if (l.kind === 0 && l.organizeTick < 0) return { key: 'front.state.placed', icon: 'warning' };
    if (leftOf(l) > 0)
      return { key: l.kind === 0 ? 'front.state.digging' : 'front.state.preparing', icon: 'hourglass' };
    return l.kind === 0
      ? { key: 'front.state.holding', icon: 'check' }
      : { key: 'front.state.ready', icon: 'lineOffense' };
  };
  const nameOf = (l: LineView) => {
    const n = lines.filter((x) => x.kind === l.kind && x.id <= l.id).length;
    return t(l.kind === 0 ? 'front.defensiveN' : 'front.offensiveN', { n });
  };
  const facing = (id: number): string => {
    const p = s.state.players.get(id);
    return p ? p.name[i18n.lang] || p.name.en : '—';
  };

  const army = $derived(hud.local?.troops ?? 0);
  const max = $derived(sel ? Math.floor(sel.troops + army) : 0);
  let target = $state(0);
  let lastId = -1;
  $effect(() => {
    if (sel && sel.id !== lastId) {
      lastId = sel.id;
      target = Math.round(sel.troops);
    }
    if (!sel) lastId = -1;
  });

  function close(): void {
    lineCard.open = false;
  }
  function apply(): void {
    if (sel) s.cmd({ t: 'lineTroops', id: sel.id, troops: target });
    audio.ui('confirm');
  }
  function remove(): void {
    if (!sel || sel.attack >= 0) return;
    s.cmd({ t: 'lineRemove', id: sel.id });
    hud.frontSel = -1;
    close();
  }
  function aim(): void {
    if (!sel) return;
    if (sel.aim >= 0 && sel.attack < 0) s.cmd({ t: 'lineLaunch', id: sel.id });
    else hud.tool = { k: 'assault', line: sel.id };
    audio.ui('click');
  }
  function all(): void {
    close();
    openPanel('front');
  }
  // The line gone (broken, taken down elsewhere): the card goes with it.
  $effect(() => {
    if (lineCard.open && !lines.some((l) => l.id === hud.frontSel)) lineCard.open = false;
  });
</script>

{#if sel}
  {@const st = stateOf(sel)}
  <section class="card newsprint" data-testid="line-card" aria-label={nameOf(sel)}>
    <header>
      <Icon name={sel.kind === 0 ? 'lineDefense' : 'lineOffense'} size={18} />
      <div class="who">
        <b>{nameOf(sel)}</b>
        <small class:warn={st.icon === 'warning'}
          ><Icon name={st.icon} size={11} />{t(st.key, { clock: clock(leftOf(sel)) })}</small
        >
      </div>
      <dl>
        <dt>{t('line.card.troops')}</dt>
        <dd class="mono">{short(sel.troops)}</dd>
        <dt>{t('line.card.strength')}</dt>
        <dd class="mono">{Math.round(sel.strength * 100)} %</dd>
        {#if sel.kind === 1}
          <dt>{t('line.card.facing')}</dt>
          <dd>{facing(sel.target)}</dd>
        {:else}
          <dt>{t('line.card.length')}</dt>
          <dd class="mono">{t('line.card.tiles', { n: sel.tiles.length })}</dd>
        {/if}
      </dl>
      <button class="x" onclick={close} aria-label={t('common.close')} data-testid="line-card-close"
        ><Icon name="close" size={18} /></button
      >
    </header>

    {#if sel.attack < 0}
      <div class="troops">
        <input
          type="range"
          min="0"
          max={Math.max(1, max)}
          step={Math.max(1, Math.round(max / 200))}
          bind:value={target}
          aria-label={t('line.card.set')}
          data-testid="line-card-slider"
        />
        <b class="mono">{short(target)}</b>
        <button
          class="np-btn ink small"
          onclick={apply}
          disabled={Math.abs(target - sel.troops) < 1}
          data-testid="line-card-apply"><Icon name="check" size={14} />{t('line.card.apply')}</button
        >
      </div>
    {/if}

    <div class="acts">
      {#if sel.kind === 0 && sel.organizeTick < 0}
        <button
          class="np-btn ink"
          onclick={() => s.cmd({ t: 'lineOrganize', id: sel.id })}
          disabled={sel.troops < 1}
          data-testid="line-card-organize"
          ><Icon name="lineDefense" size={14} />{t('radial.lineOrganize')}
          <small>{LINE_DEFENSE_PREP / 10} s</small></button
        >
      {/if}
      {#if sel.kind === 1}
        <button class="np-btn ink" onclick={aim} disabled={sel.troops < 1} data-testid="line-card-launch"
          ><Icon name="lineOffense" size={14} />{sel.attack >= 0
            ? t('line.card.turn')
            : sel.aim < 0
              ? t('line.card.give')
              : t('line.card.launchNow', {
                  n: short(sel.troops),
                  pct: Math.round(chargeOf(sel) * 100),
                })}</button
        >
      {/if}
      {#if sel.attack < 0}
        <button class="np-btn" onclick={remove} data-testid="line-card-remove"
          ><Icon name="trash" size={14} />{t('line.card.remove')}</button
        >
      {/if}
      <button class="np-btn quiet more" onclick={all} data-testid="line-card-all"
        >{t('touch.allLines')}<Icon name="chevronRight" size={13} /></button
      >
    </div>
    {#if hud.tool.k === 'assault' && hud.tool.line === sel.id}
      <p class="aiming"><Icon name="info" size={12} />{t('front.aiming')}</p>
    {/if}
  </section>
{/if}

<style>
  /* At the foot of the screen, between the army panel and the build button. */
  .card {
    position: absolute;
    left: 50%;
    bottom: 12px;
    translate: -50% 0;
    z-index: 30;
    width: min(560px, calc(100% - 24px));
    display: grid;
    gap: 6px;
    padding: 8px 10px 9px;
    border-top: 3px solid var(--np-ink);
    box-shadow: 0 10px 26px rgba(3, 10, 16, 0.45);
    color: var(--np-ink);
    font-family: var(--text);
    font-size: 13px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .who {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .who b {
    font-family: var(--title);
    font-size: 15px;
    line-height: 1.15;
  }
  .who small {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--np-ink-2);
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    color: var(--np-spot) !important;
  }
  dl {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: auto auto;
    gap: 0 14px;
    margin: 0;
    text-align: right;
  }
  dt {
    font-size: 10.5px;
    color: var(--np-ink-3);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-weight: 600;
    white-space: nowrap;
  }
  .x {
    width: 38px;
    height: 38px;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--np-ink-2);
  }
  .troops {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
  }
  .troops input {
    width: 100%;
    min-height: 32px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .acts :global(.np-btn) {
    min-height: 38px;
  }
  .acts small {
    opacity: 0.75;
  }
  .more {
    margin-left: auto;
  }
  .card :global(.np-btn[disabled]) {
    opacity: 0.5;
  }
  .aiming {
    display: flex;
    gap: 6px;
    margin: 0;
    font-size: 11.5px;
    color: var(--np-ink-2);
  }
</style>
