<script lang="ts">
  // The lobby's game-mode chooser (1.10.0): one card per mode, printed like the journal's
  // classified boxes — an ink pictogram, the name in Fraunces, the rule in one line — and,
  // under the cards, how the chosen mode plays. A radiogroup: arrows, Home and End move the
  // choice, Tab leaves the group (roving tabindex).
  import type { GameMode } from '../../core/game/config';
  import { t } from '../i18n/i18n.svelte';

  let {
    modes,
    value,
    disabled = false,
    solo = false,
    onpick,
  }: {
    modes: GameMode[];
    value: GameMode;
    disabled?: boolean;
    /** A solo game: humans vs nations is the player alone against the nations' coalition. */
    solo?: boolean;
    onpick: (m: GameMode) => void;
  } = $props();
  /** The texts of a mode that read differently alone (humans vs nations, 1.11.0). */
  const key = (m: GameMode) => (solo && m === 'humansVsNations' ? `${m}Solo` : m);

  /** How each mode plays (the timed modes, 1.10.0, have their own text: GAME_DESIGN.md §14.1, §14.2). */
  const HOW: Partial<Record<GameMode, string>> = {
    doomsday: 'modeInfo.doomsday',
    battleRoyale: 'modeInfo.battleRoyale',
  };
  let cards: HTMLButtonElement[] = $state([]);

  function pick(m: GameMode, focus = false): void {
    if (disabled) return;
    if (m !== value) onpick(m);
    if (focus) cards[modes.indexOf(m)]?.focus();
  }

  function arrow(e: KeyboardEvent, k: number): void {
    const n = modes.length;
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (k + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (k - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    pick(modes[to]!, true);
  }
</script>

<div class="picker">
  <div
    class="cards"
    role="radiogroup"
    aria-labelledby="mode-label"
    aria-disabled={disabled}
    data-testid="opt-mode"
  >
    {#each modes as m, k (m)}
      <button
        bind:this={cards[k]}
        type="button"
        class="card"
        class:on={m === value}
        role="radio"
        aria-checked={m === value}
        aria-describedby={m === value ? 'mode-how' : undefined}
        tabindex={m === value ? 0 : -1}
        {disabled}
        data-mode={m}
        data-testid="mode-{m}"
        onclick={() => pick(m)}
        onkeydown={(e) => arrow(e, k)}
      >
        <svg class="pict" viewBox="0 0 48 36" aria-hidden="true">
          {#if m === 'ffa'}
            <!-- Every country for itself: a land cut into rival shares, one taking the lead. -->
            <circle cx="24" cy="18" r="15" class="line" />
            <path d="M24 18 L24 3 A15 15 0 0 1 38.3 22.6 Z" class="ink" />
            <path d="M24 18 L38.3 22.6 M24 18 L13 28.2 M24 18 L9.4 14" class="line" />
            <circle cx="15" cy="14" r="1.6" class="ink" /><circle cx="21" cy="27" r="1.6" class="ink" />
            <circle cx="31" cy="27" r="1.6" class="ink" />
          {:else if m === 'teams'}
            <!-- Two camps: two inks, side by side. -->
            <rect x="4" y="5" width="19" height="26" rx="1" class="ink" />
            <rect x="25" y="5" width="19" height="26" rx="1" class="spot" />
            <circle cx="10" cy="13" r="2" class="paper" /><circle cx="17" cy="23" r="2" class="paper" />
            <circle cx="31" cy="13" r="2" class="paper" /><circle cx="38" cy="23" r="2" class="paper" />
          {:else if m === 'humansVsNations'}
            <!-- One side of players against a row of nations. -->
            <circle cx="12" cy="11" r="4" class="ink" />
            <path d="M4 29 Q4 18 12 18 Q20 18 20 29 Z" class="ink" />
            <path d="M23 18 L28 18" class="spotline" />
            <rect x="31" y="5" width="12" height="7" rx="1" class="line" />
            <rect x="31" y="15" width="12" height="7" rx="1" class="line" />
            <rect x="31" y="25" width="12" height="7" rx="1" class="line" />
          {:else if m === 'tribes'}
            <!-- Tribes only: tents scattered on open land. -->
            <path d="M6 28 L12 17 L18 28 Z" class="line" />
            <path d="M20 22 L26 11 L32 22 Z" class="ink" />
            <path d="M30 31 L36 20 L42 31 Z" class="line" />
            <path d="M3 32 H45" class="line" />
          {:else if m === 'doomsday'}
            <!-- The doomsday clock: minutes to midnight, the last of them in the spot ink. -->
            <circle cx="24" cy="18" r="15" class="line" />
            <path d="M24 18 L15.2 5.9 A15 15 0 0 1 24 3 Z" class="spotfill" />
            <path d="M24 3 V7" class="spotline" />
            <path d="M24 18 L16.5 7.7" class="hand" /><path d="M24 18 L23 10.5" class="hand thick" />
            <circle cx="24" cy="18" r="1.8" class="ink" />
          {:else if m === 'battleRoyale'}
            <!-- The zone: a red circle closing on the next one (dashed), off-centre. -->
            <circle cx="24" cy="18" r="15" class="spotline" />
            <circle cx="28.5" cy="15" r="8" class="dash" />
            <path d="M12.5 26 L18 21.5 M16.5 21 L18 21.5 L17.7 23" class="line" />
          {/if}
        </svg>
        <span class="name">{t(`mode.${m}`)}</span>
        <span class="rule">{t(`modeLine.${key(m)}`)}</span>
      </button>
    {/each}
  </div>
  <p class="how" id="mode-how" aria-live="polite">
    <b>{t('lobby.modeHow')}</b>
    {t(HOW[value] ?? `modeDesc.${key(value)}`)}
  </p>
</div>

<style>
  .picker {
    display: grid;
    gap: 8px;
  }
  /* The cards: two to a row in the lobby's column, three in a wide one. */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 6px;
  }
  .card {
    appearance: none;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    align-items: center;
    text-align: left;
    padding: 7px 8px 7px 6px;
    background: var(--np-card);
    border: 1px solid var(--np-rule-2);
    border-radius: 2px;
    color: var(--np-ink-2);
    cursor: var(--cursor-pointer, pointer);
    transition:
      border-color 0.15s,
      background 0.15s,
      box-shadow 0.15s;
  }
  .card:hover:not(:disabled) {
    border-color: var(--np-ink);
    background: var(--np-paper);
  }
  .card:focus-visible {
    outline: 2px solid var(--np-sea);
    outline-offset: 1px;
  }
  /* The chosen mode: the box ruled in solid ink, as the journal frames its lead. */
  .card.on {
    border-color: var(--np-ink);
    box-shadow: inset 0 0 0 1px var(--np-ink);
    background: var(--np-paper);
    color: var(--np-ink);
  }
  .card:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .card.on:disabled {
    opacity: 1;
  }
  .pict {
    grid-row: 1 / 3;
    width: 40px;
    height: 30px;
  }
  .name {
    font-family: var(--title);
    font-weight: 700;
    font-size: 0.98em;
    line-height: 1.1;
    color: var(--np-ink);
  }
  .rule {
    font-family: var(--np-serif);
    font-size: 0.76em;
    line-height: 1.25;
    color: var(--np-ink-2);
  }
  .how {
    margin: 0;
    padding: 6px 0 0 9px;
    border-left: 2px solid var(--np-ink);
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.45;
    color: var(--np-ink-2);
  }
  .how b {
    font-family: var(--text);
    font-weight: 600;
    color: var(--np-ink);
    margin-right: 3px;
  }
  /* The pictograms' inks (BRAND.md §4.1): navy, paper, the magenta of danger. */
  .line {
    fill: none;
    stroke: var(--np-ink);
    stroke-width: 1.4;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ink {
    fill: var(--np-ink);
  }
  .paper {
    fill: var(--np-card);
  }
  .spot {
    fill: var(--np-spot);
  }
  .spotfill {
    fill: color-mix(in srgb, var(--np-spot) 35%, transparent);
  }
  .spotline {
    fill: none;
    stroke: var(--np-spot);
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  .dash {
    fill: none;
    stroke: var(--np-ink);
    stroke-width: 1.4;
    stroke-dasharray: 3 2.2;
  }
  .hand {
    stroke: var(--np-ink);
    stroke-width: 1.3;
    stroke-linecap: round;
  }
  .hand.thick {
    stroke-width: 2.2;
  }
</style>
