// Replays (.rpl): seed + config + every non-empty turn. Playback re-simulates.
import type { GameConfig } from '../core/game/config';
import type { Command, Turn } from '../core/net/commands';
import type { TurnSource } from './turns';

export const REPLAY_VERSION = 1;

export interface ReplayFile {
  format: 'isoline-replay';
  version: number;
  date: string;
  appVersion: string;
  config: GameConfig;
  /** Embedded custom map (.isomap JSON) when the map is not built in. */
  customMap?: string;
  viewer: number;
  endTick: number;
  /** [tick, [[playerId, command], …]] for every turn that had commands. */
  turns: [number, [number, Command][]][];
  summary: { winner: string; players: number; durationTicks: number };
}

export class ReplayRecorder {
  private turns: [number, [number, Command][]][] = [];
  lastTick = 0;

  record(turn: Turn): void {
    this.lastTick = turn.tick;
    if (turn.cmds.length === 0) return;
    this.turns.push([turn.tick, turn.cmds.map((c) => [c.p, c.c])]);
  }

  /** Prepend turns from a previous session (resumed save). */
  seed(turns: [number, [number, Command][]][]): void {
    this.turns = [...turns, ...this.turns];
  }

  get allTurns(): [number, [number, Command][]][] {
    return this.turns;
  }

  build(
    config: GameConfig,
    viewer: number,
    appVersion: string,
    winner: string,
    players: number,
    customMap?: string,
  ): ReplayFile {
    const f: ReplayFile = {
      format: 'isoline-replay',
      version: REPLAY_VERSION,
      date: new Date().toISOString(),
      appVersion,
      config,
      viewer,
      endTick: this.lastTick,
      turns: this.turns,
      summary: { winner, players, durationTicks: this.lastTick },
    };
    if (customMap) f.customMap = customMap;
    return f;
  }
}

export function parseReplay(text: string): ReplayFile {
  const f = JSON.parse(text) as Partial<ReplayFile>;
  if (f.format !== 'isoline-replay' || !f.config || !Array.isArray(f.turns))
    throw new Error('not an Isoline replay');
  return { ...f, version: f.version ?? 1 } as ReplayFile;
}

/** Feeds recorded turns at a chosen speed; supports seeking forward in bulk. */
export class ReplayPlayer implements TurnSource {
  onTurn: (turn: Turn) => void = () => {};
  /** Bulk fast-forward hook (many turns at once). */
  onTurns: (turns: Turn[]) => void = () => {};
  private byTick = new Map<number, Turn['cmds']>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0;
  private last = 0;
  private acked = -1;
  tick = 0;
  speed = 1;
  paused = false;
  readonly canPause = true;

  constructor(readonly file: ReplayFile) {
    for (const [t, cmds] of file.turns)
      this.byTick.set(
        t,
        cmds.map(([p, c]) => ({ p, c })),
      );
  }

  turnAt(t: number): Turn {
    return { tick: t, cmds: this.byTick.get(t) ?? [] };
  }

  submit(): void {
    /* replays are read-only */
  }

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 16);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setSpeed(m: number): void {
    this.speed = Math.max(0.5, Math.min(8, m));
  }

  ack(tick: number): void {
    this.acked = Math.max(this.acked, tick - 1);
  }

  /** Rewind bookkeeping after the simulation was re-initialised from tick 0. */
  reset(): void {
    this.tick = 0;
    this.acked = -1;
    this.acc = 0;
  }

  /** Fast-forward to `target` (must be ≥ current tick). */
  seekForward(target: number): void {
    const batch: Turn[] = [];
    while (this.tick < Math.min(target, this.file.endTick + 1)) batch.push(this.turnAt(this.tick++));
    for (let k = 0; k < batch.length; k += 600) this.onTurns(batch.slice(k, k + 600));
    this.acked = this.tick - 1;
  }

  get finished(): boolean {
    return this.tick > this.file.endTick;
  }

  private pump(): void {
    const now = performance.now();
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (this.paused || this.finished) return;
    this.acc += dt * this.speed;
    let budget = 16;
    while (this.acc >= 100 && budget-- > 0 && this.tick - this.acked <= 6 && !this.finished) {
      this.acc -= 100;
      this.onTurn(this.turnAt(this.tick++));
    }
    if (this.acc > 800) this.acc = 800;
  }
}
