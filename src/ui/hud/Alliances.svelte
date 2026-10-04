<script lang="ts">
  // Current alliances, always in view: who, how long is left (a draining bar), and
  // the renewal button once the last 30 seconds have started. Short of room in the news
  // column (zones.ts) the list folds to its header, then to a chip (a click unfolds it).
  import { hud } from '../stores/game.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import { flagUrl } from '../../render/flags';
  import { ALLIANCE_TICKS, ALLIANCE_RENEW_WINDOW } from '../../core/game/constants';
  import Icon from '../icons/Icon.svelte';
  import { audio } from '../../audio/audio';
  import type { GameController } from '../game/controller';
  import { layout, zonePiece } from '../stores/layout.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
  let open = $state(true);

  const rows = $derived(
    (hud.local?.allies ?? [])
      .map((a) => ({ ...a, p: hud.players.find((p) => p.id === a.id) }))
      .filter((r) => r.p && r.p.alive)
      .sort((a, b) => a.expiresIn - b.expiresIn),
  );
  const level = $derived(layout.levelOf('alliances'));
  /** Unfolded by the player, the list asks the column for its room. */
  function toggle(): void {
    if (level !== 'full') {
      open = true;
      layout.pin('alliances');
    } else {
      open = !open;
      layout.pin('alliances', false);
    }
  }
</script>

{#if rows.length && level === 'chip'}
  <button
    class="zchip newsprint good"
    data-zone-chip
    data-testid="alliances"
    onclick={toggle}
    aria-label="{t('alliances.title')} — {t('zone.unfold')}"
    use:zonePiece={{ id: 'alliances', level }}
    ><Icon name="alliance" size={13} /><b>{t('alliances.title')}</b><span class="mono">{rows.length}</span
    ></button
  >
{:else if rows.length}
  <section
    class="allies newsprint"
    data-testid="alliances"
    aria-label={t('alliances.title')}
    use:zonePiece={{ id: 'alliances', level }}
  >
    <button class="head" onclick={toggle} aria-expanded={open && level === 'full'}>
      <Icon name="alliance" size={15} />
      <b>{t('alliances.title')}</b>
      <span class="n mono">{rows.length}</span>
      <Icon name={open && level === 'full' ? 'chevronDown' : 'chevronRight'} size={14} />
    </button>
    {#if open && level === 'full'}
      <ul>
        {#each rows as r (r.id)}
          {@const renew = r.expiresIn <= ALLIANCE_RENEW_WINDOW}
          {@const asked = hud.local?.allyRequests.includes(r.id) ?? false}
          <li class:renew>
            <img src={flagUrl(r.p!, 24)} alt="" />
            <button class="name" onclick={() => ctl.focusPlayer(r.id)}>{s.state.name(r.id, i18n.lang)}</button
            >
            <span class="time mono" data-tip={t('alliances.left')}>{clock(Math.max(0, r.expiresIn))}</span>
            <span class="bar" aria-hidden="true"
              ><i style="width:{Math.max(0, Math.min(100, (r.expiresIn / ALLIANCE_TICKS) * 100))}%"></i></span
            >
            {#if renew}
              <button
                class="renewbtn"
                class:asked
                onclick={() => {
                  audio.ui('confirm');
                  s.cmd({ t: 'allyRequest', target: r.id });
                }}
                data-tip={t(asked ? 'alliances.acceptRenewTip' : 'alliances.renewTip')}
                ><Icon name="renew" size={13} />{t(
                  asked ? 'alliances.acceptRenew' : 'alliances.renew',
                )}</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  /* A card of the column: the alliance's green rule over it, each pact with its time draining. */
  .allies {
    width: 100%;
    padding: 2px 0 8px;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-good);
    border-radius: 1px;
    box-shadow: var(--np-lift);
    font-size: 0.86em;
  }
  .head {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 5px 10px 4px;
    border: 0;
    background: transparent;
    color: var(--np-good);
    cursor: var(--cursor-pointer, pointer);
  }
  .head b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.08em;
    color: var(--np-ink);
  }
  .head:hover b {
    text-decoration: underline;
    text-decoration-color: var(--np-rule-2);
    text-underline-offset: 3px;
  }
  .n {
    margin-right: auto;
    font-weight: 600;
    color: var(--np-ink-3);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 10px;
    display: grid;
  }
  li {
    display: grid;
    grid-template-columns: 22px 1fr auto;
    grid-template-areas: 'flag name time' 'bar bar bar' 'act act act';
    column-gap: 7px;
    row-gap: 3px;
    align-items: center;
    padding: 5px 0 6px;
    border-top: 1px solid var(--np-rule);
  }
  img {
    grid-area: flag;
    width: 22px;
    height: 15px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .name {
    grid-area: name;
    appearance: none;
    border: 0;
    padding: 0;
    background: transparent;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.04em;
    color: var(--np-ink);
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover {
    text-decoration: underline;
    text-decoration-color: var(--np-rule-2);
    text-underline-offset: 3px;
  }
  .time {
    grid-area: time;
    font-weight: 600;
    color: var(--np-ink-2);
  }
  /* The pact's time left: a printed bar in the alliance's green, brass once renewal opens. */
  .bar {
    grid-area: bar;
    height: 3px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--np-good);
    transition: width 0.5s linear;
  }
  li.renew .bar i {
    background: var(--np-gold);
  }
  li.renew .time {
    color: var(--np-warn);
  }
  .renewbtn {
    grid-area: act;
    justify-self: start;
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--np-good);
    border-radius: 2px;
    background: transparent;
    font-family: var(--text);
    font-size: 0.9em;
    font-weight: 600;
    color: var(--np-good);
    cursor: var(--cursor-pointer, pointer);
  }
  .renewbtn:hover,
  .renewbtn:focus-visible {
    background: color-mix(in srgb, var(--np-good) 9%, transparent);
  }
  /* They asked first: renewing is accepting (filled, as the offers' Accept). */
  .renewbtn.asked {
    background: var(--np-good);
    color: #f8f4ec;
  }
  .renewbtn.asked:hover,
  .renewbtn.asked:focus-visible {
    background: #1f5a3c;
  }
  /* Short windows: a long list of allies scrolls instead of pushing the column down. */
  @media (max-height: 900px) {
    ul {
      max-height: 168px;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--np-rule-2) transparent;
    }
  }
</style>
