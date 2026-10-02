<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import type { GameController } from '../game/controller';
  import { COUNCIL_OPTIONS } from '../../core/rules/features';
  import Icon from '../icons/Icon.svelte';
  import { flagUrl } from '../../render/flags';
  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
</script>

<div class="requests">
  {#each hud.local?.allyRequests ?? [] as from (from)}
    {@const pv = s.state.players.get(from)}
    <div class="req panel rise-in" data-testid="ally-request">
      {#if pv}<img class="flag" src={flagUrl(pv, 24)} alt="" />{/if}
      <span class="txt"
        ><Icon name="alliance" size={15} />{t('hud.allyRequestFrom', {
          name: s.state.name(from, i18n.lang),
        })}</span
      >
      <button class="btn primary" onclick={() => s.cmd({ t: 'allyAnswer', target: from, accept: true })}
        >{t('common.accept')} <kbd>{keyLabel(settings.keys.allyAccept ?? '')}</kbd></button
      >
      <button class="btn" onclick={() => s.cmd({ t: 'allyAnswer', target: from, accept: false })}
        >{t('common.refuse')} <kbd>{keyLabel(settings.keys.allyRefuse ?? '')}</kbd></button
      >
    </div>
  {/each}
  {#if hud.world?.council && hud.local?.alive}
    <div class="req council panel rise-in" data-testid="council">
      <div>
        <b><Icon name="council" size={15} /> {t('council.title')}</b>
        <small class="mono"
          >{Math.max(0, Math.ceil((hud.world.council.closes - hud.tick) / 10))} s · {hud.world.council.votes}
          {t('council.votes')}</small
        >
      </div>
      <div class="opts">
        {#each COUNCIL_OPTIONS as o, k (o)}
          <button
            class="btn"
            class:primary={hud.world.council.myVote === k}
            onclick={() => s.cmd({ t: 'vote', option: k })}
            title={t(`council.${o}.desc`)}>{t(`council.${o}.name`)}</button
          >
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .requests {
    position: absolute;
    left: 14px;
    top: 14px;
    display: grid;
    gap: 8px;
    z-index: 27;
    max-width: 420px;
  }
  .req {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0.7rem;
    font-size: 0.88em;
    flex-wrap: wrap;
  }
  .req .btn {
    padding: 0.3em 0.7em;
  }
  .flag {
    width: 24px;
    height: 18px;
    object-fit: cover;
    border: 1px solid #0006;
  }
  .txt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1;
  }
  .council {
    display: grid;
  }
  .council small {
    color: var(--faint);
    margin-left: 0.5rem;
  }
  .opts {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  kbd {
    font-family: var(--mono);
    font-size: 0.8em;
    opacity: 0.7;
  }
</style>
