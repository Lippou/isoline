// Glyph of a notice's level (journal, cursor notes…). Never colour alone (BRAND.md §
// "Accessibilité daltonisme"): good, warning and danger news also differ by their sign.
import type { IconName } from '../icons/icons';

export type Level = 'info' | 'good' | 'warn' | 'danger';

export const LEVEL_ICON: Record<Level, IconName | null> = {
  info: null,
  good: 'check',
  warn: 'warning',
  danger: 'siren',
};
