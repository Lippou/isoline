<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import Glyph from './Glyph.svelte';
  import type { GameController } from '../game/controller';
  import { B, BUILDING_KEYS, N } from '../../core/game/constants';
  import { IS_LAND } from '../../core/map/terrain';
  import { EMOJIS } from '../../render/renderer';
  import { audio } from '../../audio/audio';
  import { confirmModal } from '../stores/app.svelte';

  let { ctl }: { ctl: GameController } = $props();
  type Item = {
    id: string;
    label: string;
    glyph?: string;
    icon?: string;
    run?: () => void;
    sub?: Item[];
    disabled?: boolean;
    danger?: boolean;
  };
  let stack: Item[][] = $state([]);
  const s = ctl.session;
  const cfg = s.config;

  function close(): void {
    hud.radial = null;
    stack = [];
  }
  function act(fn: () => void): () => void {
    return () => {
      fn();
      audio.ui('confirm');
      close();
    };
  }

  const NUKE_NAMES = ['nukeA', 'nukeH', 'nukeMirv'];

  function nukeItems(tile: number): Item[] {
    const L = hud.local;
    if (!L || !cfg.allowNukes) return [];
    return [N.Atom, N.Hydrogen, N.Mirv].map((kind) => {
      const max = L.maxLaunch[kind] ?? 0;
      const counts = kind === N.Mirv ? [1] : [1, 2, 5, max];
      return {
        id: `n${kind}`,
        label: t(`nuke.${NUKE_NAMES[kind]}.name`),
        glyph: NUKE_NAMES[kind]!,
        disabled: max === 0,
        sub: counts.map((c, k) => ({
          id: `n${kind}x${k}`,
          label: k === 3 && kind !== N.Mirv ? `×Max (${max})` : `×${c}`,
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
        label: t('radial.allyRequest'),
        icon: '🤝',
        run: act(() => s.cmd({ t: 'allyRequest', target })),
      });
    else {
      items.push({
        id: 'renew',
        label: t('radial.allyRenew'),
        icon: '🔁',
        run: act(() => s.cmd({ t: 'allyRequest', target })),
      });
      items.push({
        id: 'break',
        label: t('radial.allyBreak'),
        icon: '✂',
        danger: true,
        run: act(() => s.cmd({ t: 'allyBreak', target })),
      });
      if (cfg.allowDonations) {
        items.push({
          id: 'donate',
          label: t('radial.donate'),
          icon: '🎁',
          sub: [
            {
              id: 'g10',
              label: `🪙 10%`,
              run: act(() => s.cmd({ t: 'donate', target, gold: L.gold * 0.1, troops: 0 })),
            },
            {
              id: 'g25',
              label: `🪙 25%`,
              run: act(() => s.cmd({ t: 'donate', target, gold: L.gold * 0.25, troops: 0 })),
            },
            {
              id: 't10',
              label: `⚔ 10%`,
              run: act(() => s.cmd({ t: 'donate', target, gold: 0, troops: L.troops * 0.1 })),
            },
            {
              id: 't25',
              label: `⚔ 25%`,
              run: act(() => s.cmd({ t: 'donate', target, gold: 0, troops: L.troops * 0.25 })),
            },
          ],
        });
      }
    }
    items.push({
      id: 'emb',
      label: embargo ? t('radial.embargoOff') : t('radial.embargoOn'),
      icon: '⚓',
      run: act(() => s.cmd({ t: 'embargo', target, on: !embargo })),
    });
    items.push({
      id: 'quick',
      label: t('radial.quick'),
      icon: '💬',
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

  const root = $derived.by((): Item[] => {
    const r = hud.radial;
    if (!r) return [];
    if (r.tile < -1) {
      const tile = -r.tile - 2;
      const target = s.state.owner[tile] ?? 0;
      return EMOJIS.map((e, k) => ({
        id: `e${k}`,
        label: e,
        icon: e,
        run: act(() => s.cmd({ t: 'emoji', target, tile, emoji: k })),
      }));
    }
    const tile = r.tile;
    const owner = s.state.owner[tile]!;
    const land = IS_LAND[s.state.terrain[tile]!] === 1;
    const items: Item[] = [];
    if (s.state.phase === 'spawn') {
      items.push({
        id: 'spawn',
        label: t('radial.spawn'),
        icon: '📍',
        run: act(() => s.cmd({ t: 'spawn', tile })),
      });
      return items;
    }
    if (land && owner !== s.viewer) {
      items.push({
        id: 'attack',
        label: t('radial.attack', { pct: Math.round(hud.attackRatio * 100) }),
        icon: '⚔',
        run: attackGuard(owner, () => s.cmd({ t: 'attack', tile, ratio: hud.attackRatio })),
      });
      items.push({
        id: 'boat',
        label: t('radial.boat'),
        icon: '⛵',
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
      items.push({
        id: 'build',
        label: t('radial.build'),
        glyph: 'city',
        sub: kinds.map((k) => ({
          id: `b${k}`,
          label: t(`building.${BUILDING_KEYS[k]}.name`),
          glyph: BUILDING_KEYS[k]!,
          disabled: (hud.local?.gold ?? 0) < (hud.local?.buildCosts[k] ?? Infinity),
          run: act(() => s.cmd({ t: 'build', kind: k, tile })),
        })),
      });
      const b = s.state.buildings.find(
        (x) =>
          Math.abs(x.x - (tile % s.state.width)) <= 1 &&
          Math.abs(x.y - ((tile / s.state.width) | 0)) <= 1 &&
          x.owner === s.viewer,
      );
      if (b) {
        items.push({
          id: 'up',
          label: t('radial.upgrade'),
          icon: '⬆',
          run: act(() => s.cmd({ t: 'upgrade', id: b.id })),
        });
        items.push({
          id: 'del',
          label: t('radial.demolish'),
          icon: '🗑',
          danger: true,
          run: act(() => s.cmd({ t: 'demolish', id: b.id })),
        });
      }
    }
    const nukes = nukeItems(tile);
    if (nukes.length && owner !== s.viewer)
      items.push({ id: 'nukes', label: t('radial.nukes'), glyph: 'nukeA', sub: nukes, danger: true });
    if (!land && cfg.allowPorts) {
      items.push({
        id: 'ws',
        label: t('radial.warshipHere'),
        glyph: 'warship',
        run: act(() => s.cmd({ t: 'warship', tile })),
      });
      if (hud.selection.length)
        items.push({
          id: 'move',
          label: t('radial.moveShips', { n: hud.selection.length }),
          icon: '➜',
          run: act(() => s.cmd({ t: 'shipMove', ids: hud.selection, tile, patrol: true })),
        });
    }
    if (cfg.features.air) {
      items.push({
        id: 'air',
        label: t('radial.air'),
        glyph: 'fighter',
        sub: [
          {
            id: 'f',
            label: t('unit.fighter.name'),
            glyph: 'fighter',
            run: act(() => s.cmd({ t: 'air', kind: 0, tile })),
          },
          {
            id: 'bo',
            label: t('unit.bomber.name'),
            glyph: 'bomber',
            run: act(() => s.cmd({ t: 'air', kind: 1, tile })),
          },
          {
            id: 'r',
            label: t('unit.recon.name'),
            glyph: 'recon',
            run: act(() => s.cmd({ t: 'air', kind: 2, tile })),
          },
        ],
      });
    }
    const diplo = diplomacyItems(owner);
    if (diplo.length) items.push({ id: 'diplo', label: t('radial.diplomacy'), icon: '🏳', sub: diplo });
    items.push({
      id: 'ping',
      label: t('radial.ping'),
      icon: '◎',
      run: act(() => s.cmd({ t: 'ping', tile, kind: 0 })),
    });
    return items;
  });

  const items = $derived(stack.length ? stack[stack.length - 1]! : root);
  const R = 92;
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
  <div class="radial" style="left:{hud.radial.x}px; top:{hud.radial.y}px" data-testid="radial">
    <button class="center glass" onclick={() => (stack.length ? (stack = stack.slice(0, -1)) : close())}
      >{stack.length ? '↩' : '✕'}</button
    >
    {#each items as it, k (it.id)}
      {@const a = -Math.PI / 2 + (k / items.length) * Math.PI * 2}
      <button
        class="item glass fade-in"
        class:danger={it.danger}
        disabled={it.disabled}
        style="transform: translate({Math.cos(a) * (items.length > 8 ? R * 1.25 : R)}px, {Math.sin(a) *
          (items.length > 8 ? R * 1.25 : R)}px); animation-delay:{k * 18}ms"
        onclick={() => {
          if (it.sub) {
            stack = [...stack, it.sub];
            audio.ui('open');
          } else it.run?.();
        }}
        title={it.label}
        data-testid="radial-{it.id}"
      >
        {#if it.glyph}<Glyph kind={it.glyph} size={20} />{:else}<span class="ico">{it.icon}</span>{/if}
        <span class="lab">{it.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 40;
  }
  .radial {
    position: absolute;
    z-index: 41;
    width: 0;
    height: 0;
  }
  .center {
    position: absolute;
    left: -22px;
    top: -22px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    cursor: pointer;
    color: var(--parchment);
  }
  .item {
    position: absolute;
    left: -38px;
    top: -30px;
    width: 76px;
    height: 60px;
    border-radius: 14px;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    cursor: pointer;
    color: var(--parchment);
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .item:hover:not(:disabled) {
    background: rgba(79, 227, 193, 0.22);
    border-color: var(--aurora);
  }
  .item.danger {
    color: #ffb070;
  }
  .item:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .ico {
    font-size: 1.25em;
    line-height: 1;
  }
  .lab {
    font-size: 0.66em;
    line-height: 1.1;
    max-width: 70px;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
