import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { LanServer } from '../../src/server/server';
import { mapFromDisk } from '../helpers';
import { Game } from '../../src/core/game/state';
import { hashGame } from '../../src/core/net/hash';
import { restoreSnapshot } from '../../src/core/net/snapshot';
import { defaultConfig } from '../../src/core/game/config';
import type { ClientMsg, ServerMsg } from '../../src/server/protocol';
import { NET_VERSION } from '../../src/server/protocol';
import { HASH_EVERY } from '../../src/core/game/constants';
import { Rng } from '../../src/core/rng';

/** Headless lockstep client: runs its own Game from the server's turns. */
class Bot {
  ws: WebSocket;
  game: Game | null = null;
  playerId = -1;
  token = '';
  hashesSent = 0;
  desyncs = 0;
  inbox: ServerMsg[] = [];
  private rng: Rng;
  constructor(
    url: string,
    readonly name: string,
    code: string,
    seed: number,
    token = '',
  ) {
    this.rng = new Rng(seed);
    this.ws = new WebSocket(url);
    this.ws.on('open', () =>
      this.send({
        t: 'hello',
        name,
        version: NET_VERSION,
        spectator: false,
        code,
        ...(token ? { token } : {}),
      }),
    );
    this.ws.on('message', (raw) => this.handle(JSON.parse(String(raw)) as ServerMsg));
  }
  send(m: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  handle(m: ServerMsg): void {
    this.inbox.push(m);
    if (m.t === 'welcome') this.token = m.token;
    if (m.t === 'start') {
      this.playerId = m.playerId;
      this.game = m.snapshot
        ? restoreSnapshot(mapFromDisk(m.config.mapId), m.snapshot)
        : new Game(mapFromDisk(m.config.mapId), m.config);
    }
    if (m.t === 'snapshot' && this.game)
      this.game = restoreSnapshot(mapFromDisk(this.game.config.mapId), m.snapshot);
    if (m.t === 'desync') this.desyncs++;
    if (m.t === 'turn' && this.game) {
      if (m.turn.tick !== this.game.tick) return;
      this.game.step(m.turn.cmds);
      if (this.game.tick % HASH_EVERY === 0) {
        this.send({ t: 'hash', tick: this.game.tick, hash: hashGame(this.game) });
        this.hashesSent++;
      }
      this.act();
    }
  }
  /** Plays a little: spawn, expand, build, attack neighbours. */
  act(): void {
    const g = this.game!;
    if (this.playerId <= 0) return;
    if (g.phase === 'spawn' && g.tick === 2) {
      const pts = g.map.meta.spawnPoints;
      const [x, y] = pts[(this.playerId * 37) % pts.length]!;
      this.send({ t: 'cmd', c: { t: 'spawn', tile: g.map.idx(x, y) } });
    }
    if (g.phase !== 'playing' || g.tick % 25 !== 0) return;
    const me = g.players[this.playerId]!;
    if (!me.alive || me.border.length === 0) return;
    const b = me.border[this.rng.int(0, me.border.length - 1)]!;
    const nb = [b - 1, b + 1, b - g.map.width, b + g.map.width].find(
      (t) => t >= 0 && t < g.map.size && g.owner[t] !== this.playerId && g.map.isLand(t),
    );
    if (nb !== undefined) this.send({ t: 'cmd', c: { t: 'attack', tile: nb, ratio: 0.3 } });
    if (me.gold > 200_000 && this.rng.chance(0.3))
      this.send({ t: 'cmd', c: { t: 'build', kind: 0, tile: me.border[0]! } });
  }
  close(): void {
    this.ws.close();
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 30_000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(10);
  }
}

describe('LAN lockstep server', () => {
  it('4 clients stay in sync (hash checks) for 20 game minutes, with reconnection', async () => {
    const config = {
      ...defaultConfig(99),
      mapId: 'black-sea',
      nations: 6,
      tribes: 8,
      spawnSeconds: 2,
      players: [],
    };
    const server = new LanServer({
      name: 'test',
      config,
      loadMap: async (c) => mapFromDisk(c.mapId),
      tickMs: 4,
      discovery: false,
      port: 0,
    });
    const { port, code } = await server.start();
    const url = `ws://127.0.0.1:${port}`;
    const bots = [0, 1, 2, 3].map((k) => new Bot(url, `Bot${k}`, code, 1000 + k));
    await until(() => bots.every((b) => b.token));
    // Wrong code is rejected.
    const intruder = new Bot(url, 'Intruder', 'XXXXXX', 1);
    await until(() => intruder.inbox.some((m) => m.t === 'reject'));
    await server.startGame();
    await until(() => bots.every((b) => b.game));
    expect(bots.map((b) => b.playerId).sort()).toEqual([1, 2, 3, 4]);
    await until(() => server.game!.tick >= 2500, 120_000);
    // Disconnect bot 3, it becomes inactive (Zzz), then reconnect with its token.
    const token = bots[3]!.token;
    bots[3]!.close();
    await until(() => server.game!.players[4]!.inactive, 20_000);
    const back = new Bot(url, 'Bot3', code, 2000, token);
    bots[3] = back;
    await until(() => !!back.game && back.playerId === 4, 20_000);
    await until(() => !server.game!.players[4]!.inactive, 20_000);
    await until(() => server.game!.tick >= 12_000, 300_000);
    await wait(100);
    for (const b of bots) {
      expect(b.desyncs).toBe(0);
      expect(b.hashesSent).toBeGreaterThan(10);
    }
    expect(server.desyncs).toBe(0);
    // Freeze the server, let clients catch up, then compare full state hashes.
    server.paused = true;
    const target = server.game!.tick;
    await until(() => bots.every((b) => b.game!.tick === target), 20_000);
    const h = hashGame(server.game!);
    for (const b of bots) expect(hashGame(b.game!)).toBe(h);
    server.stop();
    for (const b of bots) b.close();
    intruder.close();
  }, 400_000);
});
