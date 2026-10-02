<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import { hud } from '../stores/game.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { filterProfanity } from '../game/chatFilter';
  import { onMount } from 'svelte';

  let { ctl }: { ctl: GameController } = $props();
  let channel = $state<'all' | 'team' | 'allies'>('all');
  let text = $state('');
  let input: HTMLInputElement;
  const s = ctl.session;
  const start = $derived(hud.world?.startTick ?? 0);

  function send(): void {
    const msg = filterProfanity(text.trim()).slice(0, 200);
    text = '';
    if (!msg) return;
    if (ctl.lan) ctl.lan.send({ t: 'chat', channel, text: msg });
    else hud.chat = [...hud.chat.slice(-99), { from: s.viewer, text: msg, channel, t: hud.tick }];
  }
  function toggleMute(id: number): void {
    hud.mutedPlayers = hud.mutedPlayers.includes(id)
      ? hud.mutedPlayers.filter((x) => x !== id)
      : [...hud.mutedPlayers, id];
  }
  onMount(() => input?.focus());
</script>

<div class="channels">
  {#each ['all', 'team', 'allies'] as c (c)}
    <button class="chip" class:on={channel === c} onclick={() => (channel = c as typeof channel)}
      >{t(`chat.${c}`)}</button
    >
  {/each}
</div>
<ul class="msgs">
  {#each hud.chat.filter((m) => !hud.mutedPlayers.includes(m.from)) as m, k (k)}
    <li>
      <span class="mono time">{clock(Math.max(0, m.t - start))}</span>
      <button class="from" title={t('chat.mute')} onclick={() => m.from !== s.viewer && toggleMute(m.from)}
        >{s.state.name(m.from, i18n.lang)}</button
      >
      <span class="ch">[{t(`chat.${m.channel}`)}]</span>
      <span>{m.text}</span>
    </li>
  {/each}
</ul>
<div class="quick">
  {#each [0, 1, 2, 3, 4, 5, 6, 7] as q (q)}
    <button class="chip" onclick={() => s.cmd({ t: 'quick', target: -1, msg: q })}>{t(`quick.${q}`)}</button>
  {/each}
</div>
<form
  onsubmit={(e) => {
    e.preventDefault();
    send();
  }}
>
  <input
    type="text"
    bind:this={input}
    bind:value={text}
    maxlength="200"
    placeholder={t('chat.placeholder')}
    onkeydown={(e) => e.key === 'Escape' && (hud.panels.chat = false)}
  />
  <button class="btn" aria-label={t('chat.send')}><Icon name="send" size={15} /></button>
</form>
{#if hud.mutedPlayers.length}<p class="muted">{t('chat.muted', { n: hud.mutedPlayers.length })}</p>{/if}

<style>
  .channels,
  .quick {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .chip {
    background: none;
    cursor: pointer;
  }
  .chip.on {
    color: var(--aurora);
    border-color: var(--aurora);
  }
  .msgs {
    list-style: none;
    padding: 0;
    margin: 0 0 0.5rem;
    max-height: 260px;
    overflow-y: auto;
    display: grid;
    gap: 3px;
  }
  .time {
    color: var(--faint);
    margin-right: 0.3rem;
  }
  .from {
    background: none;
    border: 0;
    color: var(--aurora);
    cursor: pointer;
    padding: 0;
    font-weight: 600;
  }
  .ch {
    color: var(--faint);
    font-size: 0.85em;
  }
  form {
    display: flex;
    gap: 0.4rem;
  }
  form input {
    flex: 1;
    user-select: text;
  }
  .muted {
    color: var(--faint);
    font-size: 0.8em;
  }
</style>
