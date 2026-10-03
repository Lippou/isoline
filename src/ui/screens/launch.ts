// Helpers to start matches from the menus.
import { app, go } from '../stores/app.svelte';
import type { GameConfig } from '../../core/game/config';
import { settings } from '../stores/settings.svelte';
import { profile, myFlag } from '../stores/profile.svelte';
import { MISSIONS } from '../campaign/missions';
import type { ReplayFile } from '../../engine/replay';
import type { Snapshot } from '../../core/net/snapshot';
import { loadSave } from '../game/saves';
import { t } from '../i18n/i18n.svelte';
import { toast } from '../stores/game.svelte';
import { audio } from '../../audio/audio';

export function playerName(): string {
  return (settings.playerName || profile.name || t('profile.defaultName')).slice(0, 24);
}

const randomSeed = () => (Math.random() * 2 ** 31) >>> 0;

/**
 * The profile's flag on the local player's slot (slot 0) of a new solo game. Cosmetic:
 * the simulation never reads it; it travels in the config, so saves and replays keep it.
 */
export function withMyFlag(config: GameConfig): GameConfig {
  const flag = myFlag();
  return {
    ...config,
    players: config.players.map((s) => {
      if (s.kind !== 'human' || s.slot !== 0) return s;
      const { flag: _old, ...rest } = s;
      return flag ? { ...rest, flag } : rest;
    }),
  };
}

export function startSolo(config: GameConfig, customMap?: string): void {
  audio.ui('confirm');
  const cfg: GameConfig = withMyFlag({ ...config, seed: config.seed || randomSeed() });
  app.launch = { kind: 'solo', config: cfg, viewer: 1, ...(customMap ? { customMap } : {}) };
  go('game');
}

export function startMission(id: string): void {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) return;
  app.launch = {
    kind: 'solo',
    config: withMyFlag(m.config(randomSeed(), playerName())),
    viewer: 1,
    missionId: id,
  };
  go('game');
}

export function startReplay(file: ReplayFile): void {
  app.launch = {
    kind: 'replay',
    config: file.config,
    viewer: -1,
    replay: file,
    ...(file.customMap ? { customMap: file.customMap } : {}),
  };
  go('game');
}

/**
 * Watch a replay from a given moment (the front page's "Revoir"): the replay opens,
 * fast-forwards to `tick` and the camera goes to `at`. From inside a game, the game
 * screen is mounted anew (as "Play again" does).
 */
export function watchReplayAt(file: ReplayFile, tick: number, at?: [number, number], takeover = false): void {
  app.launch = {
    kind: 'replay',
    config: file.config,
    viewer: -1,
    replay: file,
    replayAt: { tick, ...(at ? { x: at[0], y: at[1] } : {}), ...(takeover ? { takeover } : {}) },
    ...(file.customMap ? { customMap: file.customMap } : {}),
  };
  if (app.screen === 'game') {
    go('replays');
    setTimeout(() => go('game'), 0);
  } else go('game');
}

export async function startFromSave(slot: number): Promise<void> {
  const s = await loadSave(slot);
  if (!s) {
    toast(t('menu.loadFailed'), 'warn');
    return;
  }
  app.launch = {
    kind: 'solo',
    config: s.snapshot.config,
    viewer: s.viewer,
    snapshot: s.snapshot,
    priorTurns: s.turns,
    ...(s.replayStart ? { replayStart: s.replayStart } : {}),
    ...(s.customMap ? { customMap: s.customMap } : {}),
  };
  go('game');
}

/**
 * « Reprendre d'ici »: a new solo game from a replay moment, as `player` (see
 * core/net/takeover.ts). With the seats unchanged the recorded turns carry over (the new
 * game's replay still starts at tick 0); otherwise its replay starts from the snapshot.
 */
export function startTakeover(file: ReplayFile, snapshot: Snapshot, player: number, changed: boolean): void {
  audio.ui('confirm');
  const tick = snapshot.core.tick as number;
  app.launch = {
    kind: 'solo',
    config: snapshot.config,
    viewer: player,
    snapshot,
    priorTurns: changed ? [] : file.turns.filter(([t]) => t < tick),
    ...(changed ? { replayStart: snapshot } : file.start ? { replayStart: file.start } : {}),
    ...(file.customMap ? { customMap: file.customMap } : {}),
  };
  if (app.screen === 'game') {
    go('replays');
    setTimeout(() => go('game'), 0);
  } else go('game');
}
