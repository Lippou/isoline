<script lang="ts">
  // The World Council's vote (alliance offers have their own card: AllyRequests.svelte).
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { COUNCIL_OPTIONS } from '../../core/rules/features';
  import Icon from '../icons/Icon.svelte';
  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
</script>

<div class="requests">
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
    display: grid;
    gap: 8px;
    max-width: 420px;
  }
  .requests:empty {
    display: none;
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
</style>
