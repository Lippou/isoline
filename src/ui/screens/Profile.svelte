<script lang="ts">
  import { go } from '../stores/app.svelte';
  import { t, num, short, date, clock } from '../i18n/i18n.svelte';
  import { profile, saveProfile, ACHIEVEMENTS, TITLES, unlockedTitles } from '../stores/profile.svelte';

  const titles = $derived(unlockedTitles());
</script>

<div class="page" data-testid="profile">
  <header>
    <button class="btn ghost" onclick={() => go('title')}>← {t('common.back')}</button>
    <h1>{t('title.profile')}</h1>
  </header>
  <div class="cols">
    <section class="glass">
      <label
        >{t('profile.name')}
        <input type="text" bind:value={profile.name} maxlength="24" onchange={saveProfile} /></label
      >
      <label
        >{t('profile.title')}
        <select bind:value={profile.title} onchange={saveProfile}>
          {#each TITLES as ti (ti.id)}<option value={ti.id} disabled={!titles.includes(ti.id)}
              >{t(`title.${ti.id}`)} {titles.includes(ti.id) ? '' : `(🔒 ${ti.need})`}</option
            >{/each}
        </select>
      </label>
      <dl>
        <dt>{t('profile.games')}</dt>
        <dd class="mono">{num(profile.totals.games)}</dd>
        <dt>{t('profile.wins')}</dt>
        <dd class="mono">{num(profile.totals.wins)}</dd>
        <dt>{t('profile.time')}</dt>
        <dd class="mono">{clock(profile.totals.playTicks)}</dd>
        <dt>{t('stats.conquered')}</dt>
        <dd class="mono">{short(profile.totals.tilesConquered)}</dd>
        <dt>{t('stats.buildings')}</dt>
        <dd class="mono">{num(profile.totals.buildings)}</dd>
        <dt>{t('stats.shipsSunk')}</dt>
        <dd class="mono">{num(profile.totals.shipsSunk)}</dd>
        <dt>{t('stats.nukes')}</dt>
        <dd class="mono">{num(profile.totals.nukes)}</dd>
        <dt>{t('stats.intercepts')}</dt>
        <dd class="mono">{num(profile.totals.intercepts)}</dd>
        <dt>{t('stats.goldEarned')}</dt>
        <dd class="mono">{short(profile.totals.gold)}</dd>
      </dl>
      <h3>{t('profile.leaderboard')}</h3>
      <ol class="lb">
        {#each profile.leaderboard as e, k (k)}
          <li>
            <span class="mono">{k + 1}.</span> <b class="mono">{num(e.score)}</b> <span>{e.map}</span>
            <span class="muted">{t(`mode.${e.mode}`)} · {date(Date.parse(e.date))}</span>
            {e.won ? '🏆' : ''}
          </li>
        {:else}<li class="muted">{t('profile.noScores')}</li>{/each}
      </ol>
    </section>
    <section class="glass ach">
      <h3>
        {t('profile.achievements')}
        <span class="muted">{Object.keys(profile.achievements).length}/{ACHIEVEMENTS.length}</span>
      </h3>
      <ul>
        {#each ACHIEVEMENTS as a (a)}
          {@const got = profile.achievements[a]}
          <li class:got={!!got}>
            <span class="medal">{got ? '🏆' : '◌'}</span>
            <div><b>{t(`achievement.${a}.name`)}</b><small>{t(`achievement.${a}.desc`)}</small></div>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</div>

<style>
  .page {
    position: fixed;
    inset: 0;
    padding: 1.4rem 2rem;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1rem;
    background: radial-gradient(ellipse at 30% 0%, #172947, var(--abyss) 60%);
  }
  header {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 1rem;
    min-height: 0;
  }
  section {
    padding: 1.1rem;
    overflow-y: auto;
    display: grid;
    align-content: start;
    gap: 0.6rem;
  }
  label {
    display: grid;
    gap: 0.2rem;
    color: var(--muted);
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 1rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
  }
  .lb {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.2rem;
    font-size: 0.88em;
  }
  .muted {
    color: var(--faint);
  }
  .ach ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }
  .ach li {
    display: flex;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line);
    border-radius: 8px;
    opacity: 0.55;
  }
  .ach li.got {
    opacity: 1;
    border-color: rgba(242, 184, 75, 0.5);
  }
  .ach div {
    display: grid;
  }
  .ach small {
    color: var(--faint);
    font-size: 0.8em;
  }
  .medal {
    font-size: 1.3em;
  }
</style>
