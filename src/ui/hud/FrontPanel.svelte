<script lang="ts">
  // The Front (1.21): the player's battle management, printed on the journal's paper. The
  // masthead counts the lines and the troops locked on them; then every line, defensive and
  // offensive, with its state (holding, empty, getting ready, ready) and its troops and
  // strength — a click selects it and brings the camera to it (a click on a line on the map
  // opens this window on it). The selected line's sheet: garrison and where a head-on push
  // breaks it, a slider setting its troops (more from the army, fewer back to it), take it
  // down; an offensive line, ready, launches its assault: a click on a country's border
  // takes its whole border, a right-button drag along the border traces the sector to hit.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { t, short, clock } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import PaperMast from './PaperMast.svelte';
  import { keyLabel, settings } from '../stores/settings.svelte';
  import { audio } from '../../audio/audio';
  import type { GameController } from '../game/controller';
  import type { LineView } from '../../engine/protocol';
  import { LINE_BREAK_RATIO } from '../../core/game/constants';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;

  const lines = $derived.by((): LineView[] => {
    void hud.tick; // (the lines arrive with the ticks)
    return s.state.lines.filter((l) => l.owner === s.viewer);
  });
  const sel = $derived(lines.find((l) => l.id === hud.frontSel) ?? null);
  const locked = $derived(hud.local?.lineTroops ?? 0);

  const leftOf = (l: LineView) => Math.max(0, l.readyTick - hud.tick);
  /** A line's state: its words and mark (a shape, not only a colour). */
  const stateOf = (l: LineView): { key: string; icon: 'hourglass' | 'warning' | 'check' | 'lineOffense' } => {
    if (l.troops < 1) return { key: 'front.state.empty', icon: 'warning' };
    if (leftOf(l) > 0) return { key: 'front.state.preparing', icon: 'hourglass' };
    return l.kind === 0
      ? { key: 'front.state.holding', icon: 'check' }
      : { key: 'front.state.ready', icon: 'lineOffense' };
  };
  /** "Défensive 2", "Offensive 1": numbered by kind, in the order laid. */
  const nameOf = (l: LineView) => {
    const n = lines.filter((x) => x.kind === l.kind && x.id <= l.id).length;
    return t(l.kind === 0 ? 'front.defensiveN' : 'front.offensiveN', { n });
  };

  function select(l: LineView): void {
    hud.frontSel = l.id;
    audio.ui('click');
    // To it: the middle of what it holds.
    const w = s.state.width;
    const t0 = l.tiles[l.tiles.length >> 1];
    if (t0 !== undefined) {
      const cam = ctl.renderer.camera;
      cam.goTo((t0 % w) + 0.5, Math.floor(t0 / w) + 0.5, Math.max(cam.zoom, 2.5));
    }
  }

  // The selected line's troops: the slider reaches what stands on it plus the whole army.
  const army = $derived(hud.local?.troops ?? 0);
  const max = $derived(sel ? Math.floor(sel.troops + army) : 0);
  let target = $state(0);
  let lastId = -1;
  $effect(() => {
    if (sel && sel.id !== lastId) {
      lastId = sel.id;
      target = Math.round(sel.troops);
    }
  });
  function apply(): void {
    if (sel) s.cmd({ t: 'lineTroops', id: sel.id, troops: target });
  }
  function remove(): void {
    if (!sel) return;
    s.cmd({ t: 'lineRemove', id: sel.id });
    hud.frontSel = -1;
  }
  /** An offensive line, ready: aim its assault on the map (a click: a whole border; a right drag: a sector). */
  function aim(): void {
    if (!sel) return;
    hud.tool = { k: 'assault', line: sel.id };
    audio.ui('click');
  }
  function onKey(e: KeyboardEvent): void {
    if (!sel || !hud.panels.front) return;
    const el = e.target as HTMLElement | null;
    if (
      el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
      (el as HTMLInputElement).type !== 'range'
    )
      return;
    if (e.code === 'Delete') {
      e.preventDefault();
      remove();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="paper newsprint np-window front">
  <PaperMast title={t('panel.front')} onclose={() => (hud.panels.front = false)}>
    <p class="np-dateline">
      <span
        >{t('front.count', {
          d: lines.filter((l) => l.kind === 0).length,
          o: lines.filter((l) => l.kind === 1).length,
        })}</span
      >
      <b>{t('front.locked', { n: short(locked) })}</b>
    </p>
  </PaperMast>

  <div class="np-body scroll">
    {#if lines.length === 0}
      <p class="np-empty">
        {t('front.none', {
          d: keyLabel(settings.keys.lineDefense ?? ''),
          o: keyLabel(settings.keys.lineOffense ?? ''),
        })}
      </p>
    {:else}
      <ul class="list" data-testid="front-lines">
        {#each lines as l (l.id)}
          {@const st = stateOf(l)}
          <li>
            <button
              class="row"
              class:sel={l.id === hud.frontSel}
              onclick={() => select(l)}
              data-testid="front-line-{l.id}"
            >
              <Icon name={l.kind === 0 ? 'lineDefense' : 'lineOffense'} size={16} />
              <span class="who">
                <b>{nameOf(l)}</b>
                <small class:warn={st.icon === 'warning'}
                  ><Icon name={st.icon} size={11} />{t(st.key, { clock: clock(leftOf(l)) })}</small
                >
              </span>
              <span class="num mono">{short(l.troops)}</span>
              <span class="bar" aria-hidden="true"><i style:width="{Math.round(l.strength * 100)}%"></i></span
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if sel}
      {@const st = stateOf(sel)}
      <section class="sheet" data-testid="front-sheet">
        <h3 class="np-mark">
          <Icon name={sel.kind === 0 ? 'lineDefense' : 'lineOffense'} size={14} />{nameOf(sel)}
        </h3>
        <p class="state" class:warn={st.icon === 'warning'}>
          <Icon name={st.icon} size={13} />{t(st.key, { clock: clock(leftOf(sel)) })}
        </p>
        <dl class="np-figures">
          <dt>{t('line.card.troops')}</dt>
          <dd>{short(sel.troops)}</dd>
          <dt>{t('line.card.strength')}</dt>
          <dd>{Math.round(sel.strength * 100)} %</dd>
          <dt>{t('line.card.length')}</dt>
          <dd>{t('line.card.tiles', { n: sel.tiles.length })}</dd>
          {#if sel.kind === 0}
            <dt>{t('line.card.garrison')}</dt>
            <dd>{short(sel.tiles.length ? sel.troops / sel.tiles.length : 0)}</dd>
            <dt>{t('line.card.breaks')}</dt>
            <dd>{short((LINE_BREAK_RATIO * sel.troops) / Math.max(1, sel.tiles.length))}</dd>
          {/if}
        </dl>

        {#if sel.kind === 1}
          <button
            class="np-btn ink launch"
            onclick={aim}
            disabled={leftOf(sel) > 0 || sel.troops < 1}
            data-testid="front-launch"
            ><Icon name="lineOffense" size={14} />{leftOf(sel) > 0
              ? t('line.card.launchIn', { clock: clock(leftOf(sel)) })
              : t('line.card.launch', { n: short(sel.troops) })}</button
          >
          {#if hud.tool.k === 'assault' && hud.tool.line === sel.id}
            <p class="aiming" data-testid="front-aiming"><Icon name="info" size={12} />{t('front.aiming')}</p>
          {/if}
        {/if}

        <label class="slider">
          <span>{t('line.card.set')}</span>
          <input
            type="range"
            min="0"
            max={Math.max(1, max)}
            step={Math.max(1, Math.round(max / 200))}
            bind:value={target}
            data-testid="front-slider"
          />
          <b class="mono">{short(target)}</b>
        </label>
        <p class="delta mono">
          {target >= sel.troops + 1
            ? t('line.card.fromArmy', { n: short(target - sel.troops) })
            : target <= sel.troops - 1
              ? t('line.card.toArmy', { n: short(sel.troops - target) })
              : ''}
        </p>
        <div class="actions">
          <button
            class="np-btn ink"
            onclick={apply}
            disabled={Math.abs(target - sel.troops) < 1}
            data-testid="front-apply"><Icon name="check" size={13} />{t('line.card.apply')}</button
          >
          <button class="np-btn" onclick={remove} data-testid="front-remove"
            ><Icon name="trash" size={13} />{t('line.card.remove')}<kbd class="np-kbd">Suppr</kbd></button
          >
        </div>
      </section>
    {:else if lines.length}
      <p class="np-empty">{t('front.pick')}</p>
    {/if}

    <aside class="np-box np-rules">
      <h3>{t('front.rules')}</h3>
      <p>{t('front.rulesDraw')}</p>
      <p>{t('front.rulesAssault')}</p>
    </aside>
  </div>
</div>

<style>
  .list {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    appearance: none;
    width: 100%;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto 54px;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-bottom-color: var(--np-rule);
    background: transparent;
    color: var(--np-ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover,
  .row:focus-visible {
    background: var(--np-paper-2);
  }
  .row.sel {
    border-color: var(--np-ink);
    background: var(--np-paper-2);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .who b {
    font-family: var(--title);
    font-weight: 600;
  }
  .who small {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--np-ink-2);
    font-size: 0.82em;
  }
  .warn {
    color: var(--np-spot) !important;
  }
  .num {
    font-weight: 600;
  }
  .bar {
    height: 4px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--np-ink);
  }
  .sheet {
    margin: 4px 0 12px;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 8px;
    font-weight: 600;
  }
  .launch {
    width: 100%;
    justify-content: center;
    margin: 10px 0 6px;
  }
  .launch[disabled],
  .actions :global(.np-btn[disabled]) {
    opacity: 0.5;
    cursor: default;
  }
  .aiming {
    display: flex;
    gap: 6px;
    margin: 0 0 8px;
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .slider {
    display: grid;
    gap: 4px;
    margin-top: 10px;
    font-weight: 600;
  }
  .slider b {
    justify-self: end;
  }
  .delta {
    min-height: 1.2em;
    margin: 2px 0 8px;
    color: var(--np-ink-2);
    font-size: 0.9em;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }
</style>
