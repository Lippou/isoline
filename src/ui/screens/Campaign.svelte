<script lang="ts">
  import { go } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { MISSIONS } from '../campaign/missions';
  import { profile } from '../stores/profile.svelte';
  import { startMission, startTutorial } from './launch';
  import { mapsBase } from '../bridge';
  import Icon from '../icons/Icon.svelte';

  const unlocked = (k: number) => k === 0 || (profile.campaign[MISSIONS[k - 1]!.id] ?? 0) > 0;
  const totalStars = $derived(MISSIONS.reduce((s, m) => s + (profile.campaign[m.id] ?? 0), 0));
  let sel = $state(0);
  const m = $derived(MISSIONS[sel]!);
</script>

<div class="camp" data-testid="campaign">
  <header>
    <button class="btn ghost" onclick={() => go('play')}
      ><Icon name="back" size={16} />{t('common.back')}</button
    >
    <div class="htitle">
      <h1>{t('campaign.title')}</h1>
      <span class="hint">{t('campaign.intro')}</span>
    </div>
    <span class="chip big"><Icon name="star" size={14} />{totalStars} / {MISSIONS.length * 3}</span>
    <button class="btn" onclick={startTutorial}><Icon name="help" size={15} />{t('title.tutorial')}</button>
  </header>

  <div class="body">
    <ol class="list panel">
      {#each MISSIONS as mi, k (mi.id)}
        {@const stars = profile.campaign[mi.id] ?? 0}
        <li>
          <button class="row" class:on={sel === k} class:locked={!unlocked(k)} onclick={() => (sel = k)}>
            <span class="num mono">{k + 1}</span>
            <span class="name">{t(`campaign.${mi.id}.title`)}</span>
            {#if unlocked(k)}
              <span class="stars"
                >{#each [1, 2, 3] as s (s)}<span class:got={s <= stars}><Icon name="star" size={13} /></span
                  >{/each}</span
              >
            {:else}
              <span class="lock"><Icon name="lock" size={14} /></span>
            {/if}
          </button>
        </li>
      {/each}
    </ol>

    <section class="detail panel">
      <img src="{mapsBase()}{m.mapId}.thumb.png" alt="" />
      <div class="dtxt">
        <span class="section-title">{t('campaign.missionN', { n: sel + 1 })}</span>
        <h2>{t(`campaign.${m.id}.title`)}</h2>
        <p class="brief">{t(`campaign.${m.id}.brief`)}</p>
        <div class="objs">
          <div><Icon name="target" size={15} /><b>{t('campaign.objective')}</b> {t(m.main.key)}</div>
          <div class="bonus">
            <Icon name="star" size={15} /><b>{t('campaign.bonusLabel')}</b>
            {t(m.bonus.key)}
          </div>
          <div class="muted">
            <Icon name="time" size={15} /><b>{t('campaign.parTime')}</b>
            {Math.round(m.parTicks / 600)} min
          </div>
        </div>
        <p class="hint">{t('campaign.starsRule')}</p>
        <div class="act">
          {#if unlocked(sel)}
            <button class="btn primary" onclick={() => startMission(m.id)} data-testid="mission-{m.id}"
              ><Icon name="play" size={16} />{t('campaign.play')}</button
            >
          {:else}
            <span class="chip"><Icon name="lock" size={13} />{t('campaign.lockedHint')}</span>
          {/if}
        </div>
      </div>
    </section>
  </div>
</div>

<style>
  .camp {
    position: fixed;
    inset: 0;
    padding: 18px 22px;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 14px;
    background: var(--abyss);
  }
  header {
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .htitle {
    flex: 1;
    display: grid;
  }
  .chip.big {
    font-size: 0.95em;
    padding: 0.35em 0.7em;
    color: var(--brass);
  }
  .body {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 14px;
    min-height: 0;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    display: grid;
    align-content: start;
    gap: 2px;
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 26px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 12px 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--parchment);
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--panel-2);
  }
  .row.on {
    background: var(--panel-3);
    border-color: var(--line-strong);
    box-shadow: inset 3px 0 0 var(--brass);
  }
  .row.locked {
    color: var(--faint);
  }
  .num {
    color: var(--faint);
  }
  .stars {
    display: flex;
    gap: 1px;
    color: var(--line-strong);
  }
  .got {
    color: var(--brass);
  }
  .lock {
    color: var(--faint);
  }
  .detail {
    display: grid;
    grid-template-columns: minmax(280px, 42%) 1fr;
    gap: 20px;
    padding: 18px;
    align-items: start;
  }
  .detail img {
    width: 100%;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    border-radius: 3px;
    border: 1px solid var(--line);
  }
  .dtxt {
    display: grid;
    gap: 10px;
  }
  .dtxt .section-title {
    margin: 0;
  }
  .brief {
    margin: 0;
    line-height: 1.6;
  }
  .objs {
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
  }
  .objs div {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .objs b {
    color: var(--muted);
    font-weight: 600;
    min-width: 110px;
  }
  .bonus {
    color: var(--brass);
  }
  .muted {
    color: var(--muted);
  }
  .act {
    display: flex;
    gap: 8px;
  }
</style>
