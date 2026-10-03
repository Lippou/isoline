<script lang="ts">
  // Context menu (right click): what is under the cursor, then grouped actions
  // with their cost; sub-menus open in a side column.
  import { hud } from '../stores/game.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
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
  import { clientSpotError } from '../game/capitalWatch';

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
    /** Highlighted at the top of the menu (alliance offers). */
    featured?: boolean;
    /** Forbidden for now (the World Council's nuclear ban): printed in magenta, not greyed. */
    banned?: boolean;
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

  /** The World Council's nuclear ban: time left (0: none). */
  const banLeft = $derived(Math.max(0, (hud.world?.nukeBanUntil ?? 0) - hud.tick));

  function nukeItems(tile: number, own: boolean): Item[] {
    const L = hud.local;
    if (!L || !cfg.allowNukes) return [];
    const ban = banLeft > 0;
    const banHint = ban ? t('ban.short', { clock: clock(banLeft) }) : '';
    const banTip = ban ? t('ban.tip', { clock: clock(banLeft) }) : '';
    // On our own land: A and H bombs only, each behind a confirmation.
    const guard = (fn: () => void) => (own ? selfGuard(fn) : act(fn));
    return (own ? [N.Atom, N.Hydrogen] : [N.Atom, N.Hydrogen, N.Mirv]).map((kind) => {
      const max = L.maxLaunch[kind] ?? 0;
      const counts = kind === N.Mirv ? [1] : [1, 2, 5, max];
      return {
        id: `n${kind}`,
        label: t(`nuke.${NUKE_NAMES[kind]}.name`),
        icon: 'nuke' as IconName,
        hint: ban ? banHint : max > 0 ? `${max}` : t('radial.unavailable'),
        disabled: ban || max === 0,
        danger: true,
        banned: ban,
        ...(ban ? { desc: banTip } : {}),
        sub: counts.map((c, k) => ({
          id: `n${kind}x${k}`,
          label:
            k === 3 && kind !== N.Mirv ? t('radial.launchMax', { n: max }) : t('radial.launchN', { n: c }),
          disabled: c > max || c === 0,
          danger: true,
          run: guard(() => s.cmd({ t: 'nuke', kind, tile, count: Math.max(1, c), up: hud.nukeArcUp })),
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
    // They already asked us: answer instead of proposing.
    const asked = L.allyRequests.includes(target);
    if (!allied && asked) {
      items.push({
        id: 'allyAccept',
        group: 'featured',
        featured: true,
        label: t('radial.allyAccept'),
        desc: t('radial.allyAskedYou'),
        icon: 'alliance',
        run: act(() => s.cmd({ t: 'allyAnswer', target, accept: true })),
      });
      items.push({
        id: 'allyRefuse',
        group: 'featured',
        label: t('radial.allyRefuse'),
        icon: 'close',
        run: act(() => s.cmd({ t: 'allyAnswer', target, accept: false })),
      });
    } else if (!allied)
      items.push({
        id: 'ally',
        group: 'featured',
        featured: true,
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
        run: attackGuard(target, () => s.cmd({ t: 'allyBreak', target })),
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

  function selfGuard(fn: () => void): () => void {
    if (!settings.game.confirmations) return act(fn);
    return () => {
      close();
      confirmModal(
        t('confirm.selfNukeTitle'),
        t('confirm.selfNukeBody'),
        fn,
        t('confirm.selfNukeYes'),
        t('common.cancel'),
      );
    };
  }

  /**
   * The seat of government on one of our tiles: re-establish a lost capital (featured at
   * the top), or move the one we hold (once per 5 min). Refusals show their reason.
   */
  function capitalItems(tile: number): Item[] {
    const L = hud.local;
    if (!L || s.state.phase !== 'playing' || L.capital === tile) return [];
    const none = L.capital < 0;
    const err = clientSpotError(s.state, s.viewer, tile);
    const wait = none ? 0 : L.capitalCooldown;
    const hint =
      err === 'front'
        ? t('radial.capitalFront')
        : err === 'fallout'
          ? t('radial.capitalFallout')
          : wait > 0
            ? clock(wait)
            : '';
    return [
      {
        id: 'capital',
        group: none ? 'featured' : 'main',
        featured: none,
        label: t(none ? 'radial.capitalHere' : 'radial.capitalMove'),
        icon: 'capital',
        hint,
        desc: t(none ? 'radial.capitalNeeded' : 'radial.capitalDesc'),
        disabled: err !== 'ok' || wait > 0,
        run: act(() => s.cmd({ t: 'moveCapital', tile })),
      },
    ];
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
      const kinds = [
        B.City,
        B.Port,
        B.Factory,
        B.Lab,
        B.DefensePost,
        B.Silo,
        B.Sam,
        B.Radar,
        B.Airfield,
      ].filter(
        (k) =>
          !(
            (k === B.Port && !cfg.allowPorts) ||
            (k === B.Factory && !cfg.allowFactories) ||
            (k === B.Lab && !cfg.features.tech) ||
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
          hint:
            b.upgrade >= 0
              ? t('radial.upgrading', { next: b.level + 1, pct: Math.floor(b.upgrade * 100) })
              : `${t('radial.level')} ${b.level}`,
          disabled: b.upgrade >= 0 || !b.ready,
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
      out.push(...capitalItems(tile));
    }
    // Warships also sail up navigable rivers (river tiles are land, owned like any other).
    const river = TERRAIN[s.state.terrain[tile] ?? 0]?.key === 'river';
    if ((!land || river) && cfg.allowPorts) {
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
    const nukes = nukeItems(tile, owner === s.viewer);
    if (nukes.length && land)
      out.push({
        id: 'nukes',
        group: 'military',
        label: t('radial.nukes'),
        icon: 'nuke',
        sub: nukes,
        danger: true,
        ...(banLeft > 0
          ? {
              banned: true,
              hint: t('ban.short', { clock: clock(banLeft) }),
              desc: t('ban.tip', { clock: clock(banLeft) }),
            }
          : {}),
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
    const order = ['featured', 'main', 'military', 'diplo', 'signal', 'other'];
    return order
      .map((g) => ({ g, list: items.filter((it) => (it.group ?? 'other') === g) }))
      .filter((x) => x.list.length);
  });
  const sub = $derived(items.find((it) => it.id === openSub)?.sub ?? null);

  // Keep the menu on screen. It never moves while open (opening a sub-menu used to push it
  // left under the pointer, which then opened another one: the menu shook); the sub-menu
  // opens on the side that has room.
  const pos = $derived.by(() => {
    const r = hud.radial;
    if (!r) return { x: 0, y: 0, subLeft: false };
    const w = 260;
    const h = 64 + items.length * 34;
    const x = Math.max(8, Math.min(r.x + 6, window.innerWidth - w - 12));
    return {
      x,
      y: Math.max(8, Math.min(r.y + 6, window.innerHeight - h - 12)),
      subLeft: x + w + 4 + 280 > window.innerWidth - 12,
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
            class:banned={it.banned}
            class:featured={it.featured}
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
            <span class="lab"
              >{it.label}{#if it.featured && it.desc}<small class="sub">{it.desc}</small>{/if}</span
            >
            {#if it.hint}<span class="hint mono">{it.hint}</span>{/if}
            {#if it.sub}<Icon name="chevronRight" size={15} />{/if}
          </button>
        {/each}
      {/each}
    </div>
    {#if sub}
      <div class="menu panel subm fade-in" class:left={pos.subLeft}>
        {#each sub as it (it.id)}
          <button
            class="item"
            class:danger={it.danger}
            class:banned={it.banned}
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
  }
  /* The context menu: a legend printed on the paper (pictogram, label, figure). */
  .menu {
    width: 260px;
    padding: 4px;
    display: grid;
  }
  /* The sub-menu beside it, on the side with room; the menu itself never moves. */
  .subm {
    position: absolute;
    top: 0;
    left: calc(100% + 4px);
    width: 280px;
    max-height: 70vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--np-rule-2) transparent;
  }
  .subm.left {
    left: auto;
    right: calc(100% + 4px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 4px 4px;
    padding: 5px 2px 6px;
    border-bottom: 2px solid var(--np-ink);
    color: var(--np-ink-2);
  }
  header .flag {
    width: 26px;
    height: 18px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
  }
  .who {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .who b {
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.08em;
    line-height: 1.15;
    color: var(--np-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .who small {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
  }
  .x {
    display: inline-grid;
    place-items: center;
    background: none;
    border: 0;
    color: var(--np-ink-3);
    cursor: var(--cursor-pointer, pointer);
    padding: 2px;
  }
  .x:hover {
    color: var(--np-ink);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 1px;
    background: none;
    text-align: left;
    cursor: var(--cursor-pointer, pointer);
    color: var(--np-ink);
  }
  .item > :global(svg:first-child) {
    flex: none;
    color: var(--np-ink-2);
  }
  .item:hover:not(:disabled),
  .item.open {
    background: var(--np-paper-2);
  }
  .item:hover:not(:disabled) > :global(svg:first-child),
  .item.open > :global(svg:first-child) {
    color: var(--np-ink);
  }
  .item.danger,
  .item.danger > :global(svg:first-child) {
    color: var(--np-spot);
  }
  .item.danger:hover:not(:disabled),
  .item.danger.open {
    background: color-mix(in srgb, var(--np-spot) 8%, transparent);
  }
  /* Alliance offers stand out: the alliance's green, ruled, at the top. */
  .item.featured {
    margin: 2px 0;
    padding: 8px 10px;
    border: 1px solid var(--np-good);
    background: color-mix(in srgb, var(--np-good) 7%, transparent);
    color: var(--np-good);
    font-weight: 600;
  }
  .item.featured > :global(svg:first-child) {
    color: var(--np-good);
  }
  .item.featured:hover:not(:disabled) {
    background: color-mix(in srgb, var(--np-good) 14%, transparent);
  }
  .sub {
    display: block;
    font-family: var(--np-serif);
    font-weight: 400;
    font-size: 0.82em;
    color: var(--np-ink-2);
  }
  .item:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }
  /* Nuclear ban: forbidden, printed in magenta (not greyed), the time left as its figure. */
  .item.banned,
  .item.banned:disabled {
    opacity: 1;
    color: var(--np-spot);
    background: color-mix(in srgb, var(--np-spot) 7%, transparent);
  }
  .item.banned:disabled .lab {
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--np-spot) 55%, transparent);
  }
  .item.banned .hint {
    font-weight: 600;
    color: var(--np-spot);
  }
  .lab {
    flex: 1;
    min-width: 0;
  }
  .hint {
    font-weight: 600;
    color: var(--np-brass);
    font-size: 0.85em;
  }
  .sp {
    width: 17px;
  }
  .sep {
    height: 1px;
    background: var(--np-rule);
    margin: 3px 6px;
  }
  .desc {
    margin: -2px 8px 6px 35px;
    font-family: var(--np-serif);
    font-size: 0.78em;
    color: var(--np-ink-2);
    line-height: 1.35;
  }
</style>
