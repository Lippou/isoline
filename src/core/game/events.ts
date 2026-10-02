// Events emitted by the simulation for the UI / renderer / audio (not part of the state hash).

export type NotifyLevel = 'info' | 'good' | 'warn' | 'danger';

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
  | { k: 'shipSunk'; x: number; y: number; owner: number; by: number }
  | { k: 'capture'; x: number; y: number; owner: number; by: number }
  | { k: 'emoji'; from: number; to: number; tile: number; emoji: number }
  | { k: 'quick'; from: number; to: number; msg: number }
  | { k: 'ping'; from: number; tile: number; kind: number }
  | { k: 'built'; owner: number; kind: number; tile: number }
  | { k: 'alliance'; a: number; b: number; on: boolean }
  | { k: 'betrayal'; traitor: number; victim: number }
  | { k: 'worldEvent'; id: string; until: number }
  | { k: 'council'; phase: 'open' | 'result'; option: number; options: number[] }
  | { k: 'eliminated'; player: number; by: number }
  | { k: 'secession'; from: number; tribe: number; tile: number }
  | { k: 'general'; player: number; ability: string; tile: number }
  | { k: 'trainPay'; x: number; y: number; owner: number; amount: number }
  | { k: 'tradePay'; x: number; y: number; owner: number; amount: number }
  | { k: 'loot'; x: number; y: number; owner: number; amount: number }
  | { k: 'gameOver'; winner: number; team: number; reason: string };
