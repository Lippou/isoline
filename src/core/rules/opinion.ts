// What a nation thinks of a player (view only: read from the simulation, never part of it).
// The opinion is OpenFront's relation (−100 … 100, easing back to 0) with its breakdown by
// cause, and the odds that the nation accepts an alliance offer sent now.
import type { Game } from '../game/state';
import type { Player, RelationCause } from '../game/player';
import { ALLIANCE_TICKS, RELATION_HOSTILE } from '../game/constants';
import { allianceOdds, type OddsFactor } from '../npc/ai';

/** OpenFront's bands (Hostile < −50, Distrustful < 0, Neutral, Friendly ≥ 50), Neutral split at 20. */
export type OpinionLevel = 'hostile' | 'wary' | 'neutral' | 'cordial' | 'friendly';
export const OPINION_CORDIAL = 20;
export const OPINION_FRIENDLY = 50;

/** A cause as told to the player: the alliance reads differently while it lasts, and after. */
export type OpinionReason = Exclude<RelationCause, 'ally'> | 'ally' | 'longAlly' | 'formerAlly';

export interface Opinion {
  /** The nation. */
  id: number;
  /** Its relation towards the viewer, rounded (a resentment never shows as 0). */
  value: number;
  level: OpinionLevel;
  /** Causes and their share of the value (rounded points, largest first, at most 4). */
  reasons: [OpinionReason, number][];
  /** Chance (0…1) that an alliance offer sent now is accepted; -1: no offer possible. */
  accept: number;
  /** What weighs on that answer (probability shares) and a refusal that overrides them. */
  odds: [OddsFactor, number][];
  refusal: 'resent' | 'traitor' | null;
}

export function opinionLevel(r: number): OpinionLevel {
  if (r < RELATION_HOSTILE) return 'hostile';
  if (r < 0) return 'wary';
  if (r < OPINION_CORDIAL) return 'neutral';
  if (r < OPINION_FRIENDLY) return 'cordial';
  return 'friendly';
}

/** Rounded for display, without turning a slight resentment (or goodwill) into a plain 0. */
export function roundRelation(r: number): number {
  if (r < 0) return Math.min(-1, Math.round(r));
  if (r > 0) return Math.max(1, Math.round(r));
  return 0;
}

export function opinionOf(game: Game, nation: Player, viewer: Player): Opinion {
  const r = nation.relation(viewer.id);
  const reasons: [OpinionReason, number][] = [];
  const causes = nation.relationCauses.get(viewer.id) ?? {};
  for (const [k, v] of Object.entries(causes) as [RelationCause, number][]) {
    if (Math.abs(v) < 0.5) continue;
    const w = roundRelation(v);
    let reason: OpinionReason = k;
    if (k === 'ally') {
      const since = nation.allySince.get(viewer.id);
      reason = since === undefined ? 'formerAlly' : game.tick - since >= ALLIANCE_TICKS ? 'longAlly' : 'ally';
    }
    reasons.push([reason, w]);
  }
  reasons.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1));
  const canOffer =
    nation.kind === 'nation' &&
    nation.alive &&
    viewer.alive &&
    !nation.allies.has(viewer.id) &&
    !game.sameTeam(nation.id, viewer.id);
  const odds = canOffer ? allianceOdds(game, nation, viewer) : null;
  return {
    id: nation.id,
    value: roundRelation(r),
    level: opinionLevel(r),
    reasons: reasons.slice(0, 4),
    accept: odds ? odds.chance : -1,
    odds: odds ? odds.factors : [],
    refusal: odds ? odds.refusal : null,
  };
}

/** The opinion of every living nation about `viewer` (by id). */
export function opinionsOf(game: Game, viewer: Player): Opinion[] {
  const out: Opinion[] = [];
  for (const p of game.players) {
    if (!p || !p.alive || p.kind !== 'nation' || p.id === viewer.id) continue;
    out.push(opinionOf(game, p, viewer));
  }
  return out;
}
