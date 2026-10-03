<script lang="ts">
  // Alliance offers received: a small card slides in at the bottom right, above the
  // minimap, in the pact banner's language (both flags around the handshake seal), with
  // Accept (K) / Refuse (L) and a bar draining over the offer's 20 seconds. Several
  // offers stack; a card leaves as soon as its offer lapses or is answered elsewhere
  // (radial menu, diplomacy window, keyboard).
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import { audio } from '../../audio/audio';
  import { flagUrl } from '../../render/flags';
  import { ALLIANCE_REQUEST_TTL } from '../../core/game/constants';
  import Icon from '../icons/Icon.svelte';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
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
  let known = new Set<number>();
  $effect(() => {
    const ids = offers.map((o) => o.from);
    if (ids.some((id) => !known.has(id))) audio.sfx('allyOffer', 0.7);
    known = new Set(ids);
  });

  function answer(from: number, accept: boolean): void {
    audio.ui(accept ? 'confirm' : 'click');
    s.cmd({ t: 'allyAnswer', target: from, accept });
  }

  // Stacked above the minimap, whatever its height (collapsed or not).
  let above = $state(200);
  onMount(() => {
    const mini = document.querySelector<HTMLElement>('[data-testid="minimap"]');
    if (!mini) return;
    const ro = new ResizeObserver(() => (above = mini.offsetHeight));
    ro.observe(mini);
    above = mini.offsetHeight;
    return () => ro.disconnect();
  });

  const enter = (node: Element) =>
    still() ? fade(node, { duration: 120 }) : fly(node, { x: 40, duration: 260 });
  const leave = (node: Element) =>
    still() ? fade(node, { duration: 120 }) : fly(node, { x: 40, duration: 200 });
</script>

<!-- Always there (empty without offers) so that each card slides in and out by itself. -->
<div class="offers" style:bottom="{above + 24}px" aria-live="polite" data-testid="ally-offers">
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
      class="offer"
      class:renew={o.renew}
      role="group"
      aria-label={t(o.renew ? 'offer.renewTitle' : 'offer.title')}
      data-testid="ally-request"
      in:enter
      out:leave
    >
      <div class="flags">
        {#if me}<img src={flagUrl(me, 48)} alt="" />{/if}
        <span class="seal"><Icon name={o.renew ? 'renew' : 'alliance'} size={17} /></span>
        {#if o.pv}<img src={flagUrl(o.pv, 48)} alt="" />{/if}
      </div>
      <div class="copy">
        <span class="kicker"
          >{t(o.renew ? 'offer.renewTitle' : 'offer.title')}<span class="secs mono"
            >{Math.ceil(o.left / 10)} s</span
          ></span
        >
        <b>{name}</b>
        <span class="terms">{t(o.renew ? 'offer.renewTerms' : 'offer.terms')}</span>
      </div>
      <div class="acts">
        <button class="btn primary small" onclick={() => answer(o.from, true)} data-testid="ally-accept"
          ><Icon name="check" size={14} />{t('common.accept')}{#if first}<kbd
              >{keyLabel(settings.keys.allyAccept ?? '')}</kbd
            >{/if}</button
        >
        <button class="btn small" onclick={() => answer(o.from, false)} data-testid="ally-refuse"
          ><Icon name="close" size={14} />{t('common.refuse')}{#if first}<kbd
              >{keyLabel(settings.keys.allyRefuse ?? '')}</kbd
            >{/if}</button
        >
      </div>
      <div class="time" aria-hidden="true">
        <i style:width="{Math.min(100, (o.left / ALLIANCE_REQUEST_TTL) * 100)}%"></i>
      </div>
    </div>
  {/each}
</div>

<style>
  /* Bottom right, over the minimap; above the windows (an offer does not wait). */
  .offers {
    position: absolute;
    right: 12px;
    width: 300px;
    display: grid;
    gap: 8px;
    z-index: 29;
    pointer-events: none;
  }
  .offer {
    position: relative;
    pointer-events: auto;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'flags copy' 'acts acts';
    align-items: center;
    gap: 8px 10px;
    padding: 10px 12px 13px;
    border-radius: 8px;
    border: 1px solid rgba(91, 224, 138, 0.55);
    background: linear-gradient(180deg, rgba(24, 33, 28, 0.97), rgba(15, 20, 18, 0.97));
    box-shadow:
      0 12px 28px rgba(0, 0, 0, 0.5),
      0 0 22px rgba(91, 224, 138, 0.14);
    overflow: hidden;
    font-size: 0.88em;
  }
  .flags {
    grid-area: flags;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .flags img {
    width: 30px;
    height: 21px;
    object-fit: cover;
    border: 1px solid #0008;
    border-radius: 2px;
  }
  .seal {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: #5be08a;
    border: 1.5px solid #5be08a;
    background: rgba(91, 224, 138, 0.12);
  }
  .copy {
    grid-area: copy;
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .kicker {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 0.8em;
    color: #8fd3a8;
  }
  .secs {
    color: var(--faint);
  }
  b {
    font-family: var(--title);
    font-size: 1.12em;
    font-weight: 600;
    color: #b9f3cc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .terms {
    color: var(--muted);
    line-height: 1.3;
  }
  .acts {
    grid-area: acts;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .acts .btn {
    justify-content: center;
    gap: 5px;
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.8em;
    opacity: 0.7;
    margin-left: 2px;
  }
  /* The offer's lifetime, draining. */
  .time {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(91, 224, 138, 0.12);
  }
  .time i {
    display: block;
    height: 100%;
    background: #5be08a;
    transition: width 0.1s linear;
  }
  .more {
    margin: 0;
    justify-self: end;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 0.78em;
    color: var(--muted);
    background: var(--glass);
    border: 1px solid var(--line);
  }
</style>
