// Applies one player command to the game, validating it against the state
// (ownership, gold, ranges, phase). Invalid commands are ignored.
import type { Game } from './state';
import type { Command } from '../net/commands';
import { isWellFormed } from '../net/commands';
import { handleSpawnCommand } from './spawn';
import { attackSlotFree, cancelAttack, hasFrontier, launchAttack } from '../rules/combat';
import { IS_LAND } from '../map/terrain';
import {
  B,
  BUILDING_COUNT,
  CAPITAL_MOVE_COST,
  LINE_MAX_PER_PLAYER,
  MAX_ATTACKS_PER_PLAYER,
  N,
} from './constants';
import { LineKind, lineStrength, lineTarget, placeLine, removeLine, setLineTroops } from '../rules/lines';
import type { Refusal } from './state';
import {
  cancelDemolition,
  demolishBuilding,
  placeBuilding,
  planBuild,
  upgradeBuilding,
} from '../buildings/buildings';
import { buildWarship, launchBoat, orderShips, retreatTransport, warshipError } from '../units/ships';
import { launchNukes, nuclearHalt, nukeError } from '../units/nukes';
import { bomberAim, launchAircraft, planAircraft } from '../units/air';
import {
  answerAlliance,
  betray,
  donate,
  openHostilities,
  requestAlliance,
  setEmbargo,
  setEmbargoAll,
} from '../rules/diplomacy';
import { castVote, generalError, useGeneral } from '../rules/features';
import { continueAfterVictory } from '../rules/victory';
import { airLock, nukeLock, setResearch, techKey } from '../rules/tech';
import { capitalCooldown, moveCapital } from '../rules/capital';
import type { A } from './constants';

const REFUSALS = new Set<string>(['phase', 'self', 'team', 'gone', 'immune', 'summit', 'ceasefire', 'ally']);
/** Whether an order's error code is one of Game.attackRefusal's (worded by Game.refuse). */
export const isRefusal = (code: string): code is Refusal => REFUSALS.has(code);

/** The world event under way: its time left (a refusal it causes names it: ash, hurricane). */
const eventLeft = (game: Game): { left: number } => ({
  left: Math.max(0, (game.features.event?.until ?? game.tick) - game.tick),
});

const NB4 = new Int32Array(4);

/** Whether `tile` touches land of `pid` (4 neighbours). */
function touches(game: Game, pid: number, tile: number): boolean {
  const n = game.map.neighbors4(tile, NB4);
  for (let k = 0; k < n; k++) if (game.owner[NB4[k]!] === pid) return true;
  return false;
}

/**
 * A traced stretch of border (an offensive line's assault, 1.21): of the tiles given, those
 * of another owner touching our land; the owner most of them belong to, and its tiles there.
 */
function sectorAim(
  game: Game,
  pid: number,
  tiles: readonly number[],
): { target: number; tile: number; focus: number[] } | null {
  const count = new Map<number, number[]>();
  for (const t of tiles) {
    if (t < 0 || t >= game.map.size || !IS_LAND[game.map.terrain[t]!] || game.isDead(t)) continue;
    const o = game.owner[t]!;
    if (o === pid || !touches(game, pid, t)) continue;
    const list = count.get(o);
    if (list) list.push(t);
    else count.set(o, [t]);
  }
  let best: { target: number; tile: number; focus: number[] } | null = null;
  for (const [o, list] of count)
    if (!best || list.length > best.focus.length) best = { target: o, tile: list[0]!, focus: list };
  return best;
}

/** A country's whole border with us (an offensive line's assault aimed by a click, 1.21). */
function borderAim(game: Game, pid: number, target: number): { target: number; tile: number } | null {
  const p = game.players[pid];
  if (!p || target === pid) return null;
  for (const b of p.border) {
    const n = game.map.neighbors4(b, NB4);
    for (let k = 0; k < n; k++) {
      const v = NB4[k]!;
      if (game.owner[v] === target && IS_LAND[game.map.terrain[v]!] && !game.isDead(v))
        return { target, tile: v };
    }
  }
  return null;
}

export function applyCommand(game: Game, pid: number, c: Command): void {
  if (!isWellFormed(c)) return;
  const p = game.player(pid);
  if (!p) return;
  if (c.t === 'setInactive') {
    p.inactive = c.inactive;
    return;
  }
  if (c.t === 'continue') {
    // Any human, even one eliminated, may resume a finished match.
    if (p.kind === 'human') continueAfterVictory(game, p.id);
    return;
  }
  if (!p.alive && c.t !== 'emoji' && c.t !== 'quick' && c.t !== 'ping') return;
  const inMap = (t: number) => t >= 0 && t < game.map.size;

  switch (c.t) {
    case 'spawn':
      if (inMap(c.tile)) handleSpawnCommand(game, p, c.tile);
      return;

    case 'attack': {
      // A land attack needs a shared land border (OpenFront's canAttack): a country across
      // the sea is reached with the explicit 'boat' command, never by this one. Nothing
      // (betrayal, embargo, relations) happens unless the attack really starts.
      if (!inMap(c.tile) || game.phase !== 'playing') return;
      if (!IS_LAND[game.map.terrain[c.tile]!] || game.isDead(c.tile)) return;
      const target = game.owner[c.tile]!;
      if (target === p.id) return;
      // Refused: the real reason (1.16) — a truce and its time left, an immunity, a teammate.
      const why = game.attackRefusal(p.id, target, true);
      if (why) {
        game.refuse(p.id, 'attack', why);
        return;
      }
      if (!attackSlotFree(game, p.id, target)) {
        game.notify(p.id, 'error.attackSlots', 'warn', { n: MAX_ATTACKS_PER_PLAYER });
        return;
      }
      if (!hasFrontier(game, p, target, c.tile)) {
        game.notify(p.id, 'error.noFrontier', 'warn');
        return;
      }
      const troops = p.troops * c.ratio;
      if (troops < 1) return;
      if (target > 0) openHostilities(game, p, game.players[target]!);
      p.troops -= troops;
      launchAttack(game, p.id, target, troops);
      return;
    }

    case 'boat': {
      // Betrayal and refused requests happen in launchBoat, only once a transport sails.
      if (!inMap(c.tile)) return;
      const res = launchBoat(game, p, c.tile, c.ratio);
      if (res === 'ok') return;
      if (isRefusal(res)) game.refuse(p.id, 'boat', res);
      else game.notify(p.id, `error.boat.${res}`, 'warn');
      return;
    }

    case 'cancelAttack': {
      const a = game.attacks.find((x) => x.id === c.id && x.attacker === p.id);
      if (a) cancelAttack(game, a);
      return;
    }

    case 'boatRetreat':
      retreatTransport(game, p, c.id);
      return;

    case 'line': {
      const res = placeLine(game, p, c.kind as LineKind, c.pts, c.side as 1 | -1, c.ratio);
      if (typeof res === 'string') game.notify(p.id, `error.line.${res}`, 'warn', { n: LINE_MAX_PER_PLAYER });
      return;
    }

    case 'lineRemove': {
      const l = game.lines.find((x) => x.id === c.id && x.owner === p.id);
      if (l) removeLine(game, l, true);
      return;
    }

    case 'lineLaunch': {
      // The troops that waited on an offensive line go over the top (1.20): the line empties
      // into an attack, and they carry its preparation (Attack.prepared).
      const l = game.lines.find((x) => x.id === c.id && x.owner === p.id && x.kind === LineKind.Offensive);
      if (!l || l.troops < 1 || game.phase !== 'playing') return;
      if (l.readyTick > game.tick) {
        game.notify(p.id, 'error.line.notReady', 'warn', { s: Math.ceil((l.readyTick - game.tick) / 10) });
        return;
      }
      // Where (1.21): the stretch of border the player traced, a country's whole border with
      // us, or (the nations) straight ahead of the line.
      const aim = c.tiles?.length
        ? sectorAim(game, p.id, c.tiles)
        : c.target !== undefined
          ? borderAim(game, p.id, c.target)
          : lineTarget(game, l);
      if (!aim) {
        game.notify(p.id, 'error.line.noTarget', 'warn');
        return;
      }
      const why = aim.target > 0 ? game.attackRefusal(p.id, aim.target, true) : null;
      if (why) {
        game.refuse(p.id, 'attack', why);
        return;
      }
      const focus = 'focus' in aim ? (aim.focus as number[]) : undefined;
      if (!attackSlotFree(game, p.id, focus ? -1 : aim.target)) {
        game.notify(p.id, 'error.attackSlots', 'warn', { n: MAX_ATTACKS_PER_PLAYER });
        return;
      }
      if (!hasFrontier(game, p, aim.target, aim.tile)) {
        game.notify(p.id, 'error.noFrontier', 'warn');
        return;
      }
      const troops = l.troops;
      const prepared = lineStrength(game, l);
      if (aim.target > 0) openHostilities(game, p, game.players[aim.target]!);
      l.troops = 0;
      p.lineTroops = Math.max(0, p.lineTroops - troops);
      removeLine(game, l, false);
      launchAttack(game, p.id, aim.target, troops, undefined, prepared, focus);
      return;
    }

    case 'lineTroops': {
      const l = game.lines.find((x) => x.id === c.id && x.owner === p.id);
      if (l) setLineTroops(game, p, l, c.troops);
      return;
    }

    case 'build': {
      if (!inMap(c.tile) || c.kind < 0 || c.kind >= BUILDING_COUNT) return;
      const kind = c.kind as B;
      // What the cursor showed (buildings.ts planBuild): building on (or next to) one of your
      // own buildings of that type upgrades it; otherwise the click snaps to the nearest free spot.
      const plan = planBuild(game, p, kind, c.tile);
      const existing = plan.building;
      if (existing) {
        if (existing.upgradeLeft > 0) game.notify(p.id, 'error.build.upgrading', 'warn');
        else if (existing.buildLeft === 0 && !upgradeBuilding(game, p, existing))
          game.notify(p.id, 'error.build.gold', 'warn');
        return;
      }
      if (plan.error !== 'ok') {
        const lock = plan.error === 'locked' ? { tech: techKey(plan.lock) } : undefined;
        game.notify(p.id, `error.build.${plan.error}`, 'warn', lock);
        return;
      }
      placeBuilding(game, p, kind, plan.tile);
      return;
    }

    case 'upgrade': {
      const b = game.buildings.get(c.id);
      if (b) upgradeBuilding(game, p, b);
      return;
    }

    case 'demolish': {
      const b = game.buildings.get(c.id);
      if (!b) return;
      if (c.cancel) cancelDemolition(game, p, b);
      else demolishBuilding(game, p, b);
      return;
    }

    case 'warship': {
      if (!inMap(c.tile)) return;
      const res = warshipError(game, p, c.tile);
      // (A hurricane, world event: named with its time left.)
      if (res !== 'ok')
        game.notify(
          p.id,
          `error.warshipWhy.${res}`,
          'warn',
          res === 'hurricane' ? eventLeft(game) : undefined,
        );
      else buildWarship(game, p, c.tile);
      return;
    }

    case 'shipMove':
      if (inMap(c.tile)) orderShips(game, p, c.ids, c.tile);
      return;

    case 'nuke': {
      if (!inMap(c.tile) || c.kind < N.Atom || c.kind > N.Mirv) return;
      const o = game.owner[c.tile]!;
      // Never at a teammate. Your own land is a legitimate target (scorching an invader's
      // front), but a MIRV would rain on your whole country: refused.
      if (o > 0 && o !== p.id && game.sameTeam(p.id, o)) return;
      if (o === p.id && c.kind === N.Mirv) {
        game.notify(p.id, 'error.nukeSelfMirv', 'warn');
        return;
      }
      // The Council's ban and the peace summit stop every silo, the AI's included.
      const halt = nuclearHalt(game);
      if (halt) {
        const f = game.features;
        const until = halt === 'nukeBan' ? f.nukeBanUntil : (f.event?.until ?? game.tick);
        game.notify(p.id, `error.nukeHalt.${halt}`, 'warn', { left: Math.max(0, until - game.tick) });
        return;
      }
      const why = nukeError(game, p, c.kind as N);
      if (why !== 'ok') {
        const lock = why === 'locked' ? { tech: techKey(nukeLock(game, p, c.kind as N)) } : undefined;
        game.notify(p.id, `error.nukeWhy.${why}`, 'warn', lock);
        return;
      }
      // Betraying allies under the blast is decided by launchNukes, once a missile flies.
      if (launchNukes(game, p, c.kind as N, c.tile, c.count, c.up ?? true) === 0)
        game.notify(p.id, 'error.nuke', 'warn');
      return;
    }

    case 'air': {
      if (!inMap(c.tile) || c.kind < 0 || c.kind > 2) return;
      const aim = c.kind === 1 ? bomberAim(game, p, c.tile) : null;
      const o = c.kind === 1 ? (aim ? (aim.ship ?? aim.building).owner : game.owner[c.tile]!) : 0;
      // Refused: the real reason (1.16), the truce and its time left before the gold.
      const plan = planAircraft(game, p, c.kind as A, c.tile);
      if (plan.error !== 'ok') {
        if (isRefusal(plan.error)) game.refuse(p.id, c.kind === 1 ? 'bomber' : 'plane', plan.error);
        else {
          // (Research names the technology; a volcanic ash cloud, world event, its time left.)
          const params =
            plan.error === 'locked'
              ? { tech: techKey(airLock(game, p)) }
              : plan.error === 'ash'
                ? eventLeft(game)
                : undefined;
          game.notify(p.id, `error.airWhy.${plan.error}`, 'warn', params);
        }
        return;
      }
      launchAircraft(game, p, c.kind as A, c.tile);
      // Bombing an ally betrays it — once the bomber has taken off.
      if (c.kind === 1 && o > 0 && p.allies.has(o)) betray(game, p, game.players[o]!);
      return;
    }

    case 'allyRequest': {
      const q = game.player(c.target);
      if (q) requestAlliance(game, p, q);
      return;
    }
    case 'allyAnswer': {
      const q = game.player(c.target);
      if (q) answerAlliance(game, p, q, c.accept);
      return;
    }
    case 'allyBreak': {
      // Breaking an alliance makes you a traitor, exactly like attacking an ally.
      const q = game.player(c.target);
      if (q) betray(game, p, q);
      return;
    }
    case 'embargo': {
      const q = game.player(c.target);
      if (q) setEmbargo(game, p, q, c.on);
      return;
    }
    case 'embargoAll':
      setEmbargoAll(game, p, c.on, c.exceptTeam);
      return;
    case 'donate': {
      const q = game.player(c.target);
      if (q) donate(game, p, q, c.gold, c.troops);
      return;
    }
    case 'emoji':
      game.emit({ k: 'emoji', from: p.id, to: c.target, tile: c.tile, emoji: c.emoji });
      return;
    case 'quick':
      game.emit({ k: 'quick', from: p.id, to: c.target, msg: c.msg });
      return;
    case 'ping':
      if (inMap(c.tile)) game.emit({ k: 'ping', from: p.id, tile: c.tile, kind: c.kind });
      return;
    case 'research':
      setResearch(p, c.tech, c.op);
      return;
    case 'general': {
      if (!inMap(c.tile)) return;
      const why = generalError(game, p, c.tile);
      if (why === 'ok') useGeneral(game, p, c.tile);
      else if (isRefusal(why)) game.refuse(p.id, 'sabotage', why);
      else
        game.notify(p.id, `error.generalWhy.${why}`, 'warn', {
          s: Math.ceil(Math.max(0, p.generalReadyTick - game.tick) / 10),
        });
      return;
    }
    case 'vote':
      castVote(game, p, c.option);
      return;
    case 'moveCapital': {
      if (!inMap(c.tile)) return;
      const res = moveCapital(game, p, c.tile);
      if (res === 'notOwned' || res === 'fallout' || res === 'front')
        game.notify(p.id, `error.capital.${res}`, 'warn');
      else if (res === 'gold') game.notify(p.id, 'error.capital.gold', 'warn', { n: CAPITAL_MOVE_COST });
      else if (res === 'cooldown')
        game.notify(p.id, 'error.capital.cooldown', 'warn', {
          s: Math.ceil(capitalCooldown(game, p) / 10),
        });
      return;
    }
    case 'surrender': {
      p.surrendered = true;
      for (let i = 0; i < game.owner.length; i++) if (game.owner[i] === p.id) game.setOwner(i, 0);
      game.eliminate(p, 0);
      return;
    }
  }
}
