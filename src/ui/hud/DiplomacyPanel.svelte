<script lang="ts">
  import { hud } from '../stores/game.svelte';
  import { t, i18n, short, clock } from '../i18n/i18n.svelte';
  import { settings } from '../stores/settings.svelte';
  import { inkHex } from '../../render/colors';
  import { flagDataUrl } from '../../render/flags';
  import type { GameController } from '../game/controller';

  let { ctl }: { ctl: GameController } = $props();
  const s = ctl.session;
  const rows = $derived(
    hud.players
      .filter((p) => p.kind !== 'tribe' && p.id !== hud.viewer && p.alive)
      .sort((a, b) => b.tiles - a.tiles)
      .map((p) => {
        const ally = hud.local?.allies.find((a) => a.id === p.id);
        const attacking = (hud.local?.attacks ?? []).some((a) => a.target === p.id);
        return { p, ally, attacking, embargo: hud.local?.embargo.includes(p.id) ?? false };
      }),
  );
  let all = $state(false);
</script>

<div class="tools">
  <button class="btn" onclick={() => s.cmd({ t: 'embargoAll', on: true, exceptTeam: true })}
    >{t('diplo.embargoAll')}</button
  >
  <button class="btn" onclick={() => s.cmd({ t: 'embargoAll', on: false, exceptTeam: false })}
    >{t('diplo.liftAll')}</button
  >
  <label class="chip"><input type="checkbox" bind:checked={all} /> {t('diplo.showAll')}</label>
</div>

<ul class="list">
  {#each all ? rows : rows.slice(0, 25) as r (r.p.id)}
    <li>
      <img src={flagDataUrl(r.p.flagSeed, 32)} alt="" />
      <div class="who">
        <span class="name" style="color:{inkHex(r.p.color, settings.access.vision)}"
          >{r.p.name[i18n.lang] || r.p.name.en}</span
        >
        <span class="meta">
          {#if r.p.kind === 'nation'}{t(`personality.${r.p.personality}`)} ·
          {/if}⚔ {short(r.p.troops)} · ▦ {short(r.p.tiles)}
          {#if r.p.traitor}
            · <b class="bad">💔 {t('hud.traitorMark')}</b>{/if}
        </span>
      </div>
      <div class="rel">
        {#if r.ally}
          <span class="chip good" title={t('diplo.allianceTimer')}>🤝 {clock(r.ally.expiresIn)}</span>
        {:else if r.attacking}
          <span class="chip bad">⚔ {t('diplo.war')}</span>
        {:else}
          <span class="chip">{t('diplo.neutral')}</span>
        {/if}
        {#if r.embargo}<span class="chip warn">⚓</span>{/if}
      </div>
      <div class="acts">
        {#if r.ally}
          <button title={t('radial.allyRenew')} onclick={() => s.cmd({ t: 'allyRequest', target: r.p.id })}
            >🔁</button
          >
          <button title={t('radial.allyBreak')} onclick={() => s.cmd({ t: 'allyBreak', target: r.p.id })}
            >✂</button
          >
          {#if s.config.allowDonations}<button
              title={t('radial.donate')}
              onclick={() =>
                s.cmd({ t: 'donate', target: r.p.id, gold: (hud.local?.gold ?? 0) * 0.1, troops: 0 })}
              >🎁</button
            >{/if}
        {:else}
          <button title={t('radial.allyRequest')} onclick={() => s.cmd({ t: 'allyRequest', target: r.p.id })}
            >🤝</button
          >
        {/if}
        <button
          title={r.embargo ? t('radial.embargoOff') : t('radial.embargoOn')}
          onclick={() => s.cmd({ t: 'embargo', target: r.p.id, on: !r.embargo })}>⚓</button
        >
        <button
          title={t('hud.centerOn')}
          onclick={() => ctl.renderer.camera.goTo(r.p.label[0], r.p.label[1], 2.5)}>◎</button
        >
      </div>
    </li>
  {/each}
</ul>

{#if hud.betrayals.length}
  <h4>{t('diplo.betrayals')}</h4>
  <ul class="hist">
    {#each hud.betrayals.slice().reverse() as b (b.tick + '-' + b.traitor)}
      <li>
        <span class="mono">{clock(b.tick)}</span>
        {s.state.name(b.traitor, i18n.lang)} → {s.state.name(b.victim, i18n.lang)}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .tools {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  .tools .btn {
    padding: 0.3em 0.6em;
    font-size: 0.85em;
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
    grid-template-columns: 28px 1fr auto;
    grid-template-areas: 'flag who rel' 'flag acts acts';
    gap: 0.15rem 0.5rem;
    align-items: center;
    padding: 0.4rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.02);
  }
  img {
    grid-area: flag;
    width: 28px;
    height: 19px;
    border-radius: 2px;
  }
  .who {
    grid-area: who;
    display: grid;
    min-width: 0;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 0.82em;
    color: var(--faint);
  }
  .rel {
    grid-area: rel;
    display: flex;
    gap: 0.25rem;
  }
  .acts {
    grid-area: acts;
    display: flex;
    gap: 0.25rem;
  }
  .acts button {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: 7px;
    cursor: pointer;
    padding: 0.1rem 0.45rem;
  }
  .acts button:hover {
    border-color: var(--aurora);
  }
  .good {
    color: var(--verdant);
  }
  .bad {
    color: var(--signal);
  }
  .warn {
    color: var(--brass);
  }
  h4 {
    margin: 0.9rem 0 0.3rem;
    font-family: var(--title);
  }
  .hist {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 0.85em;
    color: var(--muted);
  }
</style>
