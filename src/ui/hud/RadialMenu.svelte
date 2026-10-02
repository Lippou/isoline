<script lang="ts">
  // Context menu (right click): what is under the cursor, then grouped actions
  // with their cost; sub-menus open in a side column.
  import { hud } from '../stores/game.svelte';
  import { t, i18n } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import Icon from '../icons/Icon.svelte';
  import { BUILDING_ICONS, SIGNALS, type IconName } from '../icons/icons';
  import type { GameController } from '../game/controller';
  import { B, BUILDING_KEYS, N } from '../../core/game/constants';
  import { IS_LAND, TERRAIN } from '../../core/map/terrain';
  import { audio } from '../../audio/audio';
  import { confirmModal } from '../stores/app.svelte';
  import { flagUrl } from '../../render/flags';
  import { formatShort } from '../../render/renderer';

  let { ctl }: { ctl: GameController } = $props();
  type Item = {
    id: string;
    label: string;
    icon?: IconName;
    /** Right-aligned detail: cost, count, shortcut. */
    hint?: string;
    desc?: string;
    run?: () => void;
    sub?: Item[];
    disabled?: boolean;
    danger?: boolean;
    group?: string;
  };
  let openSub: string | null = $state(null);
  const s = ctl.session;
  const cfg = s.config;

  function close(): void {
    hud.radial = null;
    openSub = null;
  }
  function act(fn: () => void): () => void {
    return () => {
      fn();
      audio.ui('confirm');
      close();
    };
  }

  const NUKE_NAMES = ['nukeA', 'nukeH', 'nukeMirv'];
  const gold = (n: number) => `${formatShort(n)}`;

  function nukeItems(tile: number): Item[] {
    const L = hud.local;
    if (!L || !cfg.allowNukes) return [];
    return [N.Atom, N.Hydrogen, N.Mirv].map((kind) => {
      const max = L.maxLaunch[kind] ?? 0;
      const counts = kind === N.Mirv ? [1] : [1, 2, 5, max];
      return {
        id: `n${kind}`,
        label: t(`nuke.${NUKE_NAMES[kind]}.name`),
        icon: 'nuke' as IconName,
        hint: max > 0 ? `${max}` : t('radial.unavailable'),
        disabled: max === 0,
        danger: true,
        sub: counts.map((c, k) => ({
          id: `n${kind}x${k}`,
          label:
            k === 3 && kind !== N.Mirv ? t('radial.launchMax', { n: max }) : t('radial.launchN', { n: c }),
          disabled: c > max || c === 0,
          danger: true,
          run: act(() => s.cmd({ t: 'nuke', kind, tile, count: Math.max(1, c) })),
        })),
      };
    });
  }

  function diplomacyItems(target: number): Item[] {
    const L = hud.local;
    if (!L || target <= 0 || target === s.viewer) return [];
    const p = s.state.players.get(target);
    if (!p || p.kind === 'tribe') return [];
    const allied = L.allies.some((a) => a.id === target);
    const embargo = L.embargo.includes(target);
    const items: Item[] = [];
    if (!allied)
      items.push({
        id: 'ally',
        group: 'diplo',
        label: t('radial.allyRequest'),
        icon: 'alliance',
        run: act(() => s.cmd({ t: 'allyRequest', target })),
      });
    else {
      items.push({
        id: 'renew',
        group: 'diplo',
        label: t('radial.allyRenew'),
        icon: 'renew',
        run: act(() => s.cmd({ t: 'allyRequest', target })),
      });
      items.push({
        id: 'break',
        group: 'diplo',
        label: t('radial.allyBreak'),
        icon: 'betrayal',
        danger: true,
        run: act(() => s.cmd({ t: 'allyBreak', target })),
      });
      if (cfg.allowDonations) {
        items.push({
          id: 'donate',
          group: 'diplo',
          label: t('radial.donate'),
          icon: 'gift',
          sub: [
            {
              id: 'g10',
              label: t('radial.giveGold', { pct: 10 }),
              hint: gold(L.gold * 0.1),
              run: act(() => s.cmd({ t: 'donate', target, gold: L.gold * 0.1, troops: 0 })),
            },
            {
              id: 'g25',
              label: t('radial.giveGold', { pct: 25 }),
              hint: gold(L.gold * 0.25),
              run: act(() => s.cmd({ t: 'donate', target, gold: L.gold * 0.25, troops: 0 })),
            },
            {
              id: 't10',
              label: t('radial.giveTroops', { pct: 10 }),
              hint: gold(L.troops * 0.1),
              run: act(() => s.cmd({ t: 'donate', target, gold: 0, troops: L.troops * 0.1 })),
            },
            {
              id: 't25',
              label: t('radial.giveTroops', { pct: 25 }),
              hint: gold(L.troops * 0.25),
              run: act(() => s.cmd({ t: 'donate', target, gold: 0, troops: L.troops * 0.25 })),
            },
          ],
        });
      }
    }
    items.push({
      id: 'emb',
      group: 'diplo',
      label: embargo ? t('radial.embargoOff') : t('radial.embargoOn'),
      icon: 'embargo',
      desc: t('radial.embargoDesc'),
      run: act(() => s.cmd({ t: 'embargo', target, on: !embargo })),
    });
    items.push({
      id: 'quick',
      group: 'diplo',
      label: t('radial.quick'),
      icon: 'chat',
      sub: [0, 1, 2, 3, 4, 5, 6, 7].map((m) => ({
        id: `q${m}`,
        label: t(`quick.${m}`),
        run: act(() => s.cmd({ t: 'quick', target, msg: m })),
      })),
    });
    return items;
  }

  function attackGuard(target: number, fn: () => void): () => void {
    const L = hud.local;
    const allied = L?.allies.some((a) => a.id === target);
    if (allied && settings.game.confirmations) {
      return () => {
        close();
        confirmModal(
          t('confirm.betrayTitle'),
          t('confirm.betrayBody'),
          fn,
          t('confirm.betrayYes'),
          t('common.cancel'),
        );
      };
    }
    return act(fn);
  }

  const signalMode = $derived(!!hud.radial && hud.radial.tile < -1);
  const tile = $derived(hud.radial ? (hud.radial.tile < -1 ? -hud.radial.tile - 2 : hud.radial.tile) : 0);
  const owner = $derived(s.state.owner[tile] ?? 0);
  const ownerView = $derived(owner > 0 ? s.state.players.get(owner) : undefined);
  const terrainKey = $derived(TERRAIN[s.state.terrain[tile] ?? 0]?.key ?? 'plains');

  const items = $derived.by((): Item[] => {
    const r = hud.radial;
    if (!r) return [];
    if (signalMode) {
      return SIGNALS.map((sig, k) => ({
        id: `e${k}`,
        group: 'signal',
        label: t(`signal.${sig.key}`),
        icon: sig.icon,
        run: act(() => s.cmd({ t: 'emoji', target: owner, tile, emoji: k })),
      }));
    }
    const land = IS_LAND[s.state.terrain[tile]!] === 1;
    const out: Item[] = [];
    if (s.state.phase === 'spawn') {
      out.push({
        id: 'spawn',
        group: 'main',
        label: t('radial.spawn'),
        icon: 'pin',
        run: act(() => s.cmd({ t: 'spawn', tile })),
      });
      return out;
    }
    if (land && owner !== s.viewer) {
      out.push({
        id: 'attack',
        group: 'main',
        label: owner === 0 ? t('radial.expand') : t('radial.attackPlain'),
        icon: 'war',
        hint: `${Math.round(hud.attackRatio * 100)} %`,
        desc: t('radial.attackDesc'),
        run: attackGuard(owner, () => s.cmd({ t: 'attack', tile, ratio: hud.attackRatio })),
      });
      out.push({
        id: 'boat',
        group: 'main',
        label: t('radial.boat'),
        icon: 'transport',
        hint: `${Math.round(hud.attackRatio * 100)} %`,
        desc: t('radial.boatDesc'),
        run: attackGuard(owner, () => s.cmd({ t: 'boat', tile, ratio: hud.attackRatio })),
      });
    }
    if (land && owner === s.viewer) {
      const kinds = [B.City, B.Port, B.Factory, B.DefensePost, B.Silo, B.Sam, B.Radar, B.Airfield].filter(
        (k) =>
          !(
            (k === B.Port && !cfg.allowPorts) ||
            (k === B.Factory && !cfg.allowFactories) ||
            (k === B.Silo && !cfg.allowNukes) ||
            (k === B.Radar && !cfg.features.radar) ||
            (k === B.Airfield && !cfg.features.air)
          ),
      );
      out.push({
        id: 'build',
        group: 'main',
        label: t('radial.build'),
        icon: 'city',
        sub: kinds.map((k) => {
          const cost = hud.local?.buildCosts[k] ?? Infinity;
          return {
            id: `b${k}`,
            label: t(`building.${BUILDING_KEYS[k]}.name`),
            icon: BUILDING_ICONS[k],
            hint: gold(cost),
            desc: t(`building.${BUILDING_KEYS[k]}.desc`),
            disabled: (hud.local?.gold ?? 0) < cost,
            run: act(() => s.cmd({ t: 'build', kind: k, tile })),
          };
        }),
      });
      const b = s.state.buildings.find(
        (x) =>
          Math.abs(x.x - (tile % s.state.width)) <= 1 &&
          Math.abs(x.y - ((tile / s.state.width) | 0)) <= 1 &&
          x.owner === s.viewer,
      );
      if (b) {
        out.push({
          id: 'up',
          group: 'main',
          label: t('radial.upgradeNamed', { name: t(`building.${BUILDING_KEYS[b.type]}.name`) }),
          icon: 'upgrade',
          hint: `${t('radial.level')} ${b.level}`,
          run: act(() => s.cmd({ t: 'upgrade', id: b.id })),
        });
        out.push({
          id: 'del',
          group: 'main',
          label: t('radial.demolish'),
          icon: 'trash',
          danger: true,
          run: act(() => s.cmd({ t: 'demolish', id: b.id })),
        });
      }
    }
    if (!land && cfg.allowPorts) {
      out.push({
        id: 'ws',
        group: 'military',
        label: t('radial.warshipHere'),
        icon: 'warship',
        hint: hud.local ? gold(hud.local.warshipCost) : '',
        run: act(() => s.cmd({ t: 'warship', tile })),
      });
      if (hud.selection.length)
        out.push({
          id: 'move',
          group: 'military',
          label: t('radial.moveShips', { n: hud.selection.length }),
          icon: 'next',
          run: act(() => s.cmd({ t: 'shipMove', ids: hud.selection, tile, patrol: true })),
        });
    }
    if (cfg.features.air) {
      out.push({
        id: 'air',
        group: 'military',
        label: t('radial.air'),
        icon: 'airfield',
        sub: [
          { id: 'f', label: t('unit.fighter.name'), k: 0 },
          { id: 'bo', label: t('unit.bomber.name'), k: 1 },
          { id: 'r', label: t('unit.recon.name'), k: 2 },
        ].map((x) => ({
          id: x.id,
          label: x.label,
          icon: 'airfield' as IconName,
          desc: t(`unit.${['fighter', 'bomber', 'recon'][x.k]}.desc`),
          run: act(() => s.cmd({ t: 'air', kind: x.k, tile })),
        })),
      });
    }
    const nukes = nukeItems(tile);
    if (nukes.length && owner !== s.viewer)
      out.push({
        id: 'nukes',
        group: 'military',
        label: t('radial.nukes'),
        icon: 'nuke',
        sub: nukes,
        danger: true,
      });
    out.push(...diplomacyItems(owner));
    out.push({
      id: 'ping',
      group: 'other',
      label: t('radial.ping'),
      icon: 'pin',
      run: act(() => s.cmd({ t: 'ping', tile, kind: 0 })),
    });
    return out;
  });

  const groups = $derived.by(() => {
    const order = ['main', 'military', 'diplo', 'signal', 'other'];
    return order
      .map((g) => ({ g, list: items.filter((it) => (it.group ?? 'other') === g) }))
      .filter((x) => x.list.length);
  });
  const sub = $derived(items.find((it) => it.id === openSub)?.sub ?? null);

  // Keep the menu on screen.
  const pos = $derived.by(() => {
    const r = hud.radial;
    if (!r) return { x: 0, y: 0 };
    const w = 260;
    const h = 64 + items.length * 34;
    return {
      x: Math.min(r.x + 6, window.innerWidth - w * (sub ? 2 : 1) - 12),
      y: Math.max(8, Math.min(r.y + 6, window.innerHeight - h - 12)),
    };
  });
</script>

{#if hud.radial && items.length}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="backdrop"
    onclick={close}
    oncontextmenu={(e) => {
      e.preventDefault();
      close();
    }}
  ></div>
  <div class="ctx" style="left:{pos.x}px; top:{pos.y}px" data-testid="radial" role="menu">
    <div class="menu panel fade-in">
      <header>
        {#if signalMode}
          <Icon name="pin" size={16} />
          <span>{t('radial.signalTitle')}</span>
        {:else if ownerView}
          <img class="flag" src={flagUrl(ownerView, 24)} alt="" />
          <div class="who">
            <b>{ownerView.name[i18n.lang] || ownerView.name.en}</b>
            <small>{t(`terrain.${terrainKey}`)}{owner === s.viewer ? ` · ${t('radial.yours')}` : ''}</small>
          </div>
        {:else}
          <Icon name="terrain" size={16} />
          <div class="who">
            <b>{t(`terrain.${terrainKey}`)}</b>
            <small>{IS_LAND[s.state.terrain[tile] ?? 0] ? t('radial.unclaimed') : t('radial.sea')}</small>
          </div>
        {/if}
        <button class="x" onclick={close} aria-label={t('common.close')}
          ><Icon name="close" size={15} /></button
        >
      </header>
      {#each groups as gr, gi (gr.g)}
        {#if gi > 0}<div class="sep"></div>{/if}
        {#each gr.list as it (it.id)}
          <button
            class="item"
            class:danger={it.danger}
            class:open={openSub === it.id}
            disabled={it.disabled}
            role="menuitem"
            title={it.desc ?? ''}
            onclick={() => {
              if (it.sub) {
                openSub = openSub === it.id ? null : it.id;
                audio.ui('open');
              } else it.run?.();
            }}
            onmouseenter={() => it.sub && !it.disabled && (openSub = it.id)}
            data-testid="radial-{it.id}"
          >
            {#if it.icon}<Icon name={it.icon} size={17} />{:else}<span class="sp"></span>{/if}
            <span class="lab">{it.label}</span>
            {#if it.hint}<span class="hint mono">{it.hint}</span>{/if}
            {#if it.sub}<Icon name="chevronRight" size={15} />{/if}
          </button>
        {/each}
      {/each}
    </div>
    {#if sub}
      <div class="menu panel subm fade-in">
        {#each sub as it (it.id)}
          <button
            class="item"
            class:danger={it.danger}
            disabled={it.disabled}
            role="menuitem"
            title={it.desc ?? ''}
            onclick={() => it.run?.()}
            data-testid="radial-{it.id}"
          >
            {#if it.icon}<Icon name={it.icon} size={17} />{:else}<span class="sp"></span>{/if}
            <span class="lab">{it.label}</span>
            {#if it.hint}<span class="hint mono">{it.hint}</span>{/if}
          </button>
          {#if it.desc && !it.disabled && sub.length <= 8}<p class="desc">{it.desc}</p>{/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 40;
  }
  .ctx {
    position: absolute;
    z-index: 41;
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .menu {
    width: 260px;
    padding: 4px;
    display: grid;
  }
  .subm {
    width: 280px;
    max-height: 70vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 8px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 4px;
    color: var(--muted);
  }
  header .flag {
    width: 26px;
    height: 19px;
    object-fit: cover;
    border: 1px solid #0006;
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .who b {
    color: var(--parchment);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .who small {
    font-size: 0.8em;
  }
  .x {
    background: none;
    border: 0;
    color: var(--faint);
    cursor: pointer;
    padding: 2px;
  }
  .x:hover {
    color: var(--parchment);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: 4px;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--parchment);
  }
  .item:hover:not(:disabled),
  .item.open {
    background: var(--panel-3);
  }
  .item.danger {
    color: #f0a49c;
  }
  .item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .lab {
    flex: 1;
    min-width: 0;
  }
  .hint {
    color: var(--brass);
    font-size: 0.85em;
  }
  .sp {
    width: 17px;
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 4px 6px;
  }
  .desc {
    margin: -2px 8px 6px 35px;
    font-size: 0.78em;
    color: var(--faint);
    line-height: 1.35;
  }
</style>
