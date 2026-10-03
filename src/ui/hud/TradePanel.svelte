<script lang="ts">
  // Commerce: who we trade with (gold over the last minutes, ships and trains running
  // between us), the embargoes both ways, and the switch to block or lift each one.
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagUrl } from '../../render/flags';
  import Icon from '../icons/Icon.svelte';
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
</script>

{#if !me}
  <p class="hint">{t('trade.intro')}</p>
{:else}
  <p class="hint intro">{t('trade.intro')}</p>

  {#if sea + rail > 0 || boom}
    <div class="sum">
      {#if sea + rail > 0}
        <b class="total mono">{short(sea + rail)}</b>
        <span class="what">{t('trade.earned')}</span>
        <span class="split mono">
          <span><Icon name="port" size={13} />{t('trade.bySea', { gold: short(sea) })}</span>
          <span><Icon name="train" size={13} />{t('trade.byRail', { gold: short(rail) })}</span>
        </span>
      {/if}
      {#if boom}<span class="boom"><Icon name="income" size={13} />{t('trade.boom')}</span>{/if}
    </div>
  {/if}

  <h4 class="section-title">
    <Icon name="trade" size={14} />{t('trade.partners')}<i class="n">{partners.length}</i>
  </h4>
  {#if partners.length}
    <ul class="legend" data-testid="trade-partners">
      {#each partners as r (r.p.id)}
        <li>
          <img src={flagUrl(r.p, 32)} alt="" />
          <div class="who">
            <button class="name" onclick={() => center(r.p)} title={t('trade.center')}
              ><i class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></i>{nameOf(
                r.p,
              )}</button
            >
            <span class="note">
              {#if r.trade?.ships}
                <span><Icon name="port" size={12} />{via(r.trade.ships, 'trade.ship1', 'trade.ships')}</span>
              {:else if r.trade?.sea}
                <span><Icon name="port" size={12} />{t('trade.viaSea')}</span>
              {/if}
              {#if r.trade?.trains}
                <span
                  ><Icon name="train" size={12} />{via(r.trade.trains, 'trade.train1', 'trade.trains')}</span
                >
              {:else if r.trade?.rail}
                <span><Icon name="train" size={12} />{t('trade.viaRail')}</span>
              {/if}
            </span>
            <span class="share" aria-hidden="true"><i style="width:{(r.gold / top) * 100}%"></i></span>
          </div>
          <span class="gold mono" class:none={r.gold <= 0} data-tip={t('trade.goldTip')}
            >{r.gold > 0 ? `+${short(r.gold)}` : '—'}</span
          >
          <button class="btn small ghost act" onclick={() => setEmbargo(r.p.id, true)}
            ><Icon name="embargo" size={13} />{t('trade.embargo')}</button
          >
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint empty">{t('trade.partnersEmpty')}</p>
  {/if}

  <h4 class="section-title">
    <Icon name="noTrade" size={14} />{t('trade.embargoes')}<i class="n">{embargoed.length}</i>
  </h4>
  {#if embargoed.length}
    <ul class="legend" data-testid="trade-embargoes">
      {#each embargoed as r (r.p.id)}
        {@const e = r.embargo!}
        <li class="blocked">
          <img src={flagUrl(r.p, 32)} alt="" />
          <div class="who">
            <button class="name" onclick={() => center(r.p)} title={t('trade.center')}
              ><i class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></i>{nameOf(
                r.p,
              )}</button
            >
            {#if e.mine || e.theirs}
              <span class="note status" class:bad={e.theirs}
                >{e.mine && e.theirs ? t('trade.mutual') : e.mine ? t('trade.mine') : t('trade.theirs')}</span
              >
            {/if}
            {#if e.mineFor > 0}
              <span class="note temp" data-tip={t('trade.tempTip')}
                ><Icon name="hourglass" size={12} />{t('trade.mineFor', { clock: clock(e.mineFor) })}</span
              >
            {/if}
            {#if e.theirsFor > 0}
              <span class="note temp bad" data-tip={t('trade.tempTip')}
                ><Icon name="hourglass" size={12} />{t('trade.theirsFor', {
                  clock: clock(e.theirsFor),
                })}</span
              >
            {/if}
          </div>
          {#if r.gold > 0}<span class="gold mono" class:none={r.gold <= 0} data-tip={t('trade.goldTip')}
              >{r.gold > 0 ? `+${short(r.gold)}` : '—'}</span
            >{/if}
          {#if e.mine}
            <button class="btn small act" onclick={() => setEmbargo(r.p.id, false)}>{t('trade.lift')}</button>
          {:else}
            <button class="btn small ghost act" onclick={() => setEmbargo(r.p.id, true)}
              ><Icon name="embargo" size={13} />{t('trade.embargo')}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint empty">{t('trade.embargoesEmpty')}</p>
  {/if}
  <div class="bulk">
    <button class="btn small" onclick={embargoAll}
      ><Icon name="embargo" size={13} />{t('trade.embargoAll')}</button
    >
    <button
      class="btn small ghost"
      disabled={!embargoed.some((r) => r.embargo?.mine)}
      onclick={() => order({ t: 'embargoAll', on: false, exceptTeam: false })}>{t('trade.liftAll')}</button
    >
  </div>

  {#if others.length}
    <button class="section-title fold" onclick={() => (showOthers = !showOthers)} aria-expanded={showOthers}>
      <Icon name={showOthers ? 'chevronDown' : 'chevronRight'} size={14} />{t('trade.others')}<i class="n"
        >{others.length}</i
      >
    </button>
    {#if showOthers}
      <ul class="legend quiet">
        {#each others as r (r.p.id)}
          <li>
            <img src={flagUrl(r.p, 32)} alt="" />
            <div class="who">
              <button class="name" onclick={() => center(r.p)} title={t('trade.center')}
                ><i class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></i>{nameOf(
                  r.p,
                )}</button
              >
              <span class="note">{t('trade.noTrade')}</span>
            </div>
            <button class="btn small ghost act" onclick={() => setEmbargo(r.p.id, true)}
              ><Icon name="embargo" size={13} />{t('trade.embargo')}</button
            >
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
{/if}

<style>
  .intro {
    margin: 0 0 12px;
  }
  .sum {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    column-gap: 10px;
    row-gap: 4px;
    padding: 0 0 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }
  .total {
    font-size: 1.9em;
    font-weight: 600;
    line-height: 1;
    color: var(--brass);
  }
  .what {
    color: var(--muted);
    font-size: 0.92em;
  }
  .split {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    color: var(--muted);
    font-size: 0.9em;
  }
  .split span,
  .boom {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .boom {
    grid-column: 1 / -1;
    color: var(--good-text);
    font-size: 0.88em;
  }
  .section-title {
    margin: 14px 0 6px;
  }
  .section-title:first-of-type {
    margin-top: 0;
  }
  .n {
    font-style: normal;
    font-weight: 500;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
  }
  .fold {
    appearance: none;
    width: 100%;
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
  }
  .fold:hover {
    color: var(--parchment);
  }

  /* A map legend: flag, name, what is going on, the figure and the switch. */
  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 26px 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 7px 0;
    border-top: 1px solid var(--line);
  }
  li:first-child {
    border-top: 0;
  }
  img {
    width: 26px;
    height: 18px;
    object-fit: cover;
    border: 1px solid #0007;
    align-self: start;
    margin-top: 2px;
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--parchment);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name:hover {
    color: var(--aurora);
  }
  .ink {
    flex: none;
    width: 4px;
    height: 13px;
    border-radius: 1px;
  }
  .note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 10px;
    font-size: 0.84em;
    color: var(--muted);
  }
  .note span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .note.temp {
    gap: 5px;
    width: fit-content;
  }
  .note.status {
    color: var(--warn-text);
  }
  .note.bad {
    color: var(--bad-text);
  }
  .share {
    display: block;
    height: 3px;
    margin-top: 3px;
    border-radius: 2px;
    background: var(--panel-3);
    overflow: hidden;
  }
  .share i {
    display: block;
    height: 100%;
    background: var(--brass);
    transition: width 0.4s ease;
  }
  .gold {
    color: var(--brass);
    font-weight: 600;
  }
  .gold.none {
    color: var(--faint);
    font-weight: 400;
  }
  .act {
    grid-column: 4;
  }
  .quiet .who .name {
    font-weight: 500;
  }
  .empty {
    margin: 0 0 4px;
  }
  .bulk {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 10px 0 4px;
  }
</style>
