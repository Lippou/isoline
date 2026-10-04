// Alliances (request/accept/renew/expire), betrayal, relations, embargoes and donations.
import type { Game } from '../game/state';
import type { Player } from '../game/player';
import {
  ALLIANCE_RENEW_WINDOW,
  ALLIANCE_REQUEST_TTL,
  ALLIANCE_TICKS,
  ATTACK_RELATION,
  GIFT_GOLD_CHUNK,
  GIFT_TROOP_DIVISORS,
  GIFT_TROOP_RELATION,
  RELATION_BETRAYED,
  RELATION_DECAY,
  RELATION_TRAITOR_NEIGHBOR,
  TEMP_EMBARGO_TICKS,
  TRAITOR_DEBUFF_TICKS,
  TRAITOR_EMBARGO_TICKS,
  TRAITOR_MARK_TICKS,
  TRADE_WARMTH_WINDOW,
  WARMTH,
} from '../game/constants';
import { IS_LAND } from '../map/terrain';
import { U } from '../units/unit';

export function requestAlliance(game: Game, from: Player, to: Player): void {
  if (from.id === to.id || !to.alive || to.kind === 'tribe' || from.kind === 'tribe') return;
  if (game.sameTeam(from.id, to.id)) return;
  // Doomsday clock, the last minute: no pact may be signed any more (victory.ts pactsFrozen).
  if (game.config.mode === 'doomsday' && (game.victory.doom?.stage ?? 0) >= 4) {
    game.notify(from.id, 'error.pactsFrozen', 'warn');
    return;
  }
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
  else {
    game.notify(requester.id, 'notify.allianceRefused', 'warn', { by: me.id });
    game.emit({ k: 'allyRefused', from: requester.id, by: me.id, silent: false });
  }
}

function form(game: Game, a: Player, b: Player): void {
  const renew = a.allies.has(b.id);
  const exp = game.tick + ALLIANCE_TICKS;
  a.allies.set(b.id, exp);
  b.allies.set(a.id, exp);
  if (!renew) {
    a.allySince.set(b.id, game.tick);
    b.allySince.set(a.id, game.tick);
  }
  a.allyRequests.delete(b.id);
  b.allyRequests.delete(a.id);
  // Temporary embargoes are lifted and missiles already flying between them are called off.
  a.embargoUntil.delete(b.id);
  b.embargoUntil.delete(a.id);
  for (const u of game.units) {
    if (!u.alive || u.type !== U.Nuke || u.dest < 0) continue;
    const victim = game.owner[u.dest]!;
    if ((u.owner === a.id && victim === b.id) || (u.owner === b.id && victim === a.id)) u.alive = false;
  }
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
  a.allySince.delete(b.id);
  b.allySince.delete(a.id);
  game.emit({ k: 'alliance', a: a.id, b: b.id, on: false });
  if (!silent) {
    game.notify(a.id, 'notify.allianceEnded', 'warn', { with: b.id });
    game.notify(b.id, 'notify.allianceEnded', 'warn', { with: a.id });
  }
}

/** Players owning land next to p's border, by id. */
export function landNeighbors(game: Game, p: Player): number[] {
  const out = new Set<number>();
  const map = game.map;
  const owner = game.owner;
  const nb = new Int32Array(4);
  for (const t of p.border) {
    const n = map.neighbors4(t, nb);
    for (let k = 0; k < n; k++) {
      const o = owner[nb[k]!]!;
      if (o > 0 && o !== p.id && IS_LAND[map.terrain[nb[k]!]!]) out.add(o);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Breaking an alliance, or attacking / nuking an ally: the alliance ends with penalties
 * (none when the other side is inactive or already a traitor itself). As in OpenFront the
 * traitor is marked for 30 s (attacks against it lose ×0.5 and advance ×1/0.8), the victim
 * turns hostile (relation −100) and every other neighbour of the traitor distrustful (−40,
 * not the victim's teammates): nations then refuse its alliances, and allies of the
 * traitor may drop it. Isoline adds a 5-min embargo by the victim and a world announcement.
 */
export function betray(game: Game, traitor: Player, victim: Player): void {
  if (!traitor.allies.has(victim.id)) return;
  breakAlliance(game, traitor, victim, true);
  if (victim.inactive || victim.isTraitor(game.tick)) {
    game.notify(victim.id, 'notify.allianceEnded', 'warn', { with: traitor.id });
    return;
  }
  traitor.traitorUntil = game.tick + TRAITOR_MARK_TICKS;
  traitor.debuffUntil = game.tick + TRAITOR_DEBUFF_TICKS;
  victim.embargoUntil.set(traitor.id, game.tick + TRAITOR_EMBARGO_TICKS);
  traitor.stats.betrayals++;
  victim.betrayedBy.set(traitor.id, game.tick);
  victim.updateRelation(traitor.id, RELATION_BETRAYED, 'betrayed');
  for (const id of landNeighbors(game, traitor)) {
    if (!game.sameTeam(id, victim.id))
      game.players[id]!.updateRelation(traitor.id, RELATION_TRAITOR_NEIGHBOR, 'traitor');
  }
  game.emit({ k: 'betrayal', traitor: traitor.id, victim: victim.id });
  game.notify(-1, 'event.betrayal', 'danger', { traitor: traitor.id, victim: victim.id });
}

/** A country attacked by another stops trading with its attacker for a while. */
export function tempEmbargo(game: Game, attacker: Player, defender: Player): void {
  if (attacker.kind === 'tribe' || defender.kind === 'tribe' || attacker.id === defender.id) return;
  defender.embargoUntil.set(attacker.id, game.tick + TEMP_EMBARGO_TICKS);
}

/** An alliance request `requester` sent to `p` is turned down: p is attacking it. */
function refuseRequest(game: Game, p: Player, requester: Player): void {
  if (!p.allyRequests.delete(requester.id)) return;
  game.notify(requester.id, 'notify.allianceRefused', 'warn', { by: p.id });
  game.emit({ k: 'allyRefused', from: requester.id, by: p.id, silent: false });
}

/**
 * A transport sails for `defender`'s coast (OpenFront's TransportShipExecution.init): an
 * ally is betrayed, and an alliance request it had sent is turned down.
 */
export function navalHostilities(game: Game, attacker: Player, defender: Player): void {
  if (attacker.allies.has(defender.id)) betray(game, attacker, defender);
  refuseRequest(game, attacker, defender);
}

/**
 * An attack actually starts against `defender`, by land or from a landing (OpenFront's
 * AttackExecution.init): an ally is betrayed, the defender stops trading with its attacker
 * for 5 min, its relation drops (−60 / −70 / −80 / −100 by difficulty) and an alliance
 * request it had sent is turned down.
 */
export function openHostilities(game: Game, attacker: Player, defender: Player): void {
  if (attacker.allies.has(defender.id)) betray(game, attacker, defender);
  tempEmbargo(game, attacker, defender);
  defender.updateRelation(attacker.id, ATTACK_RELATION[game.config.difficulty], 'attacked');
  refuseRequest(game, attacker, defender);
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
  // OpenFront: a gift earns goodwill (gold by chunks, troops past a threshold).
  to.updateRelation(from.id, giftRelation(game, to, g, t), 'gift');
  if (g > 0 || t > 0)
    game.notify(to.id, 'notify.donation', 'good', {
      from: from.id,
      gold: Math.round(g),
      troops: Math.round(t),
    });
}

/**
 * Goodwill a gift earns from its recipient (OpenFront's DonateGold/TroopExecution): +5 per
 * chunk of gold (the chunk grows by its size every 5 minutes of play), at most +100; and
 * +50 for troops reaching a random share of the recipient's troop ceiling.
 */
export function giftRelation(game: Game, to: Player, gold: number, troops: number): number {
  const d = game.config.difficulty;
  let r = 0;
  if (gold > 0) {
    const chunk = Math.round(GIFT_GOLD_CHUNK[d] * (1 + game.tick / (ALLIANCE_TICKS + game.startTick)));
    r += Math.min(100, Math.floor(gold / chunk) * 5);
  }
  if (troops > 0) {
    const [lo, hi] = GIFT_TROOP_DIVISORS[d];
    const cap = Math.max(1, to.popCap);
    if (troops >= game.rng.int(Math.floor(cap / lo), Math.floor(cap / hi))) r += GIFT_TROOP_RELATION;
  }
  return r;
}

/** Merchant ships and trains between a and b keep their trade goodwill alive. */
export function noteTrade(game: Game, a: Player, b: Player): void {
  if (a.id === b.id) return;
  a.lastTrade.set(b.id, game.tick);
  b.lastTrade.set(a.id, game.tick);
}

/** Countries each country is fighting right now (land attacks either way, tribes aside). */
export function enemiesOf(game: Game): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const add = (a: number, b: number) => {
    let s = out.get(a);
    if (!s) out.set(a, (s = new Set()));
    s.add(b);
  };
  for (const at of game.attacks) {
    if (at.done || at.target <= 0) continue;
    const a = game.players[at.attacker];
    const b = game.players[at.target];
    if (!a || !b || a.kind === 'tribe' || b.kind === 'tribe') continue;
    add(a.id, b.id);
    add(b.id, a.id);
  }
  return out;
}

/** Whether a and b both fight a third country (and not each other). */
export function commonEnemy(enemies: Map<number, Set<number>>, a: number, b: number): boolean {
  const ea = enemies.get(a);
  const eb = enemies.get(b);
  if (!ea || !eb || ea.has(b)) return false;
  for (const e of ea) if (eb.has(e)) return true;
  return false;
}

/**
 * Isoline's goodwill, once a second (see WARMTH): allies, trade partners and countries
 * fighting a common enemy warm to each other, each up to its own ceiling.
 */
function updateWarmth(game: Game, decay: number): void {
  const enemies = enemiesOf(game);
  const warm = (
    p: Player,
    q: number,
    w: { rate: number; ceiling: number },
    cause: 'ally' | 'trade' | 'enemy',
  ) => {
    const r = p.relation(q);
    if (r >= w.ceiling) return;
    p.updateRelation(q, Math.min(w.ceiling - r, w.rate + (r >= 0 ? decay : 0)), cause);
  };
  for (const p of game.alivePlayers()) {
    if (p.kind === 'tribe') continue;
    for (const id of p.allies.keys()) {
      const since = p.allySince.get(id) ?? game.tick;
      warm(p, id, game.tick - since >= ALLIANCE_TICKS ? WARMTH.longAlly : WARMTH.ally, 'ally');
    }
    for (const [id, last] of p.lastTrade) {
      if (game.tick - last > TRADE_WARMTH_WINDOW || !game.players[id]?.alive) p.lastTrade.delete(id);
      else warm(p, id, WARMTH.trade, 'trade');
    }
    const mine = enemies.get(p.id);
    if (!mine) continue;
    for (const [id] of enemies) {
      if (id !== p.id && commonEnemy(enemies, p.id, id)) warm(p, id, WARMTH.enemy, 'enemy');
    }
  }
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
    for (const [id, exp] of p.allyRequests)
      if (exp <= game.tick) {
        // Left unanswered: the requester learns it lapsed (a refusal without a word).
        p.allyRequests.delete(id);
        const q = game.players[id];
        if (q?.alive && p.alive) {
          game.notify(id, 'notify.allianceLapsed', 'warn', { by: p.id });
          game.emit({ k: 'allyRefused', from: id, by: p.id, silent: true });
        }
      }
    for (const [id, exp] of p.embargoUntil) if (exp <= game.tick) p.embargoUntil.delete(id);
    // Relations ease back to neutral (OpenFront: 0.05 a tick).
    p.decayRelations(RELATION_DECAY * 10);
  }
  updateWarmth(game, RELATION_DECAY * 10);
}
