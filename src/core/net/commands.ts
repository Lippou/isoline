// Player commands — the only inputs of the deterministic simulation.
// Every command is stamped with the issuing player id by the server.

export type Command =
  | { t: 'spawn'; tile: number }
  | { t: 'attack'; tile: number; ratio: number }
  | { t: 'boat'; tile: number; ratio: number }
  | { t: 'cancelAttack'; id: number }
  /** Turns one of your transports back (id = unit id): its troops come home, 25 % lost. */
  | { t: 'boatRetreat'; id: number }
  | { t: 'build'; kind: number; tile: number }
  | { t: 'upgrade'; id: number }
  /** Orders one of your buildings down (timed); `cancel`: calls off a demolition under way. */
  | { t: 'demolish'; id: number; cancel?: boolean }
  | { t: 'warship'; tile: number }
  /**
   * Lays a front line (rules/lines.ts): kind 0 defensive, 1 offensive; `pts` its vertices
   * [x0, y0, x1, y1, …] in tiles; `side` the side it faces; `ratio` of the army on it.
   */
  | { t: 'line'; kind: number; pts: number[]; side: number; ratio: number }
  /** Takes one of your lines down: its troops come back. */
  | { t: 'lineRemove'; id: number }
  /** Sets the troops on one of your lines (more from the army, fewer back to it; 0: empty). */
  | { t: 'lineTroops'; id: number; troops: number }
  /** Launches the assault of one of your offensive lines, once ready: it empties into an attack ahead. */
  | { t: 'lineLaunch'; id: number }
  | { t: 'shipMove'; ids: number[]; tile: number; patrol: boolean }
  /** `up`: arc towards the top of the map (default) or the bottom (A and H bombs). */
  | { t: 'nuke'; kind: number; tile: number; count: number; up?: boolean }
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
  | { t: 'research'; tech: number; op?: 'queue' | 'unqueue' }
  | { t: 'general'; tile: number }
  /** Establish (or move) the capital on one of your tiles (rules/capital.ts). */
  | { t: 'moveCapital'; tile: number }
  | { t: 'vote'; option: number }
  | { t: 'surrender' }
  /** Keep playing after the end of the match (any human; the victory check is then off). */
  | { t: 'continue' }
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
    case 'moveCapital':
      return isInt(o.tile);
    case 'attack':
    case 'boat':
      return isInt(o.tile) && ratioOk(o.ratio);
    case 'cancelAttack':
    case 'boatRetreat':
    case 'upgrade':
    case 'lineRemove':
    case 'lineLaunch':
      return isInt(o.id);
    case 'lineTroops':
      return isInt(o.id) && isNum(o.troops) && o.troops >= 0 && o.troops < 1e12;
    case 'line':
      return (
        (o.kind === 0 || o.kind === 1) &&
        (o.side === 1 || o.side === -1) &&
        ratioOk(o.ratio) &&
        Array.isArray(o.pts) &&
        o.pts.length >= 4 &&
        o.pts.length <= 64 &&
        o.pts.length % 2 === 0 &&
        o.pts.every((v) => isNum(v) && v >= 0 && v < 1e5)
      );
    case 'demolish':
      return isInt(o.id) && (o.cancel === undefined || isBool(o.cancel));
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
        (o.count as number) <= 50 &&
        (o.up === undefined || isBool(o.up))
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
    case 'research':
      return isInt(o.tech) && (o.op === undefined || o.op === 'queue' || o.op === 'unqueue');
    case 'vote':
      return isInt(o.option);
    case 'surrender':
    case 'continue':
      return true;
    case 'setInactive':
      return isBool(o.inactive);
    default:
      return false;
  }
}
