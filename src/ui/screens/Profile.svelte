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
  .flagrow {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 14px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--slate) 35%, var(--panel-solid));
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
    border-radius: 2px;
    box-shadow:
      0 0 0 1px rgba(22, 50, 74, 0.25),
      0 3px 8px rgba(22, 50, 74, 0.14);
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
    font-size: 0.84em;
    color: var(--muted);
  }
  .flagtxt b {
    font-family: var(--title);
    font-size: 1.12em;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(340px, 1fr) minmax(0, 1.45fr);
    gap: 18px;
  }
  .card {
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    background: var(--panel-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 20px 22px;
    display: grid;
    align-content: start;
    gap: 14px;
  }
  .ident {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .field {
    display: grid;
    gap: 6px;
    font-weight: 500;
    font-size: 0.93em;
  }
  .field input,
  .field select {
    font-weight: 400;
    font-size: 1.05em;
    min-width: 0;
  }
  .sec {
    font-size: 1.15em;
    margin-top: 8px;
  }
  .stats {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
  }
  .stats div {
    padding: 12px 14px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    display: grid;
    gap: 2px;
  }
  .stats dt {
    color: var(--muted);
    font-size: 0.84em;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .stats dd {
    margin: 0;
    font-size: 1.55em;
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
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .rank {
    color: var(--muted);
  }
  .what {
    display: grid;
  }
  .what small {
    color: var(--muted);
    font-size: 0.84em;
  }
  .score {
    font-size: 1.1em;
  }
  .won {
    color: var(--brass-text);
  }
  .empty-state.small {
    padding: 14px 0 4px;
    justify-items: start;
    text-align: left;
  }
  .achh {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .achh .sec {
    margin: 0;
  }
  .count {
    color: var(--muted);
  }
  .count b {
    color: var(--parchment);
    font-size: 1.25em;
  }
  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
    margin-top: -4px;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--aurora);
    border-radius: 2px;
    transform-origin: left;
    animation: grow 0.8s 0.15s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }
  .ach ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 4px 18px;
  }
  .ach li {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 12px;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .ach li div {
    display: grid;
  }
  .ach li b {
    font-weight: 600;
    color: var(--muted);
  }
  .ach li small {
    color: var(--muted);
    font-size: 0.84em;
    line-height: 1.35;
  }
  .ach li.got b {
    color: var(--parchment);
  }
  .medal {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px dashed var(--line-strong);
    color: var(--faint);
  }
  .got .medal {
    border: 1.5px solid var(--brass);
    background: color-mix(in srgb, var(--brass) 12%, transparent);
    color: var(--brass-text);
  }
</style>
