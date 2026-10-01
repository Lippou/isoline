<script lang="ts">
  import { go } from '../stores/app.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { MISSIONS } from '../campaign/missions';
  import { profile } from '../stores/profile.svelte';
  import { startMission, startTutorial } from './launch';
  import { mapsBase } from '../bridge';

  const unlocked = (k: number) => k === 0 || (profile.campaign[MISSIONS[k - 1]!.id] ?? 0) > 0;
</script>

<div class="camp" data-testid="campaign">
  <header>
    <button class="btn ghost" onclick={() => go('play')}>← {t('common.back')}</button>
    <h1>{t('campaign.title')}</h1>
    <button class="btn" onclick={startTutorial}>{t('title.tutorial')}</button>
  </header>
  <p class="intro">{t('campaign.intro')}</p>
  <ol class="missions">
    {#each MISSIONS as m, k (m.id)}
      {@const stars = profile.campaign[m.id] ?? 0}
      <li class="glass" class:locked={!unlocked(k)}>
        <img src="{mapsBase()}{m.mapId}.thumb.png" alt="" />
        <div class="txt">
          <span class="num mono">{k + 1}</span>
          <h3>{t(`campaign.${m.id}.title`)}</h3>
          <p>{t(`campaign.${m.id}.summary`)}</p>
          <div class="stars">{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</div>
        </div>
        <button
          class="btn primary"
          disabled={!unlocked(k)}
          onclick={() => startMission(m.id)}
          data-testid="mission-{m.id}">{unlocked(k) ? t('campaign.play') : '🔒'}</button
        >
      </li>
    {/each}
  </ol>
</div>

<style>
  .camp {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    overflow-y: auto;
    background: radial-gradient(ellipse at 50% 0%, #1a2c4b, var(--abyss) 65%);
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  header h1 {
    flex: 1;
  }
  .intro {
    color: var(--muted);
    max-width: 70ch;
  }
  .missions {
    list-style: none;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 1rem;
  }
  li {
    display: grid;
    grid-template-columns: 120px 1fr;
    grid-template-rows: 1fr auto;
    gap: 0.6rem 0.9rem;
    padding: 0.9rem;
  }
  li.locked {
    opacity: 0.5;
  }
  img {
    width: 120px;
    height: 80px;
    object-fit: cover;
    border-radius: 8px;
    grid-row: span 2;
  }
  .num {
    color: var(--aurora);
  }
  h3 {
    margin: 0.1rem 0 0.2rem;
  }
  p {
    margin: 0;
    color: var(--muted);
    font-size: 0.88em;
  }
  .stars {
    color: var(--brass);
    font-size: 1.2em;
    margin-top: 0.3rem;
  }
  li .btn {
    justify-self: end;
  }
</style>
