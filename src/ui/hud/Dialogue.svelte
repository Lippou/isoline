<script lang="ts">
  // Campaign / tutorial guidance: objectives with progress, the current guide
  // step (stays until accomplished) and the mission briefing.
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, short } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { audio } from '../../audio/audio';

  let { ctl }: { ctl: GameController } = $props();
  let collapsed = $state(false);

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
</script>

{#if hud.objectives.length && !hud.briefing}
  <aside class="obj panel" data-testid="objectives">
    <header>
      <span class="section-title"><Icon name="target" size={14} />{t('campaign.objectives')}</span>
      <button class="mini" onclick={() => (collapsed = !collapsed)} aria-label={t('common.close')}
        ><Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} /></button
      >
    </header>
    {#if !collapsed}
      <ul>
        {#each hud.objectives as o, k (k)}
          <li class:done={o.done} class:bonus={o.bonus}>
            <span class="mark"><Icon name={o.done ? 'check' : o.bonus ? 'star' : 'dot'} size={14} /></span>
            <div>
              <span class="txt">{o.bonus ? `${t('campaign.bonusLabel')} : ` : ''}{o.text}</span>
              {#if o.progress && !o.done}
                <div class="meter">
                  <div
                    style="width:{Math.min(100, (o.progress.value / Math.max(1e-9, o.progress.max)) * 100)}%"
                  ></div>
                </div>
                <span class="mono val">{fmt(o.progress)}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

{#if hud.guide && !hud.briefing}
  <div class="guide panel rise-in" data-testid="dialogue">
    <div class="avatar"><Icon name="book" size={22} /></div>
    <div class="body">
      <div class="who">
        <b>{hud.guide.speaker}</b>
        <span class="mono step">{t('campaign.step', { n: hud.guide.index, total: hud.guide.total })}</span>
      </div>
      <p>{hud.guide.text}</p>
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

{#if hud.briefing}
  <div class="brief-veil fade-in">
    <section class="brief panel rise-in" data-testid="briefing" role="dialog" aria-modal="true">
      <header>
        <span class="section-title"><Icon name="book" size={14} />{t('campaign.briefing')}</span>
        <h2>{hud.briefing.title}</h2>
      </header>
      <p class="text">{hud.briefing.text}</p>
      <div class="cols">
        <div>
          <h4 class="section-title"><Icon name="target" size={14} />{t('campaign.objectives')}</h4>
          <ul>
            {#each hud.briefing.objectives as o (o)}<li><Icon name="dot" size={12} />{o}</li>{/each}
            {#if hud.briefing.bonus}<li class="bonus">
                <Icon name="star" size={13} />{hud.briefing.bonus}
              </li>{/if}
          </ul>
        </div>
        <div>
          <h4 class="section-title"><Icon name="info" size={14} />{t('campaign.tips')}</h4>
          <ul>
            {#each hud.briefing.tips as tip (tip)}<li><Icon name="next" size={12} />{tip}</li>{/each}
          </ul>
        </div>
      </div>
      <footer>
        <span class="hint">{t('campaign.briefingHint')}</span>
        <button class="btn primary" onclick={() => ctl.beginMission()} data-testid="briefing-start"
          ><Icon name="play" size={15} />{t('campaign.begin')}</button
        >
      </footer>
    </section>
  </div>
{/if}

<style>
  .obj {
    position: absolute;
    left: 88px;
    top: 90px;
    width: 310px;
    padding: 0;
    z-index: 7;
    font-size: 0.88em;
  }
  .obj header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
  }
  .obj .section-title {
    margin: 0;
  }
  .obj ul {
    list-style: none;
    padding: 8px 10px;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .obj li {
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 6px;
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
    margin: 5px 0 2px;
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
  }
  .mini {
    background: none;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    padding: 2px;
  }
  .mini:hover {
    color: var(--parchment);
  }
  .guide {
    position: absolute;
    left: 50%;
    bottom: 128px;
    transform: translateX(-50%);
    width: min(680px, 64vw);
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    padding: 12px 14px;
    z-index: 29;
    align-items: start;
    border-left: 3px solid var(--brass);
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
  .side {
    display: grid;
    gap: 4px;
  }
  .brief-veil {
    position: absolute;
    inset: 0;
    z-index: 60;
    background: rgba(6, 8, 11, 0.6);
    display: grid;
    place-items: center;
  }
  .brief {
    width: min(760px, 86vw);
    padding: 22px 26px;
    display: grid;
    gap: 14px;
  }
  .brief h2 {
    font-size: 1.7em;
    margin-top: 2px;
  }
  .brief .text {
    margin: 0;
    line-height: 1.6;
    color: var(--parchment);
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  .brief ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
    color: var(--muted);
  }
  .brief li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .brief li.bonus {
    color: var(--brass);
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }
</style>
