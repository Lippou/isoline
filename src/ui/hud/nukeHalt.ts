// What stops every silo right now, as the HUD shows it: the World Council's nuclear ban or a
// peace summit (the same rule as nuclearHalt in core/units/nukes.ts, read from the world view).
import type { WorldView } from '../../engine/protocol';
import type { IconName } from '../icons/icons';
import { t, clock } from '../i18n/i18n.svelte';

export interface NukeHalt {
  reason: 'ban' | 'summit';
  /** Ticks left before launches are free again (of the longer of the two, when both hold). */
  left: number;
}

export function nukeHalt(w: WorldView | null | undefined, tick: number): NukeHalt | null {
  if (!w) return null;
  const ban = Math.max(0, w.nukeBanUntil - tick);
  const summit = w.event?.id === 'peaceSummit' ? Math.max(0, w.event.until - tick) : 0;
  if (ban <= 0 && summit <= 0) return null;
  return ban >= summit ? { reason: 'ban', left: ban } : { reason: 'summit', left: summit };
}

/** The tooltip naming who forbids the launch, and for how long. */
export const haltTip = (h: NukeHalt): string =>
  t(h.reason === 'ban' ? 'ban.tip' : 'ban.summitTip', { clock: clock(h.left) });
/** The short hint on a button or a menu entry. */
export const haltShort = (h: NukeHalt): string =>
  t(h.reason === 'ban' ? 'ban.short' : 'ban.summitShort', { clock: clock(h.left) });
/** The heading of the launch panel's notice. */
export const haltKicker = (h: NukeHalt): string => t(h.reason === 'ban' ? 'ban.kicker' : 'ban.summitKicker');
/** The verdict under the cursor while aiming. */
export const haltVerdict = (h: NukeHalt): string => t(h.reason === 'ban' ? 'launch.banned' : 'launch.summit');
export const haltIcon = (h: NukeHalt): IconName => (h.reason === 'ban' ? 'embargo' : 'ceasefire');
