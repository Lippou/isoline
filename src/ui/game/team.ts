// Teammates as the interface sees them (1.11.0). In team games (teams, humans vs nations)
// the members of a team are allies for good: the simulation already treats them so
// (Game.friendly / sameTeam: no attack, no landing, no bomb, donations, shared sight,
// trade), and the interface follows — no attack offered, no pact to sign, renew or break,
// gifts at hand. They are not entries of the alliance list (no expiry, nothing to renew).
import type { PlayerView } from '../../engine/protocol';

type Players = ReadonlyMap<number, PlayerView>;

/** Whether `id` is a teammate of `viewer` (same team > 0, the viewer aside). */
export function isTeammate(players: Players, viewer: number, id: number): boolean {
  if (id <= 0 || viewer <= 0 || id === viewer) return false;
  const me = players.get(viewer);
  return !!me && me.team > 0 && players.get(id)?.team === me.team;
}

/** The viewer's living teammates (team games), largest first. */
export function teammatesOf(players: readonly PlayerView[], viewer: number): PlayerView[] {
  const me = players.find((p) => p.id === viewer);
  if (!me || me.team <= 0) return [];
  return players
    .filter((p) => p.id !== viewer && p.alive && p.team === me.team)
    .sort((a, b) => b.tiles - a.tiles);
}
