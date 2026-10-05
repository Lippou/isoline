import { describe, expect, it } from 'vitest';
import { migrateSpacePause } from '../../src/ui/stores/keyMigrations';

/** The defaults of 1.13 (v4) and of 1.14 (v5), as far as these keys go. */
const V4 = { terrainView: 'Space', pause: 'KeyP', fogView: 'KeyV', home: 'KeyH' };
const V5 = { terrainView: 'Tab', pause: 'Space', pauseAlt: 'KeyP', fogView: 'KeyV', home: 'KeyH' };

/** What migrateSettings does: the defaults, the stored keys over them, then the migration. */
function migrate(stored: Record<string, string>): Record<string, string> {
  const keys = { ...V5, ...stored };
  migrateSpacePause(keys, stored);
  return keys;
}

describe('v4 → v5 keys: Space pauses, the terrain view moves to Tab', () => {
  it('gives the 1.13 defaults the new ones', () => {
    expect(migrate({ ...V4 })).toEqual(V5);
  });

  it('keeps a pause key the player chose, as the second one', () => {
    const k = migrate({ ...V4, pause: 'KeyZ' });
    expect(k.pause).toBe('Space');
    expect(k.pauseAlt).toBe('KeyZ');
    expect(k.terrainView).toBe('Tab');
  });

  it('leaves a terrain key the player moved off Space alone', () => {
    const k = migrate({ ...V4, terrainView: 'KeyM' });
    expect(k.terrainView).toBe('KeyM');
    expect(k.pause).toBe('Space');
    expect(k.pauseAlt).toBe('KeyP');
  });

  it('never binds a key twice: Space or Tab given by the player to another action', () => {
    const k = migrate({ ...V4, terrainView: 'KeyM', home: 'Space', fogView: 'Tab' });
    expect(k.home).toBe('Space');
    expect(k.fogView).toBe('Tab');
    expect(k.pause).toBe('KeyP');
    expect(k.pauseAlt).toBe('');
    const t = migrate({ ...V4, fogView: 'Tab' });
    expect(t.terrainView).toBe('');
    expect(t.pause).toBe('Space');
    const codes = Object.values(k).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('a pause already on Space keeps it, with no second key', () => {
    const k = migrate({ ...V4, terrainView: 'KeyM', pause: 'Space' });
    expect(k.pause).toBe('Space');
    expect(k.pauseAlt).toBe('');
  });
});
