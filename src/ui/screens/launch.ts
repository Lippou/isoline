// Helpers to start matches from the menus.
import { app, go } from '../stores/app.svelte';
import type { GameConfig } from '../../core/game/config';
import { settings } from '../stores/settings.svelte';
import { profile } from '../stores/profile.svelte';
import { MISSIONS, tutorialConfig } from '../campaign/missions';
import type { ReplayFile } from '../../engine/replay';
import { loadSave } from '../game/saves';
import { t } from '../i18n/i18n.svelte';
import { toast } from '../stores/game.svelte';
import { audio } from '../../audio/audio';

export function playerName(): string {
  return (settings.playerName || profile.name || t('profile.defaultName')).slice(0, 24);
}

const randomSeed = () => (Math.random() * 2 ** 31) >>> 0;

export function startSolo(config: GameConfig, customMap?: string): void {
  audio.ui('confirm');
  const cfg: GameConfig = { ...config, seed: config.seed || randomSeed() };
  app.launch = { kind: 'solo', config: cfg, viewer: 1, ...(customMap ? { customMap } : {}) };
  go('game');
}

export function startTutorial(): void {
  app.launch = {
    kind: 'solo',
    config: tutorialConfig(randomSeed(), playerName()),
    viewer: 1,
    tutorial: true,
  };
  go('game');
}

export function startMission(id: string): void {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) return;
  app.launch = { kind: 'solo', config: m.config(randomSeed(), playerName()), viewer: 1, missionId: id };
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
    ...(s.customMap ? { customMap: s.customMap } : {}),
  };
  go('game');
}
