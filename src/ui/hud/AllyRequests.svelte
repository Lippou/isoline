<script lang="ts">
  // Alliance offers received: a small card printed on the Courier's paper slides in at
  // the foot of the right column, above the minimap, in the pact banner's language (both
  // flags around the handshake seal, the alliance's green rule), with
  // Show (centres the camera on the country, lit up while the pointer is on the card),
  // Accept (K) / Refuse (L) and a bar draining over the offer's 20 seconds. Several
  // offers stack; a card leaves as soon as its offer lapses or is answered elsewhere
  // (radial menu, diplomacy window, keyboard).
  // In reading mode (a big window open) the offers are chips of the reading strip
  // (variant 'chips'): the flag, the name, the seconds left, Accept and Refuse — K and L
  // answer the oldest one all the same; the name restores the map and shows the country.
  import { fly, fade } from 'svelte/transition';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import { audio } from '../../audio/audio';
  import { flagUrl } from '../../render/flags';
  import { ALLIANCE_REQUEST_TTL } from '../../core/game/constants';
  import Icon from '../icons/Icon.svelte';
  import { zonePiece } from '../stores/layout.svelte';
  import { restoreColumns } from '../stores/windows.svelte';
  import type { GameController } from '../game/controller';

  let { ctl, variant = 'cards' }: { ctl: GameController; variant?: 'cards' | 'chips' } = $props();
  const s = ctl.session;
  const SHOWN = 3;

  const still = () => settings.access.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

  const me = $derived(hud.players.find((p) => p.id === hud.viewer));
  const offers = $derived.by(() => {
    const L = hud.local;
    if (!L || !L.alive) return [];
    return L.allyRequests.map((from, k) => ({
      from,
      left: L.allyRequestsIn?.[k] ?? ALLIANCE_REQUEST_TTL,
      renew: L.allies.some((a) => a.id === from),
      pv: hud.players.find((p) => p.id === from),
    }));
  });

  // A new offer arrives: a sheet of paper lands on the desk (throttled in the audio engine).
  // (Those already there were heard where they were shown before: the column or the strip.)
  // svelte-ignore state_referenced_locally
  let known = new Set<number>(offers.map((o) => o.from));
  $effect(() => {
    const ids = offers.map((o) => o.from);
    if (ids.some((id) => !known.has(id))) audio.sfx('allyOffer', 0.7);
    known = new Set(ids);
  });

  function answer(from: number, accept: boolean): void {
    audio.ui(accept ? 'confirm' : 'click');
    if (ctl.spotlight === from) ctl.spotlight = -1;
    s.cmd({ t: 'allyAnswer', target: from, accept });
  }

  function show(from: number): void {
    audio.ui('click');
    if (variant === 'chips') restoreColumns();
    ctl.focusPlayer(from);
  }

  // The lit country follows the pointer; a card that leaves takes its light with it.
  $effect(() => {
    if (ctl.spotlight > 0 && !offers.some((o) => o.from === ctl.spotlight)) ctl.spotlight = -1;
  });
  $effect(() => () => (ctl.spotlight = -1));

  const enter = (node: Element) =>
    still() ? fade(node, { duration: 120 }) : fly(node, { x: 40, duration: 260 });
  const leave = (node: Element) =>
    still() ? fade(node, { duration: 120 }) : fly(node, { x: 40, duration: 200 });
</script>

{#if variant === 'chips'}
  <!-- Reading mode: a chip each in the reading strip, the oldest first (K and L answer it). -->
  {#each offers.slice(0, SHOWN) as o, k (o.from)}
    {@const name = s.state.name(o.from, i18n.lang)}
    <div
      class="chip-offer newsprint"
      class:renew={o.renew}
      role="group"
      aria-label="{t(o.renew ? 'offer.renewTitle' : 'offer.title')} — {name}"
      data-testid="ally-request"
      transition:fade={{ duration: 120 }}
    >
      <button
        class="who"
        onclick={() => show(o.from)}
        title={t('offer.show', { name })}
        data-testid="ally-show"
      >
        <Icon name={o.renew ? 'renew' : 'alliance'} size={13} />
        {#if o.pv}<img src={flagUrl(o.pv, 24)} alt="" />{/if}
        <b>{name}</b>
        <span class="secs mono">{Math.ceil(o.left / 10)} s</span>
      </button>
      <button
        class="act yes"
        onclick={() => answer(o.from, true)}
        aria-label={t('common.accept')}
        data-tip={t('common.accept')}
        data-testid="ally-accept"
        ><Icon name="check" size={13} stroke={2.4} />{#if k === 0}<kbd class="np-kbd"
            >{keyLabel(settings.keys.allyAccept ?? '')}</kbd
          >{/if}</button
      >
      <button
        class="act no"
        onclick={() => answer(o.from, false)}
        aria-label={t('common.refuse')}
        data-tip={t('common.refuse')}
        data-testid="ally-refuse"
        ><Icon name="close" size={13} />{#if k === 0}<kbd class="np-kbd"
            >{keyLabel(settings.keys.allyRefuse ?? '')}</kbd
          >{/if}</button
      >
    </div>
  {/each}
  {#if offers.length > SHOWN}<span class="chip-more">+{offers.length - SHOWN}</span>{/if}
{:else}
  <!-- Always there (empty without offers) so that each card slides in and out by itself. -->
  <div
    class="offers"
    aria-live="polite"
    data-testid="ally-offers"
    use:zonePiece={{ id: 'offers', on: offers.length > 0, n: Math.min(offers.length, SHOWN) }}
  >
    {#if offers.length > SHOWN}
      <p class="more" transition:fade={{ duration: 120 }}>
        {t('offer.more', { n: offers.length - SHOWN })}
      </p>
    {/if}
    <!-- Oldest offer nearest the minimap: K and L answer that one. -->
    {#each offers.slice(0, SHOWN).reverse() as o (o.from)}
      {@const first = o.from === offers[0]!.from}
      {@const name = s.state.name(o.from, i18n.lang)}
      <div
        class="offer newsprint"
        class:renew={o.renew}
        role="group"
        aria-label={t(o.renew ? 'offer.renewTitle' : 'offer.title')}
        data-testid="ally-request"
        onpointerenter={() => (ctl.spotlight = o.from)}
        onpointerleave={() => ctl.spotlight === o.from && (ctl.spotlight = -1)}
        in:enter
        out:leave
      >
        <p class="kicker">
          <Icon name={o.renew ? 'renew' : 'alliance'} size={13} />{t(
            o.renew ? 'offer.renewTitle' : 'offer.title',
          )}
          <span class="secs">{Math.ceil(o.left / 10)} s</span>
        </p>
        <div class="who">
          <div class="flags" aria-hidden="true">
            {#if me}<img src={flagUrl(me, 48)} alt="" />{/if}
            <span class="seal"><Icon name={o.renew ? 'renew' : 'alliance'} size={15} /></span>
            {#if o.pv}<img src={flagUrl(o.pv, 48)} alt="" />{/if}
          </div>
          <div class="copy">
            <b>{name}</b>
            <span class="terms">{t(o.renew ? 'offer.renewTerms' : 'offer.terms')}</span>
          </div>
        </div>
        <div class="acts">
          <button
            class="act show"
            onclick={() => show(o.from)}
            aria-label={t('offer.show', { name })}
            data-tip={t('offer.show', { name })}
            data-testid="ally-show"><Icon name="target" size={14} /></button
          >
          <button class="act yes" onclick={() => answer(o.from, true)} data-testid="ally-accept"
            ><Icon name="check" size={14} stroke={2.4} />{t('common.accept')}{#if first}<kbd class="np-kbd"
                >{keyLabel(settings.keys.allyAccept ?? '')}</kbd
              >{/if}</button
          >
          <button class="act no" onclick={() => answer(o.from, false)} data-testid="ally-refuse"
            ><Icon name="close" size={14} />{t('common.refuse')}{#if first}<kbd class="np-kbd"
                >{keyLabel(settings.keys.allyRefuse ?? '')}</kbd
              >{/if}</button
          >
        </div>
        <span class="drain" aria-hidden="true">
          <i style:width="{Math.min(100, (o.left / ALLIANCE_REQUEST_TTL) * 100)}%"></i>
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  /* At the foot of the right column (GameScreen.svelte), over the minimap; above the windows. */
  .offers {
    width: 100%;
    display: grid;
    gap: 8px;
  }
  .offers:not(:has(> *)) {
    display: none;
  }
  /* A card on the paper: the green rule of an alliance over it, the time left draining under it. */
  .offer {
    position: relative;
    padding: 6px 12px 12px;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-good);
    border-radius: 1px;
    font-family: var(--np-serif);
    font-size: 0.9em;
    box-shadow: var(--np-lift);
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-family: var(--text);
    font-size: 0.78em;
    font-weight: 600;
    color: var(--np-good);
  }
  .secs {
    margin-left: auto;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-3);
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
  }
  .flags {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }
  .flags img {
    width: 26px;
    height: 18px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .seal {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 1.5px solid var(--np-good);
    color: var(--np-good);
  }
  .copy {
    display: grid;
    min-width: 0;
  }
  b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.22em;
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: var(--np-ink);
  }
  .terms {
    font-size: 0.86em;
    line-height: 1.3;
    color: var(--np-ink-2);
  }
  /* Printed buttons: accept in the alliance's green, refuse in ink. */
  .acts {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: 6px;
    margin-top: 10px;
  }
  .act {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 5px 8px;
    border: 1px solid var(--np-ink-2);
    border-radius: 2px;
    background: transparent;
    font-family: var(--text);
    font-size: 0.86em;
    font-weight: 600;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
    white-space: nowrap;
  }
  .act:hover,
  .act:focus-visible {
    background: var(--np-paper-2);
    border-color: var(--np-ink);
  }
  .act.show {
    padding-inline: 7px;
    border-color: var(--np-rule);
    color: var(--np-ink-2);
  }
  .act.yes {
    background: var(--np-good);
    border-color: var(--np-good);
    color: #f8f4ec;
  }
  .act.yes:hover,
  .act.yes:focus-visible {
    background: #1f5a3c;
    border-color: #1f5a3c;
  }
  .act.yes .np-kbd {
    border-color: rgba(248, 244, 236, 0.45);
    color: #f8f4ec;
  }
  .act .np-kbd {
    margin-left: 2px;
  }
  /* The offer's lifetime, draining along the foot of the card. */
  .drain {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: color-mix(in srgb, var(--np-good) 14%, transparent);
    pointer-events: none;
  }
  .drain i {
    display: block;
    height: 100%;
    background: var(--np-good);
    transition: width 0.1s linear;
  }
  /* Reading mode: a chip of the strip, the alliance's green rule at its left. */
  .chip-offer {
    display: inline-flex;
    align-items: stretch;
    flex: none;
    height: 30px;
    border: 1px solid var(--np-edge);
    border-left: 3px solid var(--np-good);
    border-radius: 1px;
    box-shadow: 0 1px 3px rgba(3, 10, 16, 0.25);
    font-size: 0.84em;
  }
  .chip-offer .who {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 7px;
    border: 0;
    background: none;
    color: var(--np-good);
    cursor: var(--cursor-pointer, pointer);
  }
  .chip-offer .who:hover,
  .chip-offer .who:focus-visible {
    background: var(--np-paper-2);
  }
  .chip-offer img {
    width: 22px;
    height: 15px;
    object-fit: cover;
    box-shadow: 0 0 0 1px var(--np-rule);
  }
  .chip-offer b {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 600;
    color: var(--np-ink);
  }
  .chip-offer .secs {
    font-size: 0.86em;
    color: var(--np-ink-3);
  }
  .chip-offer .act {
    border-radius: 0;
    border-width: 0 0 0 1px;
    border-color: var(--np-rule);
    padding: 0 8px;
  }
  .chip-more {
    align-self: center;
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 600;
    color: var(--np-good);
  }
  .more {
    margin: 0;
    justify-self: end;
    padding: 1px 8px;
    border: 1px solid var(--np-edge);
    border-radius: 2px;
    background: var(--np-paper);
    font-family: var(--np-serif);
    font-style: italic;
    font-size: 0.8em;
    color: var(--np-ink-2);
  }
</style>
