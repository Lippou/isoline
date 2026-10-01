// Player commands — the only inputs of the deterministic simulation.
// Every command is stamped with the issuing player id by the server.

export type Command =
  | { t: 'spawn'; tile: number }
  | { t: 'attack'; tile: number; ratio: number }
  | { t: 'boat'; tile: number; ratio: number }
  | { t: 'cancelAttack'; id: number }
  | { t: 'build'; kind: number; tile: number }
  | { t: 'upgrade'; id: number }
  | { t: 'demolish'; id: number }
  | { t: 'warship'; tile: number }
  | { t: 'shipMove'; ids: number[]; tile: number; patrol: boolean }
  | { t: 'nuke'; kind: number; tile: number; count: number }
  | { t: 'air'; kind: number; tile: number }
  | { t: 'allyRequest'; target: number }
  | { t: 'allyAnswer'; target: number; accept: boolean }
  | { t: 'allyBreak'; target: number }
  | { t: 'embargo'; target: number; on: boolean }
  | { t: 'embargoAll'; on: boolean; exceptTeam: boolean }
  | { t: 'donate'; target: number; gold: number; troops: number }
  | { t: 'emoji'; target: number; tile: number; emoji: number }
  | { t: 'quick'; target: number; msg: number }
  | { t: 'ping'; tile: number; kind: number }
  | { t: 'troopRatio'; ratio: number }
  | { t: 'research'; tech: number }
  | { t: 'general'; tile: number }
  | { t: 'vote'; option: number }
  | { t: 'surrender' }
  | { t: 'setInactive'; inactive: boolean };

export interface StampedCommand {
  /** Issuing player id (assigned by the server, never trusted from the client). */
  p: number;
  c: Command;
}

export interface Turn {
  tick: number;
  cmds: StampedCommand[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => isNum(v) && Math.floor(v) === v;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const ratioOk = (v: unknown) => isNum(v) && v > 0 && v <= 1;

/** Structural validation (types/ranges). Game-state validation happens in the simulation. */
export function isWellFormed(c: unknown): c is Command {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  switch (o.t) {
    case 'spawn':
    case 'warship':
    case 'general':
      return isInt(o.tile);
    case 'attack':
    case 'boat':
      return isInt(o.tile) && ratioOk(o.ratio);
    case 'cancelAttack':
    case 'upgrade':
    case 'demolish':
      return isInt(o.id);
    case 'build':
    case 'air':
      return isInt(o.kind) && isInt(o.tile);
    case 'shipMove':
      return (
        Array.isArray(o.ids) && o.ids.length <= 200 && o.ids.every(isInt) && isInt(o.tile) && isBool(o.patrol)
      );
    case 'nuke':
      return (
        isInt(o.kind) &&
        isInt(o.tile) &&
        isInt(o.count) &&
        (o.count as number) >= 1 &&
        (o.count as number) <= 50
      );
    case 'allyRequest':
    case 'allyBreak':
      return isInt(o.target);
    case 'allyAnswer':
      return isInt(o.target) && isBool(o.accept);
    case 'embargo':
      return isInt(o.target) && isBool(o.on);
    case 'embargoAll':
      return isBool(o.on) && isBool(o.exceptTeam);
    case 'donate':
      return (
        isInt(o.target) &&
        isNum(o.gold) &&
        isNum(o.troops) &&
        (o.gold as number) >= 0 &&
        (o.troops as number) >= 0
      );
    case 'emoji':
      return isInt(o.target) && isInt(o.tile) && isInt(o.emoji);
    case 'quick':
      return isInt(o.target) && isInt(o.msg);
    case 'ping':
      return isInt(o.tile) && isInt(o.kind);
    case 'troopRatio':
      return isNum(o.ratio) && (o.ratio === 0 || ((o.ratio as number) >= 0.05 && (o.ratio as number) <= 1));
    case 'research':
      return isInt(o.tech);
    case 'vote':
      return isInt(o.option);
    case 'surrender':
      return true;
    case 'setInactive':
      return isBool(o.inactive);
    default:
      return false;
  }
}
