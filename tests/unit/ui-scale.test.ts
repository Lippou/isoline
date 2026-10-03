import { describe, expect, it } from 'vitest';
import {
  autoUiScale,
  effectiveUiScale,
  snapScale,
  zoomFor,
  AUTO_MIN,
  AUTO_MAX,
} from '../../src/ui/stores/uiScale';

describe('interface scale', () => {
  it('keeps the design size from 1600 × 900 to 1920 × 1080', () => {
    expect(autoUiScale(1600, 900, 1)).toBe(1);
    expect(autoUiScale(1600, 960, 2)).toBe(1);
    expect(autoUiScale(1710, 1107, 2)).toBe(1);
    expect(autoUiScale(1920, 1080, 1)).toBe(1);
  });

  it('shrinks the HUD a little on laptops, never under the floor', () => {
    // MacBook Air 13" ("looks like" 1470 × 956, windowed 1470 × 880), Retina.
    expect(autoUiScale(1470, 880, 2)).toBeCloseTo(0.925, 5);
    expect(autoUiScale(1470, 956, 2)).toBeCloseTo(0.925, 5);
    // 1366 × 768 and 1280 × 720 at 100 %.
    expect(autoUiScale(1366, 768, 1)).toBeCloseTo(0.85, 5);
    expect(autoUiScale(1280, 720, 1)).toBeCloseTo(AUTO_MIN, 5);
    expect(autoUiScale(1100, 680, 1)).toBeCloseTo(AUTO_MIN, 5);
    // 1920 × 1080 at 125 %: 1536 × 864 CSS pixels.
    expect(autoUiScale(1536, 864, 1.25)).toBeCloseTo(0.96, 5);
  });

  it('grows on large screens, within the ceiling', () => {
    expect(autoUiScale(2560, 1440, 1)).toBeCloseTo(1.15, 5);
    expect(autoUiScale(2560, 1440, 2)).toBeCloseTo(1.15, 5);
    // A pixel of rounding either way does not change it.
    expect(autoUiScale(2559, 1439, 1)).toBe(autoUiScale(2561, 1441, 1));
    expect(autoUiScale(3840, 2160, 1)).toBe(AUTO_MAX);
  });

  it('snaps to twentieths of a device pixel', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const [w, h] of [
        [1280, 720],
        [1366, 768],
        [1470, 880],
        [2560, 1440],
      ] as const) {
        const p = autoUiScale(w, h, dpr) * dpr * 20;
        expect(Math.abs(p - Math.round(p))).toBeLessThan(1e-6);
      }
    }
    expect(snapScale(0.919, 2)).toBeCloseTo(0.925, 5);
  });

  it('follows a manual scale, limited to keep 1024 × 600 CSS pixels', () => {
    expect(effectiveUiScale(0, 1470, 880, 2)).toBe(autoUiScale(1470, 880, 2));
    expect(effectiveUiScale(1.1, 1920, 1080, 1)).toBe(1.1);
    expect(effectiveUiScale(1.5, 1280, 720, 1)).toBeCloseTo(1.2, 5);
    expect(effectiveUiScale(0.5, 1920, 1080, 1)).toBe(0.75);
  });

  it('never shrinks the menus', () => {
    expect(zoomFor(0.85, false)).toBe(1);
    expect(zoomFor(0.85, true)).toBe(0.85);
    expect(zoomFor(1.15, false)).toBe(1.15);
  });
});
