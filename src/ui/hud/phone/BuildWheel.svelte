<script lang="ts">
  // Touch screens (html.tactile: a phone, and a tablet since 1.26.3): the build bar becomes one
  // button at the thumb, bottom right. A press opens the build wheel above it: the buildings, the
  // two front lines, the warship, the bombs, the aircraft and the map's views — every tool of the
  // bar, the same prices, locks and bans. Slide to a tool and lift, or tap. The tool in hand is
  // printed on the button; the small cross beside it puts it down.
  import { hud, openPanel } from '../../stores/game.svelte';
  import { t, short, clock } from '../../i18n/i18n.svelte';
  import { settings } from '../../stores/settings.svelte';
  import Icon from '../../icons/Icon.svelte';
  import { BUILDING_ICONS, type IconName } from '../../icons/icons';
  import type { GameController } from '../../game/controller';
  import { B, BUILD_TICKS, BUILDING_KEYS, N, AIR_COST } from '../../../core/game/constants';
  import { buildingUnlock, lockFor, nukeUnlock, techKey, type Unlock } from '../../../core/rules/tech';
  import ResearchReminder from '../ResearchReminder.svelte';
  import { AIR_REACH } from '../../game/airPreview';
  import { hudSize } from '../../stores/hudBox.svelte';
  import { haltShort, haltTip, nukeHalt, truceShort, truceText } from '../nukeHalt';
  import { truceOf } from '../../game/truce';
  import { portsBlock } from '../worldEvents';
  import { audio } from '../../../audio/audio';
  import Wheel, { type WheelItem } from './Wheel.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const cfg = ctl.session.config;
  const L = $derived(hud.local);

  const buildings = [
    { kind: B.City },
    { kind: B.Port, off: !cfg.allowPorts },
    { kind: B.Factory, off: !cfg.allowFactories },
    { kind: B.Lab, off: !cfg.features.tech },
    { kind: B.Silo, off: !cfg.allowNukes },
    { kind: B.Sam, off: !cfg.allowNukes && !cfg.features.air },
    { kind: B.Radar, off: !cfg.features.radar },
    { kind: B.Airfield, off: !cfg.features.air },
  ].filter((b) => !b.off);
  const nukes = cfg.allowNukes
    ? [
        { kind: N.Atom, key: 'nukeA' },
        { kind: N.Hydrogen, key: 'nukeH' },
        { kind: N.Mirv, key: 'nukeMirv' },
      ]
    : [];
  const air = cfg.features.air
    ? [
        { kind: 0, name: 'fighter', icon: 'airfield' as IconName },
        { kind: 1, name: 'bomber', icon: 'bomb' as IconName },
        { kind: 2, name: 'recon', icon: 'eye' as IconName },
      ]
    : [];
  const lines = [
    { kind: 0, icon: 'lineDefense' as IconName, name: 'defensive' },
    { kind: 1, icon: 'lineOffense' as IconName, name: 'offensive' },
  ];

  const lockOf = (u: Unlock | null): number => (cfg.features.tech && L ? lockFor(L.tech, u) : -1);
  const requires = (lock: number): string =>
    lock < 0 ? '' : t('tech.requiresTech', { tech: t(`${techKey(lock)}.name`) });
  function openTech(lock: number): void {
    openPanel('tech');
    hud.techFocus = lock;
  }
  const active = (k: string, kind: number) =>
    hud.tool.k === k && 'kind' in hud.tool && hud.tool.kind === kind;
  const halt = $derived(nukeHalt(hud.world, hud.tick));
  const portsShut = $derived(portsBlock(hud.world, hud.tick));
  const truce = $derived(truceOf(hud.world, hud.tick));
  const lineTroops = $derived(Math.floor((L?.troops ?? 0) * hud.attackRatio));

  /** Takes a tool in hand (the same one again puts it down), as the bar's buttons do. */
  function take(tool: typeof hud.tool): void {
    const same = JSON.stringify(hud.tool) === JSON.stringify(tool);
    hud.tool = same ? { k: 'none' } : tool;
    audio.ui('click');
  }

  const items = $derived.by((): WheelItem[] => {
    const l = L;
    if (!l) return [];
    const out: WheelItem[] = [];
    out.push({
      id: 'buildings',
      label: t('hud.groupBuild'),
      icon: 'city',
      sub: buildings.map((b) => {
        const cost = l.buildCosts[b.kind] ?? 0;
        const lock = lockOf(buildingUnlock(b.kind));
        const key = BUILDING_KEYS[b.kind];
        return {
          id: `b${b.kind}`,
          label: t(`building.${key}.short`),
          icon: BUILDING_ICONS[b.kind]!,
          hint: short(cost),
          desc: t(`building.${key}.desc`),
          meta: [
            t('hud.buildTime', { s: (BUILD_TICKS[b.kind]! / 10).toFixed(0) }),
            t('hud.ownedN', { n: l.buildingCount[b.kind] ?? 0 }),
          ],
          ...(lock >= 0 ? { locked: true, why: requires(lock) } : {}),
          dim: l.gold < cost,
          on: active('build', b.kind),
          run: () => (lock >= 0 ? openTech(lock) : take({ k: 'build', kind: b.kind })),
          testid: `build-${key}`,
        };
      }),
    });
    for (const ln of lines)
      out.push({
        id: `l${ln.kind}`,
        label: t(`line.${ln.name}.short`),
        icon: ln.icon,
        hint: short(lineTroops),
        desc: t(`line.${ln.name}.desc`),
        meta: [t('line.costTroops', { n: short(lineTroops), pct: Math.round(hud.attackRatio * 100) })],
        dim: lineTroops < 1,
        on: hud.tool.k === 'line' && hud.tool.kind === ln.kind,
        run: () => take({ k: 'line', kind: ln.kind }),
        testid: `line-${ln.name}`,
      });
    if (cfg.allowPorts)
      out.push({
        id: 'ws',
        label: t('unit.warship.short'),
        icon: 'warship',
        hint: short(l.warshipCost),
        desc: t('unit.warship.desc'),
        ...(portsShut
          ? {
              banned: true,
              why: t('worldEventBlock.tip', {
                event: t(`worldEvent.${portsShut.id}.short`),
                clock: clock(portsShut.left),
              }),
            }
          : {}),
        dim: l.gold < l.warshipCost,
        on: hud.tool.k === 'warship',
        run: () => take({ k: 'warship' }),
        testid: 'build-warship',
      });
    if (nukes.length)
      out.push({
        id: 'nukes',
        label: t('hud.groupNukes'),
        icon: 'nuke',
        danger: true,
        ...(halt ? { banned: true, hint: haltShort(halt), why: haltTip(halt) } : {}),
        sub: nukes.map((n) => {
          const lock = lockOf(nukeUnlock(n.kind));
          return {
            id: `n${n.kind}`,
            label: t(`nuke.${n.key}.short`),
            icon: 'nuke' as IconName,
            hint: short(l.nukeCosts[n.kind] ?? 0),
            desc: t(`nuke.${n.key}.desc`),
            meta: [t('hud.readyN', { n: l.maxLaunch[n.kind] ?? 0 })],
            danger: true,
            ...(halt ? { banned: true, why: haltTip(halt) } : {}),
            ...(lock >= 0 ? { locked: true, why: requires(lock) } : {}),
            dim: (l.maxLaunch[n.kind] ?? 0) === 0,
            on: active('nuke', n.kind),
            run: () => (lock >= 0 ? openTech(lock) : take({ k: 'nuke', kind: n.kind, count: 1 })),
            testid: `nuke-${n.key}`,
          };
        }),
      });
    if (air.length) {
      const lock = lockOf('airfield');
      out.push({
        id: 'air',
        label: t('hud.groupAir'),
        icon: 'airfield',
        ...(truce ? { hint: truceShort(truce) } : {}),
        sub: air.map((a) => {
          const cost = AIR_COST[a.kind as 0 | 1 | 2];
          const noField = l.buildingCount[B.Airfield] === 0;
          return {
            id: `a${a.kind}`,
            label: t(`unit.${a.name}.short`),
            icon: a.icon,
            hint: short(cost),
            desc: t(`unit.${a.name}.desc`),
            meta: [
              t('air.reach', { n: AIR_REACH[a.kind as 0 | 1 | 2] }),
              noField ? t('hud.needsAirfield') : '',
            ].filter(Boolean),
            ...(lock >= 0
              ? { locked: true, why: requires(lock) }
              : truce && a.kind !== 2
                ? { why: truceText(truce, a.kind === 1 ? 'bomber' : 'fighter') }
                : {}),
            dim: l.gold < cost || noField,
            on: active('air', a.kind),
            run: () => (lock >= 0 ? openTech(lock) : take({ k: 'air', kind: a.kind })),
            testid: `air-${a.name}`,
          };
        }),
      });
    }
    const views: WheelItem[] = [
      {
        id: 'vTerrain',
        label: t('hud.view.terrain'),
        icon: 'terrain',
        on: hud.views.terrain,
        keep: true,
        run: () => (hud.views.terrain = !hud.views.terrain),
      },
      {
        id: 'vRes',
        label: t('hud.view.resources'),
        icon: 'oil',
        on: hud.views.resources,
        keep: true,
        run: () => (hud.views.resources = !hud.views.resources),
      },
    ];
    if (cfg.features.loyalty)
      views.push({
        id: 'vLoyalty',
        label: t('hud.view.loyalty'),
        icon: 'loyalty',
        on: hud.views.loyalty,
        keep: true,
        run: () => ctl.toggleLoyaltyView(),
      });
    if (cfg.features.fog && ctl.session.viewer <= 0)
      views.push({
        id: 'vFog',
        label: t('hud.view.fog'),
        icon: 'fog',
        on: hud.views.fog,
        keep: true,
        run: () => (hud.views.fog = !hud.views.fog),
      });
    if (cfg.allowPorts || cfg.allowFactories)
      views.push({
        id: 'vTrade',
        label: t('hud.view.tradeRoutes'),
        icon: 'tradeRoutes',
        desc: t('hud.view.tradeRoutesTip'),
        on: settings.game.tradeRoutes,
        keep: true,
        run: () => ctl.toggleTradeRoutes(),
        testid: 'view-trade-routes',
      });
    out.push({ id: 'views', label: t('hud.groupViews'), icon: 'eye', sub: views });
    return out;
  });

  /** The tool in hand, printed on the button. */
  const inHand = $derived.by((): { icon: IconName; name: string; danger: boolean } | null => {
    const tl = hud.tool;
    if (tl.k === 'build')
      return {
        icon: BUILDING_ICONS[tl.kind] ?? 'city',
        name: t(`building.${BUILDING_KEYS[tl.kind]}.short`),
        danger: false,
      };
    if (tl.k === 'nuke') {
      const n = nukes.find((x) => x.kind === tl.kind);
      return {
        icon: 'nuke',
        name: (n ? t(`nuke.${n.key}.short`) : '') + (tl.count > 1 ? ` ×${tl.count}` : ''),
        danger: true,
      };
    }
    if (tl.k === 'line') {
      const ln = lines.find((x) => x.kind === tl.kind)!;
      return { icon: ln.icon, name: t(`line.${ln.name}.short`), danger: false };
    }
    if (tl.k === 'warship') return { icon: 'warship', name: t('unit.warship.short'), danger: false };
    if (tl.k === 'air') {
      const a = air.find((x) => x.kind === tl.kind);
      return { icon: a?.icon ?? 'airfield', name: a ? t(`unit.${a.name}.short`) : '', danger: false };
    }
    // Tools taken elsewhere (the context wheel, the Front window): shown too, so that the
    // cross can put them down.
    if (tl.k === 'capital') return { icon: 'capital', name: t('touch.toolCapital'), danger: false };
    if (tl.k === 'assault') return { icon: 'lineOffense', name: t('touch.toolAssault'), danger: false };
    if (tl.k === 'ping') return { icon: 'pin', name: t('touch.toolPing'), danger: false };
    if (tl.k === 'shipMove') return { icon: 'warship', name: t('touch.toolShips'), danger: false };
    return null;
  });

  let wheel = $state<{ x: number; y: number; drag: boolean } | null>(null);
  let fab: HTMLButtonElement | undefined = $state();
  function openWheel(drag: boolean): void {
    if (!fab) return;
    const r = fab.getBoundingClientRect();
    wheel = { x: r.left + r.width / 2, y: r.top + r.height / 2, drag };
    audio.ui('open');
  }
</script>

{#if L}
  <div class="fabs" use:hudSize={'bar'} data-testid="build-bar">
    <ResearchReminder {ctl} />
    {#if inHand}
      <button
        class="drop"
        onclick={() => {
          ctl.dropTool();
          audio.ui('click');
        }}
        aria-label={t('common.cancel')}
        data-testid="build-drop"><Icon name="close" size={16} /></button
      >
    {/if}
    <button
      bind:this={fab}
      class="fab panel"
      class:hand={!!inHand}
      class:danger={inHand?.danger}
      onpointerdown={(e) => {
        e.preventDefault();
        openWheel(true);
      }}
      onclick={(e) => e.detail === 0 && openWheel(false)}
      aria-haspopup="menu"
      aria-expanded={!!wheel}
      data-testid="build-bar-tab"
    >
      <Icon name={inHand?.icon ?? 'city'} size={24} />
      <span class="lbl">{inHand?.name ?? t('fold.barTab')}</span>
    </button>
  </div>
  {#if wheel}
    <Wheel
      x={wheel.x}
      y={wheel.y}
      drag={wheel.drag}
      {items}
      title={t('fold.barTab')}
      icon="city"
      onclose={() => (wheel = null)}
      testid="build-wheel"
    />
  {/if}
{/if}

<style>
  /* Bottom right, beside the minimap's tab: the thumb's corner. */
  .fabs {
    position: absolute;
    right: calc(12px + var(--hud-mini-w, 64px) + 10px);
    bottom: 12px;
    z-index: 6;
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }
  .fab {
    width: 72px;
    height: 68px;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 3px;
    padding: 4px;
    border-top: 3px solid var(--np-ink) !important;
    font-family: var(--text);
    cursor: pointer;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .lbl {
    max-width: 100%;
    font-family: var(--title);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A tool in hand: reversed, as on the bar. */
  .fab.hand {
    background: var(--np-ink);
    color: var(--np-paper);
  }
  .fab.hand.danger {
    background: var(--np-spot);
    border-top-color: var(--np-spot) !important;
  }
  .drop {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border: 1px solid var(--np-edge);
    border-radius: 50%;
    background: var(--np-paper);
    color: var(--np-ink);
    box-shadow: var(--np-lift);
  }
  /* The research reminder: above the button, against the right edge. */
  .fabs :global(.nudge) {
    left: auto;
    right: 0;
    translate: none;
  }
</style>
