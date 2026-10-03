<script lang="ts">
  // Messages, printed on the journal's paper: the exchanges as briefs (the time run in,
  // then who speaks), the newest at the foot; under them the quick messages and the
  // line to write, with the channel it goes to.
  import './paper.css';
  import Icon from '../icons/Icon.svelte';
  import { audio } from '../../audio/audio';
  import { hud } from '../stores/game.svelte';
  import { t, i18n, clock } from '../i18n/i18n.svelte';
  import type { GameController } from '../game/controller';
  import { filterProfanity } from '../game/chatFilter';
  import { onMount, tick } from 'svelte';
  import PaperMast from './PaperMast.svelte';

  let { ctl }: { ctl: GameController } = $props();
  const CHANNELS = ['all', 'team', 'allies'] as const;
  let channel = $state<'all' | 'team' | 'allies'>('all');
  let text = $state('');
  let input: HTMLInputElement;
  let list: HTMLElement | undefined = $state();
  const s = ctl.session;
  const start = $derived(hud.world?.startTick ?? 0);
  const shown = $derived(hud.chat.filter((m) => !hud.mutedPlayers.includes(m.from)));

  function send(): void {
    const msg = filterProfanity(text.trim()).slice(0, 200);
    text = '';
    if (!msg) return;
    audio.ui('confirm');
    if (ctl.lan) ctl.lan.send({ t: 'chat', channel, text: msg });
    else hud.chat = [...hud.chat.slice(-99), { from: s.viewer, text: msg, channel, t: hud.tick }];
  }
  function toggleMute(id: number): void {
    hud.mutedPlayers = hud.mutedPlayers.includes(id)
      ? hud.mutedPlayers.filter((x) => x !== id)
      : [...hud.mutedPlayers, id];
  }
  // A new message: the column follows it down.
  $effect(() => {
    void shown.length;
    void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });
  onMount(() => input?.focus());
</script>

<div class="paper newsprint np-window chat">
  <PaperMast title={t('panel.chat')} onclose={() => (hud.panels.chat = false)}>
    <p class="np-dateline">
      <span>{shown.length === 1 ? t('chat.countOne') : t('chat.count', { n: shown.length })}</span>
      {#if hud.mutedPlayers.length}<span class="muted">{t('chat.muted', { n: hud.mutedPlayers.length })}</span
        >{/if}
    </p>
  </PaperMast>

  <ol class="msgs np-body scroll" bind:this={list}>
    {#each shown as m, k (k)}
      <li class:mine={m.from === s.viewer}>
        <time class="mono">{clock(Math.max(0, m.t - start))}</time>
        <button class="from" title={t('chat.mute')} onclick={() => m.from !== s.viewer && toggleMute(m.from)}
          >{s.state.name(m.from, i18n.lang)}</button
        >
        {#if m.channel !== 'all'}<span class="ch">{t(`chat.${m.channel}`)}</span>{/if}
        <span class="txt">{m.text}</span>
      </li>
    {:else}
      <li class="empty">{t('chat.empty')}</li>
    {/each}
  </ol>

  <div class="compose">
    <p class="kicker">{t('chat.quick')}</p>
    <div class="quick">
      {#each [0, 1, 2, 3, 4, 5, 6, 7] as q (q)}
        <button
          class="np-btn small"
          onclick={() => {
            audio.ui('confirm');
            s.cmd({ t: 'quick', target: -1, msg: q });
          }}>{t(`quick.${q}`)}</button
        >
      {/each}
    </div>
    <div class="to" role="group" aria-label={t('chat.to')}>
      <span class="kicker">{t('chat.to')}</span>
      {#each CHANNELS as c (c)}
        <button class:on={channel === c} aria-pressed={channel === c} onclick={() => (channel = c)}
          >{t(`chat.${c}`)}</button
        >
      {/each}
    </div>
    <form
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <input
        class="np-field"
        type="text"
        bind:this={input}
        bind:value={text}
        maxlength="200"
        placeholder={t('chat.placeholder')}
        onkeydown={(e) => e.key === 'Escape' && (hud.panels.chat = false)}
      />
      <button class="np-btn ink" aria-label={t('chat.send')}><Icon name="send" size={15} /></button>
    </form>
  </div>
</div>

<style>
  .chat {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .muted {
    color: var(--np-ink-3);
  }

  /* The exchanges: briefs, the time run in, the speaker in the title face. */
  .chat .msgs {
    list-style: none;
    margin: 0;
    padding-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msgs li {
    font-family: var(--np-serif);
    font-size: 0.9em;
    line-height: 1.45;
    color: var(--np-ink);
    overflow-wrap: anywhere;
  }
  /* The first message sits at the foot of the column, the latest just above the composer. */
  .msgs li:first-child {
    margin-top: auto;
  }
  time {
    margin-right: 5px;
    font-size: 0.86em;
    font-weight: 600;
    color: var(--np-ink-3);
  }
  .from {
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--title);
    font-weight: 600;
    font-size: 1.04em;
    color: var(--np-ink);
    cursor: var(--cursor-pointer, pointer);
  }
  .from:hover {
    text-decoration: underline;
    text-decoration-color: var(--np-rule-2);
    text-underline-offset: 2px;
  }
  .mine .from {
    color: var(--np-ink-2);
  }
  .from::after {
    content: ' —';
    font-weight: 400;
    color: var(--np-ink-3);
  }
  .ch {
    margin: 0 4px 0 2px;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.9em;
    color: var(--np-ink-2);
  }
  .txt {
    margin-left: 3px;
  }
  .msgs li.empty {
    margin: auto 0;
    font-family: var(--title);
    font-style: italic;
    color: var(--np-ink-2);
    text-align: center;
  }

  /* The composer: quick messages, the channel, the line to write. */
  .compose {
    display: grid;
    gap: 6px;
    padding: 8px 18px 14px;
    border-top: 1px solid var(--np-ink);
  }
  .kicker {
    margin: 0;
    font-family: var(--title);
    font-style: italic;
    font-size: 0.84em;
    color: var(--np-ink-2);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .quick .np-btn {
    border-color: var(--np-rule);
    font-family: var(--np-serif);
  }
  .to {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 14px;
    border-bottom: 1px solid var(--np-rule);
  }
  .to button {
    appearance: none;
    border: 0;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    padding: 2px 0 4px;
    background: none;
    font-size: 0.8em;
    font-weight: 500;
    color: var(--np-ink-2);
    cursor: pointer;
  }
  .to button:hover {
    color: var(--np-ink);
  }
  .to button.on {
    color: var(--np-ink);
    border-bottom-color: var(--np-ink);
  }
  form {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
  form input {
    flex: 1;
  }
  form .np-btn {
    padding: 5px 10px;
  }
</style>
