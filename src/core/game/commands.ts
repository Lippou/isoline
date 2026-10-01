// Applies one player command to the game, validating it against the state
// (ownership, gold, ranges, phase). Invalid commands are ignored.
import type { Game } from './state';
import type { Command } from '../net/commands';
import { isWellFormed } from '../net/commands';
import { handleSpawnCommand } from './spawn';
import { cancelAttack, launchAttack } from '../rules/combat';
import { IS_LAND } from '../map/terrain';
import { B, BUILDING_COUNT, N } from './constants';
import {
  checkPlacement,
  demolishBuilding,
  placeBuilding,
  snapPortTile,
  upgradeBuilding,
} from '../buildings/buildings';
import { buildWarship, findLanding, launchBoat, orderShips } from '../units/ships';
import { launchNukes } from '../units/nukes';
import { launchAircraft } from '../units/air';
import {
  answerAlliance,
  betray,
  breakAlliance,
  donate,
  requestAlliance,
  setEmbargo,
  setEmbargoAll,
} from '../rules/diplomacy';
import { castVote, useGeneral } from '../rules/features';
import type { A } from './constants';

export function applyCommand(game: Game, pid: number, c: Command): void {
  if (!isWellFormed(c)) return;
  const p = game.player(pid);
  if (!p) return;
  if (c.t === 'setInactive') {
    p.inactive = c.inactive;
    return;
  }
  if (!p.alive && c.t !== 'emoji' && c.t !== 'quick' && c.t !== 'ping') return;
  const inMap = (t: number) => t >= 0 && t < game.map.size;

  switch (c.t) {
    case 'spawn':
      if (inMap(c.tile)) handleSpawnCommand(game, p, c.tile);
      return;

    case 'attack': {
      if (!inMap(c.tile) || game.phase !== 'playing') return;
      if (!IS_LAND[game.map.terrain[c.tile]!]) return;
      const target = game.owner[c.tile]!;
      if (target === p.id) return;
      if (target > 0 && p.allies.has(target)) betray(game, p, game.players[target]!);
      if (!game.attackAllowed(p.id, target, true)) {
        game.notify(p.id, 'error.cannotAttack', 'warn');
        return;
      }
      const troops = p.troops * c.ratio;
      if (troops < 1) return;
      p.troops -= troops;
      if (!launchAttack(game, p.id, target, troops)) {
        // No land frontier: the click was across water → send a transport instead.
        const res = launchBoat(game, p, c.tile, c.ratio);
        if (res !== 'ok')
          game.notify(
            p.id,
            res === 'noPath' || res === 'noCoast' ? 'error.noFrontier' : `error.boat.${res}`,
            'warn',
          );
      }
      return;
    }

    case 'boat': {
      if (!inMap(c.tile)) return;
      const landing = findLanding(game, c.tile);
      if (landing >= 0) {
        const o = game.owner[landing]!;
        if (o > 0 && p.allies.has(o)) betray(game, p, game.players[o]!);
      }
      const res = launchBoat(game, p, c.tile, c.ratio);
      if (res !== 'ok') game.notify(p.id, `error.boat.${res}`, 'warn');
      return;
    }

    case 'cancelAttack': {
      const a = game.attacks.find((x) => x.id === c.id && x.attacker === p.id);
      if (a) cancelAttack(game, a);
      return;
    }

    case 'build': {
      if (!inMap(c.tile) || c.kind < 0 || c.kind >= BUILDING_COUNT) return;
      let tile = c.tile;
      const existing = game.buildings.get(game.buildingAt[tile]!);
      if (existing && existing.owner === p.id && existing.type === c.kind) {
        upgradeBuilding(game, p, existing);
        return;
      }
      if (c.kind === B.Port && !game.map.isCoastalLand(tile)) tile = snapPortTile(game, p, tile);
      if (tile < 0) return;
      const err = checkPlacement(game, p, c.kind as B, tile);
      if (err !== 'ok') {
        game.notify(p.id, `error.build.${err}`, 'warn');
        return;
      }
      placeBuilding(game, p, c.kind as B, tile);
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
      if (o > 0 && game.sameTeam(p.id, o)) return;
      if (o > 0 && p.allies.has(o)) betray(game, p, game.players[o]!);
      if (launchNukes(game, p, c.kind as N, c.tile, c.count) === 0) game.notify(p.id, 'error.nuke', 'warn');
      return;
    }

    case 'air': {
      if (!inMap(c.tile) || c.kind < 0 || c.kind > 2) return;
      const o = game.owner[c.tile]!;
      if (c.kind === 1 && o > 0 && p.allies.has(o)) betray(game, p, game.players[o]!);
      if (!launchAircraft(game, p, c.kind as A, c.tile)) game.notify(p.id, 'error.air', 'warn');
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
      const q = game.player(c.target);
      if (q) breakAlliance(game, p, q);
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
    case 'troopRatio':
      p.troopRatio = c.ratio;
      return;
    case 'research':
      if (c.tech >= 0 && c.tech < 5 && p.tech[c.tech]! < 4) p.researching = c.tech;
      return;
    case 'general':
      if (inMap(c.tile) && !useGeneral(game, p, c.tile)) game.notify(p.id, 'error.general', 'warn');
      return;
    case 'vote':
      castVote(game, p, c.option);
      return;
    case 'surrender': {
      p.surrendered = true;
      for (let i = 0; i < game.owner.length; i++) if (game.owner[i] === p.id) game.setOwner(i, 0);
      game.eliminate(p, 0);
      return;
    }
  }
}
