// On-screen sizes of the map markers, shared by the renderer, the capital layer and the
// pointer hit-tests (so what you see is what you hover).
import { B } from '../core/game/constants';

/** Diameter (px) of a building badge at zoom `z`: never under 24 px, growing gently to 36. */
export function badgePx(z: number, ui = 1): number {
  return Math.max(24, Math.min(36, 22 + z * 1.5)) * ui;
}

/** Diameter (px) of a capital star: always a size above the building badges. */
export function capitalPx(z: number, ui = 1): number {
  return Math.max(28, Math.min(42, 26 + z * 1.8)) * ui;
}

/**
 * Decluttering rank of a building badge (higher wins a contested spot): the viewer's own
 * first, then cities, then the strategic sites, defence posts last; levels break ties.
 */
export function badgePriority(type: number, level: number, own: boolean): number {
  const base =
    type === B.City
      ? 90
      : type === B.Silo
        ? 80
        : type === B.Port
          ? 75
          : type === B.Sam
            ? 70
            : type === B.Airfield
              ? 62
              : type === B.Lab
                ? 60
                : type === B.Factory
                  ? 55
                  : type === B.Radar
                    ? 50
                    : 30;
  return (own ? 1000 : 0) + base + Math.min(9, level);
}

/**
 * Least distance between two badge centres, in badge diameters, at zoom `z`: room for the
 * map when zoomed out (1.9 under z 0.8), easing to 0.85 (barely touching) from z 2.
 */
export function badgeSpacing(z: number): number {
  const f = Math.max(0, Math.min(1, (z - 0.8) / 1.2));
  return 1.9 + (0.85 - 1.9) * f;
}

/** Types still drawn when zoomed far out (z below MINOR_BADGE_ZOOM): the rest wait. */
export function majorBuilding(type: number): boolean {
  return type === B.City || type === B.Port || type === B.Silo || type === B.Sam;
}

/** Below this zoom only the major buildings are drawn (plus the build-bar filter's). */
export const MINOR_BADGE_ZOOM = 1.1;
/** Below this zoom defence posts are hidden (they come in clusters along fronts). */
export const DEFENSE_BADGE_ZOOM = 2;
