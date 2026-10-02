<script lang="ts">
  // Current alliances, always in view: who, how long is left (a draining bar), and
  // the renewal button once the last 30 seconds have started.
  import { hud } from '../stores/game.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import { flagUrl } from '../../render/flags';
  import { ALLIANCE_TICKS, ALLIANCE_RENEW_WINDOW } from '../../core/game/constants';
  import Icon from '../icons/Icon.svelte';
  import { audio } from '../../audio/audio';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
  let open = $state(true);

  const rows = $derived(
    (hud.local?.allies ?? [])
      .map((a) => ({ ...a, p: hud.players.find((p) => p.id === a.id) }))
      .filter((r) => r.p && r.p.alive)
      .sort((a, b) => a.expiresIn - b.expiresIn),
  );
</script>

{#if rows.length}
  <section class="allies panel" data-testid="alliances" aria-label={t('alliances.title')}>
    <button class="head" onclick={() => (open = !open)} aria-expanded={open}>
      <Icon name="alliance" size={15} />
      <b>{t('alliances.title')}</b>
      <span class="n mono">{rows.length}</span>
      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
    </button>
    {#if open}
      <ul>
        {#each rows as r (r.id)}
          {@const renew = r.expiresIn <= ALLIANCE_RENEW_WINDOW}
          {@const asked = hud.local?.allyRequests.includes(r.id) ?? false}
          <li class:renew>
            <img src={flagUrl(r.p!, 24)} alt="" />
            <button class="name" onclick={() => ctl.renderer.camera.goTo(r.p!.label[0], r.p!.label[1], 2.2)}
              >{s.state.name(r.id, i18n.lang)}</button
            >
            <span class="time mono" data-tip={t('alliances.left')}>{clock(Math.max(0, r.expiresIn))}</span>
            <span class="bar" aria-hidden="true"
              ><i style="width:{Math.max(0, Math.min(100, (r.expiresIn / ALLIANCE_TICKS) * 100))}%"></i></span
            >
            {#if renew}
              <button
                class="btn small renewbtn"
                class:primary={asked}
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
  .allies {
    width: 268px;
    padding: 4px 0 6px;
    font-size: 0.86em;
  }
  .head {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 5px 10px;
    border: 0;
    background: transparent;
    color: var(--verdant);
    cursor: var(--cursor-pointer, pointer);
  }
  .head b {
    color: var(--parchment);
    font-weight: 600;
  }
  .n {
    margin-right: auto;
    color: var(--muted);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 10px;
    display: grid;
    gap: 6px;
  }
  li {
    display: grid;
    grid-template-columns: 22px 1fr auto;
    grid-template-areas: 'flag name time' 'bar bar bar' 'act act act';
    column-gap: 7px;
    row-gap: 3px;
    align-items: center;
  }
  img {
    grid-area: flag;
    width: 22px;
    height: 15px;
    object-fit: cover;
    border: 1px solid #0007;
  }
  .name {
    grid-area: name;
    appearance: none;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--parchment);
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover {
    color: var(--verdant);
  }
  .time {
    grid-area: time;
    color: var(--muted);
  }
  .bar {
    grid-area: bar;
    height: 3px;
    border-radius: 2px;
    background: var(--panel-3);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--verdant);
    transition: width 0.5s linear;
  }
  li.renew .bar i {
    background: var(--warn);
  }
  li.renew .time {
    color: var(--warn-text);
  }
  .renewbtn {
    grid-area: act;
    justify-self: start;
  }
</style>
