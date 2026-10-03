<script lang="ts">
  import { t, num, short, date, clock } from '../i18n/i18n.svelte';
  import { profile, saveProfile, ACHIEVEMENTS, TITLES, unlockedTitles } from '../stores/profile.svelte';
  import { app, go } from '../stores/app.svelte';
  import PageHeader from '../PageHeader.svelte';
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';
  import { myFlag } from '../stores/profile.svelte';
  import { flagUrl } from '../../render/flags';
  import { hashString } from '../../core/rng';
  import FlagPicker from '../components/FlagPicker.svelte';
  import { flagName } from '../components/flagNames';
  import { playerName } from './launch';
  import { i18n } from '../i18n/i18n.svelte';

  const titles = $derived(unlockedTitles());
  const got = $derived(Object.keys(profile.achievements).length);
  const stats = $derived<{ icon: IconName; label: string; value: string }[]>([
    { icon: 'globe', label: t('profile.games'), value: num(profile.totals.games) },
    { icon: 'trophy', label: t('profile.wins'), value: num(profile.totals.wins) },
    { icon: 'time', label: t('profile.time'), value: clock(profile.totals.playTicks) },
    { icon: 'territory', label: t('stats.conquered'), value: short(profile.totals.tilesConquered) },
    { icon: 'city', label: t('stats.buildings'), value: num(profile.totals.buildings) },
    { icon: 'warship', label: t('stats.shipsSunk'), value: num(profile.totals.shipsSunk) },
    { icon: 'nuke', label: t('stats.nukes'), value: num(profile.totals.nukes) },
    { icon: 'sam', label: t('stats.intercepts'), value: num(profile.totals.intercepts) },
    { icon: 'gold', label: t('stats.goldEarned'), value: short(profile.totals.gold) },
  ]);
  let picking = $state(false);
  const myName = $derived(playerName());
  const flagSrc = $derived(flagUrl({ flagSeed: hashString(myName + 0), flag: myFlag() }, 120));
  const flagLabel = $derived(
    profile.flagChoice === 'iso'
      ? flagName(profile.flagIso, i18n.lang)
      : profile.flagChoice === 'custom'
        ? t('flag.tabCustom')
        : t('flag.tabAuto'),
  );
  function newGame(): void {
    app.lobby.lan = false;
    go('lobby');
  }
</script>

<div class="page-shell" data-testid="profile">
  <PageHeader title={t('title.profile')} subtitle={t('profile.subtitle')} />
  <div class="page-body cols">
    <section class="card">
      <div class="ident">
        <label class="field"
          ><span>{t('profile.name')}</span>
          <input
            type="text"
            bind:value={profile.name}
            maxlength="24"
            placeholder={t('profile.anonymous')}
            onchange={saveProfile}
          /></label
        >
        <label class="field"
          ><span>{t('profile.title')}</span>
          <select bind:value={profile.title} onchange={saveProfile}>
            {#each TITLES as ti (ti.id)}<option value={ti.id} disabled={!titles.includes(ti.id)}
                >{t(`title.${ti.id}`)}
                {titles.includes(ti.id) ? '' : `(${t('profile.needAch', { n: ti.need })})`}</option
              >{/each}
          </select>
        </label>
      </div>
      <div class="flagrow">
        <button
          class="flagbtn"
          onclick={() => (picking = true)}
          title={t('flag.change')}
          aria-label={t('flag.change')}><img src={flagSrc} alt="" data-testid="profile-flag-img" /></button
        >
        <div class="flagtxt">
          <span>{t('flag.title')}</span>
          <b>{flagLabel}</b>
        </div>
        <button class="btn small" onclick={() => (picking = true)} data-testid="profile-flag"
          ><Icon name="flag" size={14} />{t('flag.change')}</button
        >
      </div>

      <h2 class="sec">{t('profile.record')}</h2>
      <dl class="stats">
        {#each stats as s (s.label)}
          <div>
            <dt><Icon name={s.icon} size={14} />{s.label}</dt>
            <dd class="mono">{s.value}</dd>
          </div>
        {/each}
      </dl>

      <h2 class="sec">{t('profile.leaderboard')}</h2>
      {#if profile.leaderboard.length}
        <ol class="lb">
          {#each profile.leaderboard as e, k (k)}
            <li>
              <span class="rank mono">{k + 1}</span>
              <span class="what"
                ><b>{e.map}</b><small>{t(`mode.${e.mode}`)}, {date(Date.parse(e.date))}</small></span
              >
              {#if e.won}<span class="won" title={t('profile.won')}><Icon name="trophy" size={14} /></span
                >{/if}
              <b class="score mono">{num(e.score)}</b>
            </li>
          {/each}
        </ol>
      {:else}
        <div class="empty-state small">
          <p>{t('profile.noScoresHint')}</p>
          <div class="acts">
            <button class="btn" onclick={newGame}
              ><Icon name="play" size={15} />{t('profile.playFirst')}</button
            >
          </div>
        </div>
      {/if}
    </section>

    <section class="card ach">
      <header class="achh">
        <h2 class="sec">{t('profile.achievements')}</h2>
        <span class="mono count"><b>{got}</b> / {ACHIEVEMENTS.length}</span>
      </header>
      <div
        class="bar"
        role="progressbar"
        aria-label={t('profile.achievements')}
        aria-valuemin={0}
        aria-valuemax={ACHIEVEMENTS.length}
        aria-valuenow={got}
      >
        <span style="width:{(got / ACHIEVEMENTS.length) * 100}%"></span>
      </div>
      <ul>
        {#each ACHIEVEMENTS as a (a)}
          {@const done = !!profile.achievements[a]}
          <li class:got={done}>
            <span class="medal"><Icon name={done ? 'trophy' : 'lock'} size={done ? 16 : 14} /></span>
            <div><b>{t(`achievement.${a}.name`)}</b><small>{t(`achievement.${a}.desc`)}</small></div>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</div>

{#if picking}<FlagPicker name={myName} onclose={() => (picking = false)} />{/if}

<style>
  /* The flag, as a plate with its caption, between two fine rules. */
  .flagrow {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
    border-top: 1px solid var(--np-rule);
    border-bottom: 1px solid var(--np-rule);
  }
  .flagbtn {
    padding: 0;
    border: none;
    background: none;
    cursor: var(--cursor-pointer, pointer);
    line-height: 0;
  }
  .flagbtn img {
    width: 66px;
    height: 44px;
    object-fit: cover;
    border: 1px solid rgba(23, 42, 60, 0.35);
    mix-blend-mode: multiply;
    transition: transform 0.12s var(--ease-out);
  }
  .flagbtn:hover img {
    transform: translateY(-1px) rotate(-1.5deg);
  }
  .flagtxt {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .flagtxt span {
    font-family: var(--title);
    font-style: italic;
    font-size: 0.86em;
    color: var(--np-ink-2);
  }
  .flagtxt b {
    font-family: var(--title);
    font-size: 1.15em;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Two columns of the page, a fine rule between. */
  .cols {
    display: grid;
    grid-template-columns: minmax(340px, 1fr) minmax(0, 1.45fr);
  }
  .card {
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    padding: 2px 24px 16px 0;
    display: grid;
    align-content: start;
    gap: 12px;
  }
  .card + .card {
    padding: 2px 0 16px 24px;
    border-left: 1px solid var(--np-rule);
  }
  .ident {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .field {
    display: grid;
    gap: 6px;
    font-weight: 600;
    font-size: 0.92em;
  }
  .field input,
  .field select {
    font-weight: 400;
    font-size: 1.05em;
    min-width: 0;
  }
  /* Section heads: a title on a rule, as the Courier's. */
  .sec {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    font-weight: 700;
    font-size: 1.15em;
  }
  .sec::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--np-rule);
  }
  /* The record: figures in a ruled table. */
  .stats {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 2px solid var(--np-ink);
  }
  .stats div {
    padding: 9px 12px 10px;
    border-bottom: 1px solid var(--np-rule);
    display: grid;
    gap: 1px;
  }
  .stats div:not(:nth-child(3n + 1)) {
    border-left: 1px solid var(--np-rule);
  }
  .stats dt {
    color: var(--np-ink-2);
    font-size: 0.82em;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .stats dd {
    margin: 0;
    font-size: 1.5em;
    font-weight: 600;
    line-height: 1.2;
  }
  .lb {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
  }
  .lb li {
    display: grid;
    grid-template-columns: 2em 1fr auto auto;
    gap: 10px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px solid var(--np-rule);
  }
  .rank {
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-3);
  }
  .what {
    display: grid;
  }
  .what b {
    font-family: var(--title);
    font-weight: 600;
  }
  .what small {
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.82em;
  }
  .score {
    font-size: 1.1em;
  }
  .won {
    color: var(--brass-text);
  }
  .empty-state.small {
    padding: 4px 0 4px;
    justify-items: start;
    text-align: left;
  }
  .achh {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 14px;
  }
  .achh .sec {
    flex: 1;
    margin: 0;
  }
  .count {
    color: var(--np-ink-2);
  }
  .count b {
    color: var(--np-ink);
    font-size: 1.25em;
  }
  .bar {
    height: 3px;
    background: var(--np-rule);
    overflow: hidden;
    margin-top: -4px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--np-ink);
    transform-origin: left;
    animation: grow 0.8s 0.15s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }
  /* The achievements, as a legend: a pictogram, the name, the line; a rule between. */
  .ach ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0 22px;
  }
  .ach li {
    display: grid;
    grid-template-columns: 22px 1fr;
    gap: 10px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px solid var(--np-rule);
  }
  .ach li div {
    display: grid;
  }
  .ach li b {
    font-weight: 600;
    color: var(--np-ink-2);
  }
  .ach li small {
    font-family: var(--np-serif);
    color: var(--np-ink-2);
    font-size: 0.82em;
    line-height: 1.35;
  }
  .ach li.got b {
    font-family: var(--title);
    font-weight: 700;
    color: var(--np-ink);
  }
  .medal {
    display: grid;
    place-items: center;
    color: var(--np-ink-3);
    opacity: 0.75;
  }
  .got .medal {
    color: var(--brass-text);
    opacity: 1;
  }
</style>
