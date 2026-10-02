// LAN client: lobby connection + lockstep turn source fed by the host's server.
import type { ClientMsg, LobbyState, ServerMsg } from '../server/protocol';
import { NET_VERSION } from '../server/protocol';
import type { Command, Turn } from '../core/net/commands';
import type { TurnSource } from './turns';
import type { Snapshot } from '../core/net/snapshot';
import type { GameConfig } from '../core/game/config';
import type { PlayerFlag } from '../core/data/flagSpec';

export class LanClient {
  private ws: WebSocket | null = null;
  lobby: LobbyState | null = null;
  slot = -1;
  host = false;
  token = '';
  ping = 0;
  closed = false;
  private retries = 0;
  private hello: Extract<ClientMsg, { t: 'hello' }> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  onLobby: (l: LobbyState) => void = () => {};
  onStart: (config: GameConfig, playerId: number, tick: number, snapshot?: Snapshot) => void = () => {};
  onSnapshot: (s: Snapshot, reason: string) => void = () => {};
  onChat: (m: Extract<ServerMsg, { t: 'chat' }>) => void = () => {};
  onReject: (reason: string) => void = () => {};
  onKicked: () => void = () => {};
  onDesync: (tick: number) => void = () => {};
  onPause: (on: boolean) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  private turnHandler: ((t: Turn) => void) | null = null;
  private pendingTurns: Turn[] = [];

  constructor(readonly url: string) {}

  connect(name: string, code: string, spectator = false, flag?: PlayerFlag): void {
    this.hello = { t: 'hello', name, version: NET_VERSION, spectator, code, ...(flag ? { flag } : {}) };
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.onStatus(true);
      if (this.hello) this.send({ ...this.hello, ...(this.token ? { token: this.token } : {}) });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as ServerMsg);
    ws.onclose = () => {
      this.onStatus(false);
      if (this.pingTimer) clearInterval(this.pingTimer);
      // Automatic reconnection for 60 s.
      if (!this.closed && this.retries < 30) {
        this.retries++;
        setTimeout(() => this.open(), 2000);
      }
    };
  }

  private handle(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.slot = m.slot;
        this.token = m.token;
        this.host = m.host;
        this.lobby = m.lobby;
        this.onLobby(m.lobby);
        break;
      case 'lobby':
        this.lobby = m.lobby;
        this.onLobby(m.lobby);
        break;
      case 'reject':
        this.closed = true;
        this.onReject(m.reason);
        break;
      case 'start':
        this.onStart(m.config, m.playerId, m.tick, m.snapshot);
        break;
      case 'turn':
        if (this.turnHandler) this.turnHandler(m.turn);
        else this.pendingTurns.push(m.turn);
        break;
      case 'snapshot':
        this.onSnapshot(m.snapshot, m.reason);
        break;
      case 'chat':
        this.onChat(m);
        break;
      case 'kicked':
        this.closed = true;
        this.onKicked();
        break;
      case 'pause':
        this.onPause(m.on);
        break;
      case 'pong':
        this.ping = performance.now() - m.ts;
        break;
      case 'desync':
        this.onDesync(m.tick);
        break;
    }
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Lockstep turn source for the session (turns come from the server). */
  source(_viewer: number): TurnSource {
    return new LanTurnSource(this);
  }

  /** Called by LanTurnSource.start: deliver queued turns, then live ones. */
  attach(handler: ((t: Turn) => void) | null): void {
    this.turnHandler = handler;
    if (handler) for (const t of this.pendingTurns.splice(0)) handler(t);
  }

  close(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

/** The LAN client created in the lobby and handed over to the game screen. */
let current: LanClient | null = null;
export function setCurrentLan(c: LanClient | null): void {
  current = c;
}
export function currentLan(): LanClient | null {
  return current;
}

class LanTurnSource implements TurnSource {
  onTurn: (turn: Turn) => void = () => {};
  paused = false;

  constructor(private readonly client: LanClient) {}

  get canPause(): boolean {
    return this.client.host;
  }

  submit(c: Command): void {
    this.client.send({ t: 'cmd', c });
  }

  start(): void {
    this.client.attach((t) => this.onTurn(t));
  }

  stop(): void {
    this.client.attach(null);
  }

  setPaused(p: boolean): void {
    if (this.client.host) this.client.send({ t: 'pause', on: p });
    this.paused = p;
  }

  setSpeed(): void {}

  ack(): void {}
}
