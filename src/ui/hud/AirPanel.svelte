<script lang="ts">
  // Aircraft panel (shown while aiming a plane, in the launch panel's place): what the plane
  // will do there (the building a bomber hits and what is left of it, a patrol, a
  // reconnaissance zone) and what waits for it (SAMs, interceptors), or why it cannot go.
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short } from '../i18n/i18n.svelte';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS } from '../icons/icons';
  import { A, AIR_COST, BUILDING_KEYS } from '../../core/game/constants';
  import type { GameController } from '../game/controller';
  import { lockFor, techKey } from '../../core/rules/tech';
  import { zonePiece } from '../stores/layout.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const NAMES = ['fighter', 'bomber', 'recon'] as const;
  const tool = $derived(hud.tool.k === 'air' ? hud.tool : null);
  const kind = $derived((tool?.kind ?? 0) as A);
  const cost = $derived(AIR_COST[kind]);
  const broke = $derived((hud.local?.gold ?? 0) < cost);
  const aim = $derived(hud.airAim);
  const name = (id: number) => ctl.session.state.name(id, i18n.lang);
  const lock = $derived(
    hud.local && ctl.session.config.features.tech ? lockFor(hud.local.tech, 'airfield') : -1,
  );
</script>

{#if tool}
  <section
    class="air newsprint rise-in"
    data-testid="air-panel"
    aria-label={t(`unit.${NAMES[kind]}.name`)}
    use:zonePiece={{ id: 'launch' }}
  >
    <header>
      <span class="ico"
        ><Icon name={kind === A.Bomber ? 'bomb' : kind === A.Recon ? 'eye' : 'airfield'} size={18} /></span
      >
      <b>{t(`unit.${NAMES[kind]}.name`)}</b>
      <span class="cost mono">{short(cost)}</span>
      {#if aim}<span class="avail" data-tip={t('air.flyingTip')}
          >{t('air.flying', { n: aim.flying, max: aim.room })}</span
        >{/if}
    </header>
    <p class="role">{t(`air.role.${NAMES[kind]}`)}</p>

    <div class="verdict" aria-live="polite">
      {#if lock >= 0}
        <span class="chip bad"
          ><Icon name="lock" size={13} />{t('launch.locked', { tech: t(`${techKey(lock)}.name`) })}</span
        >
      {:else if !aim}
        <span class="chip">{t('launch.aim')}</span>
      {:else if aim.problem}
        <span class="chip bad" data-testid="air-problem"
          ><Icon name="close" size={13} />{t(`air.problem.${aim.problem}`)}</span
        >
      {:else}
        {#if broke}<span class="chip warn"><Icon name="gold" size={13} />{t('launch.gold')}</span>{/if}
        {#if kind === A.Bomber}
          {#if aim.target}
            <span class="chip good" data-testid="air-target"
              ><Icon name={BUILDING_ICONS[aim.target.type] ?? 'city'} size={13} />{aim.target.after === 0
                ? t('air.hitDestroy', {
                    building: t(`building.${BUILDING_KEYS[aim.target.type]}.name`),
                    player: name(aim.target.owner),
                  })
                : t('air.hitLevel', {
                    building: t(`building.${BUILDING_KEYS[aim.target.type]}.name`),
                    player: name(aim.target.owner),
                    from: aim.target.level,
                    to: aim.target.after,
                  })}</span
            >
            {#if aim.spotted}<span class="chip good"><Icon name="eye" size={13} />{t('air.spotted')}</span
              >{/if}
          {:else}
            <span class="chip warn"><Icon name="target" size={13} />{t('air.railsOnly')}</span>
          {/if}
          {#if aim.samMissiles > 0}
            <span class="chip bad" data-testid="air-sam"
              ><Icon name="sam" size={13} />{t('air.sam', { n: aim.samMissiles })}</span
            >
          {/if}
        {/if}
        {#if kind !== A.Fighter && aim.interceptors > 0}
          <span class="chip warn" data-testid="air-interceptors"
            ><Icon name="airfield" size={13} />{t('air.interceptors', { n: aim.interceptors })}</span
          >
        {/if}
        {#if kind === A.Bomber && aim.samMissiles === 0 && aim.interceptors === 0}
          <span class="chip good" data-testid="air-clear"
            ><Icon name="check" size={13} />{t('air.clear')}</span
          >
        {/if}
        {#if aim.betrays}
          <span class="chip warn"
            ><Icon name="brokenShield" size={13} />{t('launch.betray', { list: name(aim.betrays) })}</span
          >
        {/if}
      {/if}
    </div>

    <footer><span class="help">{t('launch.hint')}</span></footer>
  </section>
{/if}

<style>
  /* In the launch panel's place, at the top of the right column (zones.ts 'launch'). */
  .air {
    width: 100%;
    padding: 8px 12px 9px;
    display: grid;
    gap: 6px;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-brass);
    border-radius: 1px;
    box-shadow: var(--np-lift);
    font-family: var(--text);
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  header b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.12em;
    color: var(--np-ink);
  }
  .ico {
    color: var(--np-brass);
    display: inline-flex;
  }
  .cost {
    font-weight: 600;
    color: var(--np-brass);
  }
  .avail {
    margin-left: auto;
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .role {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.35;
    color: var(--np-ink-2);
  }
  .verdict {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  footer {
    display: flex;
    padding-top: 5px;
    border-top: 1px solid var(--np-rule);
    font-size: 0.74em;
  }
  .help {
    margin-left: auto;
    font-style: italic;
    color: var(--np-ink-3);
  }
</style>
