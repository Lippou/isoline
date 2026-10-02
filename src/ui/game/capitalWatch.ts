// Capital and threatened-border news for the HUD: the war horn and the capital card
// when our capital falls, the conqueror's sting, and a brief in the journal's
// « Vigilance » section plus a discreet toast when a neighbour masses an army on our
// border (view-only intelligence from the worker, throttled per neighbour).
import type { GameEvent } from '../../core/game/events';
import type { ClientState } from '../../engine/clientState';
import type { Session } from '../../engine/session';
import { capitalSpotError, type CapitalSpotError } from '../../core/rules/capital';
import { hud, toast, subtitle } from '../stores/game.svelte';
import { settings } from '../stores/settings.svelte';
import { t, i18n } from '../i18n/i18n.svelte';
import { audio } from '../../audio/audio';

/** The same neighbour makes the news at most once per 4 minutes of game time. */
export const THREAT_ALERT_GAP = 2400;

/** Client preview of the capital placement rule (the simulation decides). */
export function clientSpotError(st: ClientState, viewer: number, tile: number): CapitalSpotError {
  const me = st.players.get(viewer);
  const friendly = (o: number) =>
    !!me && (me.allies.includes(o) || (me.team > 0 && st.players.get(o)?.team === me.team));
  return capitalSpotError(st, tile, viewer, friendly);
}

/** "2.3" / "2,3": a troop ratio in the reader's language. */
export function ratioText(r: number): string {
  return r.toLocaleString(i18n.lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 });
}

export class CapitalWatch {
  /** Threats on screen at the last tick (a new one makes the news). */
  private seen = new Set<number>();
  private lastAlert = new Map<number, number>();

  constructor(private readonly session: Session) {}

  /** Broadcast notices we get a personal version of (our own capital, taken or lost). */
  skip(e: Extract<GameEvent, { k: 'notify' }>, me: number): boolean {
    if (e.key !== 'event.capitalFell' && e.key !== 'event.capitalRazed') return false;
    return e.params?.player === me || e.params?.by === me;
  }

  event(e: GameEvent, me: number): void {
    if (e.k === 'capitalLost') {
      if (e.player === me) {
        audio.sfx('warHorn', 0.85);
        if (settings.access.subtitles) subtitle(t('subtitle.capitalLost'));
      } else if (e.by === me) {
        audio.sfx('conquest', 0.7);
        if (settings.access.subtitles) subtitle(t('subtitle.capitalTaken'));
      }
    } else if (e.k === 'capitalMoved' && e.player === me) {
      if (hud.tool.k === 'capital') hud.tool = { k: 'none' };
    }
  }

  /** Every tick: a threat appearing on one of our borders makes a brief and a toast. */
  tick(tick: number): void {
    const st = this.session.state;
    const L = st.local;
    if (!L || !L.alive || this.session.viewer <= 0) {
      this.seen.clear();
      return;
    }
    const now = new Set<number>();
    for (const th of L.threats ?? []) {
      // Already fighting us: the war (red border, fronts) says it all.
      if (L.wars.includes(th.id)) continue;
      now.add(th.id);
      if (this.seen.has(th.id)) continue;
      const last = this.lastAlert.get(th.id);
      if (last !== undefined && last <= tick && tick - last < THREAT_ALERT_GAP) continue;
      this.lastAlert.set(th.id, tick);
      const tile = Math.floor(th.y) * st.width + Math.floor(th.x);
      const text = t('notify.threat', {
        player: st.name(th.id, i18n.lang),
        ratio: ratioText(th.ratio),
        why: t(`threat.why.${th.why}`),
      });
      hud.log = [
        ...hud.log.slice(-199),
        {
          tick,
          text,
          level: 'warn',
          key: 'notify.threat',
          params: { player: th.id, ratio: th.ratio, why: th.why },
          tile,
        },
      ];
      toast(text, 'warn', tile);
    }
    this.seen = now;
  }
}
