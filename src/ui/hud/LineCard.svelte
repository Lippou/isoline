<script lang="ts">
  // One of my front lines, opened by a click on it (controller.ts, core/rules/lines.ts): its
  // state (laying, holding, empty, breached), its troops and its strength; a slider sets the
  // troops on it (more from the army, fewer back to it — 0 leaves it empty) and it can be
  // taken down (its troops come back). A slip of the Courier's paper beside the click, kept
  // inside the window; Escape or a click elsewhere closes it, Delete takes the line down.
  import { hud } from '../stores/game.svelte';
  import { t, short, clock } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { GameController } from '../game/controller';
  import { LINE_BREAK_RATIO } from '../../core/game/constants';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;

  const line = $derived.by(() => {
    const c = hud.lineCard;
    if (!c) return null;
    void hud.tick; // (the lines arrive with the ticks)
    return s.state.lines.find((l) => l.id === c.id) ?? null;
  });
  // The line gone (taken, or down): the card goes with it.
  $effect(() => {
    if (hud.lineCard && !line) hud.lineCard = null;
  });

  const army = $derived(hud.local?.troops ?? 0);
  /** What the slider can reach: what stands on the line plus the whole army. */
  const max = $derived(line ? Math.floor(line.troops + army) : 0);
  let target = $state(0);
  let lastId = -1;
  $effect(() => {
    if (line && line.id !== lastId) {
      lastId = line.id;
      target = Math.round(line.troops);
    }
  });
  const left = $derived(line ? Math.max(0, line.readyTick - hud.tick) : 0);
  const status = $derived.by((): { key: string; icon: 'hourglass' | 'warning' | 'check' } => {
    if (!line) return { key: '', icon: 'check' };
    if (left > 0) return { key: 'line.card.laying', icon: 'hourglass' };
    if (line.troops < 1) return { key: 'line.card.empty', icon: 'warning' };
    return { key: line.kind === 0 ? 'line.card.holding' : 'line.card.ready', icon: 'check' };
  });

  function apply(): void {
    if (!line) return;
    s.cmd({ t: 'lineTroops', id: line.id, troops: target });
  }
  function remove(): void {
    if (!line) return;
    s.cmd({ t: 'lineRemove', id: line.id });
    hud.lineCard = null;
  }
  function onKey(e: KeyboardEvent): void {
    if (!hud.lineCard) return;
    if (e.code === 'Delete' || e.code === 'Backspace') {
      const el = e.target as HTMLElement | null;
      if (el && el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') return;
      e.preventDefault();
      remove();
    }
  }

  let w = $state(0);
  let h = $state(0);
  const pos = $derived.by(() => {
    const c = hud.lineCard;
    if (!c) return { x: 0, y: 0 };
    let x = c.x + 14;
    let y = c.y + 14;
    if (x + w > window.innerWidth - 8) x = c.x - 14 - w;
    if (y + h > window.innerHeight - 8) y = c.y - 14 - h;
    return { x: Math.max(8, Math.round(x)), y: Math.max(8, Math.round(y)) };
  });
</script>

<svelte:window onkeydown={onKey} />

{#if line && hud.lineCard && !hud.photo}
  <div
    class="card newsprint rise-in"
    role="dialog"
    aria-label={t(line.kind === 0 ? 'line.defensive.name' : 'line.offensive.name')}
    data-testid="line-card"
    style:left="{pos.x}px"
    style:top="{pos.y}px"
    bind:offsetWidth={w}
    bind:offsetHeight={h}
  >
    <header>
      <Icon name={line.kind === 0 ? 'lineDefense' : 'lineOffense'} size={18} />
      <h4>{t(line.kind === 0 ? 'line.defensive.name' : 'line.offensive.name')}</h4>
      <button class="x" onclick={() => (hud.lineCard = null)} aria-label={t('common.close')}
        ><Icon name="close" size={14} /></button
      >
    </header>
    <p class="state" class:warn={status.icon === 'warning'}>
      <Icon name={status.icon} size={13} />{t(status.key, { clock: clock(left) })}
    </p>
    <dl class="np-figures">
      <dt>{t('line.card.troops')}</dt>
      <dd data-testid="line-card-troops">{short(line.troops)}</dd>
      <dt>{t('line.card.strength')}</dt>
      <dd>{Math.round(line.strength * 100)} %</dd>
      <dt>{t('line.card.length')}</dt>
      <dd>{t('line.card.tiles', { n: line.tiles.length })}</dd>
      {#if line.kind === 0}
        <!-- The balance of forces (1.19): a push breaks a tile past 3 to 1 against its garrison. -->
        <dt>{t('line.card.garrison')}</dt>
        <dd>{short(line.tiles.length ? line.troops / line.tiles.length : 0)}</dd>
        <dt>{t('line.card.breaks')}</dt>
        <dd>{short((LINE_BREAK_RATIO * line.troops) / Math.max(1, line.tiles.length))}</dd>
      {/if}
    </dl>
    <label class="slider">
      <span>{t('line.card.set')}</span>
      <input
        type="range"
        min="0"
        max={Math.max(1, max)}
        step={Math.max(1, Math.round(max / 200))}
        bind:value={target}
        data-testid="line-card-slider"
      />
      <b class="mono">{short(target)}</b>
    </label>
    <p class="delta mono">
      {target >= line.troops + 1
        ? t('line.card.fromArmy', { n: short(target - line.troops) })
        : target <= line.troops - 1
          ? t('line.card.toArmy', { n: short(line.troops - target) })
          : ''}
    </p>
    <div class="actions">
      <button
        class="np-btn ink"
        onclick={apply}
        disabled={Math.abs(target - line.troops) < 1}
        data-testid="line-card-apply"><Icon name="check" size={13} />{t('line.card.apply')}</button
      >
      <button class="np-btn" onclick={remove} data-testid="line-card-remove"
        ><Icon name="trash" size={13} />{t('line.card.remove')}<kbd class="np-kbd">⌫</kbd></button
      >
    </div>
  </div>
{/if}

<style>
  .card {
    position: fixed;
    z-index: 40;
    width: 270px;
    padding: 10px 12px 12px;
    background: var(--np-card);
    color: var(--np-ink);
    border: 1px solid var(--np-edge, rgba(23, 42, 60, 0.42));
    border-top: 3px solid var(--np-ink);
    box-shadow: 0 2px 0 rgba(23, 42, 60, 0.14);
    font-size: 0.86em;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--np-rule);
  }
  h4 {
    flex: 1;
    margin: 0;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.08em;
  }
  .x {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--np-ink-2);
    cursor: pointer;
    padding: 2px;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
    font-weight: 600;
  }
  .state.warn {
    color: var(--np-spot);
  }
  .slider {
    display: grid;
    grid-template-columns: 1fr;
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
  .actions :global(.np-btn[disabled]) {
    opacity: 0.45;
    cursor: default;
  }
  kbd {
    margin-left: 2px;
  }
</style>
