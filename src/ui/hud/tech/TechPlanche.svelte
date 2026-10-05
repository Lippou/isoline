<script lang="ts">
  // The tree as a planche, for a wide window: a branch per row, a tier per column (the
  // endless technologies last, behind a double rule). Every card prints its name in full,
  // its effect, what it needs from other branches and its cost. Pointing at a card draws
  // the lines from what it needs and numbers its path: rings and lines only, nothing moves.
  import { onMount } from 'svelte';
  import { t, num } from '../../i18n/i18n.svelte';
  import Icon from '../../icons/Icon.svelte';
  import {
    BRANCHES,
    BRANCH_ROWS,
    LEVELS,
    MAX_REPEAT,
    NODES,
    TIERS,
    TIER_COST,
    techKey,
  } from '../../../core/rules/tech';
  import {
    BRANCH_ICON,
    ROMAN,
    branchName,
    chainOf,
    descOf,
    iconOf,
    nameOf,
    prereqs,
    tierName,
    type TechModel,
  } from './model.svelte';

  let { m }: { m: TechModel } = $props();

  /** The cards of a branch, in order: its six technologies, then the endless one. */
  const rows = BRANCH_ROWS.map((b) => NODES.filter((n) => n.branch === b).sort((a, z) => a.level - z.level));

  // Where the cards stand (measured): the lines are drawn over the grid, never in it.
  let grid: HTMLDivElement | undefined = $state();
  let box = $state({ w: 0, h: 0 });
  let gap = $state(8);
  let at = $state<{ x: number; y: number; w: number; h: number }[]>([]);
  function measure(): void {
    if (!grid) return;
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (const el of grid.querySelectorAll<HTMLElement>('[data-node]'))
      out[Number(el.dataset.node)] = {
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
      };
    at = out;
    box = { w: grid.offsetWidth, h: grid.offsetHeight };
    gap = parseFloat(getComputedStyle(grid).columnGap) || 8;
  }
  onMount(() => {
    const ro = new ResizeObserver(measure);
    if (grid) ro.observe(grid);
    measure();
    return () => ro.disconnect();
  });

  /** A rule between two cards of a branch, from one's right side to the next one's left. */
  function chainLine(a: number, b: number): string {
    const A = at[a];
    const B = at[b];
    if (!A || !B) return '';
    const y = A.y + A.h / 2;
    return `M${A.x + A.w},${y} H${B.x}`;
  }
  /**
   * A prerequisite from another branch: out of its side, along the gutters (between the
   * columns, then between the rows), into the left side of the card that needs it.
   */
  function reqLine(a: number, b: number): string {
    const A = at[a];
    const B = at[b];
    if (!A || !B) return '';
    const by = B.y + B.h / 2 + 6;
    const gx2 = B.x - gap / 2;
    if (Math.abs(A.x - B.x) < 2) {
      // Same tier: down (or up) the gutter on the column's left.
      return `M${A.x},${A.y + A.h / 2 + 6} H${gx2} V${by} H${B.x}`;
    }
    const gx1 = A.x + A.w + gap / 2;
    const gy = A.y < B.y ? B.y - gap / 2 : B.y + B.h + gap / 2;
    return `M${A.x + A.w},${A.y + A.h / 2 + 6} H${gx1} V${gy} H${gx2} V${by} H${B.x}`;
  }

  const fnode = $derived(NODES[m.focus]!);
  /** The prerequisites of the technology shown at the foot (ringed, their lines drawn). */
  const need = $derived(prereqs(fnode));
  const hotReq = $derived(fnode.requires.map((r) => ({ a: r, b: fnode.id })));
  const hotChain = $derived(chainOf(fnode));
  const endX = $derived.by(() => {
    const a = at[rows[0]![LEVELS - 1]!.id];
    const b = at[rows[0]![LEVELS]!.id];
    return a && b ? (a.x + a.w + b.x) / 2 : -1;
  });
  const levelOf = (b: number): number => Math.min(LEVELS, m.levels[b] ?? 0);

  function enter(id: number): void {
    m.hovered = id;
  }
  function leave(id: number): void {
    if (m.hovered === id) m.hovered = -1;
  }
</script>

<div class="pbox scroll">
  <div class="planche" bind:this={grid} data-testid="tech-tree">
    <!-- Every other branch lightly shaded, as a table's rows. -->
    {#each rows as _, r (r)}
      <span class="band" class:shade={r % 2 === 1} style="grid-row:{r + 2}" aria-hidden="true"></span>
    {/each}
    <span class="corner" aria-hidden="true"></span>
    {#each { length: TIERS + 1 } as _, c (c)}
      <div class="colh" class:endless={c === TIERS} style="grid-column:{c + 2}">
        {#if c < TIERS}
          <b>{ROMAN[c]}</b><span class="mono">{t('tech.points', { n: num(TIER_COST[c]!) })}</span>
        {:else}
          <b class="inf">∞</b><span>{t('tech.tierRepeat')}</span>
        {/if}
      </div>
    {/each}

    {#each rows as nodes, r (r)}
      {@const b = BRANCH_ROWS[r]!}
      {@const br = BRANCHES[b]!}
      <div class="rowh b-{br}" style="grid-row:{r + 2}">
        <span class="rico"><Icon name={BRANCH_ICON[br]!} size={16} /></span>
        <span class="rname">{t(`tech.${br}.title`)}</span>
        <span class="rlv mono">{levelOf(b)}/{LEVELS}</span>
      </div>
      {#each nodes as n (n.id)}
        {@const st = m.stateOf(n.id)}
        {@const order = m.order(n.id)}
        <button
          class="tk card {st} b-{br}"
          class:focus={n.id === m.focus}
          class:pre={need.includes(n.id) && n.id !== m.focus}
          class:need={m.preview && order >= 0}
          class:endless={n.repeat}
          style="grid-row:{r + 2}; grid-column:{n.level + 1}"
          data-node={n.id}
          onclick={(e) => m.research(n.id, e)}
          onmouseenter={() => enter(n.id)}
          onmouseleave={() => leave(n.id)}
          onfocus={() => enter(n.id)}
          onblur={() => leave(n.id)}
          aria-label="{nameOf(n.id)} — {t(`tech.state.${st}`)}"
          data-testid="tech-{techKey(n.id).slice(5)}"
        >
          <span class="c-name">{nameOf(n.id)}</span>
          <span class="c-eff">{descOf(n.id)}</span>
          <span class="c-foot">
            <span class="tk-ico"><Icon name={iconOf(n)} size={14} /></span>
            {#each n.requires as q (q)}
              {@const qn = NODES[q]!}
              <span class="tk-req b-{branchName(qn)}" class:ok={m.researched(q)} title={tierName(qn)}
                ><Icon name={m.researched(q) ? 'check' : BRANCH_ICON[branchName(qn)]!} size={11} />{ROMAN[
                  qn.tier - 1
                ]}</span
              >
            {/each}
            <span class="tk-state">
              {#if n.repeat && m.reps(n) > 0}<span class="mono reps">×{m.reps(n)}/{MAX_REPEAT}</span>{/if}
              {#if st === 'done'}<Icon name="check" size={13} />
              {:else}
                {#if st === 'locked'}<Icon name="lock" size={11} />{/if}
                <span class="tk-cost">{num(m.cost(n.id))}</span>
              {/if}
            </span>
          </span>
          {#if order >= 0 && st !== 'done'}<span class="tk-ord" class:pre={m.preview}>{order + 1}</span>{/if}
          {#if st === 'current'}<span class="tk-prog" style="width:{m.progress(n.id) * 100}%"></span>{/if}
        </button>
      {/each}
    {/each}

    <svg class="links" width={box.w} height={box.h} aria-hidden="true">
      {#if endX > 0}<line
          class="endline"
          x1={endX}
          x2={endX}
          y1={at[rows[0]![0]!.id]?.y ?? 0}
          y2={box.h}
        />{/if}
      {#each rows as nodes, r (r)}
        {#each nodes.slice(1) as n (n.id)}
          <path
            class="chain"
            class:done={n.repeat ? m.reps(n) > 0 || m.researched(chainOf(n)) : m.researched(n.id)}
            class:hot={n.id === m.focus && hotChain >= 0}
            d={chainLine(chainOf(n), n.id)}
          />
        {/each}
      {/each}
      {#each hotReq as k (`${k.a}-${k.b}`)}
        <path class="req" class:ok={m.researched(k.a)} d={reqLine(k.a, k.b)} />
        {@const B = at[k.b]}
        {#if B}<path
            class="tip"
            class:ok={m.researched(k.a)}
            d="M{B.x - 5},{B.y + B.h / 2 + 2} l5,4 l-5,4"
          />{/if}
      {/each}
    </svg>
  </div>
</div>

<style>
  .pbox {
    min-height: 0;
    container: planche / size;
    padding: 6px 18px 6px 14px;
    scrollbar-color: var(--np-rule) transparent;
  }
  .planche {
    --gap: 8px;
    position: relative;
    display: grid;
    grid-template-columns: minmax(96px, 124px) repeat(6, minmax(120px, 1fr)) minmax(112px, 0.92fr);
    grid-template-rows: auto repeat(6, minmax(min-content, 1fr));
    gap: var(--gap);
    min-height: 100%;
    min-width: 1060px;
  }
  .band {
    grid-column: 1 / -1;
    margin: calc(var(--gap) / -2) 0;
    border-top: 1px solid var(--np-rule);
  }
  .band.shade {
    background: rgba(23, 42, 60, 0.03);
  }
  .corner {
    grid-row: 1;
    grid-column: 1;
  }
  .colh {
    grid-row: 1;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 2px 2px;
    border-bottom: 2px solid var(--np-ink);
    font-family: var(--title);
    color: var(--np-ink);
  }
  .colh b {
    font-weight: 700;
    font-size: 1.02em;
  }
  .colh span {
    font-family: var(--text);
    font-size: 0.72em;
    color: var(--np-ink-3);
  }
  .colh .inf {
    font-weight: 400;
    font-size: 1.2em;
    line-height: 0.9;
  }
  .colh.endless {
    border-bottom-style: double;
    border-bottom-width: 3px;
  }
  .rowh {
    grid-column: 1;
    display: grid;
    align-content: center;
    justify-items: start;
    row-gap: 2px;
    padding-left: 10px;
    border-left: 3px solid var(--acc);
    min-width: 0;
  }
  .rico {
    display: inline-flex;
    color: var(--acc);
  }
  .rname {
    font-family: var(--title);
    font-weight: 600;
    font-size: 1em;
    line-height: 1.15;
    color: var(--np-ink);
  }
  .rlv {
    font-size: 0.72em;
    color: var(--np-ink-3);
  }

  /* ---- a card: its sign and name, its effect, then what it needs and its cost */
  .card {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 1px;
    padding: 5px 9px 4px;
  }
  .c-name {
    min-width: 0;
    padding-right: 10px;
    font-family: var(--title);
    font-weight: 600;
    font-size: 0.92em;
    line-height: 1.12;
    overflow-wrap: break-word;
    hyphens: auto;
  }
  .c-eff {
    align-self: start;
    max-height: 2.6em;
    font-family: var(--np-serif);
    font-size: 0.74em;
    line-height: 1.3;
    color: var(--np-ink-2);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* A taller window: larger print (the window's height decides it, never what is shown). */
  @container planche (min-height: 620px) {
    .c-eff {
      font-size: 0.8em;
    }
  }
  @container planche (min-height: 720px) {
    .planche {
      --gap: 12px;
    }
    .card {
      gap: 2px;
      padding: 6px 10px 5px;
    }
    .c-name {
      font-size: 1.05em;
    }
    .c-eff {
      font-size: 0.84em;
    }
    .c-foot {
      font-size: 0.8em;
    }
  }
  .tk.current .c-eff {
    color: rgba(241, 236, 226, 0.82);
  }
  .tk.locked .c-eff {
    color: var(--np-ink-3);
  }
  .c-foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 3px 4px;
    min-height: 15px;
    font-size: 0.74em;
  }
  .tk-state {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--np-ink-3);
  }
  .reps {
    font-weight: 600;
    color: var(--np-ink);
  }
  .tk.current .reps {
    color: inherit;
  }

  /* ---- the lines, over the grid */
  .links {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    overflow: visible;
  }
  .links path {
    fill: none;
  }
  .links .chain {
    stroke: var(--np-rule-2);
    stroke-width: 1.4;
  }
  /* Researched links: a heavier rule, not only green (the rest stays a fine dotted rule). */
  .links .chain {
    stroke-dasharray: 2 2.5;
  }
  .links .chain.done {
    stroke: color-mix(in srgb, var(--np-good) 65%, transparent);
    stroke-width: 2.2;
    stroke-dasharray: none;
  }
  .links .chain.hot {
    stroke: var(--np-ink);
    stroke-width: 2;
  }
  .links .req,
  .links .tip {
    stroke: var(--np-ink);
    stroke-width: 2.2;
    stroke-linejoin: round;
  }
  .links .req {
    stroke-dasharray: 6 3;
  }
  .links .req.ok,
  .links .tip.ok {
    stroke: var(--np-good);
  }
  /* A requirement met is drawn solid, one still to research stays dashed. */
  .links .req.ok {
    stroke-dasharray: none;
  }
  .links .endline {
    stroke: var(--np-rule-2);
    stroke-width: 3;
    stroke-dasharray: none;
  }
</style>
