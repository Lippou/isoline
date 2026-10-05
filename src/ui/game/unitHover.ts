// What the hover card says about the ship, plane or train under the pointer: whose it is
// (and what they are to us), what it is, its troops or its hull, and where it is heading.
// Pure: read from the client mirror's unit buffer (UF in engine/protocol.ts).
import { UF, UNIT_STRIDE, type PlayerView } from '../../engine/protocol';
import { U, UNIT_KEYS } from '../../core/units/unit';

/** What the owner is to the viewer, printed with an icon and a word (never colour alone). */
export type UnitRelation = 'you' | 'teammate' | 'ally' | 'enemy' | 'neutral';

/** What the unit is doing, when that says more than a destination. */
export type UnitStatus =
  | 'turnedBack'
  | 'patrolling'
  | 'repairing'
  | 'docked'
  | 'pirated'
  | 'returning'
  | 'intercepting'
  | 'orbiting';

export interface UnitHoverData {
  id: number;
  type: U;
  key: (typeof UNIT_KEYS)[number];
  owner: number;
  /** Null for a spectator (no "us"). */
  relation: UnitRelation | null;
  /** Transports: troops aboard. */
  troops: number | null;
  /** Warships and planes: hull left, 0..1. */
  hp: number | null;
  /** Warships: veterancy (0: none). */
  veteran: number;
  status: UnitStatus | null;
  /** Owner of the tile it heads to (0: unclaimed land), null when there is none to name. */
  dest: number | null;
}

/** The part of the client mirror (engine/clientState.ts) the card reads. */
export interface UnitHoverState {
  units: Float32Array;
  unitCount: number;
  players: ReadonlyMap<number, PlayerView>;
  owner: ArrayLike<number>;
  width: number;
  height: number;
  viewer: number;
}

/** Unit `kind` values mirrored from the simulation (ships.ts WS / TRANSPORT_RETREATING, air.ts). */
const TRANSPORT_RETREATING = 1;
const WS_RETREATING = 1;
const WS_DOCKED = 2;
const MERCHANT_PIRATED = 1;
const AIR_BACK = 1; // bombers: flying home; reconnaissance: orbiting its zone
const AIR_INTERCEPTOR = 2;
const AIR_HOME = 3;

const HOVERABLE = new Set<number>([
  U.Transport,
  U.Warship,
  U.Merchant,
  U.Train,
  U.Fighter,
  U.Bomber,
  U.Recon,
]);

/** What `owner` is to the viewer; a transport or bomber coming at us is an enemy whatever the papers say. */
export function relationTo(
  s: Pick<UnitHoverState, 'players' | 'viewer'>,
  wars: readonly number[],
  owner: number,
  comingAtUs = false,
): UnitRelation | null {
  const v = s.viewer;
  if (v <= 0) return null;
  if (owner === v) return 'you';
  const me = s.players.get(v);
  if (me && me.team > 0 && s.players.get(owner)?.team === me.team) return 'teammate';
  if (me?.allies.includes(owner)) return 'ally';
  if (wars.includes(owner) || comingAtUs) return 'enemy';
  return 'neutral';
}

/** The card of unit `id`, or null when it is gone (sunk, landed) or not one the card shows. */
export function unitHover(s: UnitHoverState, wars: readonly number[], id: number): UnitHoverData | null {
  const b = s.units;
  for (let k = 0; k < s.unitCount; k++) {
    const o = k * UNIT_STRIDE;
    if (b[o + UF.Id] !== id) continue;
    const type = b[o + UF.Type]! as U;
    if (!HOVERABLE.has(type)) return null;
    const owner = b[o + UF.Owner]!;
    const kind = b[o + UF.Kind]!;
    const ownerAt = (tile: number) => (tile >= 0 && tile < s.width * s.height ? (s.owner[tile] ?? 0) : -1);
    let dest: number | null = null;
    let status: UnitStatus | null = null;
    let troops: number | null = null;
    let hp: number | null = null;
    let veteran = 0;
    switch (type) {
      case U.Transport: {
        troops = b[o + UF.Troops]!;
        if (kind === TRANSPORT_RETREATING) status = 'turnedBack';
        else {
          const d = ownerAt(b[o + UF.Dest]!);
          if (d >= 0) dest = d;
        }
        break;
      }
      case U.Warship:
        hp = b[o + UF.Hp]!;
        veteran = b[o + UF.Level]!;
        status = kind === WS_DOCKED ? 'docked' : kind === WS_RETREATING ? 'repairing' : 'patrolling';
        break;
      case U.Merchant: {
        if (kind === MERCHANT_PIRATED) status = 'pirated';
        const d = ownerAt(b[o + UF.Dest]!);
        if (d > 0) dest = d;
        break;
      }
      case U.Train: {
        // Within its own country a train says nothing new; across a border, it does.
        const d = ownerAt(b[o + UF.Dest]!);
        if (d > 0 && d !== owner) dest = d;
        break;
      }
      default: {
        // Planes: their target point (tx, ty) until they turn for home.
        hp = b[o + UF.Hp]!;
        if (type === U.Fighter && kind === AIR_INTERCEPTOR) status = 'intercepting';
        else if (kind === AIR_HOME || (type === U.Bomber && kind === AIR_BACK)) status = 'returning';
        else {
          if (type === U.Recon && kind === AIR_BACK) status = 'orbiting';
          else if (type === U.Fighter) status = 'patrolling';
          const tx = Math.floor(b[o + UF.Tx]!);
          const ty = Math.floor(b[o + UF.Ty]!);
          const d = tx >= 0 && ty >= 0 && tx < s.width && ty < s.height ? ownerAt(ty * s.width + tx) : -1;
          if (d > 0) dest = d;
        }
        break;
      }
    }
    const comingAtUs =
      s.viewer > 0 && dest === s.viewer && (type === U.Transport || type === U.Bomber) && status === null;
    return {
      id,
      type,
      key: UNIT_KEYS[type]!,
      owner,
      relation: relationTo(s, wars, owner, comingAtUs),
      troops,
      hp,
      veteran,
      status,
      dest,
    };
  }
  return null;
}
