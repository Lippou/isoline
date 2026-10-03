<script lang="ts">
  // Campaign guidance: the mission dock at the bottom centre — the objectives with their
  // progress, and under them the advisor's current guide step (it stays until it is
  // accomplished; a step asking to build waits for the gold with a bar, a hint shows for
  // a moment) — and the mission briefing. The dock lives in the band kept free above the
  // build bar, between the resources panel and the alliance offers: the windows, the
  // column of cards and the offers never cover it.
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, short, i18n } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { audio } from '../../audio/audio';
  import { reserveBottom } from '../stores/windows.svelte';
  import { hudBox } from '../stores/hudBox.svelte';
  import { settings } from '../stores/settings.svelte';
  import { researchIdle } from './research';
  import Masthead from './Masthead.svelte';
  import './paper.css';
  import { app } from '../stores/app.svelte';
  import { MISSIONS } from '../campaign/missions';

  let { ctl }: { ctl: GameController } = $props();
  let collapsed = $state(false);

  // The briefing's masthead: the map, the mission's number in the campaign, today's date.
  const mapName = $derived.by(() => {
    const n = ctl.session.state.meta?.name;
    return n ? n[i18n.lang] || n.en : ctl.session.config.mapId;
  });
  const mission = $derived.by(() => {
    const k = MISSIONS.findIndex((m) => m.id === app.launch?.missionId);
    return k < 0 ? null : { n: k + 1, total: MISSIONS.length };
  });
  const day = $derived(
    new Intl.DateTimeFormat(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'full' }).format(new Date()),
  );

  const reached = $derived(hud.objectives.filter((o) => o.done).length);

  // Above the build bar — and above the "research stopped" prompt while it shows
  // (ResearchReminder.svelte) — then windows open above the dock (its height, its offset
  // from the bottom and a margin).
  const nudge = $derived(
    !hud.replay &&
      !hud.panels.tech &&
      !settings.game.autoResearch &&
      researchIdle(hud.local, ctl.session.config.features.tech),
  );
  const bottom = $derived((hudBox.bar || 112) + (nudge ? 48 : 16));
  let dockH = $state(0);
  $effect(() => {
    reserveBottom(dockH > 0 ? bottom + Math.ceil(dockH) + 8 : 0);
  });
  $effect(() => () => reserveBottom(0));

  function fmt(p: { value: number; max: number; format: string }): string {
    switch (p.format) {
      case 'pct':
        return `${p.value.toFixed(1)} / ${p.max.toFixed(0)} %`;
      case 'gold':
        return `${short(p.value)} / ${short(p.max)}`;
      case 'time': {
        const m = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
        return `${m(Math.min(p.value, p.max))} / ${m(p.max)}`;
      }
      default:
        return `${Math.min(p.value, p.max)} / ${p.max}`;
    }
  }

  /** Seconds to wait, in words: "42 s", "1 min 05 s". */
  function wait(s: number): string {
    if (s < 60) return `${s} s`;
    return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  }
</script>

<!-- Once the mission is over its communiqué tells the rest: the dock steps aside. -->
{#if !hud.briefing && !hud.end && (hud.objectives.length || hud.guide)}
  <div class="dock" data-testid="mission-dock" style:bottom="{bottom}px" bind:clientHeight={dockH}>
    {#if hud.objectives.length}
      <aside class="obj panel" class:collapsed data-testid="objectives" aria-label={t('campaign.objectives')}>
        <button
          class="head"
          onclick={() => (collapsed = !collapsed)}
          aria-expanded={!collapsed}
          data-tip={t('campaign.objectives')}
          ><Icon name="target" size={15} /><span class="mono tally">{reached}/{hud.objectives.length}</span
          >{#if collapsed}<span class="section-title">{t('campaign.objectives')}</span>{/if}<Icon
            name={collapsed ? 'chevronRight' : 'chevronDown'}
            size={13}
          /></button
        >
        {#if !collapsed}
          <ul>
            {#each hud.objectives as o, k (k)}
              <li class:done={o.done} class:bonus={o.bonus}>
                <span class="mark"><Icon name={o.done ? 'check' : o.bonus ? 'star' : 'dot'} size={14} /></span
                >
                <div>
                  <span class="txt">{o.bonus ? `${t('campaign.bonusLabel')} : ` : ''}{o.text}</span>
                  {#if o.progress && !o.done}
                    <div class="prog">
                      <div class="meter">
                        <div
                          style="width:{Math.min(
                            100,
                            (o.progress.value / Math.max(1e-9, o.progress.max)) * 100,
                          )}%"
                        ></div>
                      </div>
                      <span class="mono val">{fmt(o.progress)}</span>
                    </div>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </aside>
    {/if}

    {#if hud.guide}
      {@const need = hud.guide.need}
      <div class="guide panel rise-in" class:hint={hud.guide.hint} data-testid="dialogue">
        <div class="avatar"><Icon name={hud.guide.hint ? 'info' : 'book'} size={22} /></div>
        <div class="body">
          <div class="who">
            <b>{hud.guide.speaker}</b>
            <span class="mono step"
              >{hud.guide.hint
                ? t('campaign.hint')
                : t('campaign.step', { n: hud.guide.index, total: hud.guide.total })}</span
            >
          </div>
          {#if need}
            <p class="need" data-testid="guide-need">
              <Icon name="gold" size={14} />{Number.isFinite(need.eta)
                ? t('campaign.need', { gold: short(need.cost), time: wait(need.eta) })
                : t('campaign.needGold', { gold: short(need.cost) })}
            </p>
            <div class="meter gold" aria-hidden="true">
              <div style="width:{Math.min(100, (need.gold / Math.max(1, need.cost)) * 100)}%"></div>
            </div>
            <p class="later">{hud.guide.text}</p>
          {:else}
            <p>{hud.guide.text}</p>
          {/if}
        </div>
        <div class="side">
          <button
            class="mini"
            onclick={() => audio.stopVoice()}
            aria-label={t('campaign.stopVoice')}
            title={t('campaign.stopVoice')}><Icon name="sound" size={15} /></button
          >
          <button class="mini" onclick={() => (hud.guide = null)} aria-label={t('common.close')}
            ><Icon name="close" size={15} /></button
          >
        </div>
      </div>
    {/if}
  </div>
{/if}

{#if hud.briefing}
  <!-- The opening dispatch, printed by the Courier as its communiqué closes the mission. -->
  <div class="np-veil fade-in brief-veil">
    <section
      class="brief newsprint np-sheet"
      data-testid="briefing"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mb-title"
    >
      <div class="sheet scroll">
        <Masthead
          ear={t('campaign.briefing')}
          date={day}
          dateline={[
            mapName,
            mission ? t('campaign.missionOf', { n: mission.n, total: mission.total }) : t('mode.campaign'),
            t('campaign.title'),
          ]}
        />
        <h2 id="mb-title">{hud.briefing.title}</h2>
        <blockquote class="word">
          <p>{hud.briefing.text}</p>
          <footer>— {t('campaign.advisor')}</footer>
        </blockquote>
        <div class="cols">
          <section aria-labelledby="mb-objectives">
            <h3 class="np-mark" id="mb-objectives">{t('campaign.objectives')}</h3>
            <ul class="objectives">
              {#each hud.briefing.objectives as o (o)}<li>
                  <span class="mark" aria-hidden="true"></span>{o}
                </li>{/each}
              {#if hud.briefing.bonus}<li class="bonus">
                  <span class="mark" aria-hidden="true"><Icon name="star" size={11} /></span><span
                    ><span class="np-tag">{t('campaign.bonusLabel')}</span> {hud.briefing.bonus}</span
                  >
                </li>{/if}
            </ul>
          </section>
          <section aria-labelledby="mb-tips">
            <h3 class="np-mark" id="mb-tips">{t('campaign.tips')}</h3>
            <ol class="tips">
              {#each hud.briefing.tips as tip (tip)}<li>{tip}</li>{/each}
            </ol>
          </section>
        </div>
      </div>
      <footer class="foot">
        <span class="hint">{t('campaign.briefingHint')}</span>
        <button class="np-btn ink start" onclick={() => ctl.beginMission()} data-testid="briefing-start"
          ><Icon name="play" size={15} />{t('campaign.begin')}</button
        >
      </footer>
    </section>
  </div>
{/if}

<style>
  /*
   * Bottom centre, above the build bar: between the resources panel (left, 300 px) and
   * the alliance offers (right, 300 px), under the windows' reserved bottom band.
   */
  .dock {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    transition: bottom 0.2s ease-out;
    width: min(680px, calc(100vw - 640px));
    min-width: 420px;
    display: grid;
    gap: 6px;
    z-index: 29;
    pointer-events: none;
  }
  .dock > :global(*) {
    pointer-events: auto;
  }
  /* One compact row: the tally (folds the list), then the objectives side by side. */
  .obj {
    padding: 0;
    font-size: 0.84em;
    display: flex;
    align-items: stretch;
  }
  .obj.collapsed {
    justify-self: start;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 0;
    border-right: 1px solid var(--line);
    background: var(--panel-2);
    color: var(--muted);
    font: inherit;
    cursor: var(--cursor-pointer, pointer);
  }
  .obj.collapsed .head {
    border-right: 0;
  }
  .head:hover {
    color: var(--parchment);
  }
  .head .section-title {
    margin: 0;
  }
  .tally {
    color: var(--parchment);
  }
  .obj ul {
    flex: 1;
    list-style: none;
    padding: 6px 10px;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 4px 14px;
    align-items: center;
  }
  .obj li {
    display: grid;
    grid-template-columns: 16px 1fr;
    gap: 5px;
    min-width: 0;
    line-height: 1.3;
  }
  .prog {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .prog .meter {
    flex: 1;
    margin: 0;
  }
  .mark {
    color: var(--muted);
    padding-top: 1px;
  }
  li.bonus .mark {
    color: var(--brass);
  }
  li.done .mark,
  li.done .txt {
    color: var(--verdant);
  }
  .meter {
    height: 5px;
    margin: 4px 0 2px;
    background: var(--panel-3);
    border-radius: 2px;
    overflow: hidden;
  }
  .meter div {
    height: 100%;
    background: var(--brass);
    transition: width 0.4s;
  }
  .val {
    font-size: 0.85em;
    color: var(--faint);
    white-space: nowrap;
  }
  .mini {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: var(--cursor-pointer, pointer);
    padding: 2px;
  }
  .mini:hover {
    color: var(--parchment);
  }
  .guide {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    padding: 11px 14px;
    align-items: start;
    border-left: 3px solid var(--brass);
  }
  .guide.hint {
    border-left-color: var(--aurora);
  }
  .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--panel-3);
    color: var(--brass);
  }
  .guide.hint .avatar {
    color: var(--aurora);
  }
  .who {
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .who b {
    font-family: var(--title);
    color: var(--brass);
  }
  .step {
    font-size: 0.8em;
    color: var(--faint);
  }
  .guide p {
    margin: 4px 0 0;
    line-height: 1.5;
  }
  .need {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--brass);
    font-weight: 600;
  }
  .meter.gold {
    margin: 6px 0 4px;
  }
  .later {
    color: var(--faint);
    font-size: 0.92em;
  }
  .side {
    display: grid;
    gap: 4px;
  }
  .brief-veil {
    z-index: 60;
  }
  .brief {
    width: min(820px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    font-family: var(--np-serif);
  }
  .sheet {
    min-height: 0;
    padding: 14px 26px 4px;
    scrollbar-color: var(--np-rule) transparent;
  }
  /* No close cross on this sheet: the ears span the full measure. */
  .sheet :global(.ears) {
    margin-right: 0;
  }
  .brief h2 {
    margin: 14px 0 0;
    font-family: var(--title);
    font-weight: 700;
    font-size: 2.5em;
    line-height: 1.02;
    letter-spacing: -0.02em;
    text-align: center;
    text-wrap: balance;
    color: var(--np-ink);
  }
  /* The advisor's word, as the communiqué prints her debrief. */
  .word {
    margin: 14px 0 0;
    padding: 0 0 0 16px;
    border-left: 3px solid var(--np-ink);
  }
  .word p {
    margin: 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 1.14em;
    line-height: 1.42;
    color: var(--np-ink);
    text-wrap: pretty;
  }
  .word footer {
    margin-top: 5px;
    font-family: var(--text);
    font-size: 0.82em;
    font-weight: 600;
    color: var(--np-ink-2);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 28px;
    margin-top: 6px;
  }
  .objectives,
  .tips {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .objectives li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px solid var(--np-rule);
    font-family: var(--text);
    font-size: 0.92em;
    line-height: 1.35;
    color: var(--np-ink);
  }
  /* An empty ring to tick: the communiqué inks it in at the end. */
  .objectives .mark {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid var(--np-ink);
    border-radius: 50%;
    transform: translateY(3px);
  }
  .objectives .bonus .mark {
    border-color: var(--np-rule-2);
    color: var(--np-warn);
  }
  .objectives .np-tag {
    margin-right: 2px;
    vertical-align: 1px;
  }
  .tips {
    counter-reset: tip;
  }
  .tips li {
    position: relative;
    padding: 6px 0 6px 22px;
    border-bottom: 1px solid var(--np-rule);
    font-size: 0.86em;
    line-height: 1.5;
    color: var(--np-ink-2);
    text-wrap: pretty;
  }
  .tips li::before {
    counter-increment: tip;
    content: counter(tip);
    position: absolute;
    left: 0;
    top: 6px;
    font-family: var(--title);
    font-weight: 700;
    font-size: 1.05em;
    line-height: 1.35;
    color: var(--np-ink);
  }
  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 14px;
    margin: 0 26px;
    padding: 10px 0 14px;
    border-top: 2px solid var(--np-ink);
  }
  .hint {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.9em;
    color: var(--np-ink-2);
  }
  .brief .start {
    padding: 8px 16px;
    font-size: 0.95em;
    font-weight: 600;
  }
  @media (max-width: 760px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
