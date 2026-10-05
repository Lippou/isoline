<script lang="ts">
  // Commerce, printed on the journal's paper: the masthead counts partners and embargoes
  // and gives the takings by sea and by rail; then the gold of the last five minutes as
  // the lead figure, the partners by what they bring, the embargoes both ways, the
  // countries we do not trade with, each with its order. The rules close the page.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
  import PaperMast from './PaperMast.svelte';
  import { audio } from '../../audio/audio';
  import type { GameController } from '../game/controller';
  import type { LocalView, PlayerView } from '../../engine/protocol';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
  let showOthers = $state(false);

  type Trade = LocalView['trade'][number];
  type Embargo = LocalView['embargoes'][number];
  interface Row {
    p: PlayerView;
    trade: Trade | undefined;
    embargo: Embargo | undefined;
    gold: number;
  }

  const me = $derived(hud.local);
  const rows = $derived.by((): Row[] => {
    const l = hud.local;
    if (!l) return [];
    const trade = new Map(l.trade.map((r) => [r.id, r]));
    const emb = new Map(l.embargoes.map((r) => [r.id, r]));
    return hud.players
      .filter((p) => p.alive && p.spawned && p.kind !== 'tribe' && p.id !== l.id)
      .map((p) => {
        const tr = trade.get(p.id);
        return { p, trade: tr, embargo: emb.get(p.id), gold: tr ? tr.sea + tr.rail : 0 };
      });
  });
  const blocked = (r: Row) =>
    !!r.embargo && (r.embargo.mine || r.embargo.theirs || r.embargo.mineFor > 0 || r.embargo.theirsFor > 0);
  const partners = $derived(
    rows
      .filter((r) => !blocked(r) && r.trade && (r.gold > 0 || r.trade.ships + r.trade.trains > 0))
      .sort((a, b) => b.gold - a.gold),
  );
  const embargoed = $derived(rows.filter(blocked).sort((a, b) => b.gold - a.gold || a.p.tiles - b.p.tiles));
  const others = $derived(
    rows.filter((r) => !blocked(r) && !partners.includes(r)).sort((a, b) => b.p.tiles - a.p.tiles),
  );
  const top = $derived(Math.max(1, ...partners.map((r) => r.gold)));
  const sea = $derived((me?.trade ?? []).reduce((a, r) => a + r.sea, 0));
  const rail = $derived((me?.trade ?? []).reduce((a, r) => a + r.rail, 0));
  const boom = $derived(hud.world?.event?.id === 'boom');
  const allies = $derived(new Set(me?.allies.map((a) => a.id) ?? []));
  const myTeam = $derived(hud.players.find((p) => p.id === hud.viewer)?.team ?? 0);

  const nameOf = (p: PlayerView) => p.name[i18n.lang] || p.name.en;
  const center = (p: PlayerView) => ctl.focusPlayer(p.id);
  /** Every order given from this window is acknowledged by a sound. */
  const order = (c: Parameters<typeof s.cmd>[0]) => {
    audio.ui('confirm');
    s.cmd(c);
  };
  const setEmbargo = (id: number, on: boolean) => order({ t: 'embargo', target: id, on });
  /** Block everyone but allies and teammates (one order per country). */
  function embargoAll(): void {
    audio.ui('confirm');
    for (const r of rows) {
      if (r.embargo?.mine || allies.has(r.p.id) || (myTeam > 0 && r.p.team === myTeam)) continue;
      s.cmd({ t: 'embargo', target: r.p.id, on: true });
    }
  }
  const via = (n: number, one: string, many: string) => (n === 1 ? t(one) : t(many, { n }));
  const count = (n: number, none: string, one: string, many: string) =>
    n === 0 ? t(none) : n === 1 ? t(one) : t(many, { n });
</script>

{#snippet name(r: Row)}
  <button class="np-name" onclick={() => center(r.p)} title={t('trade.center')}
    ><i class="np-ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></i>{nameOf(
      r.p,
    )}</button
  >
{/snippet}

<div class="paper newsprint np-window trade">
  <PaperMast title={t('panel.trade')} onclose={() => (hud.panels.trade = false)}>
    {#if me}
      <p class="np-dateline">
        <span>{count(partners.length, 'trade.partnersNone', 'trade.partnersOne', 'trade.partnersMany')}</span>
        {#if sea + rail > 0}
          <span class="split">
            <span><Icon name="port" size={12} />{t('trade.bySea', { gold: short(sea) })}</span>
            <span><Icon name="train" size={12} />{t('trade.byRail', { gold: short(rail) })}</span>
          </span>
        {:else}
          <span>{t('trade.noTakings')}</span>
        {/if}
        <b class:spot={embargoed.length > 0}
          >{count(embargoed.length, 'trade.embargoesNone', 'trade.embargoesOne', 'trade.embargoesMany')}</b
        >
      </p>
      <div class="tools">
        <button class="np-btn small quiet" onclick={embargoAll}
          ><Icon name="embargo" size={14} />{t('trade.embargoAll')}</button
        >
        <button
          class="np-btn small quiet"
          disabled={!embargoed.some((r) => r.embargo?.mine)}
          onclick={() => order({ t: 'embargoAll', on: false, exceptTeam: false })}
          >{t('trade.liftAll')}</button
        >
      </div>
    {/if}
  </PaperMast>

  <div class="np-body scroll">
    {#if !me}
      <p class="np-empty">{t('trade.intro')}</p>
    {:else}
      <!-- The lead figure: the gold of the last five minutes, sea and rail as one rule. -->
      {#if sea + rail > 0 || boom}
        <div class="lead">
          {#if sea + rail > 0}
            <p class="sum">
              <b class="total">+{short(sea + rail)}</b>
              <span class="what">{t('trade.earned')}</span>
            </p>
            <span class="ways" aria-hidden="true"
              ><i class="sea" style:flex-grow={sea}></i><i class="rail" style:flex-grow={rail}></i></span
            >
          {/if}
          {#if boom}<p class="boom"><Icon name="income" size={13} />{t('trade.boom')}</p>{/if}
        </div>
      {/if}

      <h3 class="np-mark">
        <Icon name="trade" size={13} />{t('trade.partners')} <span class="n">{partners.length}</span>
      </h3>
      {#if partners.length}
        <ul class="list" data-testid="trade-partners">
          {#each partners as r (r.p.id)}
            <li class="row">
              <img class="np-flag" src={flagUrl(r.p, 32)} alt="" />
              <div class="who">
                {@render name(r)}
                <span class="note">
                  {#if r.trade?.ships}
                    <span
                      ><Icon name="port" size={12} />{via(r.trade.ships, 'trade.ship1', 'trade.ships')}</span
                    >
                  {:else if r.trade?.sea}
                    <span><Icon name="port" size={12} />{t('trade.viaSea')}</span>
                  {/if}
                  {#if r.trade?.trains}
                    <span
                      ><Icon name="train" size={12} />{via(
                        r.trade.trains,
                        'trade.train1',
                        'trade.trains',
                      )}</span
                    >
                  {:else if r.trade?.rail}
                    <span><Icon name="train" size={12} />{t('trade.viaRail')}</span>
                  {/if}
                </span>
                <span class="share" aria-hidden="true"><i style="width:{(r.gold / top) * 100}%"></i></span>
              </div>
              <span class="gold" class:none={r.gold <= 0} data-tip={t('trade.goldTip')}
                >{r.gold > 0 ? `+${short(r.gold)}` : '—'}</span
              >
              <button class="np-act" onclick={() => setEmbargo(r.p.id, true)}
                ><Icon name="embargo" size={13} />{t('trade.embargo')}</button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="np-empty">{t('trade.partnersEmpty')}</p>
      {/if}

      <h3 class="np-mark" class:spot={embargoed.length > 0}>
        <Icon name="noTrade" size={13} />{t('trade.embargoes')} <span class="n">{embargoed.length}</span>
      </h3>
      {#if embargoed.length}
        <ul class="list" data-testid="trade-embargoes">
          {#each embargoed as r (r.p.id)}
            {@const e = r.embargo!}
            <li class="row">
              <img class="np-flag" src={flagUrl(r.p, 32)} alt="" />
              <div class="who">
                {@render name(r)}
                <span class="note">
                  {#if e.mine || e.theirs}
                    <span class="np-tag" class:spot={e.theirs} class:warn={!e.theirs}
                      >{e.mine && e.theirs
                        ? t('trade.mutual')
                        : e.mine
                          ? t('trade.mine')
                          : t('trade.theirs')}</span
                    >
                  {/if}
                  {#if e.mineFor > 0}
                    <span class="temp" data-tip={t('trade.tempTip')}
                      ><Icon name="hourglass" size={12} />{t('trade.mineFor', {
                        clock: clock(e.mineFor),
                      })}</span
                    >
                  {/if}
                  {#if e.theirsFor > 0}
                    <span class="temp spot" data-tip={t('trade.tempTip')}
                      ><Icon name="hourglass" size={12} />{t('trade.theirsFor', {
                        clock: clock(e.theirsFor),
                      })}</span
                    >
                  {/if}
                </span>
              </div>
              {#if r.gold > 0}<span class="gold" data-tip={t('trade.goldTip')}>+{short(r.gold)}</span>{/if}
              {#if e.mine}
                <button class="np-act" onclick={() => setEmbargo(r.p.id, false)}>{t('trade.lift')}</button>
              {:else}
                <button class="np-act" onclick={() => setEmbargo(r.p.id, true)}
                  ><Icon name="embargo" size={13} />{t('trade.embargo')}</button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="np-empty">{t('trade.embargoesEmpty')}</p>
      {/if}

      {#if others.length}
        <button class="np-mark fold" onclick={() => (showOthers = !showOthers)} aria-expanded={showOthers}>
          <Icon name={showOthers ? 'chevronDown' : 'chevronRight'} size={13} />{t('trade.others')}
          <span class="n">{others.length}</span>
        </button>
        {#if showOthers}
          <ul class="list quiet">
            {#each others as r (r.p.id)}
              <li class="row">
                <img class="np-flag" src={flagUrl(r.p, 32)} alt="" />
                <div class="who">
                  {@render name(r)}
                  <span class="note">{t('trade.noTrade')}</span>
                </div>
                <button class="np-act" onclick={() => setEmbargo(r.p.id, true)}
                  ><Icon name="embargo" size={13} />{t('trade.embargo')}</button
                >
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      <aside class="np-box np-rules">
        <h3>{t('trade.rules')}</h3>
        <p>{t('trade.intro')}</p>
      </aside>
    {/if}
  </div>
</div>

<style>
  .np-dateline .split {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0 10px;
  }
  .np-dateline .split span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .np-dateline .spot {
    color: var(--np-spot);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 6px 0 7px;
    border-bottom: 1px solid var(--np-rule);
  }
  .tools .np-btn:first-child {
    margin-left: -8px;
  }

  /* The lead: the takings as the page's big figure, the share of sea and rail under it. */
  .lead {
    display: grid;
    gap: 6px;
    padding: 12px 0 4px;
  }
  .sum {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    margin: 0;
  }
  .total {
    font-family: var(--text);
    font-size: 1.9em;
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    color: var(--np-warn);
  }
  .what {
    font-family: var(--np-serif);
    font-style: italic;
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .ways {
    display: flex;
    gap: 2px;
    height: 3px;
  }
  .ways i {
    flex: 0 1 0;
    min-width: 0;
  }
  .ways .sea {
    background: var(--np-sea);
  }
  /* Rail: broken like sleepers, sea solid, so the two shares part without their colours. */
  .ways .rail {
    background: repeating-linear-gradient(90deg, var(--np-gold) 0 5px, transparent 5px 7px);
  }
  .boom {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    font-size: 0.82em;
    font-weight: 500;
    color: var(--np-good);
  }

  .np-mark :global(svg) {
    flex: none;
  }
  .fold {
    margin-top: 14px;
  }

  /* A country: its flag in the margin; its name and the gold it brings, then what runs
     between us and the order; its share of the takings as a rule at the foot. */
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    grid-template-areas: 'flag name gold' 'flag note act' 'flag share share';
    align-items: center;
    gap: 2px 10px;
    padding: 8px 0;
  }
  .row + .row {
    border-top: 1px solid var(--np-rule);
  }
  .row > img {
    grid-area: flag;
    align-self: start;
    width: 28px;
    height: 19px;
    margin-top: 2px;
  }
  .who {
    display: contents;
  }
  .who .np-name {
    grid-area: name;
    justify-self: start;
    max-width: 100%;
  }
  .note {
    grid-area: note;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 10px;
    font-size: 0.78em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
  }
  .note span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .note .np-tag {
    font-size: 1em;
  }
  .temp.spot {
    color: var(--np-spot);
  }
  /* The partner's share of the takings: a brass rule on a hairline. */
  .share {
    grid-area: share;
    display: block;
    height: 2px;
    margin-top: 3px;
    background: var(--np-paper-2);
  }
  .share i {
    display: block;
    height: 100%;
    background: var(--np-gold);
    transition: width 0.4s ease;
  }
  .gold {
    grid-area: gold;
    justify-self: end;
    font-family: var(--text);
    font-size: 0.9em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--np-warn);
  }
  .gold.none {
    font-weight: 400;
    color: var(--np-ink-3);
  }
  .row > .np-act {
    grid-area: act;
    justify-self: end;
    margin-right: -5px;
  }
  .quiet .np-name {
    font-weight: 500;
  }
  @media (prefers-reduced-motion: reduce) {
    .share i {
      transition: none;
    }
  }
</style>
