<script lang="ts">
  import { hud, openPanel } from '../stores/game.svelte';
  import { t, short, clock } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS, type IconName } from '../icons/icons';
  import type { GameController } from '../game/controller';
  import { B, BUILD_TICKS, BUILDING_KEYS, N, AIR_COST } from '../../core/game/constants';
  import { currentSession } from '../stores/app.svelte';
  import { buildingUnlock, lockFor, nukeUnlock, techKey, type Unlock } from '../../core/rules/tech';
  import ResearchReminder from './ResearchReminder.svelte';
  import { AIR_REACH } from '../game/airPreview';
  import { hudSize } from '../stores/hudBox.svelte';
  import { folds, setFold } from '../stores/folds.svelte';
  import FoldButton from './FoldButton.svelte';
  import { haltIcon, haltShort, haltTip, nukeHalt, truceShort, truceText } from './nukeHalt';
  import { truceOf } from '../game/truce';
  import { eventIcon, portsBlock, type EventBlock } from './worldEvents';

  let { ctl }: { ctl: GameController } = $props();
  const cfg = currentSession()!.config;
  const L = $derived(hud.local);

  const buildings = [
    { kind: B.City, key: 'buildCity' },
    { kind: B.Port, key: 'buildPort', off: !cfg.allowPorts },
    { kind: B.Factory, key: 'buildFactory', off: !cfg.allowFactories },
    { kind: B.Lab, key: 'buildLab', off: !cfg.features.tech },
    { kind: B.DefensePost, key: 'buildDefense' },
    { kind: B.Silo, key: 'buildSilo', off: !cfg.allowNukes },
    { kind: B.Sam, key: 'buildSam', off: !cfg.allowNukes && !cfg.features.air },
    { kind: B.Radar, key: 'buildRadar', off: !cfg.features.radar },
    { kind: B.Airfield, key: 'buildAirfield', off: !cfg.features.air },
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
  let hovered: string | null = $state(null);
  // Hovering a button filters the map: matching buildings light up, with their reach.
  $effect(() => {
    hud.barHover = hovered;
  });

  function pickBuild(kind: number): void {
    hud.tool = hud.tool.k === 'build' && hud.tool.kind === kind ? { k: 'none' } : { k: 'build', kind };
  }
  function pickNuke(kind: number): void {
    hud.tool =
      hud.tool.k === 'nuke' && hud.tool.kind === kind ? { k: 'none' } : { k: 'nuke', kind, count: 1 };
  }
  /** The World Council's nuclear ban or a peace summit: the bombs print in magenta while it lasts. */
  const halt = $derived(nukeHalt(hud.world, hud.tick));
  /** A hurricane (world event): no warship until the ports reopen. */
  const portsShut = $derived(portsBlock(hud.world, hud.tick));
  /** The tooltip of a button greyed by an event: "Hurricane: not possible for now (1:12 left)". */
  const blockTip = (b: EventBlock): string =>
    t('worldEventBlock.tip', { event: t(`worldEvent.${b.id}.short`), clock: clock(b.left) });
  /** A truce (peace summit, Council's ceasefire): bombers and fighters spare every country meanwhile. */
  const truce = $derived(truceOf(hud.world, hud.tick));
  const active = (k: string, kind: number) =>
    hud.tool.k === k && 'kind' in hud.tool && hud.tool.kind === kind;

  // Tech tree: silos, bombs, SAMs, radars, airfields and aircraft wait for their technology.
  const lockOf = (u: Unlock | null): number => (cfg.features.tech && L ? lockFor(L.tech, u) : -1);
  const requires = (lock: number): string =>
    lock < 0 ? '' : t('tech.requiresTech', { tech: t(`${techKey(lock)}.name`) });
  /** A locked tool opens the technology tree on what it needs. */
  function openTech(lock: number): void {
    openPanel('tech');
    hud.techFocus = lock;
  }

  void ctl;

  // Folded by the player (remembered, folds.svelte.ts): a slim strip at the foot of the map.
  // The keys still choose the tools; the strip shows the one in hand.
  const folded = $derived(folds.bar);
  /** The tool in hand, for the folded strip: its mark, its name, its key. */
  const inHand = $derived.by((): { icon: IconName; name: string; key: string; danger: boolean } | null => {
    const tl = hud.tool;
    if (tl.k === 'build') {
      const b = buildings.find((x) => x.kind === tl.kind);
      return {
        icon: BUILDING_ICONS[tl.kind] ?? 'city',
        name: t(`building.${BUILDING_KEYS[tl.kind]}.short`),
        key: b ? keyLabel(settings.keys[b.key] ?? '') : '',
        danger: false,
      };
    }
    if (tl.k === 'nuke') {
      const n = nukes.find((x) => x.kind === tl.kind);
      return {
        icon: 'nuke',
        name: (n ? t(`nuke.${n.key}.short`) : '') + (tl.count > 1 ? ` ×${tl.count}` : ''),
        key: n ? keyLabel(settings.keys[n.key] ?? '') : '',
        danger: true,
      };
    }
    if (tl.k === 'warship')
      return {
        icon: 'warship',
        name: t('unit.warship.short'),
        key: keyLabel(settings.keys.warship ?? ''),
        danger: false,
      };
    if (tl.k === 'air') {
      const a = air.find((x) => x.kind === tl.kind);
      return { icon: 'airfield', name: a ? t(`unit.${a.name}.short`) : '', key: '', danger: false };
    }
    return null;
  });
  /** The keys of the first and last tools (1–0 by default). */
  const keyRange = $derived.by(() => {
    const first = keyLabel(settings.keys.buildCity ?? '');
    const last = keyLabel(settings.keys[nukes.length ? 'nukeMirv' : 'warship'] ?? '');
    return `${first}–${last}`;
  });
</script>

{#snippet tip(title: string, body: string, meta: string[], req: string = '', ban: string = '')}
  <div class="tip newsprint rise-in">
    <h4>{title}</h4>
    {#if ban}<p class="ban" data-testid="nuke-ban-tip"><Icon name="embargo" size={13} />{ban}</p>{/if}
    <p>{body}</p>
    {#if req}<p class="req"><Icon name="lock" size={13} />{req}</p>
      <p class="reqhint">{t('tech.openTree')}</p>{/if}
    {#if meta.length}<div class="meta">
        {#each meta as m (m)}<span>{m}</span>{/each}
      </div>{/if}
  </div>
{/snippet}

{#snippet tool(
  id: string,
  icon: IconName,
  label: string,
  cost: string,
  key: string,
  isActive: boolean,
  poor: boolean,
  danger: boolean,
  onclick: () => void,
  testid: string,
  banned: boolean = false,
  banIcon: IconName | null = null,
)}
  <button
    class="tool"
    class:active={isActive}
    class:poor={poor && !banned}
    class:danger
    class:banned
    {onclick}
    onmouseenter={() => (hovered = id)}
    onmouseleave={() => (hovered = null)}
    data-testid={testid}
    aria-label={label}
  >
    <Icon name={icon} size={20} />
    <span class="name">{label}</span>
    <span class="cost mono">{cost}</span>
    {#if key}<kbd>{key}</kbd>{/if}
    {#if banned}<span class="banmark" aria-hidden="true"
        ><Icon name={banIcon ?? (halt ? haltIcon(halt) : 'embargo')} size={11} /></span
      >{/if}
  </button>
{/snippet}

{#if L && folded}
  <section class="bar panel folded" data-testid="build-bar" data-folded="true" use:hudSize={'bar'}>
    <ResearchReminder {ctl} />
    <button
      class="fstrip fold-in"
      onclick={() => setFold('bar', false)}
      aria-expanded="false"
      aria-label={t('fold.unfold', { name: t('fold.bar') })}
      data-tip="{t('fold.unfold', { name: t('fold.bar') })} · {t('fold.allKey', {
        key: keyLabel(settings.keys.hudFold ?? ''),
      })}"
      data-testid="build-bar-tab"
    >
      <FoldButton glyph folded name={t('fold.bar')} dir="down" />
      <Icon name="city" size={15} />
      <b>{t('fold.barTab')}</b>
      {#if inHand}
        <span class="hand" class:danger={inHand.danger} data-testid="build-bar-in-hand"
          ><Icon name={inHand.icon} size={14} />{inHand.name}{#if inHand.key}<span class="np-kbd"
              >{inHand.key}</span
            >{/if}</span
        >
      {:else}
        <span class="keys">{t('fold.keys', { keys: keyRange })}</span>
      {/if}
    </button>
  </section>
{:else if L}
  <section class="bar panel" data-testid="build-bar" use:hudSize={'bar'}>
    <ResearchReminder {ctl} />
    <div class="group">
      <div class="gtitle">{t('hud.groupBuild')}</div>
      <div class="tools">
        {#each buildings as b (b.kind)}
          {@const cost = L.buildCosts[b.kind] ?? 0}
          {@const name = t(`building.${BUILDING_KEYS[b.kind]}.short`)}
          {@const lock = lockOf(buildingUnlock(b.kind))}
          <div class="slot" class:locked={lock >= 0}>
            {@render tool(
              `b${b.kind}`,
              BUILDING_ICONS[b.kind]!,
              name,
              short(cost),
              keyLabel(settings.keys[b.key] ?? ''),
              active('build', b.kind),
              L.gold < cost,
              false,
              () => (lock >= 0 ? openTech(lock) : pickBuild(b.kind)),
              `build-${BUILDING_KEYS[b.kind]}`,
            )}
            {#if lock >= 0}<span class="lock" aria-hidden="true"><Icon name="lock" size={11} /></span>{/if}
            {#if hovered === `b${b.kind}`}
              {@render tip(
                t(`building.${BUILDING_KEYS[b.kind]}.name`),
                t(`building.${BUILDING_KEYS[b.kind]}.desc`),
                [
                  t('hud.costN', { n: short(cost) }),
                  t('hud.buildTime', { s: (BUILD_TICKS[b.kind]! / 10).toFixed(0) }),
                  t('hud.ownedN', { n: L.buildingCount[b.kind] ?? 0 }),
                ],
                requires(lock),
              )}
            {/if}
          </div>
        {/each}
      </div>
    </div>
    {#if cfg.allowPorts}
      <div class="group">
        <!-- A hurricane (world event) closes the ports: the warship is greyed, with the reason. -->
        <div class="gtitle" class:spot={!!portsShut} data-testid="navy-group-title">
          {t('hud.groupNavy')}{#if portsShut}<span class="mono"
              >{`· ${t('worldEventBlock.ports')} ${clock(portsShut.left)}`}</span
            >{/if}
        </div>
        <div class="tools">
          <div class="slot">
            {@render tool(
              'ws',
              'warship',
              t('unit.warship.short'),
              short(L.warshipCost),
              keyLabel(settings.keys.warship ?? ''),
              hud.tool.k === 'warship',
              L.gold < L.warshipCost,
              false,
              () => (hud.tool = hud.tool.k === 'warship' ? { k: 'none' } : { k: 'warship' }),
              'build-warship',
              !!portsShut,
              portsShut ? eventIcon(portsShut.id) : null,
            )}
            {#if hovered === 'ws'}
              {@render tip(
                t('unit.warship.name'),
                t('unit.warship.desc'),
                [t('hud.costN', { n: short(L.warshipCost) })],
                '',
                portsShut ? blockTip(portsShut) : '',
              )}
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if nukes.length}
      <div class="group">
        <div class="gtitle" class:spot={!!halt} data-testid="nuke-group-title">
          {t('hud.groupNukes')}{#if halt}<span class="mono">{`· ${haltShort(halt)}`}</span>{/if}
        </div>
        <div class="tools">
          {#each nukes as n (n.kind)}
            {@const lock = lockOf(nukeUnlock(n.kind))}
            <div class="slot" class:locked={lock >= 0}>
              {@render tool(
                `n${n.kind}`,
                'nuke',
                t(`nuke.${n.key}.short`),
                short(L.nukeCosts[n.kind] ?? 0),
                keyLabel(settings.keys[n.key] ?? ''),
                active('nuke', n.kind),
                (L.maxLaunch[n.kind] ?? 0) === 0,
                true,
                () => (lock >= 0 ? openTech(lock) : pickNuke(n.kind)),
                `nuke-${n.key}`,
                !!halt,
              )}
              {#if lock >= 0}<span class="lock" aria-hidden="true"><Icon name="lock" size={11} /></span>{/if}
              {#if active('nuke', n.kind) && hud.tool.k === 'nuke'}<span class="count mono"
                  >×{hud.tool.count}</span
                >{/if}
              {#if hovered === `n${n.kind}`}
                {@render tip(
                  t(`nuke.${n.key}.name`),
                  t(`nuke.${n.key}.desc`),
                  [
                    t('hud.costN', { n: short(L.nukeCosts[n.kind] ?? 0) }),
                    t('hud.readyN', { n: L.maxLaunch[n.kind] ?? 0 }),
                  ],
                  requires(lock),
                  halt ? haltTip(halt) : '',
                )}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
    {#if air.length}
      <div class="group">
        <div class="gtitle" class:spot={!!truce} data-testid="air-group-title">
          {t('hud.groupAir')}{#if truce}<span class="mono">{`· ${truceShort(truce)}`}</span>{/if}
        </div>
        <div class="tools">
          {#each air as a (a.kind)}
            {@const lock = lockOf('airfield')}
            <div class="slot" class:locked={lock >= 0}>
              {@render tool(
                `a${a.kind}`,
                a.icon,
                t(`unit.${a.name}.short`),
                short(AIR_COST[a.kind as 0 | 1 | 2]),
                '',
                active('air', a.kind),
                L.gold < AIR_COST[a.kind as 0 | 1 | 2] || L.buildingCount[B.Airfield] === 0,
                false,
                () => (lock >= 0 ? openTech(lock) : (hud.tool = { k: 'air', kind: a.kind })),
                `air-${a.name}`,
              )}
              {#if lock >= 0}<span class="lock" aria-hidden="true"><Icon name="lock" size={11} /></span>{/if}
              {#if hovered === `a${a.kind}`}
                {@render tip(
                  t(`unit.${a.name}.name`),
                  t(`unit.${a.name}.desc`),
                  [
                    t('hud.costN', { n: short(AIR_COST[a.kind as 0 | 1 | 2]) }),
                    t('air.reach', { n: AIR_REACH[a.kind as 0 | 1 | 2] }),
                    L.buildingCount[B.Airfield] === 0 ? t('hud.needsAirfield') : '',
                  ].filter(Boolean),
                  requires(lock),
                  truce && a.kind !== 2 ? truceText(truce, a.kind === 1 ? 'bomber' : 'fighter') : '',
                )}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
    <div class="group views">
      <div class="gtitle">{t('hud.groupViews')}</div>
      <div class="vtools">
        <button
          class="vt"
          class:active={hud.views.terrain}
          onclick={() => (hud.views.terrain = !hud.views.terrain)}
          data-tip="{t('hud.view.terrain')} ({keyLabel(settings.keys.terrainView ?? '')})"
          aria-label={t('hud.view.terrain')}><Icon name="terrain" size={16} /></button
        >
        <button
          class="vt"
          class:active={hud.views.resources}
          onclick={() => (hud.views.resources = !hud.views.resources)}
          data-tip="{t('hud.view.resources')} ({keyLabel(settings.keys.resourcesView ?? '')})"
          aria-label={t('hud.view.resources')}><Icon name="oil" size={16} /></button
        >
        {#if cfg.features.loyalty}<button
            class="vt"
            class:active={hud.views.loyalty}
            onclick={() => ctl.toggleLoyaltyView()}
            data-tip="{t('hud.view.loyalty')} ({keyLabel(settings.keys.loyaltyView ?? '')})"
            aria-label={t('hud.view.loyalty')}><Icon name="loyalty" size={16} /></button
          >{/if}
        {#if cfg.features.fog && ctl.session.viewer <= 0}<button
            class="vt"
            class:active={hud.views.fog}
            onclick={() => (hud.views.fog = !hud.views.fog)}
            data-tip="{t('hud.view.fog')} ({keyLabel(settings.keys.fogView ?? '')})"
            aria-label={t('hud.view.fog')}><Icon name="fog" size={16} /></button
          >{/if}
        {#if cfg.allowPorts || cfg.allowFactories}<button
            class="vt"
            class:active={settings.game.tradeRoutes}
            onclick={() => ctl.toggleTradeRoutes()}
            aria-pressed={settings.game.tradeRoutes}
            data-testid="view-trade-routes"
            data-tip="{t('hud.view.tradeRoutes')} ({keyLabel(settings.keys.tradeRoutes ?? '')}). {t(
              'hud.view.tradeRoutesTip',
            )}"
            aria-label={t('hud.view.tradeRoutes')}><Icon name="tradeRoutes" size={16} /></button
          >{/if}
      </div>
      <!-- The fold control, in the corner of the last group (it takes no room of its own). -->
      <span class="vfold"
        ><FoldButton
          folded={false}
          name={t('fold.bar')}
          dir="down"
          tip="above"
          onclick={() => setFold('bar', true)}
          testid="fold-bar"
        /></span
      >
    </div>
  </section>
{/if}

<style>
  /*
   * The bottom strip (zones.ts): centred in the room between the resources panel and the
   * right column; when that room is too narrow for one row, the groups go on two (the
   * zones read its height).
   */
  .bar {
    position: absolute;
    left: var(--zone-bar-l, calc(12px + var(--res-w, 290px) + 10px));
    right: var(--zone-bar-r, calc(12px + var(--hud-mini-w, 278px) + 10px));
    bottom: 12px;
    width: fit-content;
    margin-inline: auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    padding: 0;
    z-index: 6;
  }
  /* Folded (the player's choice): a slim strip, the tool in hand printed on it. */
  .fstrip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px 0 6px;
    border: 0;
    border-top: 3px solid var(--np-ink);
    background: transparent;
    color: var(--np-ink);
    font-family: var(--text);
    font-size: 0.84em;
    white-space: nowrap;
    cursor: var(--cursor-pointer, pointer);
    transition: background 0.12s;
  }
  .fstrip:hover,
  .fstrip:focus-visible {
    background: var(--np-card);
  }
  .fstrip b {
    font-family: var(--title);
    font-weight: 600;
  }
  .fstrip :global(.fold) {
    border-color: transparent;
    background: transparent;
  }
  .fstrip .keys {
    font-style: italic;
    color: var(--np-ink-3);
  }
  /* The tool in hand: reversed, as on the bar. */
  .hand {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 1px 4px 1px 6px;
    border-radius: 2px;
    background: var(--np-ink);
    color: var(--np-paper);
    font-weight: 600;
  }
  .hand.danger {
    background: var(--np-spot);
  }
  .hand .np-kbd {
    border-color: color-mix(in srgb, var(--np-paper) 45%, transparent);
    color: color-mix(in srgb, var(--np-paper) 80%, transparent);
  }
  /* The fold control, in the corner of the views' group, beside its kicker. */
  .views {
    position: relative;
  }
  .vfold {
    position: absolute;
    top: 3px;
    right: 4px;
  }
  .vfold :global(.fold) {
    width: 18px;
    height: 18px;
  }
  .vfold :global(.fold svg) {
    width: 12px;
    height: 12px;
  }
  /* Narrower windows: the tools lose their name (it is in the tooltip), then shrink. */
  @media (max-width: 1750px) {
    .name {
      display: none;
    }
    .tool {
      width: 48px !important;
      height: 50px !important;
    }
  }
  .group {
    display: grid;
    align-content: start;
    padding: 5px 8px 8px;
  }
  /* A rule before each group (one starting a second row has it against the edge). */
  .group + .group {
    box-shadow: -1px 0 0 var(--np-rule);
  }
  /* Each group under its kicker, in the journal's italic. */
  .gtitle {
    margin: 0 0 4px 2px;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.8em;
    white-space: nowrap;
    color: var(--np-ink-2);
  }
  .gtitle.spot {
    color: var(--np-spot);
  }
  .gtitle .mono {
    margin-left: 0.35em;
    font-family: var(--text);
    font-style: normal;
    font-weight: 600;
  }
  .tools {
    display: flex;
    gap: 3px;
  }
  .slot {
    position: relative;
  }
  .slot.locked .tool {
    opacity: 0.45;
  }
  .slot.locked .tool:hover {
    opacity: 0.8;
  }
  /* The ban speaks louder than the lock: in full magenta, its mark in place of the padlock. */
  .slot.locked .tool.banned {
    opacity: 1;
  }
  .slot:has(.banned) .lock {
    display: none;
  }
  /* The first group's explanations open to the right, the others' to the left (over the bar). */
  .group:first-of-type .tip {
    left: 0;
    right: auto;
  }
  .lock {
    position: absolute;
    top: 3px;
    left: 4px;
    display: inline-flex;
    color: var(--np-ink);
    pointer-events: none;
  }
  /* A tool: its pictogram, name and price printed on the paper; nothing moves on hover. */
  .tool {
    position: relative;
    width: 62px;
    height: 64px;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 1px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 2px;
    color: var(--np-ink);
    cursor: pointer;
    padding: 4px 2px;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .tool:hover {
    background: var(--np-card);
    border-color: var(--np-rule-2);
  }
  /* The tool in hand: reversed. */
  .tool.active {
    background: var(--np-ink);
    border-color: var(--np-ink);
    color: var(--np-paper);
  }
  .tool.active .name {
    color: color-mix(in srgb, var(--np-paper) 82%, transparent);
  }
  .tool.active .cost {
    color: #e6c67e;
  }
  .tool.active kbd {
    color: color-mix(in srgb, var(--np-paper) 70%, transparent);
  }
  .tool.poor {
    opacity: 0.45;
  }
  .tool.danger {
    color: var(--np-spot);
  }
  .tool.danger.active {
    background: var(--np-spot);
    border-color: var(--np-spot);
    color: #fff7f9;
  }
  /* Nuclear ban (World Council): the bombs are printed in magenta, struck by the ban's mark. */
  .tool.banned {
    background: color-mix(in srgb, var(--np-spot) 10%, transparent);
    border-color: color-mix(in srgb, var(--np-spot) 55%, transparent);
    color: var(--np-spot);
  }
  .tool.banned:hover {
    background: color-mix(in srgb, var(--np-spot) 16%, transparent);
    border-color: var(--np-spot);
  }
  .tool.banned .name,
  .tool.banned .cost {
    color: var(--np-spot);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--np-spot) 60%, transparent);
  }
  .banmark {
    position: absolute;
    top: 3px;
    left: 4px;
    display: inline-flex;
    color: var(--np-spot);
    pointer-events: none;
  }
  .name {
    font-size: 0.66em;
    color: var(--np-ink-2);
    max-width: 58px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cost {
    font-size: 0.68em;
    font-weight: 600;
    color: var(--np-brass);
  }
  kbd {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 0.58em;
    font-weight: 600;
    color: var(--np-ink-3);
    font-family: var(--text);
  }
  .count {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 0.65em;
    font-weight: 600;
    color: var(--np-spot);
  }
  .vtools {
    display: grid;
    grid-template-columns: repeat(2, 30px);
    gap: 3px;
  }
  .vt {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    background: transparent;
    border: 1px solid var(--np-rule);
    border-radius: 2px;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .vt:hover {
    color: var(--np-ink);
    border-color: var(--np-ink-2);
    background: var(--np-card);
  }
  .vt.active {
    color: var(--np-paper);
    border-color: var(--np-ink);
    background: var(--np-ink);
  }
  /* What a tool does: a card laid above the bar (it never takes the pointer). */
  .tip {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    width: 270px;
    padding: 9px 12px 10px;
    text-align: left;
    z-index: 20;
    pointer-events: none;
    border: 1px solid var(--np-edge);
    border-top: 3px solid var(--np-ink);
    border-radius: 1px;
    box-shadow: var(--np-lift);
  }
  .tip h4 {
    margin: 0 0 4px;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.05em;
    color: var(--np-ink);
  }
  .tip p {
    margin: 0 0 6px;
    font-family: var(--np-serif);
    font-size: 0.82em;
    color: var(--np-ink-2);
    line-height: 1.45;
  }
  .tip .req {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 2px;
    font-family: var(--text);
    font-weight: 600;
    color: var(--np-warn);
  }
  .tip .ban {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 0 5px;
    border-top: 1px solid var(--np-spot);
    border-bottom: 1px solid var(--np-spot);
    font-family: var(--text);
    font-weight: 600;
    color: var(--np-spot);
  }
  .tip .ban :global(svg) {
    flex: none;
    margin-top: 2px;
  }
  .tip .reqhint {
    margin: 0 0 6px;
    font-size: 0.78em;
    font-style: italic;
    color: var(--np-ink-3);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding-top: 5px;
    border-top: 1px solid var(--np-rule);
    font-size: 0.8em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-brass);
  }
  /* (After the base rules, which it overrides.) */
  @media (max-width: 1600px) {
    .tool {
      width: 44px !important;
      height: 48px !important;
    }
    .group {
      padding: 5px 6px 6px;
    }
    .vtools {
      grid-template-columns: repeat(2, 28px);
    }
    .vt {
      width: 28px;
      height: 28px;
    }
  }
</style>
