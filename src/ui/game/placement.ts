// The build cursor's label (PlacementTip.svelte): what a click would do, before the click —
// build here (or on the free spot beside, when buildings stand too close), upgrade the
// building there, or why it cannot (outside your land, no coast, too close everywhere
// around, gold short, research missing…). The rules are the simulation's (buildings.ts
// planBuild, answered by the worker's 'placement' query); this only words them.

export interface PlacementInfo {
  error: string;
  cost: number;
  missing: number;
  upgrade: boolean;
  level: number;
  tech: string;
  snapped: boolean;
}

type Tr = (key: string, params?: Record<string, string | number>) => string;

/** Errors that have their own short line beside the cursor. */
const REASONS = new Set([
  'notOwned',
  'notLand',
  'occupied',
  'tooClose',
  'notCoastal',
  'gold',
  'locked',
  'disabled',
  'phase',
  'upgrading',
  'constructing',
]);

/** The label's text and whether the order would go through. */
export function placementText(
  p: PlacementInfo,
  t: Tr,
  money: (v: number) => string,
): { text: string; ok: boolean } {
  if (p.error === 'ok') {
    const cost = money(p.cost);
    if (p.upgrade) return { text: t('place.upgrade', { level: p.level, cost }), ok: true };
    return { text: t(p.snapped ? 'place.snapped' : 'place.build', { cost }), ok: true };
  }
  if (p.error === 'gold') return { text: t('place.gold', { gold: money(p.missing) }), ok: false };
  if (p.error === 'locked')
    return { text: t('place.locked', { tech: p.tech ? t(`${p.tech}.name`) : '' }), ok: false };
  return { text: t(REASONS.has(p.error) ? `place.${p.error}` : 'place.notLand'), ok: false };
}
