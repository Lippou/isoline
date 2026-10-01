// Alliances (request/accept/renew/expire), betrayal, embargoes and donations.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  ALLIANCE_RENEW_WINDOW,
  ALLIANCE_REQUEST_TTL,
  ALLIANCE_TICKS,
  TRAITOR_DEBUFF_TICKS,
  TRAITOR_EMBARGO_TICKS,
  TRAITOR_MARK_TICKS,
} from '../game/constants';

export function requestAlliance(game: Game, from: Player, to: Player): void {
  if (from.id === to.id || !to.alive || to.kind === 'tribe' || from.kind === 'tribe') return;
  if (game.sameTeam(from.id, to.id)) return;
  const exp = from.allies.get(to.id);
  if (exp !== undefined) {
    // Renewal: only inside the renewal window; both sides must ask.
    if (exp - game.tick > ALLIANCE_RENEW_WINDOW) return;
    if (from.allyRequests.has(to.id)) {
      form(game, from, to);
      return;
    }
    to.allyRequests.set(from.id, game.tick + ALLIANCE_REQUEST_TTL);
    game.notify(to.id, 'notify.renewRequest', 'info', { from: from.id });
    return;
  }
  if (from.allyRequests.has(to.id)) {
    // Crossing requests = accept.
    form(game, from, to);
    return;
  }
  to.allyRequests.set(from.id, game.tick + ALLIANCE_REQUEST_TTL);
  game.notify(to.id, 'notify.allianceRequest', 'info', { from: from.id });
}

export function answerAlliance(game: Game, me: Player, requester: Player, accept: boolean): void {
  if (!me.allyRequests.has(requester.id)) return;
  me.allyRequests.delete(requester.id);
  if (accept && requester.alive) form(game, me, requester);
  else game.notify(requester.id, 'notify.allianceRefused', 'warn', { by: me.id });
}

function form(game: Game, a: Player, b: Player): void {
  const renew = a.allies.has(b.id);
  const exp = game.tick + ALLIANCE_TICKS;
  a.allies.set(b.id, exp);
  b.allies.set(a.id, exp);
  a.allyRequests.delete(b.id);
  b.allyRequests.delete(a.id);
  // Allies stop fighting each other.
  for (const at of game.attacks) {
    if ((at.attacker === a.id && at.target === b.id) || (at.attacker === b.id && at.target === a.id)) {
      game.players[at.attacker]!.troops += at.troops;
      at.troops = 0;
      at.done = true;
    }
  }
  game.emit({ k: 'alliance', a: a.id, b: b.id, on: true });
  game.notify(a.id, renew ? 'notify.allianceRenewed' : 'notify.allianceFormed', 'good', { with: b.id });
  game.notify(b.id, renew ? 'notify.allianceRenewed' : 'notify.allianceFormed', 'good', { with: a.id });
}

export function breakAlliance(game: Game, a: Player, b: Player, silent = false): void {
  if (!a.allies.has(b.id)) return;
  a.allies.delete(b.id);
  b.allies.delete(a.id);
  game.emit({ k: 'alliance', a: a.id, b: b.id, on: false });
  if (!silent) {
    game.notify(a.id, 'notify.allianceEnded', 'warn', { with: b.id });
    game.notify(b.id, 'notify.allianceEnded', 'warn', { with: a.id });
  }
}

/** Attacking (or nuking) an ally: break the alliance with penalties (none against inactive players). */
export function betray(game: Game, traitor: Player, victim: Player): void {
  if (!traitor.allies.has(victim.id)) return;
  breakAlliance(game, traitor, victim, true);
  if (victim.inactive) return;
  traitor.traitorUntil = game.tick + TRAITOR_MARK_TICKS;
  traitor.debuffUntil = game.tick + TRAITOR_DEBUFF_TICKS;
  victim.embargoUntil.set(traitor.id, game.tick + TRAITOR_EMBARGO_TICKS);
  traitor.stats.betrayals++;
  victim.betrayedBy.set(traitor.id, game.tick);
  game.emit({ k: 'betrayal', traitor: traitor.id, victim: victim.id });
  game.notify(-1, 'event.betrayal', 'danger', { traitor: traitor.id, victim: victim.id });
}

export function setEmbargo(game: Game, p: Player, target: Player, on: boolean): void {
  if (p.id === target.id) return;
  if (on) p.embargo.add(target.id);
  else p.embargo.delete(target.id);
  game.notify(target.id, on ? 'notify.embargoOn' : 'notify.embargoOff', on ? 'warn' : 'info', { by: p.id });
}

export function setEmbargoAll(game: Game, p: Player, on: boolean, exceptTeam: boolean): void {
  for (const q of game.alivePlayers()) {
    if (q.id === p.id || q.kind === 'tribe') continue;
    if (on && exceptTeam && game.sameTeam(p.id, q.id)) {
      p.embargo.delete(q.id);
      continue;
    }
    if (on) p.embargo.add(q.id);
    else p.embargo.delete(q.id);
  }
}

export function donate(game: Game, from: Player, to: Player, gold: number, troops: number): void {
  if (!game.config.allowDonations || !to.alive || from.id === to.id) return;
  if (!from.allies.has(to.id) && !game.sameTeam(from.id, to.id)) return;
  const g = Math.max(0, Math.min(gold, from.gold));
  const t = Math.max(0, Math.min(troops, from.troops));
  from.gold -= g;
  to.gold += g;
  from.troops -= t;
  to.troops += t;
  if (g > 0 || t > 0)
    game.notify(to.id, 'notify.donation', 'good', {
      from: from.id,
      gold: Math.round(g),
      troops: Math.round(t),
    });
}

export function updateDiplomacy(game: Game): void {
  if (game.tick % 10 !== 0) return;
  for (const p of game.alivePlayers()) {
    for (const [id, exp] of p.allies) {
      const q = game.players[id]!;
      if (!q.alive) {
        p.allies.delete(id);
        continue;
      }
      if (exp <= game.tick) {
        // Expiry without penalty.
        breakAlliance(game, p, q);
      } else if (exp - game.tick === ALLIANCE_RENEW_WINDOW - (ALLIANCE_RENEW_WINDOW % 10) && p.id < q.id) {
        game.notify(p.id, 'notify.allianceExpiring', 'info', { with: q.id });
        game.notify(q.id, 'notify.allianceExpiring', 'info', { with: p.id });
      }
    }
    for (const [id, exp] of p.allyRequests) if (exp <= game.tick) p.allyRequests.delete(id);
    for (const [id, exp] of p.embargoUntil) if (exp <= game.tick) p.embargoUntil.delete(id);
  }
}
