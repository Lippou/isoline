<script lang="ts">
  // Alliance signed (or renewed): a notice printed on the Courier's paper, both flags
  // sealed by a handshake, a signature drawn in ink, then it fades out by itself. An offer turned down
  // gets a « Refusé » stamp slammed across it; a pact betrayed is torn in two (flags
  // drawn apart, red tear instead of a signature).
  import { hud, nextPact } from '../stores/game.svelte';
  import { audio } from '../../audio/audio';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  const SHOW_MS = 4600;

  const pact = $derived(hud.pact);
  const me = $derived(hud.players.find((p) => p.id === hud.viewer));
  const them = $derived(pact ? hud.players.find((p) => p.id === pact.with) : undefined);

  $effect(() => {
    const id = pact?.id;
    if (id === undefined) return;
    // Its sound plays as it appears: pen on parchment, a stamp and a sour note, or paper torn.
    const p = hud.pact;
    if (p?.betrayed) audio.sfx('torn', 0.85);
    else if (p?.refused) {
      audio.sfx('stamp', 0.85);
      audio.sfx('rejected', 0.5);
    } else audio.sfx('alliance', 0.8);
    const timer = setTimeout(() => {
      if (hud.pact?.id === id) nextPact();
    }, SHOW_MS);
    return () => clearTimeout(timer);
  });
</script>

{#if pact && them}
  {#key pact.id}
    {@const name = ctl.session.state.name(them.id, i18n.lang)}
    <div
      class="pact newsprint"
      class:refused={pact.refused}
      class:betrayed={pact.betrayed}
      role="status"
      data-testid="pact-banner"
    >
      <div class="flags">
        {#if me}<img class="mine" src={flagUrl(me, 48)} alt="" />{/if}
        <span class="seal"><Icon name="alliance" size={22} /></span>
        <img class="theirs" src={flagUrl(them, 48)} alt="" />
      </div>
      {#if pact.refused}
        <b>{t(pact.silent ? 'pact.lapsed' : 'pact.refused')}</b>
        <span class="terms">{t(pact.silent ? 'pact.lapsedTerms' : 'pact.refusedTerms', { name })}</span>
        <span class="stamp" aria-hidden="true">{t(pact.silent ? 'pact.stampLapsed' : 'pact.stamp')}</span>
      {:else if pact.betrayed}
        <b>{t('pact.betrayed')}</b>
        <span class="terms">{t('pact.betrayedTerms', { name })}</span>
        <svg class="sig tear" viewBox="0 0 220 34" aria-hidden="true">
          <path
            d="M8 17l12-7 10 12 11-10 9 9 12-11 10 12 12-10 9 8 11-11 10 12 12-9 9 9 12-12 10 11 11-8 9 8 12-10 9 7"
          />
        </svg>
      {:else}
        <b>{t(pact.renewed ? 'pact.renewed' : 'pact.signed')}</b>
        <span class="terms">{t('pact.terms', { name })}</span>
        <svg class="sig" viewBox="0 0 220 34" aria-hidden="true">
          <path
            d="M6 24c10-14 18-18 22-8s-6 14-2 6 14-18 20-10-2 14 4 10 10-14 18-12 0 12 8 10 14-16 22-14-4 14 6 12 12-10 20-8 8 6 18 4 22-6 36-8"
          />
        </svg>
      {/if}
    </div>
  {/key}
{/if}

<style>
  /* Lower centre, above the build bar and the campaign guide: clear of the dispatches and the launch panel. */
  .pact {
    position: absolute;
    left: 50%;
    bottom: calc(var(--hud-bar-h, 112px) + 138px);
    transform: translateX(-50%);
    z-index: 29;
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 12px 24px 8px;
    min-width: 300px;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-good);
    border-radius: 1px;
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 10px 24px rgba(3, 10, 16, 0.42);
    font-family: var(--np-serif);
    pointer-events: none;
    animation: appear 4.6s ease both;
  }
  .flags {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .flags img {
    width: 42px;
    height: 29px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .seal {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    color: var(--np-good);
    border: 2px solid var(--np-good);
    animation: stamp 0.5s 0.15s cubic-bezier(0.3, 1.6, 0.5, 1) both;
  }
  b {
    margin-top: 3px;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.3em;
    line-height: 1.1;
    color: var(--np-ink);
  }
  .terms {
    font-size: 0.84em;
    color: var(--np-ink-2);
  }
  /* The signature, in the journal's ink. */
  .sig {
    width: 180px;
    height: 26px;
  }
  .sig path {
    fill: none;
    stroke: var(--np-ink);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 420;
    stroke-dashoffset: 420;
    animation: sign 1.6s 0.35s ease-out forwards;
  }
  /* Turned down or betrayed: the magenta rule, the seal struck through, the flags drawn apart. */
  .pact.refused,
  .pact.betrayed {
    border-top-color: var(--np-spot);
  }
  .refused .seal,
  .betrayed .seal {
    position: relative;
    color: var(--np-spot);
    border-color: var(--np-spot);
  }
  .refused .seal::after,
  .betrayed .seal::after {
    content: '';
    position: absolute;
    left: 5px;
    right: 5px;
    top: 50%;
    height: 2px;
    background: var(--np-spot);
    transform: rotate(-40deg);
  }
  .refused b,
  .betrayed b {
    color: var(--np-spot);
  }
  .betrayed .mine {
    animation: apart-l 0.6s 0.5s ease-out both;
  }
  .betrayed .theirs {
    animation: apart-r 0.6s 0.5s ease-out both;
  }
  .sig.tear path {
    stroke: var(--np-spot);
    stroke-width: 1.8;
    stroke-dasharray: 520;
    stroke-dashoffset: 520;
    animation: sign 0.7s 0.3s ease-in forwards;
  }
  /* « Refusé »: a rubber stamp slammed across the notice, its ink soaked into the paper. */
  .stamp {
    position: absolute;
    right: 10px;
    top: 14px;
    padding: 2px 12px 3px;
    border: 2.5px solid var(--np-spot);
    border-radius: 3px;
    color: var(--np-spot);
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.1em;
    letter-spacing: 0.04em;
    transform: rotate(-9deg);
    opacity: 0.85;
    mix-blend-mode: multiply;
    animation: slam 0.32s 0.25s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  @keyframes slam {
    from {
      transform: rotate(-9deg) scale(2.2);
      opacity: 0;
    }
    to {
      transform: rotate(-9deg) scale(1);
      opacity: 0.85;
    }
  }
  @keyframes apart-l {
    to {
      transform: translateX(-8px) rotate(-4deg);
      opacity: 0.75;
    }
  }
  @keyframes apart-r {
    to {
      transform: translateX(8px) rotate(4deg);
      opacity: 0.75;
    }
  }
  @keyframes appear {
    0% {
      opacity: 0;
      transform: translateX(-50%) translateY(-8px);
    }
    8%,
    85% {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(-6px);
    }
  }
  @keyframes stamp {
    from {
      transform: scale(1.8);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  @keyframes sign {
    to {
      stroke-dashoffset: 0;
    }
  }
  :global(.reduced-motion) .stamp,
  :global(.reduced-motion) .pact,
  :global(.reduced-motion) .seal,
  :global(.reduced-motion) .mine,
  :global(.reduced-motion) .theirs,
  :global(.reduced-motion) .sig path {
    animation: none;
    stroke-dashoffset: 0;
  }
</style>
