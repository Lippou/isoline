// In-app update state, mirrored from the main process (src/desktop/updater.ts).
import { bridge, isDesktop, type UpdateStatus } from '../bridge';
import { settings } from './settings.svelte';

export const update = $state<{ s: UpdateStatus }>({
  s: { state: 'idle', current: '', access: 'none', installable: false },
});

let started = false;

/**
 * Subscribes to the main process, then checks once at launch — only when the player
 * kept the option on AND gave access to the private repository (token or GitHub CLI).
 */
export function startUpdates(): void {
  if (started || !isDesktop) return;
  started = true;
  bridge.update.onStatus((s) => (update.s = s));
  void bridge.update.status().then((s) => {
    update.s = s;
    if (settings.game.autoUpdate && s.access !== 'none') void bridge.update.check();
  });
}

export const checkUpdate = () => bridge.update.check().then((s) => (update.s = s));
export const downloadUpdate = () => bridge.update.download().then((s) => (update.s = s));
export const installUpdate = () => bridge.update.install().then((s) => (update.s = s));
export const saveUpdateToken = (t: string) => bridge.update.setToken(t).then((s) => (update.s = s));
export const clearUpdateToken = () => bridge.update.clearToken().then((s) => (update.s = s));
