// A running match on the client: worker + turn source + mirror state + recorder.
import { SimHost } from './simHost';
import { ClientState } from './clientState';
import { LocalServer, type TurnSource } from './turns';
import { ReplayRecorder, ReplayPlayer, type ReplayFile } from './replay';
import type { MapSource, FinalStats, InitDone, TickUpdate } from './protocol';
import type { GameConfig } from '../core/game/config';
import type { Command, Turn } from '../core/net/commands';
import type { Snapshot } from '../core/net/snapshot';
import type { MapMeta } from '../core/map/gamemap';
import type { GameEvent } from '../core/game/events';
import { parseIsoMap } from '../core/map/format';

export type SessionKind = 'solo' | 'lan' | 'replay' | 'demo';

export interface SessionOptions {
  kind: SessionKind;
  config: GameConfig;
  /** Local player id (1-based) or -1 for spectators / replays. */
  viewer: number;
  snapshot?: Snapshot;
  replay?: ReplayFile;
  /** Previously recorded turns (resumed save) so the replay stays complete. */
  priorTurns?: ReplayFile['turns'];
  source?: TurnSource;
  customMap?: string; // .isomap JSON
}

export async function loadMapSource(
  config: GameConfig,
  base: string,
  customMap?: string,
): Promise<{ src: MapSource; custom?: string }> {
  if (config.procedural) return { src: { kind: 'procedural', params: config.procedural } };
  if (customMap) {
    const m = parseIsoMap(customMap);
    return {
      src: {
        kind: 'builtin',
        meta: m.meta,
        terrainPng: m.terrainPng.slice().buffer,
        elevPng: m.elevPng.slice().buffer,
      },
      custom: customMap,
    };
  }
  const [meta, t, e] = await Promise.all([
    fetch(`${base}${config.mapId}.json`).then((r) => r.json() as Promise<MapMeta>),
    fetch(`${base}${config.mapId}.png`).then((r) => r.arrayBuffer()),
    fetch(`${base}${config.mapId}.elev.png`).then((r) => r.arrayBuffer()),
  ]);
  return { src: { kind: 'builtin', meta, terrainPng: t, elevPng: e } };
}

export class Session {
  readonly sim = new SimHost();
  readonly state = new ClientState();
  readonly recorder = new ReplayRecorder();
  source!: TurnSource;
  readonly kind: SessionKind;
  readonly config: GameConfig;
  viewer: number;
  customMap: string | undefined;
  private listeners: ((u: TickUpdate, events: GameEvent[]) => void)[] = [];
  private readyListeners: ((d: InitDone) => void)[] = [];
  private hashListeners: ((tick: number, hash: number) => void)[] = [];
  ended = false;
  replay: ReplayPlayer | null = null;
  loadMs = 0;

  constructor(private readonly opts: SessionOptions) {
    this.kind = opts.kind;
    // Plain copy: UI state may hand us reactive proxies that cannot be cloned to the worker.
    this.config = JSON.parse(JSON.stringify(opts.config)) as GameConfig;
    this.viewer = opts.viewer;
    this.customMap = opts.customMap;
    if (opts.priorTurns) this.recorder.seed(opts.priorTurns);
  }

  onTick(fn: (u: TickUpdate, events: GameEvent[]) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((f) => f !== fn));
  }

  onReady(fn: (d: InitDone) => void): void {
    this.readyListeners.push(fn);
  }

  onHash(fn: (tick: number, hash: number) => void): void {
    this.hashListeners.push(fn);
  }

  async start(mapsBase: string): Promise<InitDone> {
    const t0 = performance.now();
    const { src, custom } = await loadMapSource(
      this.config,
      mapsBase,
      this.opts.customMap ?? this.opts.replay?.customMap,
    );
    this.customMap = custom;
    this.sim.onTick = (u) => {
      const events = this.state.apply(u);
      this.source?.ack(u.tick);
      if (u.hash !== undefined) for (const f of this.hashListeners) f(u.tick, u.hash);
      for (const f of this.listeners) f(u, events);
      // 'ended' can switch back to 'playing' when the players choose to carry on.
      this.ended = u.phase === 'ended';
    };
    // A save arrives through the app state as a reactive proxy, which the worker cannot
    // receive either (DataCloneError): hand it a plain copy (saves are plain JSON).
    const snapshot = this.opts.snapshot
      ? (JSON.parse(JSON.stringify(this.opts.snapshot)) as Snapshot)
      : undefined;
    const ready = await this.sim.init(this.config, src, this.viewer, snapshot);
    this.loadMs = performance.now() - t0;
    this.state.init(ready);
    for (const f of this.readyListeners) f(ready);
    // Turn source.
    if (this.kind === 'replay' && this.opts.replay) {
      // Plain copy too: a replay handed over by the UI's launch state is a reactive proxy,
      // and its commands could not be posted to the worker.
      const rp = new ReplayPlayer(JSON.parse(JSON.stringify(this.opts.replay)) as ReplayFile);
      rp.onTurns = (turns) => this.sim.turns(turns);
      this.replay = rp;
      this.source = rp;
    } else if (this.opts.source) {
      this.source = this.opts.source;
    } else {
      this.source = new LocalServer(this.viewer, ready.tick);
    }
    this.source.onTurn = (turn: Turn) => {
      if (this.kind !== 'replay') this.recorder.record(turn);
      this.sim.turn(turn);
    };
    this.source.start();
    return ready;
  }

  cmd(c: Command): void {
    if (this.kind === 'replay') return;
    this.source.submit(c);
  }

  setPaused(p: boolean): void {
    if (this.source?.canPause) this.source.setPaused(p);
  }

  get paused(): boolean {
    return this.source?.paused ?? false;
  }

  snapshot(): Promise<Snapshot> {
    return this.sim.snapshot();
  }

  finalStats(): Promise<FinalStats> {
    return this.sim.query<FinalStats>({ q: 'stats' });
  }

  stop(): void {
    this.source?.stop();
    this.sim.terminate();
  }
}
