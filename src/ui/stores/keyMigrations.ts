// Key bindings carried over from older settings (pure: settings.svelte.ts, tests/unit/settings-keys.test.ts).

/**
 * v4 → v5: the terrain view leaves Space for Tab, and Space becomes the pause key (the
 * former pause key, P unless changed, stays as the second one). `keys`: merged with the
 * defaults; `stored`: what the player had saved (to tell their own choices apart).
 */
export function migrateSpacePause(keys: Record<string, string>, stored: Record<string, string>): void {
  const user = (code: string, but: string) =>
    Object.keys(keys).some((a) => a !== but && keys[a] === code && a in stored);
  const oldPause = stored.pause ?? 'KeyP';
  if ((stored.terrainView ?? 'Space') === 'Space') keys.terrainView = user('Tab', 'terrainView') ? '' : 'Tab';
  if (!user('Space', 'pause')) {
    keys.pause = 'Space';
    keys.pauseAlt = oldPause === 'Space' ? '' : oldPause;
  } else {
    // Space is the player's for something else: the pause keeps its key, alone.
    keys.pause = oldPause;
    keys.pauseAlt = '';
  }
}
