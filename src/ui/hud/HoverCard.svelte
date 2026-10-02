<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short } from '../i18n/i18n.svelte';
  import { currentSession } from '../stores/app.svelte';
  import { TERRAIN, RESOURCE_KEYS } from '../../core/map/terrain';
  import { BUILDING_KEYS } from '../../core/game/constants';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS } from '../icons/icons';

  const info = $derived.by(() => {
    const h = hud.hover;
    if (!h || hud.radial) return null;
    const s = currentSession()?.state;
    if (!s) return null;
    // Fog of war: other players' details only where the viewer can see.
    let visible = true;
    const me = s.players.get(s.viewer);
    if (s.fog && s.viewer > 0 && h.owner > 0 && h.owner !== s.viewer && !me?.allies.includes(h.owner)) {
      const w = s.width;
      const fx = Math.min(s.fog.w - 1, Math.floor((h.tile % w) / 4));
      const fy = Math.min(s.fog.h - 1, Math.floor(Math.floor(h.tile / w) / 4));
      visible = s.fog.data[fy * s.fog.w + fx] === 255;
    }
    const p = h.owner > 0 && visible ? s.players.get(h.owner) : undefined;
    const allied = !!p && p.allies.includes(hud.viewer);
    const terrain = TERRAIN[h.terrain];
    return { h, p, visible, allied, terrain, name: s.name(h.owner, i18n.lang) };
  });
  const relation = $derived.by(() => {
    const i = info;
    if (!i?.p) return '';
    if (i.p.id === hud.viewer) return t('hover.you');
    if (i.allied) return t('hover.ally');
    if (i.p.kind === 'tribe') return t('hover.tribe');
    return t(`personality.${i.p.personality}`);
  });
</script>

{#if info && (info.h.owner > 0 || info.h.building || info.h.resource > 0 || info.h.fallout > 0 || info.terrain?.passable)}
  <div class="card panel" style="left:{info.h.sx + 18}px; top:{info.h.sy + 18}px">
    {#if info.p}
      <div class="who">
        <img src={flagUrl(info.p, 24)} alt="" />
        <div>
          <b>{info.name}</b>
          <small>{relation}</small>
        </div>
        {#if info.p.traitor}<span class="tag bad" title={t('hud.traitorMark')}
            ><Icon name="traitor" size={14} /></span
          >{/if}
        {#if info.allied}<span class="tag good" title={t('hover.ally')}
            ><Icon name="alliance" size={14} /></span
          >{/if}
      </div>
      <div class="stats">
        <span><Icon name="troops" size={13} />{short(info.p.troops)}</span>
        <span><Icon name="territory" size={13} />{short(info.p.tiles)}</span>
      </div>
      {#if info.p.bigMalus > 0}<div class="note">
          {t('hud.bigEmpire', { pct: Math.round(info.p.bigMalus * 100) })}
        </div>{/if}
    {:else if info.h.owner > 0}
      <div class="who"><Icon name="fog" size={16} /><b>{t('hover.unknown')}</b></div>
    {/if}
    <div class="terrain">
      <Icon name="terrain" size={13} />
      <span>{t(`terrain.${info.terrain?.key ?? 'plains'}`)}</span>
      {#if info.terrain?.passable}<span class="mono cost" title={t('hover.attackCostTip')}
          >×{((info.terrain.mag || 80) / 80).toFixed(2)}</span
        >{/if}
    </div>
    {#if info.h.fallout > 0}<div class="line bad"><Icon name="nuke" size={13} />{t('hud.fallout')}</div>{/if}
    {#if info.h.building && info.visible}
      <div class="line">
        <Icon name={BUILDING_ICONS[info.h.building.type] ?? 'city'} size={13} />
        {t(`building.${BUILDING_KEYS[info.h.building.type]}.name`)} · {t('hud.level')}
        {info.h.building.level}
      </div>
    {/if}
    {#if info.h.resource > 0}
      <div class="line res">
        <Icon
          name={(['gold', 'oil', 'uranium', 'fertile', 'metals'] as const)[info.h.resource] ?? 'gold'}
          size={13}
        />
        {t(`resource.${RESOURCE_KEYS[info.h.resource]}`)}
      </div>
    {/if}
  </div>
{/if}

<style>
  .card {
    position: absolute;
    padding: 8px 10px;
    font-size: 0.82em;
    pointer-events: none;
    z-index: 25;
    min-width: 170px;
    max-width: 250px;
    display: grid;
    gap: 5px;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .who img {
    width: 26px;
    height: 19px;
    object-fit: cover;
    border: 1px solid #0006;
  }
  .who div {
    display: grid;
    flex: 1;
  }
  .who b {
    font-family: var(--title);
    font-size: 1.08em;
  }
  .who small {
    color: var(--faint);
  }
  .tag {
    display: inline-flex;
  }
  .stats {
    display: flex;
    gap: 12px;
    color: var(--parchment);
  }
  .stats span,
  .line,
  .terrain {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .terrain {
    color: var(--muted);
    border-top: 1px solid var(--line);
    padding-top: 5px;
  }
  .cost {
    margin-left: auto;
    color: var(--brass);
  }
  .note {
    color: var(--brass);
    font-size: 0.92em;
  }
  .res {
    color: var(--aurora);
  }
</style>
