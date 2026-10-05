// Events emitted by the simulation for the UI / renderer / audio (not part of the state hash).

export type NotifyLevel = 'info' | 'good' | 'warn' | 'danger';

/**
 * How a country fell: its last tile was taken by `by` ('conquered'), it gave up
 * ('surrender'), a nuclear blast razed it ('nuked') or the battle royale zone
 * closed on it ('zone').
 */
export type EliminationCause = 'conquered' | 'surrender' | 'nuked' | 'zone';

export type GameEvent =
  | {
      k: 'notify';
      /** Recipient player id, or -1 for everyone. */
      to: number;
      key: string;
      params?: Record<string, string | number>;
      level: NotifyLevel;
      tile?: number;
    }
  | { k: 'explosion'; x: number; y: number; kind: number; radius: number; owner: number }
  | {
      k: 'nukeLaunch';
      id: number;
      owner: number;
      kind: number;
      sx: number;
      sy: number;
      tx: number;
      ty: number;
      impact: number;
      threatened: number[];
    }
  | { k: 'intercept'; x: number; y: number; owner: number }
  /**
   * A bomber of `owner` dropped its bombs: `victim`'s building of `type` lost `levels` levels
   * (`destroyed`: nothing is left of it); `type` −1 and `victim` 0 when no structure was hit.
   */
  | {
      k: 'airStrike';
      x: number;
      y: number;
      owner: number;
      victim: number;
      type: number;
      levels: number;
      destroyed: boolean;
    }
  /** An aircraft of `owner` (unit type `kind`) was shot down by `by`'s SAM or fighter. */
  | {
      k: 'planeDown';
      x: number;
      y: number;
      owner: number;
      kind: number;
      by: number;
      cause: 'sam' | 'fighter';
    }
  /** An airfield of `owner` scrambled an interceptor at unit `target` (`radar`: detected by radar). */
  | { k: 'scramble'; x: number; y: number; owner: number; radar: boolean; target: number }
  /**
   * A wave of troops sent at `target`: a new land attack, troops added to one already under
   * way, or a landing. `tile`: a tile of its front (or the beach), −1 if none. `riposte`:
   * `target` was already attacking `attacker` when this attack began — the wave answers it.
   */
  | { k: 'attackWave'; attacker: number; target: number; troops: number; tile: number; riposte: boolean }
  | { k: 'shipSunk'; x: number; y: number; owner: number; by: number }
  | { k: 'capture'; x: number; y: number; owner: number; by: number }
  | { k: 'emoji'; from: number; to: number; tile: number; emoji: number }
  | { k: 'quick'; from: number; to: number; msg: number }
  | { k: 'ping'; from: number; tile: number; kind: number }
  | { k: 'built'; owner: number; kind: number; tile: number }
  | { k: 'alliance'; a: number; b: number; on: boolean }
  /** `by` turned down `from`'s alliance offer (`silent`: left unanswered until it lapsed). */
  | { k: 'allyRefused'; from: number; by: number; silent: boolean }
  | { k: 'betrayal'; traitor: number; victim: number }
  | { k: 'worldEvent'; id: string; until: number }
  | { k: 'council'; phase: 'open' | 'result'; option: number; options: number[] }
  | { k: 'eliminated'; player: number; by: number; cause: EliminationCause }
  | { k: 'secession'; from: number; tribe: number; tile: number }
  /**
   * Revolutions (rules/revolution.ts): `tribe` rose up in `from`'s land around `tile`
   * (phase 'start', `tiles` taken), or its revolution ended ('over': the land rejoined
   * `from`; 'crushed': `by` took its last tile).
   */
  | {
      k: 'revolution';
      phase: 'start' | 'over' | 'crushed';
      from: number;
      tribe: number;
      tile: number;
      tiles: number;
      by: number;
    }
  | { k: 'general'; player: number; ability: string; tile: number }
  | { k: 'trainPay'; x: number; y: number; owner: number; amount: number }
  | { k: 'tradePay'; x: number; y: number; owner: number; amount: number }
  | { k: 'loot'; x: number; y: number; owner: number; amount: number }
  /** `player`'s capital fell to `by` (0: razed by a nuke or the zone); `gold`: treasury seized or burnt. */
  | { k: 'capitalLost'; player: number; by: number; tile: number; gold: number }
  | { k: 'capitalMoved'; player: number; tile: number }
  | { k: 'gameOver'; winner: number; team: number; reason: string }
  /** A human resumed the match after its end (sandbox, no further victory). */
  | { k: 'gameContinued'; by: number };
