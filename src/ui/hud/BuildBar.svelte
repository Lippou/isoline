<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, short } from '../i18n/i18n.svelte';
  import { settings, keyLabel } from '../stores/settings.svelte';
  import Glyph from './Glyph.svelte';
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
        { kind: N.Atom, glyph: 'nukeA', key: 'nukeA' },
        { kind: N.Hydrogen, glyph: 'nukeH', key: 'nukeH' },
        { kind: N.Mirv, glyph: 'nukeMirv', key: 'nukeMirv' },
      ]
    : [];
  const air = cfg.features.air
    ? [
        { kind: 0, glyph: 'fighter' },
        { kind: 1, glyph: 'bomber' },
        { kind: 2, glyph: 'recon' },
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

{#if L}
  <section class="bar glass" data-testid="build-bar">
    <div class="group">
      {#each buildings as b (b.kind)}
        {@const cost = L.buildCosts[b.kind] ?? 0}
        <button
          class="tool"
          class:active={active('build', b.kind)}
          class:poor={L.gold < cost}
          onclick={() => pickBuild(b.kind)}
          onmouseenter={() => (hovered = `b${b.kind}`)}
          onmouseleave={() => (hovered = null)}
          data-testid="build-{BUILDING_KEYS[b.kind]}"
          aria-label={t(`building.${BUILDING_KEYS[b.kind]}.name`)}
        >
          <Glyph kind={BUILDING_KEYS[b.kind]!} />
          <span class="cost mono">{short(cost)}</span>
          <kbd>{keyLabel(settings.keys[b.key] ?? '')}</kbd>
          {#if hovered === `b${b.kind}`}
            <div class="tip glass rise-in">
              <h4>{t(`building.${BUILDING_KEYS[b.kind]}.name`)}</h4>
              <p>{t(`building.${BUILDING_KEYS[b.kind]}.desc`)}</p>
              <div class="meta">
                <span>🪙 {short(cost)}</span><span>⏱ {(BUILD_TICKS[b.kind]! / 10).toFixed(0)} s</span><span
                  >{t('hud.owned')} {L.buildingCount[b.kind]}</span
                >
              </div>
            </div>
          {/if}
        </button>
      {/each}
    </div>
    {#if cfg.allowPorts}
      <div class="group">
        <button
          class="tool"
          class:active={hud.tool.k === 'warship'}
          class:poor={L.gold < L.warshipCost}
          onclick={() => (hud.tool = hud.tool.k === 'warship' ? { k: 'none' } : { k: 'warship' })}
          onmouseenter={() => (hovered = 'ws')}
          onmouseleave={() => (hovered = null)}
          aria-label={t('unit.warship.name')}
        >
          <Glyph kind="warship" />
          <span class="cost mono">{short(L.warshipCost)}</span>
          <kbd>{keyLabel(settings.keys.warship ?? '')}</kbd>
          {#if hovered === 'ws'}
            <div class="tip glass rise-in">
              <h4>{t('unit.warship.name')}</h4>
              <p>{t('unit.warship.desc')}</p>
            </div>
          {/if}
        </button>
      </div>
    {/if}
    {#if nukes.length}
      <div class="group">
        {#each nukes as n (n.kind)}
          <button
            class="tool nuke"
            class:active={active('nuke', n.kind)}
            class:poor={(L.maxLaunch[n.kind] ?? 0) === 0}
            onclick={() => pickNuke(n.kind)}
            onmouseenter={() => (hovered = `n${n.kind}`)}
            onmouseleave={() => (hovered = null)}
            data-testid="nuke-{n.glyph}"
            aria-label={t(`nuke.${n.glyph}.name`)}
          >
            <Glyph kind={n.glyph} />
            <span class="cost mono">{short(L.nukeCosts[n.kind] ?? 0)}</span>
            <kbd>{keyLabel(settings.keys[n.key] ?? '')}</kbd>
            {#if active('nuke', n.kind) && hud.tool.k === 'nuke'}<span class="count mono"
                >×{hud.tool.count}</span
              >{/if}
            {#if hovered === `n${n.kind}`}
              <div class="tip glass rise-in">
                <h4>{t(`nuke.${n.glyph}.name`)}</h4>
                <p>{t(`nuke.${n.glyph}.desc`)}</p>
                <div class="meta"><span>{t('hud.ready')} ×{L.maxLaunch[n.kind]}</span></div>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    {#if air.length}
      <div class="group">
        {#each air as a (a.kind)}
          <button
            class="tool"
            class:active={active('air', a.kind)}
            class:poor={L.gold < AIR_COST[a.kind as 0 | 1 | 2] || L.buildingCount[B.Airfield] === 0}
            onclick={() => (hud.tool = { k: 'air', kind: a.kind })}
            onmouseenter={() => (hovered = `a${a.kind}`)}
            onmouseleave={() => (hovered = null)}
            aria-label={t(`unit.${a.glyph}.name`)}
          >
            <Glyph kind={a.glyph} />
            <span class="cost mono">{short(AIR_COST[a.kind as 0 | 1 | 2])}</span>
            {#if hovered === `a${a.kind}`}
              <div class="tip glass rise-in">
                <h4>{t(`unit.${a.glyph}.name`)}</h4>
                <p>{t(`unit.${a.glyph}.desc`)}</p>
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
    <div class="group views">
      <button
        class="tool small"
        class:active={hud.views.terrain}
        onclick={() => (hud.views.terrain = !hud.views.terrain)}
        title="{t('hud.view.terrain')} ({keyLabel(settings.keys.terrainView ?? '')})"
        ><Glyph kind="terrain" size={18} /></button
      >
      {#if cfg.features.fog}<button
          class="tool small"
          class:active={hud.views.fog}
          onclick={() => (hud.views.fog = !hud.views.fog)}
          title="{t('hud.view.fog')} ({keyLabel(settings.keys.fogView ?? '')})"
          ><Glyph kind="fog" size={18} /></button
        >{/if}
      <button
        class="tool small"
        class:active={hud.views.resources}
        onclick={() => (hud.views.resources = !hud.views.resources)}
        title="{t('hud.view.resources')} ({keyLabel(settings.keys.resourcesView ?? '')})"
        ><Glyph kind="resources" size={18} /></button
      >
    </div>
  </section>
{/if}

<style>
  .bar {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 0.5rem;
    padding: 0.45rem;
    z-index: 6;
    transform-origin: bottom right;
    transform: scale(var(--ui-scale));
  }
  .group {
    display: flex;
    gap: 0.3rem;
    padding-right: 0.5rem;
    border-right: 1px solid var(--line);
  }
  .group:last-child {
    border-right: 0;
    padding-right: 0;
  }
  .views {
    flex-direction: column;
    justify-content: center;
  }
  .tool {
    position: relative;
    width: 54px;
    height: 58px;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid transparent;
    border-radius: 10px;
    color: var(--parchment);
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s,
      transform 0.12s;
  }
  .tool.small {
    width: 34px;
    height: 26px;
  }
  .tool:hover {
    background: rgba(79, 227, 193, 0.12);
    border-color: var(--line-strong);
    transform: translateY(-1px);
  }
  .tool.active {
    background: rgba(79, 227, 193, 0.22);
    border-color: var(--aurora);
    color: var(--aurora);
  }
  .tool.poor {
    opacity: 0.45;
  }
  .tool.nuke {
    color: #ffb070;
  }
  .cost {
    font-size: 0.68em;
    color: var(--brass);
  }
  kbd {
    position: absolute;
    top: 2px;
    right: 4px;
    font-size: 0.6em;
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
  .tip {
    position: absolute;
    bottom: calc(100% + 10px);
    right: 0;
    width: 250px;
    padding: 0.7rem 0.8rem;
    text-align: left;
    z-index: 20;
    pointer-events: none;
  }
  .tip h4 {
    margin: 0 0 0.3rem;
    font-family: var(--title);
    color: var(--parchment);
  }
  .tip p {
    margin: 0 0 0.4rem;
    font-size: 0.82em;
    color: var(--muted);
    line-height: 1.4;
  }
  .meta {
    display: flex;
    gap: 0.8rem;
    font-size: 0.78em;
    color: var(--brass);
  }
</style>
