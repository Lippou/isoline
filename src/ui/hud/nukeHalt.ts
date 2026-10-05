// What stops every silo right now, as the HUD shows it: the World Council's nuclear ban or a
// peace summit (the same rule as nuclearHalt in core/units/nukes.ts, read from the world view).
import type { WorldView } from '../../engine/protocol';
import type { IconName } from '../icons/icons';
import { t, clock } from '../i18n/i18n.svelte';
import type { Truce } from '../game/truce';

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

/**
 * The world's truce (ui/game/truce.ts) refusing an order, named with its time left (1.16):
 * « Sommet de la paix : aucun bombardement pendant encore 0:42 ». `act` words the order
 * (refusedAct.*).
 */
export const truceText = (tr: Truce, act: string): string =>
  t(`truce.${tr.reason}`, { act: t(`refusedAct.${act}`), clock: clock(tr.left) });
/** The short hint on a menu entry: « Sommet · 0:42 ». */
export const truceShort = (tr: Truce): string => t(`truce.${tr.reason}Short`, { clock: clock(tr.left) });
