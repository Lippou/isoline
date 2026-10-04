// Applies one player command to the game, validating it against the state
// (ownership, gold, ranges, phase). Invalid commands are ignored.
import type { Game } from './state';
import type { Command } from '../net/commands';
import { isWellFormed } from '../net/commands';
import { handleSpawnCommand } from './spawn';
import { attackSlotFree, cancelAttack, hasFrontier, launchAttack } from '../rules/combat';
import { IS_LAND } from '../map/terrain';
import { B, BUILDING_COUNT, N } from './constants';
import { demolishBuilding, placeBuilding, planBuild, upgradeBuilding } from '../buildings/buildings';
import { buildWarship, launchBoat, orderShips, retreatTransport } from '../units/ships';
import { launchNukes } from '../units/nukes';
import { launchAircraft } from '../units/air';
import {
  answerAlliance,
  betray,
  donate,
  openHostilities,
  requestAlliance,
  setEmbargo,
  setEmbargoAll,
} from '../rules/diplomacy';
import { castVote, useGeneral } from '../rules/features';
import { continueAfterVictory } from '../rules/victory';
import { setResearch, techKey } from '../rules/tech';
import { capitalCooldown, moveCapital } from '../rules/capital';
import type { A } from './constants';

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
      if (!game.attackAllowed(p.id, target, true) || !attackSlotFree(game, p.id, target)) {
        game.notify(p.id, 'error.cannotAttack', 'warn');
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
      if (res !== 'ok') game.notify(p.id, `error.boat.${res}`, 'warn');
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
      if (b) demolishBuilding(game, p, b);
      return;
    }

    case 'warship':
      if (inMap(c.tile) && !buildWarship(game, p, c.tile)) game.notify(p.id, 'error.warship', 'warn');
      return;

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
      // Betraying allies under the blast is decided by launchNukes, once a missile flies.
      if (launchNukes(game, p, c.kind as N, c.tile, c.count, c.up ?? true) === 0)
        game.notify(p.id, 'error.nuke', 'warn');
      return;
    }

    case 'air': {
      if (!inMap(c.tile) || c.kind < 0 || c.kind > 2) return;
      const o = game.owner[c.tile]!;
      if (!launchAircraft(game, p, c.kind as A, c.tile)) game.notify(p.id, 'error.air', 'warn');
      // Bombing an ally betrays it — once the bomber has taken off.
      else if (c.kind === 1 && o > 0 && p.allies.has(o)) betray(game, p, game.players[o]!);
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
    case 'general':
      if (inMap(c.tile) && !useGeneral(game, p, c.tile)) game.notify(p.id, 'error.general', 'warn');
      return;
    case 'vote':
      castVote(game, p, c.option);
      return;
    case 'moveCapital': {
      if (!inMap(c.tile)) return;
      const res = moveCapital(game, p, c.tile);
      if (res === 'notOwned' || res === 'fallout' || res === 'front')
        game.notify(p.id, `error.capital.${res}`, 'warn');
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
