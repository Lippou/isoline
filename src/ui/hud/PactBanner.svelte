<script lang="ts">
  // Alliance signed (or renewed): both flags sealed by a handshake, a signature
  // drawn on the parchment, then the banner fades out by itself. An offer turned down
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
      class="pact"
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
  /* Lower centre, above the build bar and the campaign guide: clear of the toasts and the launch panel. */
  .pact {
    position: absolute;
    left: 50%;
    bottom: calc(var(--hud-bar-h, 112px) + 138px);
    transform: translateX(-50%);
    z-index: 29;
    display: grid;
    justify-items: center;
    gap: 4px;
    padding: 12px 22px 8px;
    min-width: 300px;
    border-radius: 8px;
    border: 1px solid rgba(91, 224, 138, 0.55);
    background: linear-gradient(180deg, rgba(24, 33, 28, 0.96), rgba(15, 20, 18, 0.96));
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.5),
      0 0 26px rgba(91, 224, 138, 0.18);
    pointer-events: none;
    animation: appear 4.6s ease both;
  }
  .flags {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .flags img {
    width: 46px;
    height: 32px;
    object-fit: cover;
    border: 1px solid #0008;
    border-radius: 2px;
  }
  .seal {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    color: #5be08a;
    border: 2px solid #5be08a;
    background: rgba(91, 224, 138, 0.12);
    animation: stamp 0.5s 0.15s cubic-bezier(0.3, 1.6, 0.5, 1) both;
  }
  b {
    font-family: var(--title);
    font-size: 1.15em;
    color: #b9f3cc;
    letter-spacing: 0.02em;
  }
  .terms {
    font-size: 0.82em;
    color: var(--muted);
  }
  .sig {
    width: 180px;
    height: 26px;
  }
  .sig path {
    fill: none;
    stroke: #e8e5dd;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 420;
    stroke-dashoffset: 420;
    animation: sign 1.6s 0.35s ease-out forwards;
  }
  /* Turned down: cold red edge, the seal struck through, the flags drawn apart. */
  .pact.refused,
  .pact.betrayed {
    border-color: rgba(240, 96, 112, 0.6);
    background: linear-gradient(180deg, rgba(36, 22, 26, 0.96), rgba(20, 14, 16, 0.96));
    box-shadow:
      0 12px 32px rgba(0, 0, 0, 0.5),
      0 0 26px rgba(240, 96, 112, 0.16);
  }
  .refused .seal,
  .betrayed .seal {
    position: relative;
    color: #f06070;
    border-color: #f06070;
    background: rgba(240, 96, 112, 0.1);
  }
  .refused .seal::after,
  .betrayed .seal::after {
    content: '';
    position: absolute;
    left: 6px;
    right: 6px;
    top: 50%;
    height: 2px;
    background: #f06070;
    transform: rotate(-40deg);
    border-radius: 1px;
  }
  .refused b,
  .betrayed b {
    color: #ffc2c8;
  }
  .betrayed .mine {
    animation: apart-l 0.6s 0.5s ease-out both;
  }
  .betrayed .theirs {
    animation: apart-r 0.6s 0.5s ease-out both;
  }
  .sig.tear path {
    stroke: #f06070;
    stroke-width: 1.8;
    stroke-dasharray: 520;
    stroke-dashoffset: 520;
    animation: sign 0.7s 0.3s ease-in forwards;
  }
  /* « Refusé »: a rubber stamp slammed across the document. */
  .stamp {
    position: absolute;
    right: 10px;
    top: 14px;
    padding: 2px 12px 3px;
    border: 2.5px solid #f06070;
    border-radius: 4px;
    color: #f06070;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.1em;
    letter-spacing: 0.04em;
    transform: rotate(-9deg);
    opacity: 0.92;
    mix-blend-mode: screen;
    animation: slam 0.32s 0.25s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  @keyframes slam {
    from {
      transform: rotate(-9deg) scale(2.2);
      opacity: 0;
    }
    to {
      transform: rotate(-9deg) scale(1);
      opacity: 0.92;
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
      transform: translateX(-50%) translateY(-8px) scale(0.96);
    }
    8%,
    85% {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(-6px) scale(0.98);
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
