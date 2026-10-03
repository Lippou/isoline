<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { ratioText } from '../game/capitalWatch';
  import { currentSession } from '../stores/app.svelte';
  import { TERRAIN, RESOURCE_KEYS } from '../../core/map/terrain';
  import { BUILDING_KEYS } from '../../core/game/constants';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS } from '../icons/icons';
  import { UNIT_STRIDE } from '../../engine/protocol';
  import { U } from '../../core/units/unit';
  import { FOG_SIGHT, STORM_AIR_SPEED, STORM_SHIP_SPEED } from '../../core/rules/weather';
  import OpinionMeter from './OpinionMeter.svelte';
  import { pct } from './opinion';

  /** Weather over the hovered tile (storms first) and what it does there. */
  const sky = $derived.by(() => {
    const h = hud.hover;
    if (!h || hud.radial) return null;
    let found: { kind: 0 | 1 } | null = null;
    for (const c of hud.world?.weather ?? []) {
      if ((c.x - h.x - 0.5) ** 2 + (c.y - h.y - 0.5) ** 2 >= c.r * c.r) continue;
      found = c;
      if (c.kind === 0) break;
    }
    if (!found) return null;
    const pct = (f: number) => Math.round((1 - f) * 100);
    return found.kind === 0
      ? {
          icon: 'storm' as const,
          text: t('hover.storm', { ship: pct(STORM_SHIP_SPEED), air: pct(STORM_AIR_SPEED) }),
        }
      : { icon: 'fogBank' as const, text: t('hover.fogBank', { pct: pct(FOG_SIGHT) }) };
  });
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
    const war = !!p && !!hud.local?.wars.includes(p.id);
    const noTrade = !!p && !!hud.local?.noTrade.includes(p.id);
    // A neighbour massing an army on our border (view-only intelligence from the worker).
    const threat = p ? hud.local?.threats?.find((x) => x.id === p.id) : undefined;
    // What this nation thinks of us (and why, in short).
    const op = p ? hud.local?.opinions?.find((o) => o.id === p.id) : undefined;
    // The country's capital marker under the pointer.
    const capital = !!p && h.capital === p.id && p.capital >= 0;
    const terrain = TERRAIN[h.terrain];
    return {
      h,
      p,
      visible,
      allied,
      war,
      noTrade,
      threat,
      op,
      capital,
      terrain,
      name: s.name(h.owner, i18n.lang),
    };
  });
  /** What the hovered country owns: buildings (count and total levels) and fleet. */
  const assets = $derived.by(() => {
    const i = info;
    const s = currentSession()?.state;
    if (!i?.p || !s) return null;
    const count = new Array<number>(BUILDING_KEYS.length).fill(0);
    const levels = new Array<number>(BUILDING_KEYS.length).fill(0);
    for (const b of s.buildings) {
      if (b.owner !== i.p.id) continue;
      count[b.type]!++;
      levels[b.type]! += b.level;
    }
    let warships = 0;
    let transports = 0;
    for (let k = 0; k < s.unitCount; k++) {
      const o = k * UNIT_STRIDE;
      if (s.units[o + 2] !== i.p.id) continue;
      if (s.units[o + 1] === U.Warship) warships++;
      else if (s.units[o + 1] === U.Transport) transports++;
    }
    const items = BUILDING_KEYS.map((key, type) => ({
      icon: BUILDING_ICONS[type] ?? 'city',
      n: count[type]!,
      lv: levels[type]!,
      label: t(`building.${key}.name`),
    })).filter((x) => x.n > 0);
    return { items, warships, transports };
  });
  const relation = $derived.by(() => {
    const i = info;
    if (!i?.p) return '';
    if (i.p.id === hud.viewer) return t('hover.you');
    if (i.allied) return t('hover.ally');
    if (i.war) return t('hover.war');
    if (i.p.kind === 'tribe') return t('hover.tribe');
    return t(`personality.${i.p.personality}`);
  });
</script>

{#if info && (info.h.owner > 0 || info.h.building || info.h.resource > 0 || info.h.fallout > 0 || info.terrain?.passable || sky)}
  <div class="card panel" style="left:{info.h.sx + 18}px; top:{info.h.sy + 18}px">
    {#if info.p}
      <div class="who">
        <img src={flagUrl(info.p, 24)} alt="" />
        <div>
          <b
            class:ally={info.allied}
            class:war={info.war && !info.allied}
            class:traitor={info.p.traitor && !info.allied && !info.war}>{info.name}</b
          >
          <small>{relation}</small>
        </div>
        {#if info.p.traitor}<span class="tag traitor" title={t('hud.traitorMark')}
            ><Icon name="brokenShield" size={14} /><small class="mono"
              >{Math.ceil(info.p.traitorFor / 10)} s</small
            ></span
          >{/if}
        {#if info.allied}<span class="tag ally" title={t('hover.ally')}
            ><Icon name="alliance" size={14} /></span
          >{/if}
        {#if info.war}<span class="tag war" title={t('hover.war')}><Icon name="sword" size={14} /></span>{/if}
        {#if info.noTrade}<span class="tag" title={t('hover.noTrade')}><Icon name="noTrade" size={14} /></span
          >{/if}
        {#if info.threat}<span class="tag threat" title={t('threat.tag')}
            ><Icon name="warning" size={14} /></span
          >{/if}
      </div>
      {#if info.op}
        <div class="opinion" data-testid="hover-opinion">
          <OpinionMeter o={info.op} compact />
          {#if info.op.accept >= 0}<small class="mono" title={t('opinion.acceptTip')}
              ><Icon name="alliance" size={11} />{pct(info.op.accept)} %</small
            >{/if}
          {#each info.op.reasons.slice(0, 2) as [k, w] (k)}
            <span class="why" class:neg={w < 0}
              >{t(`opinion.reason.${k}`)} <b class="mono">{w > 0 ? '+' : ''}{w}</b></span
            >
          {/each}
        </div>
      {/if}
      {#if info.capital}
        <div class="line capital" data-testid="hover-capital">
          <Icon name="capital" size={13} />{info.p.id === hud.viewer
            ? t('hover.yourCapital')
            : t('hover.capital')}
        </div>
      {/if}
      <div class="stats">
        <span><Icon name="troops" size={13} />{short(info.p.troops)}</span>
        <span><Icon name="territory" size={13} />{short(info.p.tiles)}</span>
        {#if info.p.id === hud.viewer || info.allied}<span
            ><Icon name="gold" size={13} />{short(info.p.gold)}</span
          >{/if}
      </div>
      {#if assets && (assets.items.length || assets.warships || assets.transports)}
        <div class="assets" data-testid="hover-assets">
          {#each assets.items as a (a.icon)}
            <span title="{a.label} · {t('hover.levels', { n: a.lv })}"
              ><Icon name={a.icon} size={13} /><b class="mono">{a.n}</b>{#if a.lv > a.n}<small class="mono"
                  >{t('hover.lv', { n: a.lv })}</small
                >{/if}</span
            >
          {/each}
          {#if assets.warships}<span title={t('unit.warship.name')}
              ><Icon name="warship" size={13} /><b class="mono">{assets.warships}</b></span
            >{/if}
          {#if assets.transports}<span title={t('unit.transport.name')}
              ><Icon name="transport" size={13} /><b class="mono">{assets.transports}</b></span
            >{/if}
        </div>
      {/if}
      {#if info.p.bigMalus > 0}<div class="note">
          {t('hud.bigEmpire', { pct: Math.round(info.p.bigMalus * 100) })}
        </div>{/if}
      {#if info.threat}
        <div class="line threat" data-testid="hover-threat">
          <Icon name="warning" size={13} />
          <span
            >{t('hover.threat', { ratio: ratioText(info.threat.ratio) })}<small
              >{t(`threat.short.${info.threat.why}`)}</small
            ></span
          >
        </div>
      {/if}
      {#if info.p.disorgFor > 0}
        <div class="line bad">
          <Icon name="crisis" size={13} />{t('hover.disorg', { clock: clock(info.p.disorgFor) })}
        </div>
      {/if}
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
    {#if sky}<div class="line sky" data-testid="hover-weather">
        <Icon name={sky.icon} size={13} />{sky.text}
      </div>{/if}
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
    align-items: center;
    gap: 2px;
  }
  .tag small {
    color: inherit;
  }
  .ally {
    color: #6ee7a0;
  }
  .war {
    color: #ff7a7a;
  }
  .traitor {
    color: #ffd84d;
  }
  .assets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding-top: 4px;
    border-top: 1px solid var(--line);
    color: var(--muted);
  }
  .assets span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .assets b {
    color: var(--parchment);
    font-weight: 600;
  }
  .assets small {
    color: var(--faint);
  }
  .opinion {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
  }
  .opinion small {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    color: var(--muted);
  }
  .opinion .why {
    flex-basis: 100%;
    color: var(--muted);
    font-size: 0.94em;
  }
  .opinion .why b {
    color: var(--good-text);
    font-weight: 600;
  }
  .opinion .why.neg b {
    color: var(--bad-text);
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
  .capital {
    color: var(--parchment);
    font-weight: 600;
  }
  .capital :global(svg) {
    color: var(--brass);
  }
  /* Threatened border: the amber of the map's border glow. */
  .threat {
    color: #f3b24a;
  }
  .line.threat {
    align-items: flex-start;
  }
  .line.threat :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .line.threat span {
    display: grid;
  }
  .line.threat small {
    color: var(--muted);
  }
  .res {
    color: var(--aurora);
  }
  .sky {
    align-items: flex-start;
    color: #c9d6e8;
  }
  .sky :global(svg) {
    flex: none;
    margin-top: 2px;
  }
</style>
