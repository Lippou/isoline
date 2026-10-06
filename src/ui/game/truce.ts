// The world's truce as the client sees it (the same rule as Game.truce / Game.inTruce in
// core/game/state.ts, read from the world view): a peace summit or the World Council's
// ceasefire stops every hostile order between countries (tribes and revolutions are not
// covered) — attacks, landings, bombers, fighters' fire. The interface names it
// and its time left wherever an order would be refused (1.16).
import type { WorldView } from '../../engine/protocol';

export interface Truce {
  reason: 'summit' | 'ceasefire';
  /** Ticks left. */
  left: number;
}

export function truceOf(w: WorldView | null | undefined, tick: number): Truce | null {
  if (!w || w.ceasefireUntil <= tick) return null;
  const summit = w.event?.id === 'peaceSummit' && w.event.until > tick && w.event.until >= w.ceasefireUntil;
  return { reason: summit ? 'summit' : 'ceasefire', left: w.ceasefireUntil - tick };
}

/** Whether a truce covers an order of `a` against `b` (two countries; tribes and rebels never). */
export function truceCovers(players: ReadonlyMap<number, { kind: string }>, a: number, b: number): boolean {
  if (a <= 0 || b <= 0 || a === b) return false;
  const A = players.get(a);
  const B = players.get(b);
  return !!A && !!B && A.kind !== 'tribe' && B.kind !== 'tribe';
}
