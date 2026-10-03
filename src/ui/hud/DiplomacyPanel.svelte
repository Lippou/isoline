<script lang="ts">
  // Diplomacy, printed on the journal's paper: the masthead counts allies and wars, then
  // every country by standing (allies, at war, the others by size) with what it thinks of
  // you and what can be done with it. The rules close the page.
  import './paper.css';
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagUrl } from '../../render/flags';
  import type { GameController } from '../game/controller';
  import { confirmModal } from '../stores/app.svelte';
  import Icon from '../icons/Icon.svelte';
  import { audio } from '../../audio/audio';
  import { ALLIANCE_REQUEST_TTL, ALLIANCE_RENEW_WINDOW, ALLIANCE_TICKS } from '../../core/game/constants';
  import OpinionMeter from './OpinionMeter.svelte';
  import PaperMast from './PaperMast.svelte';
  import { pct, oddsLine } from './opinion';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
  /** Every order given from this window is acknowledged by a sound: the click did register. */
  const order = (c: Parameters<typeof s.cmd>[0]) => {
    audio.ui('confirm');
    s.cmd(c);
  };
  /** Offers sent from here (tick): the button says so while the other side thinks it over. */
  let sent = $state<Record<number, number>>({});
  const pending = (id: number) => sent[id] !== undefined && hud.tick - sent[id]! < ALLIANCE_REQUEST_TTL;
  function propose(id: number): void {
    order({ t: 'allyRequest', target: id });
    sent[id] = hud.tick;
  }
  /** Breaking an alliance is a betrayal: confirm first (unless confirmations are off). */
  function breakAlliance(target: number): void {
    const go = () => order({ t: 'allyBreak', target });
    if (!settings.game.confirmations) return go();
    confirmModal(
      t('confirm.betrayTitle'),
      t('confirm.betrayBody'),
      go,
      t('confirm.betrayYes'),
      t('common.cancel'),
    );
  }
  /** Rows whose opinion breakdown is unfolded. */
  let why = $state<Record<number, boolean>>({});
  let filter = $state('');
  let all = $state(false);
  const rows = $derived(
    hud.players
      .filter((p) => p.kind !== 'tribe' && p.id !== hud.viewer && p.alive)
      .filter((p) => !filter || (p.name[i18n.lang] || p.name.en).toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => b.tiles - a.tiles)
      .map((p) => {
        const ally = hud.local?.allies.find((a) => a.id === p.id);
        const attacking = hud.local?.wars.includes(p.id) ?? false;
        return {
          p,
          ally,
          attacking,
          embargo: hud.local?.embargo.includes(p.id) ?? false,
          noTrade: hud.local?.noTrade.includes(p.id) ?? false,
          op: hud.local?.opinions?.find((o) => o.id === p.id),
        };
      }),
  );
  type Row = (typeof rows)[number];
  const allies = $derived(rows.filter((r) => r.ally));
  const wars = $derived(rows.filter((r) => !r.ally && r.attacking));
  const others = $derived(rows.filter((r) => !r.ally && !r.attacking));
  /** Allies and enemies are always listed; the others fill the page up to 25 rows. */
  const cap = $derived(Math.max(10, 25 - allies.length - wars.length));
  const nameOf = (r: Row) => r.p.name[i18n.lang] || r.p.name.en;
</script>

{#snippet row(r: Row)}
  <li class="row">
    <img class="np-flag" src={flagUrl(r.p, 32)} alt="" />
    <div class="who">
      <span class="name"
        ><i class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></i>{nameOf(r)}</span
      >
      <button
        class="act icon"
        aria-label={t('hud.centerOn')}
        data-tip={t('hud.centerOn')}
        onclick={() => {
          audio.ui('click');
          ctl.renderer.camera.goTo(r.p.label[0], r.p.label[1], 2.5);
        }}><Icon name="target" size={14} /></button
      >
      <span class="meta">
        {#if r.p.kind === 'nation'}{t(`personality.${r.p.personality}`)} ·{/if}
        <Icon name="troops" size={12} />{short(r.p.troops)} · <Icon name="territory" size={12} />{short(
          r.p.tiles,
        )}
      </span>
    </div>
    <div class="rel">
      {#if r.ally}
        <span
          class="np-tag good ally"
          class:renew={r.ally.expiresIn <= ALLIANCE_RENEW_WINDOW}
          data-tip={t('diplo.allianceTimer')}
          ><Icon name="alliance" size={12} />{t('diplo.allied')} · {clock(r.ally.expiresIn)}<i
            class="drain"
            style="width:{Math.max(0, Math.min(100, (r.ally.expiresIn / ALLIANCE_TICKS) * 100))}%"
          ></i></span
        >
      {:else if r.attacking}
        <span class="np-tag spot"><Icon name="sword" size={12} />{t('diplo.war')}</span>
      {:else if !r.op}
        <span class="np-tag">{t('diplo.neutral')}</span>
      {/if}
      {#if r.noTrade}<span class="np-tag warn" data-tip={r.embargo ? '' : t('diplo.tempEmbargoTip')}
          ><Icon name="noTrade" size={12} />{t('diplo.embargo')}</span
        >{/if}
      {#if r.p.traitor}<span class="np-tag spot"
          ><Icon name="brokenShield" size={12} />{t('hud.traitorMark')} · {Math.ceil(r.p.traitorFor / 10)} s</span
        >{/if}
      {#if r.op}
        <button
          class="opbtn"
          aria-expanded={!!why[r.p.id]}
          data-tip={t('opinion.title')}
          data-testid="diplo-opinion"
          onclick={() => (why[r.p.id] = !why[r.p.id])}
          ><OpinionMeter o={r.op} /><Icon
            name={why[r.p.id] ? 'chevronDown' : 'chevronRight'}
            size={12}
          /></button
        >
      {/if}
      <span class="end">
        <button class="act" onclick={() => order({ t: 'embargo', target: r.p.id, on: !r.embargo })}
          >{r.embargo ? t('radial.embargoOff') : t('radial.embargoOn')}</button
        >
      </span>
    </div>
    {#if r.op && why[r.p.id]}
      <div class="why" data-testid="diplo-why">
        <div>
          <h5>{t('opinion.title')}</h5>
          {#if r.op.reasons.length}
            <ul>
              {#each r.op.reasons as [k, w] (k)}
                <li class:pos={w > 0} class:neg={w < 0}>
                  <span>{t(`opinion.reason.${k}`)}</span><b class="mono">{w > 0 ? '+' : ''}{w}</b>
                </li>
              {/each}
            </ul>
          {:else}<p>{t('opinion.noReasons')}</p>{/if}
        </div>
        {#if r.op.accept >= 0}
          <div>
            <h5>{t('opinion.oddsTitle')}</h5>
            {#if r.op.refusal}<p class="neg">{t(`opinion.refusal.${r.op.refusal}`)}</p>{/if}
            <ul>
              {#each r.op.odds as [k, w] (k)}
                <li class:pos={w > 0} class:neg={w < 0}>
                  <span>{oddsLine(k, r.p.personality)}</span><b class="mono"
                    >{w > 0 ? '+' : '−'}{pct(Math.abs(w))}</b
                  >
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
    <div class="acts">
      {#if r.ally}
        <button class="act" onclick={() => order({ t: 'allyRequest', target: r.p.id })}
          ><Icon name="renew" size={13} />{t('diplo.renew')}</button
        >
        {#if s.config.allowDonations}<button
            class="act"
            data-tip={t('diplo.giveTip')}
            onclick={() =>
              order({ t: 'donate', target: r.p.id, gold: (hud.local?.gold ?? 0) * 0.1, troops: 0 })}
            ><Icon name="gift" size={13} />{t('diplo.give')}</button
          >{/if}
        <button class="act spot" onclick={() => breakAlliance(r.p.id)}
          ><Icon name="betrayal" size={13} />{t('diplo.break')}</button
        >
      {:else}
        <button
          class="np-btn small"
          class:sent={pending(r.p.id)}
          onclick={() => propose(r.p.id)}
          data-testid="diplo-propose"
          ><Icon name={pending(r.p.id) ? 'hourglass' : 'alliance'} size={13} />{t(
            pending(r.p.id) ? 'diplo.proposed' : 'diplo.propose',
          )}</button
        >
        {#if r.op && r.op.accept >= 0}<span
            class="odds"
            class:bad={r.op.accept < 0.1}
            class:good={r.op.accept >= 0.5}
            data-tip={t('opinion.acceptTip')}
            data-testid="diplo-odds">{t('opinion.accept', { pct: pct(r.op.accept) })}</span
          >{/if}
      {/if}
    </div>
  </li>
{/snippet}

<div class="paper newsprint np-window diplo">
  <PaperMast title={t('panel.diplomacy')} onclose={() => (hud.panels.diplomacy = false)}>
    <p class="np-dateline">
      <span
        >{allies.length === 0
          ? t('diplo.alliesNone')
          : allies.length === 1
            ? t('diplo.alliesOne')
            : t('diplo.alliesMany', { n: allies.length })}</span
      >
      <b class:war={wars.length > 0}
        >{wars.length ? t('diplo.atWar', { n: wars.length }) : t('diplo.atPeace')}</b
      >
      <span>{rows.length === 1 ? t('diplo.countriesOne') : t('diplo.countries', { n: rows.length })}</span>
    </p>
    <div class="tools">
      <input class="np-field" type="text" placeholder={t('diplo.search')} bind:value={filter} />
      <button
        class="np-btn small quiet"
        onclick={() => order({ t: 'embargoAll', on: true, exceptTeam: true })}
        ><Icon name="embargo" size={14} />{t('diplo.embargoAll')}</button
      >
      <button
        class="np-btn small quiet"
        onclick={() => order({ t: 'embargoAll', on: false, exceptTeam: false })}>{t('diplo.liftAll')}</button
      >
    </div>
  </PaperMast>

  <div class="np-body scroll">
    {#if allies.length}
      <h3 class="np-mark good">{t('diplo.sectionAllies')} <span class="n">{allies.length}</span></h3>
      <ul class="list">
        {#each allies as r (r.p.id)}{@render row(r)}{/each}
      </ul>
    {/if}
    {#if wars.length}
      <h3 class="np-mark spot">{t('diplo.sectionWar')} <span class="n">{wars.length}</span></h3>
      <ul class="list">
        {#each wars as r (r.p.id)}{@render row(r)}{/each}
      </ul>
    {/if}
    {#if others.length}
      <h3 class="np-mark">
        {allies.length || wars.length ? t('diplo.sectionOthers') : t('diplo.sectionAll')}
        <span class="n">{others.length}</span>
      </h3>
      <ul class="list">
        {#each all ? others : others.slice(0, cap) as r (r.p.id)}{@render row(r)}{/each}
      </ul>
      {#if others.length > cap}
        <button class="np-link more" onclick={() => (all = !all)}
          >{all ? t('diplo.showLess') : t('diplo.showAllN', { n: rows.length })}</button
        >
      {/if}
    {/if}
    {#if !rows.length}
      <p class="empty">{t('diplo.noMatch')}</p>
    {/if}

    {#if hud.betrayals.length}
      <h3 class="np-mark spot"><Icon name="betrayal" size={13} />{t('diplo.betrayals')}</h3>
      <ul class="hist">
        {#each hud.betrayals.slice().reverse() as b (b.tick + '-' + b.traitor)}
          <li>
            <time class="mono">{clock(b.tick)}</time>
            {t('diplo.betrayedLine', {
              traitor: s.state.name(b.traitor, i18n.lang),
              victim: s.state.name(b.victim, i18n.lang),
            })}
          </li>
        {/each}
      </ul>
    {/if}

    <aside class="np-box rules">
      <h3>{t('diplo.rules')}</h3>
      <p>{t('diplo.intro')}</p>
    </aside>
  </div>
</div>

<style>
  .np-dateline .war {
    color: var(--np-spot);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 4px;
    padding: 7px 0 8px;
    border-bottom: 1px solid var(--np-rule);
  }
  .tools input {
    flex: 1 1 140px;
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  /* A country: its flag in the margin, then name, standing, opinion and the orders. */
  .row {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    grid-template-areas: 'flag who' 'flag rel' '. why' '. acts';
    gap: 4px 10px;
    align-items: center;
    padding: 9px 0 9px;
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
    grid-area: who;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 2px;
    min-width: 0;
  }
  .name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.06em;
    line-height: 1.2;
    color: var(--np-ink);
  }
  .ink {
    flex: none;
    width: 3px;
    height: 13px;
  }
  .meta {
    margin-left: auto;
    padding-left: 6px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 0.76em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-3);
    white-space: nowrap;
  }
  .rel {
    grid-area: rel;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }
  /* The alliance's time left drains along the foot of its tag, as on the alliances card. */
  .ally {
    position: relative;
    overflow: hidden;
  }
  .ally.renew {
    color: var(--np-warn);
    border-color: color-mix(in srgb, var(--np-warn) 45%, transparent);
  }
  .drain {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: currentColor;
    opacity: 0.5;
  }
  .opbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    color: var(--np-ink-3);
    cursor: var(--cursor-pointer, pointer);
  }
  .opbtn:hover,
  .opbtn[aria-expanded='true'] {
    border-color: var(--np-rule);
    background: var(--np-paper-2);
  }
  /* Why: two short columns of figures, set off by a rule in the margin. */
  .why {
    grid-area: why;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 4px 16px;
    margin: 2px 0;
    padding: 2px 0 2px 10px;
    border-left: 2px solid var(--np-rule);
    font-size: 0.8em;
  }
  .why h5 {
    margin: 0 0 3px;
    font-family: var(--title);
    font-style: italic;
    font-weight: 400;
    font-size: 1.04em;
    color: var(--np-ink-2);
  }
  .why ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .why li {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--np-ink-2);
  }
  .why b {
    font-weight: 600;
  }
  .why p {
    margin: 0 0 3px;
    color: var(--np-ink-3);
  }
  .why .pos b {
    color: var(--np-good);
  }
  .why .neg b,
  .why p.neg {
    color: var(--np-spot);
  }
  .acts {
    grid-area: acts;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 4px;
    padding-top: 2px;
  }
  .rel .end {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-right: -4px;
  }
  /* The other orders are printed as words: a rule appears around the one pointed at. */
  .act {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 5px;
    border: 1px solid transparent;
    border-radius: 2px;
    background: none;
    font-family: var(--text);
    font-size: 0.8em;
    font-weight: 500;
    color: var(--np-ink-2);
    cursor: pointer;
    white-space: nowrap;
  }
  .acts > .act:first-child {
    margin-left: -5px;
  }
  .act:hover,
  .act:focus-visible {
    color: var(--np-ink);
    border-color: var(--np-rule);
    background: var(--np-card);
  }
  .act.spot {
    color: var(--np-spot);
  }
  .act.spot:hover,
  .act.spot:focus-visible {
    border-color: color-mix(in srgb, var(--np-spot) 45%, transparent);
  }
  .act.icon {
    padding: 1px 3px;
    color: var(--np-ink-3);
  }
  /* An offer on its way: the button keeps a green dashed rule until it is answered. */
  .np-btn.sent {
    color: var(--np-good);
    border-style: dashed;
    border-color: var(--np-good);
  }
  .odds {
    font-size: 0.76em;
    font-variant-numeric: tabular-nums;
    color: var(--np-ink-2);
  }
  .odds.good {
    color: var(--np-good);
  }
  .odds.bad {
    color: var(--np-spot);
  }
  .more {
    margin: 6px 0 0 38px;
    font-size: 0.8em;
  }
  .empty {
    margin: 22px 0 0;
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
    text-align: center;
  }

  /* Betrayals: briefs, the time run in. */
  .np-mark :global(svg) {
    flex: none;
  }
  .hist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
    font-family: var(--np-serif);
    font-size: 0.84em;
    line-height: 1.45;
    color: var(--np-ink);
  }
  .hist time {
    margin-right: 4px;
    font-weight: 600;
    color: var(--np-spot);
  }

  .rules {
    margin-top: 18px;
  }
  .rules p {
    margin: 0;
    font-family: var(--np-serif);
    font-size: 0.82em;
    line-height: 1.5;
    color: var(--np-ink-2);
    text-wrap: pretty;
  }
</style>
