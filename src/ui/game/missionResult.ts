// The campaign's result, as the end of a mission hands it to the final edition: the
// « Communiqué de mission » (page 1 of the paper), then the results page (page 2).
//
// How to end a mission (campaign director, or anything that drives a mission):
//
//   void ctl.endMission({
//     id: 'm2',
//     title: t('campaign.m2.title'),
//     success: true,
//     stars: 2,
//     objectives: [
//       { text: t('campaign.m2.main'), done: true, star: true },
//       { text: t('end.mission.par', { time: '20:00' }), done: false, star: true },
//       { text: t('campaign.m2.bonus'), done: true, star: true, bonus: true },
//     ],
//     debrief: t('campaign.m2.outro'),
//     speaker: t('campaign.advisor'),
//     index: 2,
//     total: 6,
//     next: { id: 'm3', title: t('campaign.m3.title') },
//   });
//
// The controller fetches the final statistics, opens the paper on the communiqué and
// sets the victory / defeat music. Every text is already translated by the caller (the
// language does not change while the paper is open in a mission). The buttons are
// handled by the paper: « Mission suivante » starts `next.id` (or calls `onNext`),
// « Recommencer » starts `id` again (or calls `onRetry`), « Campagne » goes back to the
// campaign screen.

export interface MissionObjective {
  /** The objective, translated ("Contrôler 15 % des terres"). */
  text: string;
  done: boolean;
  /** Earns a star (printed with a star instead of a bullet). */
  star?: boolean;
  /** The optional objective (printed as "Bonus"). */
  bonus?: boolean;
  /** A short measure next to it, translated ("12:40 sur 15:00", "3 / 5"). */
  detail?: string;
}

export interface MissionResult {
  /** Mission id (the campaign's own; used by « Recommencer »). */
  id: string;
  /** Mission name, translated ("Tenir la ligne"). */
  title: string;
  success: boolean;
  /** Stars earned (0 on a failure). */
  stars: number;
  /** Stars a mission can earn (default 3). */
  maxStars?: number;
  /** Best stars ever earned on this mission, this result included (optional). */
  best?: number;
  objectives: MissionObjective[];
  /** The advisor's debrief (outro or failure line), translated. */
  debrief?: string;
  /** Who signs the debrief ("Conseillère Ilse"). */
  speaker?: string;
  /** Mission number and count, for "Mission 2 sur 6" (optional). */
  index?: number;
  total?: number;
  /** The mission this result unlocks (null or absent: none, or the last one). */
  next?: { id: string; title: string } | null;
  /**
   * The same result with its texts in the current language: called again when the
   * reader changes language while the paper is open (optional; without it, the texts
   * stay as given).
   */
  localize?: () => MissionResult;
  /** Replace the default actions (start `next.id` / start `id` again) if needed. */
  onNext?: () => void;
  onRetry?: () => void;
}
