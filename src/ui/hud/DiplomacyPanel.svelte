<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagUrl } from '../../render/flags';
  import type { GameController } from '../game/controller';
  import { confirmModal } from '../stores/app.svelte';
  import Icon from '../icons/Icon.svelte';
  import { audio } from '../../audio/audio';
  import { ALLIANCE_REQUEST_TTL } from '../../core/game/constants';
  import OpinionMeter from './OpinionMeter.svelte';
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
</script>

<p class="hint intro">{t('diplo.intro')}</p>

<div class="tools">
  <input type="text" placeholder={t('diplo.search')} bind:value={filter} />
  <button class="btn small" onclick={() => order({ t: 'embargoAll', on: true, exceptTeam: true })}
    ><Icon name="embargo" size={14} />{t('diplo.embargoAll')}</button
  >
  <button class="btn small" onclick={() => order({ t: 'embargoAll', on: false, exceptTeam: false })}
    >{t('diplo.liftAll')}</button
  >
</div>

<ul class="list">
  {#each all ? rows : rows.slice(0, 25) as r (r.p.id)}
    <li>
      <img src={flagUrl(r.p, 32)} alt="" />
      <div class="who">
        <span class="name"
          ><i class="ink" style="background:{inkHex(r.p.color, settings.access.vision)}"></i>{r.p.name[
            i18n.lang
          ] || r.p.name.en}</span
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
          <span class="chip good" data-tip={t('diplo.allianceTimer')}
            ><Icon name="alliance" size={13} />{t('diplo.allied')} · {clock(r.ally.expiresIn)}</span
          >
        {:else if r.attacking}
          <span class="chip bad"><Icon name="sword" size={13} />{t('diplo.war')}</span>
        {:else if !r.op}
          <span class="chip">{t('diplo.neutral')}</span>
        {/if}
        {#if r.noTrade}<span class="chip warn" data-tip={r.embargo ? '' : t('diplo.tempEmbargoTip')}
            ><Icon name="noTrade" size={13} />{t('diplo.embargo')}</span
          >{/if}
        {#if r.p.traitor}<span class="chip warn"
            ><Icon name="brokenShield" size={13} />{t('hud.traitorMark')} · {Math.ceil(r.p.traitorFor / 10)} s</span
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
          <button class="btn small" onclick={() => order({ t: 'allyRequest', target: r.p.id })}
            ><Icon name="renew" size={13} />{t('diplo.renew')}</button
          >
          {#if s.config.allowDonations}<button
              class="btn small"
              data-tip={t('diplo.giveTip')}
              onclick={() =>
                order({ t: 'donate', target: r.p.id, gold: (hud.local?.gold ?? 0) * 0.1, troops: 0 })}
              ><Icon name="gift" size={13} />{t('diplo.give')}</button
            >{/if}
          <button class="btn small danger" onclick={() => breakAlliance(r.p.id)}
            ><Icon name="betrayal" size={13} />{t('diplo.break')}</button
          >
        {:else}
          <button
            class="btn small"
            class:sent={pending(r.p.id)}
            onclick={() => propose(r.p.id)}
            data-testid="diplo-propose"
            ><Icon name={pending(r.p.id) ? 'hourglass' : 'alliance'} size={13} />{t(
              pending(r.p.id) ? 'diplo.proposed' : 'diplo.propose',
            )}</button
          >
          {#if r.op && r.op.accept >= 0}<span
              class="chip odds"
              class:bad={r.op.accept < 0.1}
              class:good={r.op.accept >= 0.5}
              data-tip={t('opinion.acceptTip')}
              data-testid="diplo-odds">{t('opinion.accept', { pct: pct(r.op.accept) })}</span
            >{/if}
        {/if}
        <button class="btn small" onclick={() => order({ t: 'embargo', target: r.p.id, on: !r.embargo })}
          >{r.embargo ? t('radial.embargoOff') : t('radial.embargoOn')}</button
        >
        <button
          class="btn small ghost"
          aria-label={t('hud.centerOn')}
          data-tip={t('hud.centerOn')}
          onclick={() => {
            audio.ui('click');
            ctl.renderer.camera.goTo(r.p.label[0], r.p.label[1], 2.5);
          }}><Icon name="target" size={14} /></button
        >
      </div>
    </li>
  {/each}
</ul>
{#if rows.length > 25}
  <button class="btn small ghost more" onclick={() => (all = !all)}
    >{all ? t('diplo.showLess') : t('diplo.showAllN', { n: rows.length })}</button
  >
{/if}

{#if hud.betrayals.length}
  <h4 class="section-title"><Icon name="betrayal" size={14} />{t('diplo.betrayals')}</h4>
  <ul class="hist">
    {#each hud.betrayals.slice().reverse() as b (b.tick + '-' + b.traitor)}
      <li>
        <span class="mono">{clock(b.tick)}</span>
        {t('diplo.betrayedLine', {
          traitor: s.state.name(b.traitor, i18n.lang),
          victim: s.state.name(b.victim, i18n.lang),
        })}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .intro {
    margin: 0 0 10px;
  }
  .tools {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .tools input {
    flex: 1;
    min-width: 120px;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: grid;
    grid-template-columns: 30px 1fr;
    grid-template-areas: 'flag who' 'flag rel' 'why why' 'acts acts';
    gap: 4px 10px;
    align-items: center;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: var(--panel-2);
  }
  img {
    grid-area: flag;
    width: 30px;
    height: 22px;
    object-fit: cover;
    border: 1px solid #0006;
    align-self: start;
  }
  .who {
    grid-area: who;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ink {
    width: 4px;
    height: 14px;
    border-radius: 1px;
  }
  .meta {
    font-size: 0.84em;
    color: var(--faint);
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }
  .rel {
    grid-area: rel;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .opbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: var(--faint);
    cursor: var(--cursor-pointer, pointer);
  }
  .opbtn:hover,
  .opbtn[aria-expanded='true'] {
    border-color: var(--line);
    background: var(--panel-3);
  }
  .why {
    grid-area: why;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 4px 14px;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--input-bg);
    font-size: 0.84em;
  }
  .why h5 {
    margin: 0 0 3px;
    font-size: 0.92em;
    font-weight: 600;
    color: var(--muted);
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
    padding: 0;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--muted);
  }
  .why p {
    margin: 0 0 3px;
    color: var(--faint);
  }
  .why .pos b {
    color: var(--good-text);
  }
  .why .neg b,
  .why p.neg {
    color: var(--bad-text);
  }
  .odds {
    align-self: center;
  }
  .acts {
    grid-area: acts;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--line);
  }
  .more {
    margin-top: 6px;
  }
  /* An offer on its way: the button keeps a quiet green edge until it is answered. */
  .btn.sent {
    color: var(--good-text);
    border-color: rgba(91, 201, 138, 0.5);
  }
  h4 {
    margin: 14px 0 6px;
  }
  .hist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 3px;
    font-size: 0.88em;
    color: var(--muted);
  }
  .hist .mono {
    color: var(--faint);
    margin-right: 6px;
  }
</style>
