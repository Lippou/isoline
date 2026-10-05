// Main-thread handle on the simulation worker.
import type { GameConfig } from '../core/game/config';
import type { Turn } from '../core/net/commands';
import type { Snapshot } from '../core/net/snapshot';
import type { FromWorker, InitDone, MapSource, Query, TickUpdate, ToWorker } from './protocol';
import SimWorker from './sim.worker.ts?worker';

export class SimHost {
  private readonly worker: Worker;
  private nextQuery = 1;
  private pending = new Map<number, (v: unknown) => void>();
  private snapshots = new Map<number, (s: Snapshot) => void>();
  private readyResolve: ((d: InitDone) => void) | null = null;
  onTick: (u: TickUpdate) => void = () => {};
  onError: (msg: string) => void = (m) => console.error('[sim]', m);

  constructor() {
    this.worker = new SimWorker();
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.handle(ev.data);
    this.worker.onerror = (ev) => this.onError(ev.message);
  }

  private handle(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.readyResolve?.(msg);
        this.readyResolve = null;
        break;
      case 'tick':
        this.onTick(msg);
        break;
      case 'answer': {
        const r = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        r?.(msg.a);
        break;
      }
      case 'snapshot': {
        const r = this.snapshots.get(msg.id);
        this.snapshots.delete(msg.id);
        r?.(msg.snapshot);
        break;
      }
      case 'error':
        this.onError(msg.message);
        break;
    }
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  init(config: GameConfig, map: MapSource, viewer: number, snapshot?: Snapshot): Promise<InitDone> {
    return new Promise((resolve) => {
      this.readyResolve = resolve;
      const transfer: Transferable[] = map.kind === 'builtin' ? [map.terrainPng, map.elevPng] : [];
      const msg: ToWorker = { type: 'init', config, map, viewer };
      if (snapshot) msg.snapshot = snapshot;
      this.send(msg, transfer);
    });
  }

  turn(turn: Turn): void {
    this.send({ type: 'turn', turn });
  }

  turns(turns: Turn[]): void {
    this.send({ type: 'turns', turns });
  }

  setLayers(loyalty: boolean): void {
    this.send({ type: 'layers', loyalty });
  }

  /** QA (?automation, solo only): a revolution breaks out in `player`'s land at once. */
  qaRevolution(player: number): void {
    this.send({ type: 'qa', action: 'revolution', player });
  }

  /** QA (?automation, solo only): `player` keeps only its `keep` tiles nearest its centre. */
  qaShrink(player: number, keep: number): void {
    this.send({ type: 'qa', action: 'shrink', player, keep });
  }

  setViewer(viewer: number, fogEnabled: boolean): void {
    this.send({ type: 'setViewer', viewer, fogEnabled });
  }

  query<T>(q: Query): Promise<T> {
    const id = this.nextQuery++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve as (v: unknown) => void);
      this.send({ type: 'query', id, q });
    });
  }

  snapshot(): Promise<Snapshot> {
    const id = this.nextQuery++;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.send({ type: 'snapshot', id });
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
