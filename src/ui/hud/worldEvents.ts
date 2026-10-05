// World events as the HUD shows them (GAME_DESIGN.md §12): one glyph each (the chip, the
// Flash info, the map's zone), whether the news is good, and what the event under way forbids
// right now (the buttons it greys, with the reason), read from the world view. Pure: no i18n here.
import type { WorldView } from '../../engine/protocol';
import type { IconName } from '../icons/icons';
import {
  GOOD_WORLD_EVENTS,
  MUTINY_CAP,
  segmentDistance,
  type WorldEventId,
} from '../../core/rules/worldEvents';

export const EVENT_ICON: Record<WorldEventId, IconName> = {
  crisis: 'crisis',
  pandemic: 'pandemic',
  boom: 'income',
  solarStorm: 'solarStorm',
  peaceSummit: 'ceasefire',
  earthquake: 'earthquake',
  volcano: 'volcano',
  hurricane: 'hurricane',
  harshWinter: 'harshWinter',
  oilShock: 'oilShock',
  mutiny: 'mutiny',
  armsRace: 'armsRace',
  railStrike: 'railStrike',
  breakthrough: 'breakthrough',
  publicWorks: 'publicWorks',
  worldGames: 'worldGames',
};

export const eventIcon = (id: string): IconName => EVENT_ICON[id as WorldEventId] ?? 'event';

/** Good news for everybody (the chip and the journal print it as such). */
export const GOOD_EVENTS = GOOD_WORLD_EVENTS;

/** The event under way (and the ticks it has left), null when there is none. */
export function activeEvent(
  w: WorldView | null | undefined,
  tick: number,
): { id: WorldEventId; left: number; x: number; y: number; r: number } | null {
  const e = w?.event;
  if (!e || e.until <= tick) return null;
  return { id: e.id as WorldEventId, left: e.until - tick, x: e.x ?? 0, y: e.y ?? 0, r: e.r ?? 0 };
}

/** What a world event stops right now, as a button or a verdict shows it. */
export interface EventBlock {
  id: WorldEventId;
  left: number;
}

/** A hurricane: no warship can be launched (ports closed). */
export function portsBlock(w: WorldView | null | undefined, tick: number): EventBlock | null {
  const e = activeEvent(w, tick);
  return e && e.id === 'hurricane' ? { id: e.id, left: e.left } : null;
}

/** Mutinies: the share of the army an order may commit (1: no limit). */
export function attackCapOf(w: WorldView | null | undefined, tick: number): number {
  return activeEvent(w, tick)?.id === 'mutiny' ? MUTINY_CAP : 1;
}

/** A volcanic eruption: whether a flight from (ax, ay) to (bx, by) crosses the ash cloud. */
export function ashOnRoute(
  w: WorldView | null | undefined,
  tick: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const e = activeEvent(w, tick);
  return !!e && e.id === 'volcano' && e.r > 0 && segmentDistance(e.x, e.y, ax, ay, bx, by) <= e.r;
}
