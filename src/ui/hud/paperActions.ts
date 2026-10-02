// What the buttons of the final edition do (front page, mission communiqué, results).
import { hud } from '../stores/game.svelte';
import { app, go } from '../stores/app.svelte';
import { bridge } from '../bridge';
import { i18n } from '../i18n/i18n.svelte';
import { watchReplayAt, startMission } from '../screens/launch';
import { exportStatsCsv } from '../game/csv';
import type { GameController } from '../game/controller';
import type { MissionResult } from '../game/missionResult';

/** Seconds of play shown before a turning point. */
export const LEAD_TICKS = 80;

/** Can this game be watched again (a replay, or the replay file it just saved)? */
export const canWatch = (ctl: GameController) => ctl.session.kind === 'replay' || !!ctl.replayFile;

/** Watch the game again from `tick` (the camera on `at`): the paper folds. */
export function watchFrom(ctl: GameController, tick: number, at?: [number, number]): void {
  const target = Math.max(0, tick);
  hud.paper = false;
  if (ctl.session.kind === 'replay') void ctl.seekReplay(target, at);
  else if (ctl.replayFile) watchReplayAt(ctl.replayFile, target, at);
}

/** Mount the game screen anew on the launch request now in `app.launch`. */
function relaunch(via: 'lobby' | 'campaign'): void {
  go(via);
  setTimeout(() => go('game'), 0);
}

/** Rematch: the same settings, a new world (new seed). */
export function rematch(): void {
  const req = app.launch;
  if (!req) return;
  app.launch = {
    ...req,
    config: { ...req.config, seed: (Math.random() * 2 ** 31) >>> 0 },
    snapshot: undefined,
    priorTurns: undefined,
  } as typeof req;
  relaunch('lobby');
}

export function nextMission(r: MissionResult): void {
  if (r.onNext) return r.onNext();
  if (!r.next) return;
  startMission(r.next.id);
  relaunch('campaign');
}

export function retryMission(r: MissionResult): void {
  if (r.onRetry) return r.onRetry();
  startMission(r.id);
  relaunch('campaign');
}

/** Save a copy of the game's replay where the reader wants it. */
export async function exportReplay(ctl: GameController): Promise<void> {
  const file = ctl.replayFile ?? ctl.session.replay?.file;
  if (!file) return;
  const stamp = file.date.replace(/[:.]/g, '-');
  await bridge.storage.exportFile(`isoline-${stamp}.rpl`, JSON.stringify(file), 'Isoline replay', 'rpl');
}

export async function exportCsv(): Promise<void> {
  if (!hud.end) return;
  await bridge.storage.exportFile(
    `isoline-stats-${Date.now()}.csv`,
    exportStatsCsv(hud.end.stats, i18n.lang),
    'CSV',
    'csv',
  );
}
