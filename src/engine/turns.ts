// Turn sources: the local in-memory server (solo), and the shared interface used
// by the LAN client and the replay player. All feed the same lockstep pipeline.
import type { Command, StampedCommand, Turn } from '../core/net/commands';
import { isWellFormed } from '../core/net/commands';

export interface TurnSource {
  /** Called for every turn, in order. */
  onTurn: (turn: Turn) => void;
  submit(cmd: Command): void;
  start(): void;
  stop(): void;
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  setSpeed(mult: number): void;
  /** Ack from the simulation (backpressure). */
  ack(tick: number): void;
  readonly canPause: boolean;
}

/** Solo "server" living in the renderer: one turn every 100 ms / speed. */
export class LocalServer implements TurnSource {
  onTurn: (turn: Turn) => void = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: StampedCommand[] = [];
  private nextTick: number;
  private acked: number;
  private speed = 1;
  private accumulator = 0;
  private last = 0;
  paused = false;
  readonly canPause = true;

  constructor(
    private readonly playerId: number,
    startTick = 0,
  ) {
    this.nextTick = startTick;
    this.acked = startTick - 1;
  }

  submit(cmd: Command): void {
    if (!isWellFormed(cmd) || this.playerId <= 0) return;
    this.pending.push({ p: this.playerId, c: cmd });
  }

  /** Commands injected on behalf of another player id (tutorial scripts, AI helpers). */
  inject(p: number, cmd: Command): void {
    this.pending.push({ p, c: cmd });
  }

  start(): void {
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 16);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setSpeed(mult: number): void {
    this.speed = Math.max(0.25, Math.min(8, mult));
  }

  ack(tick: number): void {
    this.acked = Math.max(this.acked, tick - 1);
  }

  private pump(): void {
    const now = performance.now();
    const dt = Math.min(250, now - this.last);
    this.last = now;
    if (this.paused) return;
    this.accumulator += dt * this.speed;
    // At most a few turns per pump; never run more than 3 turns ahead of the simulation.
    let budget = 4;
    while (this.accumulator >= 100 && budget-- > 0 && this.nextTick - this.acked <= 3) {
      this.accumulator -= 100;
      const turn: Turn = { tick: this.nextTick++, cmds: this.pending };
      this.pending = [];
      this.onTurn(turn);
    }
    if (this.accumulator > 400) this.accumulator = 400;
  }
}
