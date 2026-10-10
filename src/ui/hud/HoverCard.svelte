<script lang="ts">
  import { activeEvent } from './worldEvents';
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { ratioText } from '../game/capitalWatch';
  import { currentSession } from '../stores/app.svelte';
  import { TERRAIN, RESOURCE_KEYS } from '../../core/map/terrain';
  import {
    B,
    BUILDING_KEYS,
    DEMOLISH_REFUND,
    RECON_LOSS_MULT,
    REVOLUTION_BARRICADE_MULT,
    REVOLUTION_GUERRILLA_HOME,
    REVOLUTION_GUERRILLA_MAG,
    REVOLUTION_GUERRILLA_SPEED,
    REVOLUTION_SPREAD_HOLD,
  } from '../../core/game/constants';
  import { reconZones } from '../game/airPreview';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS } from '../icons/icons';
  import { UNIT_STRIDE } from '../../engine/protocol';
  import { U } from '../../core/units/unit';
  import { FOG_SIGHT, STORM_AIR_SPEED, STORM_SHIP_SPEED } from '../../core/rules/weather';
  import OpinionMeter from './OpinionMeter.svelte';
  import { pct } from './opinion';
  import { isTeammate } from '../game/team';
  import { truceCovers, truceOf } from '../game/truce';
  import { truceText } from './nukeHalt';
  import { unitHover, type UnitRelation, type UnitStatus } from '../game/unitHover';
  import type { IconName } from '../icons/icons';

  /** The relation is printed with an icon and a word, never by colour alone. */
  const REL_ICON: Record<UnitRelation, IconName> = {
    you: 'user',
    teammate: 'users',
    ally: 'alliance',
    enemy: 'sword',
    neutral: 'dot',
  };
  const TYPE_ICON: Record<string, IconName> = {
    transport: 'transport',
    warship: 'warship',
    merchant: 'trade',
    train: 'train',
    fighter: 'airfield',
    bomber: 'bomb',
    recon: 'eye',
  };
  const STATUS_ICON: Record<UnitStatus, IconName> = {
    turnedBack: 'undo',
    patrolling: 'eye',
    repairing: 'port',
    docked: 'port',
    pirated: 'warning',
    returning: 'undo',
    intercepting: 'target',
    orbiting: 'eye',
  };
  /** The ship, plane or train under the pointer (refreshed every tick: troops, hull, course). */
  const unit = $derived.by(() => {
    const u = hud.hoverUnit;
    void hud.tick;
    if (!u || hud.radial) return null;
    const s = currentSession()?.state;
    if (!s) return null;
    const d = unitHover(s, hud.local?.wars ?? [], u.id);
    if (!d) return null;
    const p = s.players.get(d.owner);
    const over = d.status === 'patrolling' || d.status === 'orbiting';
    return {
      u,
      d,
      p,
      name: s.name(d.owner, i18n.lang),
      dest:
        d.dest === null
          ? ''
          : d.dest > 0
            ? t(over ? 'unitHover.over' : 'unitHover.to', { name: s.name(d.dest, i18n.lang) })
            : t('unitHover.toWild'),
    };
  });

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
  /** Whether (x, y) lies in the circle of an earthquake under way (its buildings are being repaired). */
  function quakeHit(x: number, y: number): boolean {
    const e = activeEvent(hud.world, hud.tick);
    return !!e && e.id === 'earthquake' && (e.x - x - 0.5) ** 2 + (e.y - y - 0.5) ** 2 <= e.r * e.r;
  }
  const info = $derived.by(() => {
    const h = hud.hover;
    if (!h || hud.radial) return null;
    // Laying an offensive line or aiming its arrow: the note by the pointer says it all, and
    // the card would hide the border and the arrow.
    const tl = hud.tool;
    if (tl.k === 'assault' || (tl.k === 'line' && tl.kind === 1)) return null;
    // (Over an arrow or a grip, or dragging one: its note says what to do.)
    if (hud.lineTip && tl.k === 'none') return null;
    const s = currentSession()?.state;
    if (!s) return null;
    // Fog of war: other players' details only where the viewer can see.
    let visible = true;
    const me = s.players.get(s.viewer);
    const friend = !!me?.allies.includes(h.owner) || isTeammate(s.players, s.viewer, h.owner);
    if (s.fog && s.viewer > 0 && h.owner > 0 && h.owner !== s.viewer && !friend) {
      const w = s.width;
      const fx = Math.min(s.fog.w - 1, Math.floor((h.tile % w) / 4));
      const fy = Math.min(s.fog.h - 1, Math.floor(Math.floor(h.tile / w) / 4));
      visible = s.fog.data[fy * s.fog.w + fx] === 255;
    }
    const p = h.owner > 0 && visible ? s.players.get(h.owner) : undefined;
    // A teammate reads like an ally (allies for good), with its own word.
    const mate = !!p && isTeammate(s.players, s.viewer, p.id);
    const allied = !!p && (mate || p.allies.includes(hud.viewer));
    const war = !!p && !!hud.local?.wars.includes(p.id);
    const noTrade = !!p && !!hud.local?.noTrade.includes(p.id);
    // A neighbour massing an army on our border (view-only intelligence from the worker).
    const threat = p ? hud.local?.threats?.find((x) => x.id === p.id) : undefined;
    // What this nation thinks of us (and why, in short).
    const op = p ? hud.local?.opinions?.find((o) => o.id === p.id) : undefined;
    // The country's capital marker under the pointer.
    const capital = !!p && h.capital === p.id && p.capital >= 0;
    // Land border with us (what a land attack needs); spectators have no "us".
    const border =
      !p || p.id === hud.viewer || !hud.local ? null : (hud.local.neighbors?.includes(p.id) ?? false);
    const terrain = TERRAIN[h.terrain];
    return {
      h,
      p,
      visible,
      allied,
      mate,
      war,
      noTrade,
      threat,
      op,
      capital,
      border,
      terrain,
      name: s.name(h.owner, i18n.lang),
      // A revolution (rules/revolution.ts): whom it rose against, and when it runs out of steam.
      revolt:
        p && p.revoltFor !== undefined
          ? {
              against: s.name(p.rebelOf, i18n.lang),
              left: p.revoltFor,
              mine: p.rebelOf === s.viewer,
              ...guerrillaLines(p.revoltBarricades ?? 0, p.revoltSpreadIn ?? -1, !!p.revoltHolds, p),
            }
          : null,
    };
  });
  const num = (v: number) => v.toLocaleString(i18n.lang, { maximumFractionDigits: 1 });
  /**
   * Why a revolution is hard to retake (rules/revolution.ts, 1.16): the guerrilla's toll —
   * behind the barricades for a while — and whether it is about to spread.
   */
  function guerrillaLines(
    barricades: number,
    spreadIn: number,
    holds: boolean,
    p: { tiles: number; revoltLand?: number; rebelOf: number },
  ) {
    const bar = barricades > 0 ? REVOLUTION_BARRICADE_MULT : 1;
    const params = {
      mag: num(REVOLUTION_GUERRILLA_MAG * bar),
      home: num(REVOLUTION_GUERRILLA_MAG * REVOLUTION_GUERRILLA_HOME * bar),
      speed: num(REVOLUTION_GUERRILLA_SPEED * bar),
      clock: clock(barricades),
    };
    // (Their pushes into the country can take them past the land they raised: 100 % at most.)
    const held = Math.min(100, Math.round((100 * p.tiles) / Math.max(1, p.revoltLand ?? p.tiles)));
    const guerrilla = t(barricades > 0 ? 'hover.barricades' : 'hover.guerrilla', params);
    const spread =
      spreadIn < 0
        ? ''
        : holds
          ? t('hover.revoltSpread', { clock: clock(spreadIn), held })
          : t('hover.revoltContained', { held, bar: Math.round(REVOLUTION_SPREAD_HOLD * 100) });
    return { guerrilla, spread, barricades: barricades > 0, holds };
  }
  /** The hovered building as it stands now (its demolition countdown runs while the pointer rests). */
  const liveBuilding = $derived.by(() => {
    void hud.tick;
    const id = info?.h.building?.id;
    if (id === undefined) return null;
    return currentSession()?.state.buildings.find((b) => b.id === id) ?? null;
  });
  const demolish = $derived(liveBuilding?.demolish ?? info?.h.building?.demolish ?? 0);
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
  /**
   * Reconnaissance (GAME_DESIGN.md §11): over a foreign country under one of our zones, what
   * is hidden otherwise — its treasury, loaded silo tubes, SAM missiles and interceptors on
   * alert — and the edge our attacks get there.
   */
  const intel = $derived.by(() => {
    const i = info;
    const s = currentSession()?.state;
    if (!i?.p || !s || i.p.id === hud.viewer || i.allied || hud.viewer <= 0) return null;
    const x = (i.h.tile % s.width) + 0.5;
    const y = Math.floor(i.h.tile / s.width) + 0.5;
    if (!reconZones(s, hud.viewer).some((z) => (z.x - x) ** 2 + (z.y - y) ** 2 <= z.r * z.r)) return null;
    const sum = (type: number) => {
      let ready = 0;
      let all = 0;
      for (const b of s.buildings) {
        if (b.owner !== i.p!.id || b.type !== type || !b.ready) continue;
        ready += Math.min(b.level, b.tubesReady);
        all += b.level;
      }
      return { ready, all };
    };
    return {
      gold: i.p.gold,
      silos: sum(B.Silo),
      sams: sum(B.Sam),
      alert: sum(B.Airfield),
      pct: Math.round((1 - RECON_LOSS_MULT) * 100),
    };
  });
  /** A truce (peace summit, Council's ceasefire) between us and the hovered country: no attack meanwhile. */
  const truce = $derived.by(() => {
    const i = info;
    const s = currentSession()?.state;
    if (!i?.p || !s || i.allied) return null;
    const tr = truceOf(hud.world, hud.tick);
    return tr && truceCovers(s.players, s.viewer, i.p.id) ? tr : null;
  });
  /** Our own airfield under the pointer: its interceptors on alert. */
  const alert = $derived.by(() => {
    const b = info?.h.building;
    if (!b || b.type !== B.Airfield || b.owner !== hud.viewer) return null;
    return { ready: Math.min(b.level, b.tubes ?? b.level), all: b.level };
  });
  const relation = $derived.by(() => {
    const i = info;
    if (!i?.p) return '';
    if (i.p.id === hud.viewer) return t('hover.you');
    if (i.mate) return t('hover.teammate');
    if (i.allied) return t('hover.ally');
    if (i.war) return t('hover.war');
    if (i.revolt) return t('hover.revolution');
    if (i.p.kind === 'tribe') return t('hover.tribe');
    return t(`personality.${i.p.personality}`);
  });
</script>

{#if unit}
  {@const d = unit.d}
  <div
    class="card panel unit"
    data-testid="hover-unit"
    style="left:{unit.u.sx + 18}px; top:{unit.u.sy + 18}px"
  >
    <div class="who">
      {#if unit.p}<img src={flagUrl(unit.p, 24)} alt="" />{/if}
      <div>
        <b class:ally={d.relation === 'ally' || d.relation === 'teammate'} class:war={d.relation === 'enemy'}
          >{unit.name}</b
        >
        {#if d.relation}<small class="rel {d.relation}" data-testid="hover-unit-relation"
            ><Icon name={REL_ICON[d.relation]} size={12} />{t(`unitHover.rel.${d.relation}`)}</small
          >{/if}
      </div>
    </div>
    <div class="line kind">
      <Icon name={TYPE_ICON[d.key] ?? 'warship'} size={13} /><b>{t(`unitHover.type.${d.key}`)}</b>
      {#if d.veteran > 0}<small class="mono">{t('unitHover.veteran', { n: d.veteran })}</small>{/if}
    </div>
    {#if d.troops !== null}
      <div class="line" data-testid="hover-unit-troops">
        <Icon name="troops" size={13} />{t('unitHover.troops', { n: short(d.troops) })}
      </div>
    {/if}
    {#if d.hp !== null}
      <div class="line hull" class:bad={d.hp < 0.5} data-testid="hover-unit-hp">
        <Icon name="immune" size={13} /><span class="mono"
          >{t('unitHover.hull', { pct: Math.round(d.hp * 100) })}</span
        >
        <span class="meter" aria-hidden="true"><i style="width:{Math.round(d.hp * 100)}%"></i></span>
      </div>
    {/if}
    {#if d.status}
      <div class="line status">
        <Icon name={STATUS_ICON[d.status]} size={13} />{t(`unitHover.status.${d.status}`)}
      </div>
    {/if}
    {#if unit.dest}
      <div class="line dest" data-testid="hover-unit-dest"><Icon name="next" size={13} />{unit.dest}</div>
    {/if}
  </div>
{:else if info && (info.h.owner > 0 || info.h.building || info.h.resource > 0 || info.h.fallout > 0 || info.terrain?.passable || sky)}
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
        {#if info.allied}<span class="tag ally" title={t(info.mate ? 'hover.teammate' : 'hover.ally')}
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
      {#if info.revolt}
        <div class="line revolt" class:bad={info.revolt.mine} data-testid="hover-revolt">
          <Icon name="revolt" size={13} /><span
            >{t('hover.revolt', { player: info.revolt.against, time: clock(info.revolt.left) })}<small
              >{t('hover.revoltTip')}</small
            ></span
          >
        </div>
        <!-- Why retaking it is hard: the guerrilla (behind barricades at first), the contagion. -->
        <div class="line revolt guerrilla" data-testid="hover-guerrilla">
          <Icon name={info.revolt.barricades ? 'defensePost' : 'war'} size={13} /><span
            >{info.revolt.guerrilla}</span
          >
        </div>
        {#if info.revolt.spread}
          <div class="line revolt" class:bad={info.revolt.holds} data-testid="hover-spread">
            <Icon name={info.revolt.holds ? 'warning' : 'borders'} size={13} /><span
              >{info.revolt.spread}</span
            >
          </div>
        {/if}
      {/if}
      {#if truce}
        <div class="line truce" data-testid="hover-truce">
          <Icon name="ceasefire" size={13} /><span>{truceText(truce, 'attack')}</span>
        </div>
      {/if}
      {#if info.capital}
        <div class="line capital" data-testid="hover-capital">
          <Icon name="capital" size={13} />{info.p.id === hud.viewer
            ? t('hover.yourCapital')
            : t('hover.capital')}
        </div>
      {/if}
      {#if info.border !== null}
        <div class="line border" class:shared={info.border} data-testid="hover-border">
          <Icon name="borders" size={13} />{info.border ? t('hover.border') : t('hover.noBorder')}
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
      {#if intel}
        <div class="line intel" data-testid="hover-recon">
          <Icon name="eye" size={13} />
          <span
            >{t('hover.recon.title')}<small
              >{t('hover.recon.gold', { gold: short(intel.gold) })}{#if intel.silos.all}
                · {t('hover.recon.silos', {
                  n: intel.silos.ready,
                  m: intel.silos.all,
                })}{/if}{#if intel.sams.all}
                · {t('hover.recon.sams', {
                  n: intel.sams.ready,
                  m: intel.sams.all,
                })}{/if}{#if intel.alert.all}
                · {t('hover.recon.alert', { n: intel.alert.ready, m: intel.alert.all })}{/if}
              · {t('hover.recon.attack', { pct: intel.pct })}</small
            ></span
          >
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
    {#if info.terrain?.harsh && info.terrain.passable}<div class="note" data-testid="hover-harsh">
        {t('hover.harshTerrain')}
      </div>{/if}
    {#if info.h.fallout > 0}<div class="line bad"><Icon name="nuke" size={13} />{t('hud.fallout')}</div>{/if}
    {#if sky}<div class="line sky" data-testid="hover-weather">
        <Icon name={sky.icon} size={13} />{sky.text}
      </div>{/if}
    {#if info.h.building && info.visible}
      <div class="line">
        <Icon name={BUILDING_ICONS[info.h.building.type] ?? 'city'} size={13} />
        {t(`building.${BUILDING_KEYS[info.h.building.type]}.name`)} · {t('hud.level')}
        {info.h.building.level}
        {#if info.h.building.upgrade >= 0}<span class="up mono" data-testid="hover-upgrading"
            >{t('hover.upgrading', {
              next: info.h.building.level + 1,
              pct: Math.floor(info.h.building.upgrade * 100),
            })}</span
          >{/if}
        {#if alert}<span class="up mono" data-testid="hover-alert"
            >{t('hover.alert', { n: alert.ready, m: alert.all })}</span
          >{/if}
      </div>
      {#if demolish > 0}
        <!-- Being demolished (1.16): out of service, down when the countdown ends. -->
        <div class="line bad demolish" data-testid="hover-demolish">
          <Icon name="trash" size={13} /><span
            >{t('hover.demolishing', { clock: clock(demolish) })}<small
              >{t('hover.demolishTip', { pct: Math.round(DEMOLISH_REFUND * 100) })}</small
            ></span
          >
        </div>
      {/if}
      {#if (info.h.building.occupied ?? 0) > 0}
        {@const secs = Math.ceil((info.h.building.occupied ?? 0) / 10)}
        <!-- Taken by conquest: looted, and out of service a while (GAME_DESIGN.md §6.4); or
             struck by an earthquake (world event), being repaired. -->
        <div class="line bad occupied" data-testid="hover-occupied">
          {#if quakeHit(info.h.x, info.h.y)}<Icon name="earthquake" size={13} /><span
              >{t('worldEventBlock.occupiedQuake', { s: secs })}</span
            >{:else}<Icon name="time" size={13} /><span
              >{t('hover.occupied', { s: secs })}<small>{t('hover.occupiedTip')}</small></span
            >{/if}
        </div>
      {/if}
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
  /* Touch web version: no pointer hovers there — a tap attacks, it opens no card (the long
     press's menu says what the place is). */
  :global(html.tactile) .card {
    display: none;
  }
  /* What is under the pointer: a small card of paper that follows it (it never takes the pointer). */
  .card {
    position: absolute;
    padding: 7px 10px 8px;
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
    padding-bottom: 4px;
    border-bottom: 1px solid var(--np-ink);
  }
  .who img {
    width: 26px;
    height: 18px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .who div {
    display: grid;
    flex: 1;
  }
  .who b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.12em;
    line-height: 1.15;
    color: var(--np-ink);
  }
  .who small {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.94em;
    color: var(--np-ink-2);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--np-ink-2);
  }
  .tag small {
    color: inherit;
  }
  .who .ally,
  .tag.ally {
    color: var(--np-good);
  }
  .who .war,
  .tag.war {
    color: var(--np-spot);
  }
  .who .traitor,
  .tag.traitor {
    color: var(--np-warn);
  }
  .assets {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding-top: 4px;
    border-top: 1px solid var(--np-rule);
    color: var(--np-ink-2);
  }
  .assets span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .assets b {
    color: var(--np-ink);
    font-weight: 600;
  }
  .assets small {
    color: var(--np-ink-3);
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
    color: var(--np-ink-2);
  }
  .opinion .why {
    flex-basis: 100%;
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.94em;
  }
  .opinion .why b {
    font-family: var(--text);
    color: var(--np-good);
    font-weight: 600;
  }
  .opinion .why.neg b {
    color: var(--np-spot);
  }
  .stats {
    display: flex;
    gap: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink);
  }
  .stats :global(svg) {
    color: var(--np-ink-2);
  }
  .stats span,
  .line,
  .terrain {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .line {
    color: var(--np-ink);
  }
  .line.bad {
    color: var(--np-spot);
  }
  .terrain {
    color: var(--np-ink-2);
    border-top: 1px solid var(--np-rule);
    padding-top: 5px;
  }
  .cost {
    margin-left: auto;
    font-weight: 600;
    color: var(--np-brass);
  }
  .note {
    color: var(--np-warn);
    font-size: 0.92em;
  }
  .capital {
    color: var(--np-ink);
    font-weight: 600;
  }
  .capital :global(svg) {
    color: var(--np-brass);
  }
  /* Threatened border: the amber of the map's border glow, in the paper's brass. */
  .threat,
  .tag.threat {
    color: var(--np-warn);
  }
  .line.threat {
    align-items: flex-start;
  }
  /* Reconnaissance: the hidden numbers, in the sea ink of intelligence. */
  .line.intel {
    align-items: flex-start;
    color: var(--np-sea);
  }
  .line.intel :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .line.intel span {
    display: grid;
    font-weight: 600;
  }
  .line.intel small {
    font-weight: 400;
    color: var(--np-ink-2);
  }
  .border {
    color: var(--np-ink-2);
  }
  .border.shared {
    color: var(--np-warn);
  }
  .up {
    font-weight: 600;
    color: var(--np-warn);
  }
  /* A captured building under occupation: out of service for a while. */
  .line.occupied,
  .line.demolish {
    align-items: flex-start;
  }
  .line.occupied :global(svg),
  .line.demolish :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .line.revolt {
    align-items: flex-start;
  }
  .line.revolt :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .line.revolt span {
    display: grid;
    font-weight: 600;
  }
  .line.revolt small {
    font-weight: 400;
    color: var(--np-ink-2);
  }
  .line.occupied span,
  .line.demolish span {
    display: grid;
    font-weight: 600;
  }
  .line.occupied small,
  .line.demolish small {
    font-weight: 400;
    color: var(--np-ink-2);
  }
  .line.threat :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .line.threat span {
    display: grid;
  }
  .line.threat small {
    font-style: italic;
    color: var(--np-ink-2);
  }
  .res {
    color: var(--np-sea);
  }
  /* A ship, plane or train: whose, what, and where to. */
  .unit {
    min-width: 160px;
  }
  .unit .rel {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-style: normal;
    font-family: var(--text);
    font-weight: 600;
    font-size: 0.86em;
  }
  .unit .rel.ally,
  .unit .rel.teammate {
    color: var(--np-good);
  }
  .unit .rel.enemy {
    color: var(--np-spot);
  }
  .unit .kind b {
    font-weight: 600;
  }
  .unit .kind small {
    color: var(--np-ink-3);
  }
  .unit .hull .meter {
    flex: 1;
    min-width: 40px;
    height: 4px;
    background: var(--np-paper-2);
    box-shadow: inset 0 0 0 1px var(--np-rule);
  }
  .unit .hull .meter i {
    display: block;
    height: 100%;
    background: currentColor;
  }
  .unit .status {
    color: var(--np-ink-2);
    font-style: italic;
    font-family: var(--np-serif);
  }
  .unit .dest {
    font-weight: 600;
  }
  .sky {
    align-items: flex-start;
    color: var(--np-sea);
  }
  .sky :global(svg) {
    flex: none;
    margin-top: 2px;
  }
</style>
