// What the Technologies window shows, shared by its layouts (the planche and the ladder):
// the player's levels, the research plan (current goal's path, then the queue's), each
// technology's state, and the orders (research, queue, unqueue, stop).
import { hud } from '../../stores/game.svelte';
import { t, num } from '../../i18n/i18n.svelte';
import type { GameController } from '../../game/controller';
import {
  BRANCHES,
  LEVELS,
  MAX_REPEAT,
  NODES,
  costOf,
  isAvailable,
  isResearched,
  nodeId,
  repeatCount,
  researchPath,
  techKey,
  type TechNode,
  type Unlock,
} from '../../../core/rules/tech';
import { researchPlan, etaSeconds } from '../research';
import type { IconName } from '../../icons/icons';

export const BRANCH_ICON: Record<string, IconName> = {
  economy: 'gold',
  industry: 'factory',
  military: 'war',
  naval: 'warship',
  defense: 'immune',
  nuclear: 'nuke',
};
/** Icons of each branch's technologies, the endless one last. */
const NODE_ICON: Record<string, IconName[]> = {
  economy: ['gold', 'council', 'book', 'globe', 'income', 'trade', 'sparkles'],
  industry: ['train', 'factory', 'airfield', 'settings', 'city', 'network', 'upgrade'],
  military: ['terrain', 'forward', 'sword', 'event', 'users', 'target', 'troops'],
  naval: ['warship', 'target', 'transport', 'port', 'factory', 'tradeRoutes', 'income'],
  defense: ['sam', 'radar', 'upgrade', 'immune', 'siren', 'target', 'eye'],
  nuclear: ['uranium', 'silo', 'nuke', 'collapse', 'bomb', 'factory', 'refresh'],
};
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
export const UNLOCK_ICON: Record<Unlock, IconName> = {
  silo: 'silo',
  atom: 'nuke',
  hydrogen: 'nuke',
  mirv: 'bomb',
  sam: 'sam',
  radar: 'radar',
  airfield: 'airfield',
};

export type TechState = 'done' | 'current' | 'queued' | 'available' | 'locked';

export const branchName = (n: TechNode): string => BRANCHES[n.branch]!;
export const nameOf = (id: number): string => t(`${techKey(id)}.name`);
export const descOf = (id: number): string => t(`${techKey(id)}.desc`);
export const iconOf = (n: TechNode): IconName => NODE_ICON[branchName(n)]![n.level - 1] ?? 'tech';
/** "Industry II": a technology's branch and tier, as its prerequisites are named on the cards. */
export const tierName = (n: TechNode): string =>
  `${t(`tech.${branchName(n)}.title`)} ${n.repeat ? '∞' : ROMAN[n.tier - 1]}`;
/** The previous technology of the same branch (the last regular one for the endless technology). */
export const chainOf = (n: TechNode): number =>
  n.repeat ? nodeId(n.branch, LEVELS) : n.level > 1 ? n.id - 1 : -1;
/** Everything a technology needs: the previous one of its branch, then those of other branches. */
export const prereqs = (n: TechNode): number[] => {
  const c = chainOf(n);
  return [...(c >= 0 ? [c] : []), ...n.requires];
};

export class TechModel {
  private ctl: GameController;
  constructor(ctl: GameController) {
    this.ctl = ctl;
  }

  L = $derived(hud.local);
  levels = $derived(this.L?.tech ?? []);
  target = $derived(this.L?.researching ?? -1);
  queue = $derived(this.L?.researchQueue ?? []);
  goals = $derived(this.target >= 0 ? [this.target, ...this.queue] : [...this.queue]);
  /** Everything planned, in order: the current goal's path, then each queued goal's. */
  plan = $derived(researchPlan(this.levels, this.goals));
  planIds = $derived(this.plan.map((s) => s.id));
  current = $derived(this.target >= 0 ? (this.plan[0]?.id ?? -1) : -1);
  rate = $derived(this.L?.researchRate ?? 0);
  bank = $derived(this.L?.researchPoints ?? 0);
  src = $derived(this.L?.research ?? { base: 0, labs: 0, labLevels: 0, mult: 1 });

  /** The technology pointed at (hovered or keyboard-focused); -1: none. Paint only, never layout. */
  hovered = $state(-1);
  /** The technology the panel was opened on, or chosen by a click. */
  firstOpen = $derived(NODES.find((n) => isAvailable(this.levels, n.id))?.id ?? 0);
  focus = $derived(
    this.hovered >= 0
      ? this.hovered
      : hud.techFocus >= 0
        ? hud.techFocus
        : this.target >= 0
          ? this.target
          : this.firstOpen,
  );
  /** The path to the technology pointed at, when it is not planned already (its steps are numbered as a preview). */
  preview = $derived(this.hovered >= 0 && !this.planIds.includes(this.hovered));
  shown = $derived(this.preview ? researchPath(this.levels, this.hovered) : this.planIds);

  stateOf(id: number): TechState {
    const n = NODES[id]!;
    if (n.repeat ? repeatCount(this.levels, n.branch) >= MAX_REPEAT : isResearched(this.levels, id))
      return 'done';
    if (id === this.current) return 'current';
    if (this.planIds.includes(id)) return 'queued';
    return isAvailable(this.levels, id) ? 'available' : 'locked';
  }
  researched = (id: number): boolean => isResearched(this.levels, id);
  reps = (n: TechNode): number => (n.repeat ? repeatCount(this.levels, n.branch) : 0);
  cost = (id: number): number => costOf(this.levels, id);
  inQueue = (id: number): boolean => this.queue.includes(id);
  /** Order of `id` in the plan (or in the previewed path), 0-based; -1 when not in it. */
  order = (id: number): number => this.shown.indexOf(id);
  path = (id: number): number[] => researchPath(this.levels, id);
  pathCost = (id: number): number => this.path(id).reduce((s, k) => s + costOf(this.levels, k), 0);
  /** Progress of the technology being studied (0…1). */
  progress = (id: number): number => Math.min(1, this.bank / Math.max(1, costOf(this.levels, id)));

  /** Game time to gather `points` more at the current rate. */
  eta(points: number): string {
    const s = etaSeconds(points, this.rate);
    if (s === 0) return t('tech.etaNow');
    if (!Number.isFinite(s)) return '—';
    if (s < 60) return t('tech.etaS', { s });
    const m = Math.floor(s / 60);
    return m >= 10 ? t('tech.etaM', { m }) : t('tech.etaMS', { m, s: String(s % 60).padStart(2, '0') });
  }
  /** Points still needed (bank deducted) to finish the plan up to the end of `goal`. */
  goalEta(goal: number): string {
    const last = this.plan.filter((s) => s.goal === goal).at(-1);
    return last ? this.eta(last.cum - this.bank) : '—';
  }
  /** Where the points come from: the base rate, the research centres, the bonuses. */
  sources = $derived(
    [
      t('tech.srcBase', { n: num(this.src.base, 1) }),
      this.src.labLevels > 0 ? t('tech.srcLabs', { lv: this.src.labLevels, n: num(this.src.labs, 1) }) : '',
      this.src.mult > 1 ? t('tech.srcBonus', { n: Math.round((this.src.mult - 1) * 100) }) : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );

  /** Click: aims research at `id` (its missing prerequisites first); Shift+click: queues it after the current goal. */
  research(id: number, e?: MouseEvent | KeyboardEvent): void {
    if (this.stateOf(id) === 'done') return;
    hud.techFocus = -1;
    if (e?.shiftKey) this.ctl.session.cmd({ t: 'research', tech: id, op: 'queue' });
    else this.ctl.session.cmd({ t: 'research', tech: id });
  }
  enqueue = (id: number): void => this.ctl.session.cmd({ t: 'research', tech: id, op: 'queue' });
  unqueue = (id: number): void => this.ctl.session.cmd({ t: 'research', tech: id, op: 'unqueue' });
  stop = (): void => this.ctl.session.cmd({ t: 'research', tech: -1 });
}
