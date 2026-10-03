// « Reprendre d'ici »: a replay's state handed over to a local player, who carries on
// from that exact moment in a new solo game.
import type { Snapshot } from './snapshot';

export interface Takeover {
  snapshot: Snapshot;
  /**
   * Whether seats changed hands (another country than the only human of the recorded
   * game): the old commands then no longer replay from tick 0, so the new game's replay
   * starts from this snapshot.
   */
  changed: boolean;
}

type RawPlayer = { id: number; kind: string; alive: boolean; inactive?: boolean } & Record<string, unknown>;

/**
 * The snapshot with `player` as the local human and every other human seat handed to
 * the AI (a nation of the same country). Null when `player` cannot be played: it does
 * not exist, it has fallen or it is a tribe.
 */
export function takeOverSnapshot(snap: Snapshot, player: number): Takeover | null {
  const chosen = snap.players[player] as RawPlayer | null | undefined;
  if (!chosen || !chosen.alive || chosen.kind === 'tribe') return null;
  let changed = false;
  const players = snap.players.map((raw) => {
    if (!raw) return raw;
    const p = raw as RawPlayer;
    if (p.id === player) {
      if (p.kind === 'human' && !p.inactive) return p;
      changed ||= p.kind !== 'human';
      return { ...p, kind: 'human', inactive: false };
    }
    if (p.kind !== 'human') return p;
    changed = true;
    return { ...p, kind: 'nation', inactive: false };
  });
  return { snapshot: { ...snap, players }, changed };
}
