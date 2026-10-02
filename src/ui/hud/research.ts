// Research helpers shared by the tech panel, the "research stopped" reminder and the dock.
import type { LocalView } from '../../engine/protocol';
import { NODES, costOf, isAvailable, planGoal, researchPath } from '../../core/rules/tech';

/** The cheapest technology that can be studied right now (-1: none). */
export function cheapestAvailable(levels: ArrayLike<number>): number {
  return planGoal(levels, []);
}

/**
 * Whether research has stopped while it could go on: nothing aimed at, something
 * available, and either a research centre running or enough points banked for the
 * cheapest technology (at the start, with neither, there is nothing to remind yet).
 */
export function researchIdle(L: LocalView | null | undefined, techOn: boolean): boolean {
  if (!techOn || !L || !L.alive || L.researching >= 0 || L.researchQueue.length > 0) return false;
  const next = cheapestAvailable(L.tech);
  if (next < 0) return false;
  return L.research.labLevels > 0 || L.researchPoints >= costOf(L.tech, next);
}

/** Game time to gather `points` more at `rate` points a second, in seconds (Infinity when it never comes). */
export function etaSeconds(points: number, rate: number): number {
  if (points <= 0) return 0;
  return rate > 0 ? Math.ceil(points / rate) : Infinity;
}

/** Whether any technology at all can still be studied. */
export function anyAvailable(levels: ArrayLike<number>): boolean {
  return NODES.some((n) => isAvailable(levels, n.id));
}

export interface PlanStep {
  /** Technology studied at this step. */
  id: number;
  /** Goal (current or queued) this step belongs to. */
  goal: number;
  /** Points this step costs, and the points needed from now up to the end of it. */
  cost: number;
  cum: number;
}

/**
 * Every study planned, in order: the current goal's path, then each queued goal's
 * (prerequisites already covered by an earlier goal are not counted twice; a repeatable
 * goal counts one level).
 */
export function researchPlan(levels: ArrayLike<number>, goals: readonly number[]): PlanStep[] {
  const lv = Array.from({ length: levels.length }, (_, k) => levels[k] ?? 0);
  const out: PlanStep[] = [];
  let cum = 0;
  for (const goal of goals) {
    if (goal < 0) continue;
    for (const id of researchPath(lv, goal)) {
      const cost = costOf(lv, id);
      cum += cost;
      out.push({ id, goal, cost, cum });
      const n = NODES[id]!;
      lv[n.branch] = n.repeat ? lv[n.branch]! + 1 : n.level;
    }
  }
  return out;
}
