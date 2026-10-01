// Embedded LAN server (Node): lobby, lockstep turn relay, authoritative simulation
// for validation / resync / reconnection, hash checks, spectators, UDP discovery.
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Game } from '../core/game/state';
import type { GameMap } from '../core/map/gamemap';
import type { GameConfig } from '../core/game/config';
import { isWellFormed, type Command, type StampedCommand } from '../core/net/commands';
import { takeSnapshot } from '../core/net/snapshot';
import { hashGame } from '../core/net/hash';
import { HASH_EVERY } from '../core/game/constants';
import { checkPlacement } from '../core/buildings/buildings';
import {
  DISCOVERY_PORTS,
  NET_VERSION,
  makeCode,
  type Beacon,
  type ClientMsg,
  type LobbyPlayer,
  type LobbyState,
  type ServerMsg,
} from './protocol';

export interface ServerOptions {
  name: string;
  config: GameConfig;
  loadMap: (config: GameConfig) => Promise<GameMap>;
  /** Fixed port (tests); otherwise a free port in 40000–49999 is chosen. */
  port?: number;
  /** Milliseconds per tick at speed ×1 (100 in play; smaller in tests). */
  tickMs?: number;
  discovery?: boolean;
  maxPlayers?: number;
  log?: (msg: string) => void;
}

interface Client {
  ws: WebSocket | null;
  slot: number;
  token: string;
  name: string;
  spectator: boolean;
  ready: boolean;
  team: number;
  general: LobbyPlayer['general'];
  host: boolean;
  playerId: number;
  ping: number;
  disconnectedAt: number;
  cmdWindow: number[];
}

const RECONNECT_GRACE_MS = 60_000;

export class LanServer {
  private http: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private udp: dgram.Socket | null = null;
  private beaconTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private clients: Client[] = [];
  private nextSlot = 0;
  readonly code: string;
  port = 0;
  config: GameConfig;
  game: Game | null = null;
  started = false;
  paused = false;
  private pending: StampedCommand[] = [];
  private hashes = new Map<number, number>();
  private readonly tickMs: number;
  desyncs = 0;
  stopped = false;

  constructor(private readonly opts: ServerOptions) {
    this.code = makeCode(Math.random);
    this.config = opts.config;
    this.tickMs = opts.tickMs ?? 100;
  }

  private log(m: string): void {
    this.opts.log?.(`[lan] ${m}`);
  }

  async start(): Promise<{ port: number; code: string }> {
    this.http = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Isoline LAN server');
    });
    this.port = await this.listen(this.http);
    this.wss = new WebSocketServer({ server: this.http, maxPayload: 512 * 1024 });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    if (this.opts.discovery !== false) this.startBeacons();
    this.log(`listening on ${this.port} code ${this.code}`);
    return { port: this.port, code: this.code };
  }

  /** Try the requested port, else random free ports in 40000–49999 (verified by binding). */
  private async listen(server: http.Server): Promise<number> {
    const attempt = (port: number) =>
      new Promise<boolean>((resolve) => {
        const onErr = () => {
          server.removeListener('listening', onOk);
          resolve(false);
        };
        const onOk = () => {
          server.removeListener('error', onErr);
          resolve(true);
        };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(port, '0.0.0.0');
      });
    if (this.opts.port !== undefined) {
      if (await attempt(this.opts.port)) return (server.address() as { port: number }).port;
    }
    for (let k = 0; k < 40; k++) {
      const p = 40000 + Math.floor(Math.random() * 10000);
      if (await attempt(p)) return p;
    }
    if (await attempt(0)) return (server.address() as { port: number }).port;
    throw new Error('no free port');
  }

  stop(): void {
    this.stopped = true;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.beaconTimer) clearInterval(this.beaconTimer);
    this.udp?.close();
    for (const c of this.clients) c.ws?.close();
    this.wss?.close();
    this.http?.close();
  }

  // ------------------------------------------------------------- discovery
  private startBeacons(): void {
    try {
      this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udp.bind(() => {
        this.udp!.setBroadcast(true);
        this.beaconTimer = setInterval(() => this.beacon(), 1000);
      });
      this.udp.on('error', (e) => this.log(`udp error ${e.message}`));
    } catch (e) {
      this.log(`discovery disabled: ${String(e)}`);
    }
  }

  private beacon(): void {
    const b: Beacon = {
      isoline: NET_VERSION,
      name: this.opts.name,
      port: this.port,
      code: this.code,
      players: this.clients.filter((c) => c.ws).length,
      map: this.config.mapId,
      started: this.started,
    };
    const msg = Buffer.from(JSON.stringify(b));
    for (const addr of broadcastAddresses()) for (const p of DISCOVERY_PORTS) this.udp?.send(msg, p, addr);
  }

  // ------------------------------------------------------------- lobby
  lobby(): LobbyState {
    return {
      code: this.code,
      name: this.opts.name,
      config: this.config,
      started: this.started,
      paused: this.paused,
      players: this.clients.map((c) => ({
        slot: c.slot,
        name: c.name,
        ready: c.ready,
        connected: !!c.ws,
        spectator: c.spectator,
        team: c.team,
        general: c.general,
        host: c.host,
        playerId: c.playerId,
        ping: c.ping,
      })),
    };
  }

  private send(c: Client, m: ServerMsg): void {
    if (c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  }

  private broadcast(m: ServerMsg): void {
    const s = JSON.stringify(m);
    for (const c of this.clients) if (c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(s);
  }

  private pushLobby(): void {
    this.broadcast({ t: 'lobby', lobby: this.lobby() });
  }

  private onConnection(ws: WebSocket): void {
    let client: Client | null = null;
    ws.on('message', (raw) => {
      let m: ClientMsg;
      try {
        m = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        return;
      }
      if (!client) {
        if (m.t !== 'hello') return;
        client = this.hello(ws, m);
        return;
      }
      this.handle(client, m);
    });
    ws.on('close', () => {
      if (client) this.onDisconnect(client);
    });
  }

  private hello(ws: WebSocket, m: Extract<ClientMsg, { t: 'hello' }>): Client | null {
    const reject = (reason: 'version' | 'code' | 'full' | 'started') => {
      ws.send(JSON.stringify({ t: 'reject', reason } satisfies ServerMsg));
      ws.close();
      return null;
    };
    if (m.version !== NET_VERSION) return reject('version');
    if (m.code !== this.code) return reject('code');
    // Reconnection.
    if (m.token) {
      const old = this.clients.find(
        (c) =>
          c.token === m.token && (!c.disconnectedAt || Date.now() - c.disconnectedAt <= RECONNECT_GRACE_MS),
      );
      if (old) {
        old.ws = ws;
        old.disconnectedAt = 0;
        this.send(old, {
          t: 'welcome',
          slot: old.slot,
          token: old.token,
          host: old.host,
          lobby: this.lobby(),
        });
        if (this.started && this.game) {
          if (old.playerId > 0)
            this.pending.push({ p: old.playerId, c: { t: 'setInactive', inactive: false } });
          this.send(old, {
            t: 'start',
            config: this.config,
            playerId: old.playerId,
            tick: this.game.tick,
            snapshot: takeSnapshot(this.game),
          });
        }
        this.pushLobby();
        return old;
      }
    }
    const playersNow = this.clients.filter((c) => !c.spectator).length;
    const spectator = m.spectator || this.started;
    if (this.started && !this.config.allowSpectators) return reject('started');
    if (!spectator && playersNow >= (this.opts.maxPlayers ?? 16)) return reject('full');
    const c: Client = {
      ws,
      slot: this.nextSlot++,
      token: crypto.randomUUID(),
      name: (m.name || 'Player').slice(0, 24),
      spectator,
      ready: false,
      team: 1 + (this.clients.length % Math.max(2, this.config.teamCount)),
      general: 'blitz',
      host: this.clients.length === 0,
      playerId: -1,
      ping: 0,
      disconnectedAt: 0,
      cmdWindow: [],
    };
    this.clients.push(c);
    this.send(c, { t: 'welcome', slot: c.slot, token: c.token, host: c.host, lobby: this.lobby() });
    if (this.started && this.game) {
      this.send(c, {
        t: 'start',
        config: this.config,
        playerId: -1,
        tick: this.game.tick,
        snapshot: takeSnapshot(this.game),
      });
    }
    this.pushLobby();
    this.log(`${c.name} joined (slot ${c.slot}${spectator ? ', spectator' : ''})`);
    return c;
  }

  private handle(c: Client, m: ClientMsg): void {
    switch (m.t) {
      case 'ready':
        c.ready = m.ready;
        this.pushLobby();
        break;
      case 'profile':
        c.team = Math.max(1, Math.min(8, m.team | 0));
        c.general = m.general;
        this.pushLobby();
        break;
      case 'config':
        if (c.host && !this.started) {
          this.config = { ...m.config, seed: this.config.seed };
          this.pushLobby();
        }
        break;
      case 'start':
        if (c.host && !this.started) void this.startGame();
        break;
      case 'kick': {
        if (!c.host) break;
        const target = this.clients.find((x) => x.slot === m.slot && !x.host);
        if (target) {
          this.send(target, { t: 'kicked' });
          target.ws?.close();
          if (target.playerId > 0 && this.started)
            this.pending.push({ p: target.playerId, c: { t: 'setInactive', inactive: true } });
          this.clients = this.clients.filter((x) => x !== target);
          this.pushLobby();
        }
        break;
      }
      case 'pause':
        if (c.host && this.started) {
          this.paused = m.on;
          this.broadcast({ t: 'pause', on: m.on });
        }
        break;
      case 'cmd':
        this.onCommand(c, m.c);
        break;
      case 'hash':
        this.onHash(c, m.tick, m.hash);
        break;
      case 'chat': {
        const text = String(m.text).slice(0, 200);
        const from = c.playerId;
        const recipients = this.clients.filter((x) => {
          if (m.channel === 'all' || x === c) return true;
          const g = this.game;
          if (!g || from <= 0 || x.playerId <= 0) return false;
          if (m.channel === 'team') return g.sameTeam(from, x.playerId);
          return g.friendly(from, x.playerId);
        });
        for (const r of recipients) this.send(r, { t: 'chat', from, name: c.name, channel: m.channel, text });
        break;
      }
      case 'ping':
        c.ping = 0;
        this.send(c, { t: 'pong', ts: m.ts });
        break;
    }
  }

  private onDisconnect(c: Client): void {
    c.ws = null;
    c.disconnectedAt = Date.now();
    if (!this.started) {
      this.clients = this.clients.filter((x) => x !== c);
      if (c.host && this.clients.length) this.clients[0]!.host = true;
    } else if (c.playerId > 0) {
      this.pending.push({ p: c.playerId, c: { t: 'setInactive', inactive: true } });
    }
    this.pushLobby();
    this.log(`${c.name} disconnected`);
  }

  // -------------------------------------------------------------- game
  async startGame(): Promise<void> {
    const humans = this.clients.filter((c) => !c.spectator);
    this.config = {
      ...this.config,
      players: humans.map((c, k) => ({
        slot: k,
        name: c.name,
        kind: 'human',
        team: c.team,
        general: c.general,
      })),
    };
    const map = await this.opts.loadMap(this.config);
    this.game = new Game(map, this.config);
    // Player ids follow the human slot order (see setupPlayers).
    humans.forEach((c, k) => (c.playerId = k + 1));
    this.started = true;
    for (const c of this.clients)
      this.send(c, { t: 'start', config: this.config, playerId: c.playerId, tick: 0 });
    this.pushLobby();
    this.scheduleTick();
    this.log(`game started with ${humans.length} players on ${this.config.mapId}`);
  }

  private scheduleTick(): void {
    if (this.stopped) return;
    const interval = this.tickMs / Math.max(0.25, this.config.gameSpeed || 1);
    this.tickTimer = setTimeout(() => {
      this.tick();
      this.scheduleTick();
    }, interval);
  }

  /** Produce and broadcast one turn (exposed for tests). */
  tick(): void {
    const g = this.game;
    if (!g || this.paused) return;
    this.stepTurn(g);
  }

  private stepTurn(g: Game): void {
    const cmds = this.pending;
    this.pending = [];
    const turn = { tick: g.tick, cmds };
    g.step(cmds);
    if (g.tick % HASH_EVERY === 0) {
      this.hashes.set(g.tick, hashGame(g));
      if (this.hashes.size > 40) this.hashes.delete(Math.min(...this.hashes.keys()));
    }
    this.broadcast({ t: 'turn', turn });
  }

  private onCommand(c: Client, cmd: Command): void {
    if (!this.started || !this.game || c.playerId <= 0 || c.spectator) return;
    // Rate limit: 25 commands per second per client.
    const now = Date.now();
    c.cmdWindow = c.cmdWindow.filter((t) => now - t < 1000);
    if (c.cmdWindow.length >= 25) return;
    c.cmdWindow.push(now);
    if (!isWellFormed(cmd) || cmd.t === 'setInactive') return;
    if (!validateOnServer(this.game, c.playerId, cmd)) return;
    this.pending.push({ p: c.playerId, c: cmd });
  }

  private onHash(c: Client, tick: number, hash: number): void {
    const mine = this.hashes.get(tick);
    if (mine === undefined || mine === hash || !this.game) return;
    this.desyncs++;
    this.log(`desync from ${c.name} at tick ${tick}`);
    this.send(c, { t: 'desync', tick });
    this.send(c, { t: 'snapshot', snapshot: takeSnapshot(this.game), reason: 'resync' });
  }
}

/** Cheap server-side pre-validation using the authoritative state (ownership, gold, phase). */
export function validateOnServer(g: Game, pid: number, c: Command): boolean {
  const p = g.player(pid);
  if (!p) return false;
  const inMap = (t: number) => t >= 0 && t < g.map.size;
  switch (c.t) {
    case 'spawn':
      return g.phase === 'spawn' && inMap(c.tile);
    case 'build': {
      if (!inMap(c.tile)) return false;
      const existing = g.buildings.get(g.buildingAt[c.tile]!);
      if (existing && existing.owner === pid) return true; // upgrade
      if (c.kind === 1) return true; // ports snap to the coast inside the simulation
      return checkPlacement(g, p, c.kind as never, c.tile) === 'ok';
    }
    case 'upgrade':
    case 'demolish':
      return g.buildings.get(c.id)?.owner === pid;
    case 'nuke':
    case 'attack':
    case 'boat':
    case 'warship':
    case 'air':
    case 'general':
    case 'ping':
      return inMap(c.tile) && p.alive;
    case 'donate':
      return c.gold <= p.gold + 1 && c.troops <= p.troops + 1;
    default:
      return true;
  }
}

function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const ip = ni.address.split('.').map(Number);
      const mask = ni.netmask.split('.').map(Number);
      out.add(ip.map((b, k) => (b | (~mask[k]! & 255)) & 255).join('.'));
    }
  }
  return [...out];
}

export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const ni of list ?? []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  return out;
}

/** Listen for beacons for `ms` milliseconds. */
export function discover(ms = 1500): Promise<(Beacon & { host: string })[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Beacon & { host: string }>();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let bound = false;
    const tryBind = (k: number) => {
      if (k >= DISCOVERY_PORTS.length) return;
      sock.once('error', () => tryBind(k + 1));
      sock.bind(DISCOVERY_PORTS[k]!, () => (bound = true));
    };
    sock.on('message', (msg, rinfo) => {
      try {
        const b = JSON.parse(String(msg)) as Beacon;
        if (b.isoline === NET_VERSION) found.set(`${rinfo.address}:${b.port}`, { ...b, host: rinfo.address });
      } catch {
        /* ignore */
      }
    });
    tryBind(0);
    setTimeout(() => {
      if (bound) sock.close();
      resolve([...found.values()]);
    }, ms);
  });
}
