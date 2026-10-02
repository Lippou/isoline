<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS, type IconName } from '../icons/icons';
  import type { GameController } from '../game/controller';
  import { B, BUILD_TICKS, BUILDING_KEYS, N, AIR_COST } from '../../core/game/constants';
  import { currentSession } from '../stores/app.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const cfg = currentSession()!.config;
  const L = $derived(hud.local);

  const buildings = [
    { kind: B.City, key: 'buildCity' },
    { kind: B.Port, key: 'buildPort', off: !cfg.allowPorts },
    { kind: B.Factory, key: 'buildFactory', off: !cfg.allowFactories },
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
        { kind: 0, name: 'fighter' },
        { kind: 1, name: 'bomber' },
        { kind: 2, name: 'recon' },
      ]
    : [];
  let hovered: string | null = $state(null);

  function pickBuild(kind: number): void {
    hud.tool = hud.tool.k === 'build' && hud.tool.kind === kind ? { k: 'none' } : { k: 'build', kind };
  }
  function pickNuke(kind: number): void {
    hud.tool =
      hud.tool.k === 'nuke' && hud.tool.kind === kind ? { k: 'none' } : { k: 'nuke', kind, count: 1 };
  }
  const active = (k: string, kind: number) =>
    hud.tool.k === k && 'kind' in hud.tool && hud.tool.kind === kind;

  void ctl;
</script>

{#snippet tip(title: string, body: string, meta: string[])}
  <div class="tip panel rise-in">
    <h4>{title}</h4>
    <p>{body}</p>
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
)}
  <button
    class="tool"
    class:active={isActive}
    class:poor
    class:danger
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
  </button>
{/snippet}

{#if L}
  <section class="bar panel" data-testid="build-bar">
    <div class="group">
      <div class="gtitle">{t('hud.groupBuild')}</div>
      <div class="tools">
        {#each buildings as b (b.kind)}
          {@const cost = L.buildCosts[b.kind] ?? 0}
          {@const name = t(`building.${BUILDING_KEYS[b.kind]}.short`)}
          <div class="slot">
            {@render tool(
              `b${b.kind}`,
              BUILDING_ICONS[b.kind]!,
              name,
              short(cost),
              keyLabel(settings.keys[b.key] ?? ''),
              active('build', b.kind),
              L.gold < cost,
              false,
              () => pickBuild(b.kind),
              `build-${BUILDING_KEYS[b.kind]}`,
            )}
            {#if hovered === `b${b.kind}`}
              {@render tip(
                t(`building.${BUILDING_KEYS[b.kind]}.name`),
                t(`building.${BUILDING_KEYS[b.kind]}.desc`),
                [
                  t('hud.costN', { n: short(cost) }),
                  t('hud.buildTime', { s: (BUILD_TICKS[b.kind]! / 10).toFixed(0) }),
                  t('hud.ownedN', { n: L.buildingCount[b.kind] ?? 0 }),
                ],
              )}
            {/if}
          </div>
        {/each}
      </div>
    </div>
    {#if cfg.allowPorts}
      <div class="group">
        <div class="gtitle">{t('hud.groupNavy')}</div>
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
            )}
            {#if hovered === 'ws'}
              {@render tip(t('unit.warship.name'), t('unit.warship.desc'), [
                t('hud.costN', { n: short(L.warshipCost) }),
              ])}
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if nukes.length}
      <div class="group">
        <div class="gtitle">{t('hud.groupNukes')}</div>
        <div class="tools">
          {#each nukes as n (n.kind)}
            <div class="slot">
              {@render tool(
                `n${n.kind}`,
                'nuke',
                t(`nuke.${n.key}.short`),
                short(L.nukeCosts[n.kind] ?? 0),
                keyLabel(settings.keys[n.key] ?? ''),
                active('nuke', n.kind),
                (L.maxLaunch[n.kind] ?? 0) === 0,
                true,
                () => pickNuke(n.kind),
                `nuke-${n.key}`,
              )}
              {#if active('nuke', n.kind) && hud.tool.k === 'nuke'}<span class="count mono"
                  >×{hud.tool.count}</span
                >{/if}
              {#if hovered === `n${n.kind}`}
                {@render tip(t(`nuke.${n.key}.name`), t(`nuke.${n.key}.desc`), [
                  t('hud.costN', { n: short(L.nukeCosts[n.kind] ?? 0) }),
                  t('hud.readyN', { n: L.maxLaunch[n.kind] ?? 0 }),
                ])}
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
    {#if air.length}
      <div class="group">
        <div class="gtitle">{t('hud.groupAir')}</div>
        <div class="tools">
          {#each air as a (a.kind)}
            <div class="slot">
              {@render tool(
                `a${a.kind}`,
                'airfield',
                t(`unit.${a.name}.short`),
                short(AIR_COST[a.kind as 0 | 1 | 2]),
                '',
                active('air', a.kind),
                L.gold < AIR_COST[a.kind as 0 | 1 | 2] || L.buildingCount[B.Airfield] === 0,
                false,
                () => (hud.tool = { k: 'air', kind: a.kind }),
                `air-${a.name}`,
              )}
              {#if hovered === `a${a.kind}`}
                {@render tip(
                  t(`unit.${a.name}.name`),
                  t(`unit.${a.name}.desc`),
                  [
                    t('hud.costN', { n: short(AIR_COST[a.kind as 0 | 1 | 2]) }),
                    L.buildingCount[B.Airfield] === 0 ? t('hud.needsAirfield') : '',
                  ].filter(Boolean),
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
      </div>
    </div>
  </section>
{/if}

<style>
  .bar {
    position: absolute;
    left: 50%;
    bottom: 12px;
    display: flex;
    padding: 0;
    z-index: 6;
    transform-origin: bottom center;
    transform: translateX(-50%) scale(var(--ui-scale));
  }
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
    padding: 6px 8px 8px;
  }
  .group + .group {
    border-left: 1px solid var(--line);
  }
  .gtitle {
    font-size: 0.66em;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--faint);
    margin: 0 0 5px 2px;
  }
  .tools {
    display: flex;
    gap: 3px;
  }
  .slot {
    position: relative;
  }
  .tool {
    position: relative;
    width: 62px;
    height: 64px;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 1px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--parchment);
    cursor: pointer;
    padding: 4px 2px;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .tool:hover {
    background: var(--panel-3);
    border-color: var(--line-strong);
  }
  .tool.active {
    border-color: var(--aurora);
    background: rgba(127, 169, 214, 0.18);
  }
  .tool.poor {
    opacity: 0.5;
  }
  .tool.danger {
    color: #f0a49c;
  }
  .name {
    font-size: 0.66em;
    color: var(--muted);
    max-width: 58px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cost {
    font-size: 0.68em;
    color: var(--brass);
  }
  kbd {
    position: absolute;
    top: 2px;
    right: 3px;
    font-size: 0.58em;
    color: var(--faint);
    font-family: var(--mono);
  }
  .count {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 0.65em;
    color: var(--signal);
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
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
  }
  .vt:hover {
    color: var(--parchment);
    border-color: var(--line-strong);
  }
  .vt.active {
    color: var(--parchment);
    border-color: var(--aurora);
    background: rgba(127, 169, 214, 0.18);
  }
  .tip {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    width: 270px;
    padding: 10px 12px;
    text-align: left;
    z-index: 20;
    pointer-events: none;
  }
  .tip h4 {
    margin: 0 0 4px;
    font-family: var(--title);
    font-size: 1em;
    color: var(--parchment);
  }
  .tip p {
    margin: 0 0 6px;
    font-size: 0.84em;
    color: var(--muted);
    line-height: 1.45;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 0.8em;
    color: var(--brass);
  }
</style>
