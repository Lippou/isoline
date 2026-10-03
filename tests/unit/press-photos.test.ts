// Every world event has its press photo: printed, shipped, captioned and credited.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORLD_EVENTS } from '../../src/core/rules/features';
import { PRESS_PHOTOS, pressPhotoUrl, hasPressPhoto } from '../../src/ui/hud/pressPhotos';
import fr from '../../src/ui/i18n/fr.json';
import en from '../../src/ui/i18n/en.json';

const ROOT = path.resolve(import.meta.dirname, '../..');
const credits = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');

describe('press photos', () => {
  it('cover every world event and nothing else', () => {
    expect(Object.keys(PRESS_PHOTOS).sort()).toEqual([...WORLD_EVENTS].sort());
    expect(hasPressPhoto('crisis')).toBe(true);
    expect(hasPressPhoto('toString')).toBe(false);
  });

  it.each(WORLD_EVENTS)('%s: printed in public/ (small), framed, captioned and credited', (id) => {
    const p = PRESS_PHOTOS[id];
    const file = path.join(ROOT, 'public', pressPhotoUrl(id));
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeLessThan(120 * 1024);
    // Redistributable licences only (no NC / ND).
    expect(['Public domain', 'CC0', 'CC BY 2.0', 'CC BY 4.0']).toContain(p.licence);
    const [x, y, w] = p.crop;
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(1);
    for (const dict of [fr.pressPhoto, en.pressPhoto]) {
      expect(dict.caption[id]).toBeTruthy();
      expect(dict.alt[id]).toBeTruthy();
    }
    expect(credits).toContain(p.source);
    expect(credits).toContain(p.licenceUrl);
  });
});
