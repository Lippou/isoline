<script lang="ts" module>
  import type { IconName } from '../../icons/icons';

  /** One case of the wheel: an action, or a group whose cases replace the ring. */
  export type WheelItem = {
    id: string;
    label: string;
    icon?: IconName;
    /** A figure printed under the label: a cost, a count, a time. */
    hint?: string;
    /** What it does, shown when the case is held (or slid over). */
    desc?: string;
    /** Figures under the description (cost, build time, owned). */
    meta?: string[];
    /** Why it cannot be done now: shown instead of acting. */
    why?: string;
    disabled?: boolean;
    /** Possible but out of reach for now (not enough gold): printed faint, still chosen. */
    dim?: boolean;
    danger?: boolean;
    /** Forbidden for now (a nuclear ban, a truce): in magenta, struck through. */
    banned?: boolean;
    /** Put forward (an alliance offered to us, a capital to re-establish). */
    featured?: boolean;
    /** Switched on (a view of the map, the tool in hand). */
    on?: boolean;
    /** Waits for a technology: a padlock; a tap opens the tree. */
    locked?: boolean;
    /** A count on the case (unread news). */
    badge?: string;
    sub?: WheelItem[];
    run?: () => void;
    /** The wheel stays open after it (a view switched on or off). */
    keep?: boolean;
    testid?: string;
  };
</script>

<script lang="ts">
  // Phone only (html.phone): the wheel that stands in for the context menu, the build bar and
  // the dock. Its cases are slices of a ring around the finger. Two ways to use it, as in a
  // mobile game: tap a slice (a group opens its own ring, the centre goes back), or keep the
  // finger down from the press that opened it and slide to the slice — lifted there, it acts;
  // a group opens when the finger rests on it. Held without moving, a slice tells what it does.
  import { onDestroy, onMount } from 'svelte';
  import Icon from '../../icons/Icon.svelte';
  import { t } from '../../i18n/i18n.svelte';
  import { view } from '../../stores/viewport.svelte';
  import { audio } from '../../../audio/audio';

  let {
    x,
    y,
    items,
    title,
    subtitle = '',
    flag = '',
    icon,
    drag = false,
    onclose,
    testid = 'wheel',
  }: {
    /** Where it was asked for (client px): its centre, moved in to keep it on the screen. */
    x: number;
    y: number;
    items: WheelItem[];
    title: string;
    subtitle?: string;
    flag?: string;
    icon?: IconName;
    /** Opened by a press whose finger is still down: lifting it on a slice acts. */
    drag?: boolean;
    onclose: () => void;
    testid?: string;
  } = $props();

  /** The groups opened, from the root. */
  let path = $state<string[]>([]);
  const level = $derived.by((): WheelItem[] => {
    let list = items;
    for (const id of path) list = list.find((i) => i.id === id)?.sub ?? list;
    return list;
  });
  const parent = $derived.by((): WheelItem | null => {
    let list = items;
    let at: WheelItem | null = null;
    for (const id of path) {
      at = list.find((i) => i.id === id) ?? at;
      list = at?.sub ?? list;
    }
    return at;
  });

  // ------------------------------------------------------------ geometry
  const RI = 46;
  const n = $derived(Math.max(1, level.length));
  const span = $derived(360 / n);
  const sf = $derived(view.safe);
  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);
  /** The ring's outer radius: wider with more slices, never taller than the screen. */
  const RO = $derived(Math.min(n <= 4 ? 112 : n <= 8 ? 130 : 146, (vh - sf.t - sf.b - 16) / 2));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  // The centre: where the finger was, moved in so that the root's ring is whole on the screen
  // (it does not move between levels).
  let cx = $state(0);
  let cy = $state(0);
  function place(): void {
    const r = RO + 6;
    cx = clamp(x, sf.l + r, Math.max(sf.l + r, vw - sf.r - r));
    cy = clamp(y, sf.t + r, Math.max(sf.t + r, vh - sf.b - r));
  }
  place();

  const rad = (a: number) => (a * Math.PI) / 180;
  /** The slice k's middle angle (degrees, 0 to the right; the first slice at the top). */
  const mid = (k: number) => -90 + k * span;
  function slice(k: number): string {
    const a0 = mid(k) - span / 2 + (n > 1 ? 0.6 : 0);
    const a1 = mid(k) + span / 2 - (n > 1 ? 0.6 : 0.01);
    const big = a1 - a0 > 180 ? 1 : 0;
    const p = (r: number, a: number) =>
      `${(r * Math.cos(rad(a))).toFixed(2)} ${(r * Math.sin(rad(a))).toFixed(2)}`;
    return `M${p(RO, a0)} A${RO} ${RO} 0 ${big} 1 ${p(RO, a1)} L${p(RI + 4, a1)} A${RI + 4} ${RI + 4} 0 ${big} 0 ${p(RI + 4, a0)} Z`;
  }
  /** Where a slice's label sits, and how wide it may be. */
  const labelAt = (k: number) => {
    const r = (RI + 4 + RO) / 2;
    const w = Math.min(96, n > 1 ? 2 * r * Math.sin(rad(span / 2)) * 1.12 : 120);
    return { x: r * Math.cos(rad(mid(k))), y: r * Math.sin(rad(mid(k))), w };
  };

  /** What is under (px, py): the centre, a slice, or outside the ring. */
  function at(px: number, py: number, sliding: boolean): { zone: 'hub' | 'ring' | 'out'; k: number } {
    const dx = px - cx;
    const dy = py - cy;
    const d = Math.hypot(dx, dy);
    if (d < RI) return { zone: 'hub', k: -1 };
    if (!sliding && d > RO + 18) return { zone: 'out', k: -1 };
    const a = ((((Math.atan2(dy, dx) * 180) / Math.PI + 90 + span / 2) % 360) + 360) % 360;
    return { zone: 'ring', k: Math.min(n - 1, Math.floor(a / span)) };
  }

  // ------------------------------------------------------------ the finger
  /** The slice under the finger (or the one held), -1 none. */
  let hot = $state(-1);
  /** The case whose description shows (held, slid over, or refused). */
  let info = $state<WheelItem | null>(null);
  type Track = { id: number; x0: number; y0: number; moved: boolean; opener: boolean; held: boolean };
  let track: Track | null = drag ? { id: -1, x0: x, y0: y, moved: false, opener: true, held: false } : null;
  /** A group under a resting finger opens; a held slice tells what it does. */
  let dwell: ReturnType<typeof setTimeout> | null = null;
  let hold: ReturnType<typeof setTimeout> | null = null;
  /** After a group opened under the finger, lifting it acts only once it has moved again. */
  let freshAt = { x: -1e4, y: -1e4 };

  function clearTimers(): void {
    if (dwell) clearTimeout(dwell);
    if (hold) clearTimeout(hold);
    dwell = hold = null;
  }

  function open(it: WheelItem): void {
    path = [...path, it.id];
    hot = -1;
    info = null;
    audio.ui('open');
    navigator.vibrate?.(8);
  }
  function back(): void {
    if (path.length) {
      path = path.slice(0, -1);
      hot = -1;
      info = null;
      audio.ui('click');
    } else onclose();
  }
  /** A slice chosen: a group opens, a refused one says why, an action is done. */
  function act(it: WheelItem | undefined): void {
    if (!it) return;
    if (it.disabled) {
      info = it;
      navigator.vibrate?.([10, 40, 10]);
      return;
    }
    if (it.sub?.length) return open(it);
    it.run?.();
    if (it.keep) info = null;
    else onclose();
  }

  function setHot(k: number, sliding: boolean, px: number, py: number): void {
    if (k === hot) return;
    hot = k;
    if (dwell) clearTimeout(dwell);
    dwell = null;
    const it = k >= 0 ? level[k] : undefined;
    if (sliding) info = it ?? null;
    // Sliding: a group opens when the finger rests on it.
    if (sliding && it?.sub?.length && !it.disabled)
      dwell = setTimeout(() => {
        dwell = null;
        if (hot !== k || level[k]?.id !== it.id) return;
        open(it);
        freshAt = { x: px, y: py };
      }, 380);
  }

  function down(e: PointerEvent): void {
    e.preventDefault();
    clearTimers();
    track = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, opener: false, held: false };
    const h = at(e.clientX, e.clientY, false);
    hot = h.k;
    if (h.zone === 'ring') {
      const k = h.k;
      // Held without moving: what the slice does, and lifting does nothing.
      hold = setTimeout(() => {
        hold = null;
        if (!track || track.moved || hot !== k) return;
        track.held = true;
        info = level[k] ?? null;
        navigator.vibrate?.(10);
      }, 420);
    }
  }
  function move(e: PointerEvent): void {
    if (!track || (track.id >= 0 && e.pointerId !== track.id)) return;
    if (track.id < 0) track.id = e.pointerId;
    if (!track.moved && Math.hypot(e.clientX - track.x0, e.clientY - track.y0) > 12) {
      track.moved = true;
      if (hold) clearTimeout(hold);
      hold = null;
    }
    if (!track.moved || track.held) return;
    const h = at(e.clientX, e.clientY, true);
    setHot(h.zone === 'ring' ? h.k : -1, true, e.clientX, e.clientY);
  }
  function up(e: PointerEvent): void {
    const tr = track;
    if (!tr || (tr.id >= 0 && e.pointerId !== tr.id)) return;
    track = null;
    clearTimers();
    if (tr.held) {
      hot = -1;
      return;
    }
    const fresh = Math.hypot(e.clientX - freshAt.x, e.clientY - freshAt.y) < 14;
    freshAt = { x: -1e4, y: -1e4 };
    if (tr.opener && !tr.moved) return; // the press that opened it: the wheel stays, to be tapped
    const h = at(e.clientX, e.clientY, tr.moved);
    hot = -1;
    if (tr.moved) {
      if (h.zone === 'ring' && !fresh) act(level[h.k]);
      else if (h.zone === 'ring') info = null;
      return;
    }
    if (h.zone === 'hub') back();
    else if (h.zone === 'out') onclose();
    else act(level[h.k]);
  }
  function cancel(e: PointerEvent): void {
    if (track && (track.id < 0 || e.pointerId === track.id)) {
      track = null;
      clearTimers();
      hot = -1;
    }
  }
  /** A keyboard or an assistive tool (no pointer): the slice's own button. */
  function keyAct(e: MouseEvent, it: WheelItem): void {
    if (e.detail !== 0) return;
    act(it);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      back();
    }
  }
  function onResize(): void {
    vw = window.innerWidth;
    vh = window.innerHeight;
    place();
  }

  onMount(() => {
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
  onDestroy(() => {
    clearTimers();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
  });

  // (Items are rebuilt with every tick: the case shown is looked up again by its id.)
  const shown = $derived.by((): WheelItem | null => {
    if (!info) return null;
    const it = level.find((i) => i.id === info!.id) ?? info;
    return it.desc || it.why || it.meta?.length ? it : null;
  });
  /** The description card: beside the wheel, on the side with more room. */
  const card = $derived.by(() => {
    const w = 236;
    const leftRoom = cx - RO - sf.l;
    const rightRoom = vw - sf.r - cx - RO;
    const right = rightRoom >= leftRoom;
    const room = right ? rightRoom : leftRoom;
    if (room >= w + 20) return { left: right ? cx + RO + 12 : cx - RO - 12 - w, top: cy, w, below: false };
    return { left: clamp(cx - w / 2, sf.l + 8, vw - sf.r - w - 8), top: cy + RO + 8, w, below: true };
  });
</script>

<svelte:window onresize={onResize} onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="veil"
  onpointerdown={down}
  oncontextmenu={(e) => e.preventDefault()}
  data-testid="{testid}-veil"
></div>
<div
  class="wheel"
  style:left="{cx}px"
  style:top="{cy}px"
  style:--ro="{RO}px"
  role="menu"
  aria-label={parent ? parent.label : title}
  data-testid={testid}
>
  <svg
    class="ring"
    width={2 * RO + 8}
    height={2 * RO + 8}
    viewBox="{-RO - 4} {-RO - 4} {2 * RO + 8} {2 * RO + 8}"
    aria-hidden="true"
  >
    <circle r={RO + 2} class="edge" />
    {#each level as it, k (it.id)}
      <path
        d={slice(k)}
        class="slice"
        class:hot={hot === k}
        class:on={it.on}
        class:danger={it.danger}
        class:banned={it.banned}
        class:featured={it.featured}
        class:off={it.disabled}
      />
    {/each}
    <circle r={RI} class="hubdisc" class:hot={false} />
  </svg>
  {#each level as it, k (it.id)}
    {@const p = labelAt(k)}
    <button
      class="lab"
      class:hot={hot === k}
      class:on={it.on}
      class:danger={it.danger}
      class:banned={it.banned}
      class:off={it.disabled}
      class:locked={it.locked}
      class:dim={it.dim}
      style:left="{p.x}px"
      style:top="{p.y}px"
      style:width="{p.w}px"
      role="menuitem"
      aria-disabled={it.disabled}
      aria-label={it.hint ? `${it.label} (${it.hint})` : it.label}
      tabindex="0"
      onclick={(e) => keyAct(e, it)}
      data-testid={it.testid ?? `${testid}-${it.id}`}
    >
      {#if it.icon}<span class="ic"
          ><Icon name={it.icon} size={21} />{#if it.locked}<i class="mark"><Icon name="lock" size={10} /></i
            >{/if}{#if it.sub?.length}<i class="more" aria-hidden="true"></i>{/if}</span
        >{/if}
      <span class="name">{it.label}</span>
      {#if it.hint}<span class="cost mono">{it.hint}</span>{/if}
      {#if it.badge}<i class="badge mono">{it.badge}</i>{/if}
    </button>
  {/each}
  <button
    class="hub"
    onclick={(e) => e.detail === 0 && back()}
    aria-label={path.length ? t('common.back') : t('common.close')}
    data-testid="{testid}-hub"
  >
    {#if parent}
      <Icon name="back" size={16} />
      <b>{parent.label}</b>
    {:else}
      {#if flag}<img src={flag} alt="" />{:else if icon}<Icon name={icon} size={18} />{/if}
      <b>{title}</b>
      {#if subtitle}<small>{subtitle}</small>{/if}
    {/if}
  </button>
</div>
{#if shown}
  <div
    class="card newsprint"
    class:below={card.below}
    class:refused={shown.disabled}
    style:left="{card.left}px"
    style:top="{card.top}px"
    style:width="{card.w}px"
    role="status"
    data-testid="{testid}-info"
  >
    <b>{shown.label}</b>
    {#if shown.hint}<span class="mono fig">{shown.hint}</span>{/if}
    {#if shown.why}<p class="why">{shown.why}</p>{/if}
    {#if shown.desc && shown.desc !== shown.why}<p>{shown.desc}</p>{/if}
    {#if shown.meta?.length}<div class="meta">
        {#each shown.meta as m (m)}<span>{m}</span>{/each}
      </div>{/if}
  </div>
{/if}

<style>
  /* Under the wheel: the map dimmed a little, a tap there closes. */
  .veil {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(4, 8, 16, 0.3);
    touch-action: none;
  }
  .wheel {
    position: fixed;
    z-index: 41;
    width: 0;
    height: 0;
    pointer-events: none;
    animation: open 0.14s ease-out;
  }
  @keyframes open {
    from {
      scale: 0.82;
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .wheel {
      animation: none;
    }
  }
  .ring {
    position: absolute;
    left: calc(-1 * var(--ro) - 4px);
    top: calc(-1 * var(--ro) - 4px);
    overflow: visible;
    filter: drop-shadow(0 8px 18px rgba(3, 10, 16, 0.45));
  }
  /* The ring is a sheet of the Courier's paper, cut in slices by ink hairlines. */
  .edge {
    fill: var(--np-ink);
  }
  .slice {
    fill: var(--np-paper);
    transition: fill 0.08s;
  }
  .slice.featured {
    fill: color-mix(in srgb, var(--np-good) 14%, var(--np-paper));
  }
  .slice.banned {
    fill: color-mix(in srgb, var(--np-spot) 10%, var(--np-paper));
  }
  .slice.on {
    fill: var(--np-paper-2);
  }
  .slice.hot {
    fill: var(--np-ink);
  }
  .slice.danger.hot {
    fill: var(--np-spot);
  }
  .slice.off.hot {
    fill: var(--np-ink-3);
  }
  .hubdisc {
    fill: var(--np-card);
    stroke: var(--np-ink);
    stroke-width: 2;
  }
  /* A slice's legend: pictogram, name, figure (it takes no pointer: the wheel reads the finger). */
  .lab {
    position: absolute;
    translate: -50% -50%;
    display: grid;
    justify-items: center;
    gap: 1px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--np-ink);
    font-family: var(--text);
    pointer-events: none;
    text-align: center;
  }
  .lab .ic {
    position: relative;
    display: inline-flex;
  }
  .name {
    max-width: 100%;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1.12;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    hyphens: auto;
  }
  .cost {
    font-size: 10px;
    font-weight: 600;
    color: var(--np-brass);
    white-space: nowrap;
  }
  .lab.danger,
  .lab.banned {
    color: var(--np-spot);
  }
  .lab.banned .name {
    text-decoration: line-through;
  }
  .lab.off,
  .lab.dim,
  .lab.locked {
    opacity: 0.5;
  }
  .lab.hot {
    color: var(--np-paper);
    opacity: 1;
  }
  .lab.hot .cost {
    color: #e6c67e;
  }
  .lab.on:not(.hot) .ic::after {
    content: '';
    position: absolute;
    right: -7px;
    top: -3px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--np-good);
  }
  .mark {
    position: absolute;
    left: -9px;
    top: -4px;
    display: inline-flex;
  }
  /* A group: a small notch says that it opens its own ring. */
  .more {
    position: absolute;
    right: -8px;
    bottom: -1px;
    width: 0;
    height: 0;
    border-left: 4px solid currentColor;
    border-top: 3px solid transparent;
    border-bottom: 3px solid transparent;
  }
  .badge {
    position: absolute;
    top: -6px;
    right: 6px;
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--np-spot);
    color: #fff;
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    line-height: 16px;
  }
  /* The centre: where the wheel is (a country, a group); a tap there goes back or closes. */
  .hub {
    position: absolute;
    left: -42px;
    top: -42px;
    width: 84px;
    height: 84px;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 1px;
    padding: 4px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--np-ink);
    pointer-events: none;
    text-align: center;
  }
  .hub b {
    max-width: 76px;
    font-family: var(--title);
    font-size: 11.5px;
    font-weight: 700;
    line-height: 1.1;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .hub small {
    max-width: 74px;
    font-size: 9.5px;
    line-height: 1.1;
    color: var(--np-ink-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hub img {
    width: 26px;
    height: auto;
    box-shadow: 0 0 0 1px var(--np-rule);
  }
  /* What a slice does: a slip of paper beside the wheel. */
  .card {
    position: fixed;
    z-index: 42;
    translate: 0 -50%;
    display: grid;
    gap: 3px;
    padding: 9px 12px 10px;
    border-top: 3px solid var(--np-ink);
    box-shadow: 0 10px 26px rgba(3, 10, 16, 0.45);
    pointer-events: none;
    color: var(--np-ink);
  }
  .card.below {
    translate: 0 0;
  }
  .card.refused {
    border-top-color: var(--np-spot);
  }
  .card b {
    font-family: var(--title);
    font-size: 15px;
    line-height: 1.15;
  }
  .card .fig {
    font-size: 12px;
    font-weight: 600;
    color: var(--np-brass);
  }
  .card p {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 12px;
    line-height: 1.4;
    color: var(--np-ink-2);
  }
  .card .why {
    font-family: var(--text);
    font-weight: 600;
    color: var(--np-spot);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    padding-top: 4px;
    border-top: 1px solid var(--np-rule);
    font-size: 11px;
    font-weight: 600;
    color: var(--np-brass);
  }
</style>
