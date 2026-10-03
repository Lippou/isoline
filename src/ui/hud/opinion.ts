// Wording of a nation's opinion of you (DiplomacyPanel, HoverCard).
import type { OddsFactor } from '../../core/npc/ai';
import { t } from '../i18n/i18n.svelte';

/** A probability as a whole percentage ("45"). */
export const pct = (p: number): string => String(Math.round(p * 100));

/** One line of what weighs on a nation's answer to an alliance offer. */
export function oddsLine(k: OddsFactor, personality: string): string {
  return k === 'temper'
    ? t('opinion.odds.temper', { personality: t(`personality.${personality}`) })
    : t(`opinion.odds.${k}`);
}
