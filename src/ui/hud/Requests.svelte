<script lang="ts">
  // The World Council's vote, as a ballot printed on the Courier's paper (the news flash's
  // sibling): the time left and the votes cast as its dateline, the motions as printed
  // buttons, ours inked. Alliance offers have their own card: AllyRequests.svelte.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { COUNCIL_OPTIONS } from '../../core/rules/features';
  import { COUNCIL_VOTE_TICKS } from '../../core/game/constants';
  import Icon from '../icons/Icon.svelte';
  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;

  const council = $derived(hud.world?.council && hud.local?.alive ? hud.world.council : null);
  const left = $derived(council ? Math.max(0, council.closes - hud.tick) : 0);
  const mine = $derived(council && council.myVote >= 0 ? COUNCIL_OPTIONS[council.myVote] : undefined);
</script>

<div class="requests">
  {#if council}
    <section class="ballot newsprint rise-in" data-testid="council" aria-labelledby="council-title">
      <p class="kicker"><Icon name="council" size={13} />{t('council.kicker')}</p>
      <h3 id="council-title">{t('council.title')}</h3>
      <p class="dateline">
        <b>{Math.ceil(left / 10)} s</b>
        <span>{council.votes} {t('council.votes')}</span>
        <span class="cast" class:none={!mine}
          >{mine ? t('council.cast', { motion: t(`council.${mine}.name`) }) : t('council.notCast')}</span
        >
      </p>
      <span class="bar" aria-hidden="true"><i style="width:{(left / COUNCIL_VOTE_TICKS) * 100}%"></i></span>
      <div class="motions" role="group" aria-label={t('council.motions')}>
        {#each COUNCIL_OPTIONS as o, k (o)}
          {@const on = council.myVote === k}
          <button
            class="np-btn motion"
            class:ink={on}
            aria-pressed={on}
            onclick={() => s.cmd({ t: 'vote', option: k })}
            title={t(`council.${o}.desc`)}
            ><span class="box" aria-hidden="true"
              >{#if on}<Icon name="check" size={12} stroke={3} />{/if}</span
            ><span class="txt"><b>{t(`council.${o}.name`)}</b><small>{t(`council.${o}.desc`)}</small></span
            ></button
          >
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .requests {
    display: grid;
    gap: 8px;
    max-width: 420px;
  }
  .requests:empty {
    display: none;
  }
  .ballot {
    width: 300px;
    padding: 8px 14px 12px;
    border-radius: 1px;
    border-top: 3px solid var(--np-ink);
    font-family: var(--np-serif);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.45) inset,
      0 10px 24px rgba(3, 10, 16, 0.5);
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-family: var(--text);
    font-size: 0.76em;
    font-weight: 600;
    color: var(--np-spot);
  }
  h3 {
    margin: 2px 0 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.32em;
    line-height: 1.06;
    letter-spacing: -0.012em;
    color: var(--np-ink);
  }
  /* Time left and the votes cast, between fine rules. */
  .dateline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 1px 10px;
    margin: 6px 0 0;
    padding: 4px 0 3px;
    border-top: 1px solid var(--np-ink);
    border-bottom: 1px solid var(--np-ink);
    font-family: var(--text);
    font-size: 0.76em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
  }
  .dateline b {
    font-weight: 600;
    color: var(--np-ink);
  }
  .cast {
    margin-left: auto;
    font-weight: 600;
    color: var(--np-ink);
  }
  .cast.none {
    font-weight: 400;
    font-style: italic;
    color: var(--np-ink-2);
  }
  /* The vote's time, a printed bar that drains. */
  .bar {
    display: block;
    height: 3px;
    margin-top: 4px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--np-ink);
    transition: width 0.5s linear;
  }
  .motions {
    display: grid;
    gap: 5px;
    margin-top: 8px;
  }
  /* A motion: a box to tick, its name and what it does. */
  .ballot .motion {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr);
    align-items: start;
    gap: 9px;
    width: 100%;
    padding: 6px 9px 7px;
    text-align: left;
    white-space: normal;
  }
  .box {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    margin-top: 2px;
    border: 1.5px solid currentColor;
    border-radius: 1px;
  }
  .txt {
    display: grid;
    gap: 1px;
  }
  .txt b {
    font-weight: 600;
    font-size: 1.02em;
  }
  .txt small {
    font-family: var(--np-serif);
    font-weight: 400;
    font-size: 0.86em;
    line-height: 1.35;
    color: var(--np-ink-2);
  }
  .motion.ink small {
    color: color-mix(in srgb, var(--np-paper) 82%, transparent);
  }
  @media (prefers-reduced-motion: reduce) {
    .bar i {
      transition: none;
    }
  }
</style>
