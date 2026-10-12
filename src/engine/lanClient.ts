// LAN client: lobby connection + lockstep turn source fed by the host's server.
import type { ClientMsg, LobbyState, ServerMsg } from '../server/protocol';
import { NET_VERSION } from '../server/protocol';
import type { Command, Turn } from '../core/net/commands';
import type { TurnSource } from './turns';
import type { Snapshot } from '../core/net/snapshot';
import type { GameConfig } from '../core/game/config';
import { sanitizeFlag, type PlayerFlag } from '../core/data/flagSpec';

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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the server was last heard (performance.now()): it speaks every 2 s at least. */
  private heard = 0;
  private readonly onVisible = () => {
    if (document.visibilityState !== 'visible' || this.closed) return;
    // Back on the page (a phone's screen unlocked): the connection may have died meanwhile
    // without a word; it gets a few seconds to speak, and is opened again at once if closed.
    this.heard = performance.now();
    if (this.ws) return;
    this.retries = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open();
  };
  onLobby: (l: LobbyState) => void = () => {};
  onStart: (config: GameConfig, playerId: number, tick: number, snapshot?: Snapshot) => void = () => {};
  onSnapshot: (s: Snapshot, reason: string) => void = () => {};
  onChat: (m: Extract<ServerMsg, { t: 'chat' }>) => void = () => {};
  /** Turned away; `host` is the host's game version (a 'game' mismatch). */
  onReject: (reason: string, host?: string) => void = () => {};
  onKicked: () => void = () => {};
  onDesync: (tick: number) => void = () => {};
  onPause: (on: boolean) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  private turnHandler: ((t: Turn) => void) | null = null;
  private pendingTurns: Turn[] = [];

  constructor(readonly url: string) {}

  connect(name: string, code: string, spectator = false, flag?: PlayerFlag, game?: string): void {
    this.hello = {
      t: 'hello',
      name,
      version: NET_VERSION,
      spectator,
      code,
      ...(flag ? { flag } : {}),
      ...(game ? { game } : {}),
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
    this.open();
  }

  private open(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.heard = performance.now();
      this.onStatus(true);
      if (this.hello) this.send({ ...this.hello, ...(this.token ? { token: this.token } : {}) });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        // Silent for 8 s (a connection gone without closing, which can take long to
        // say so): let go, and opened again.
        if (performance.now() - this.heard > 8000) {
          ws.close();
          this.lost(ws);
          return;
        }
        this.send({ t: 'ping', ts: performance.now() });
      }, 2000);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.heard = performance.now();
      this.handle(JSON.parse(String(ev.data)) as ServerMsg);
    };
    ws.onclose = () => this.lost(ws);
  }

  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.onStatus(false);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    // Automatic reconnection for 60 s (and again whenever the page comes back in sight).
    if (!this.closed && this.retries < 30) {
      this.retries++;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        if (!this.closed) this.open();
      }, 2000);
    }
  }

  private handle(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.slot = m.slot;
        this.token = m.token;
        this.host = m.host;
        this.lobby = cleanLobby(m.lobby);
        this.onLobby(this.lobby);
        break;
      case 'lobby':
        this.lobby = cleanLobby(m.lobby);
        this.onLobby(this.lobby);
        break;
      case 'reject':
        this.closed = true;
        this.onReject(m.reason, m.host);
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
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    this.ws?.close();
  }
}

/**
 * Flags as the lobby draws them: the host's server sanitises what players send, but a
 * modified host could still pass a malformed flag that would throw while rendering.
 */
function cleanLobby(l: LobbyState): LobbyState {
  const players = Array.isArray(l.players) ? l.players : [];
  return {
    ...l,
    players: players.map((p) => {
      const { flag, ...rest } = p;
      const f = sanitizeFlag(flag);
      return f ? { ...rest, flag: f } : rest;
    }),
  };
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
