<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short } from '../i18n/i18n.svelte';
  import { currentSession } from '../stores/app.svelte';
  import { TERRAIN, RESOURCE_KEYS } from '../../core/map/terrain';
  import { BUILDING_KEYS } from '../../core/game/constants';

  const info = $derived.by(() => {
    const h = hud.hover;
    if (!h || hud.radial) return null;
    const s = currentSession()?.state;
    if (!s) return null;
    const p = h.owner > 0 ? s.players.get(h.owner) : undefined;
    return { h, p, name: s.name(h.owner, i18n.lang) };
  });
</script>

{#if info && (info.h.owner > 0 || info.h.building || info.h.resource > 0 || info.h.fallout > 0)}
  <div class="card glass" style="left:{info.h.sx + 18}px; top:{info.h.sy + 18}px">
    <div class="who">
      {info.name}{#if info.p?.traitor}
        💔{/if}{#if info.p && info.p.allies.includes(hud.viewer)}
        🤝{/if}
    </div>
    {#if info.p}
      <div class="row">
        <span>⚔ {short(info.p.troops)}</span><span>▦ {short(info.p.tiles)}</span
        >{#if info.p.kind === 'nation'}<span class="pers">{t(`personality.${info.p.personality}`)}</span>{/if}
      </div>
      {#if info.p.bigMalus > 0}<div class="malus">
          {t('hud.bigEmpire', { pct: Math.round(info.p.bigMalus * 100) })}
        </div>{/if}
    {/if}
    <div class="row muted">
      {t(`terrain.${TERRAIN[info.h.terrain]?.key ?? 'plains'}`)}{#if info.h.fallout > 0}
        · ☢ {t('hud.fallout')}{/if}
    </div>
    {#if info.h.building}<div class="row">
        {t(`building.${BUILDING_KEYS[info.h.building.type]}.name`)} · {t('hud.level')}
        {info.h.building.level}
      </div>{/if}
    {#if info.h.resource > 0}<div class="row res">
        ◆ {t(`resource.${RESOURCE_KEYS[info.h.resource]}`)}
      </div>{/if}
  </div>
{/if}

<style>
  .card {
    position: absolute;
    padding: 0.45rem 0.65rem;
    font-size: 0.8em;
    pointer-events: none;
    z-index: 25;
    max-width: 240px;
    border-radius: 10px;
  }
  .who {
    font-family: var(--title);
    font-size: 1.1em;
  }
  .row {
    display: flex;
    gap: 0.7rem;
  }
  .muted {
    color: var(--muted);
  }
  .pers {
    color: var(--faint);
  }
  .malus {
    color: var(--brass);
  }
  .res {
    color: var(--aurora);
  }
</style>
