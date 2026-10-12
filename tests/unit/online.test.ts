// The online server (web version on the Binotech server): accounts from the portal's headers,
// rooms opened, listed and joined, the opener as host, a nation found again by its account.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { defaultConfig } from '../../src/core/game/config';
import { defaultGenParams } from '../../src/core/map/generator';
import { NET_VERSION, type ServerMsg } from '../../src/server/protocol';

const ORIGIN = 'https://isoline.test';
let server: http.Server;
let base = '';
let mod: typeof import('../../src/server/online');

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-online-'));
  fs.mkdirSync(path.join(dir, 'site', 'assets'), { recursive: true });
  fs.symlinkSync(path.resolve('assets/maps'), path.join(dir, 'site', 'assets', 'maps'));
  fs.writeFileSync(path.join(dir, 'site', 'index.html'), '<!doctype html><title>Isoline</title>');
  Object.assign(process.env, {
    ISO_SITE: path.join(dir, 'site'),
    ISO_DATA: path.join(dir, 'data'),
    ISO_PROXY: '',
    ISO_ORIGIN: ORIGIN,
    PORT: '0',
  });
  mod = await import('../../src/server/online');
  server = mod.startOnline();
  await new Promise<void>((r) => (server.listening ? r() : server.once('listening', () => r())));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

const who = (user: string, name = user) => ({
  'Remote-User': user,
  'Remote-Name': Buffer.from(name, 'utf8').toString('latin1'),
});
async function api(route: string, user: string | null, body?: unknown, origin = ORIGIN) {
  const r = await fetch(`http://${base}/online/api/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(user ? who(user, user === 'mamie' ? 'Mamie Jeanne' : user) : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

/** A player's socket in a room; collects what the server says. */
function enter(code: string, user: string): Promise<{ ws: WebSocket; inbox: ServerMsg[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/online/ws?code=${code}`, {
      headers: { ...who(user, user === 'mamie' ? 'Mamie Jeanne' : user), Origin: ORIGIN },
    });
    const inbox: ServerMsg[] = [];
    ws.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as ServerMsg));
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          t: 'hello',
          name: 'forged',
          version: NET_VERSION,
          spectator: false,
          code,
          game: mod.BUILD_ID,
        }),
      );
      resolve({ ws, inbox });
    });
    ws.on('error', reject);
  });
}
const until = async (f: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('online server', () => {
  it('knows the account from the portal headers only', async () => {
    expect((await api('me', null)).status).toBe(403);
    const me = await api('me', 'mamie');
    expect(me.body.pseudo).toBe('Mamie');
  });

  it('keeps a chosen name, cleaned', async () => {
    expect((await api('me', 'papy', { pseudo: '  Papy\u0000 <b>Jo</b>  ' })).body.pseudo).toBe('Papy bJo/b');
    expect((await api('me', 'papy')).body.pseudo).toBe('Papy bJo/b');
    expect((await api('me', 'papy', { pseudo: 'x' })).status).toBe(400);
  });

  it('refuses a request from another site', async () => {
    expect((await api('me', 'papy', { pseudo: 'Papy' }, 'https://evil.test')).status).toBe(403);
  });

  it('only opens rooms on shipped or generated maps', () => {
    const c = defaultConfig(1);
    expect(mod.checkConfig(c, () => true)).toBe(true);
    expect(mod.checkConfig({ ...c, mapId: 'custom:x.isomap' }, (id) => id === 'world')).toBe(false);
    expect(
      mod.checkConfig({
        ...c,
        mapId: 'gen',
        procedural: { ...defaultGenParams(1), width: 9000, height: 9000 },
      }),
    ).toBe(false);
  });

  it('opens, lists and joins a room; the opener is its host; names come from the accounts', async () => {
    const opened = await api('rooms', 'mamie', { config: { ...defaultConfig(1), mapId: 'black-sea' } });
    expect(opened.status).toBe(200);
    const code = String(opened.body.code);
    // A guest who comes first is not the host.
    const bob = await enter(code, 'bob');
    const mamie = await enter(code, 'mamie');
    await until(() => mamie.inbox.some((m) => m.t === 'welcome'));
    const w = (x: { inbox: ServerMsg[] }) =>
      x.inbox.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }>;
    await until(() => !!w(bob));
    expect(w(mamie).host).toBe(true);
    expect(w(bob).host).toBe(false);
    await until(() => mamie.inbox.some((m) => m.t === 'lobby' && m.lobby.players.length === 2));
    const last = [...mamie.inbox].reverse().find((m) => m.t === 'lobby') as Extract<
      ServerMsg,
      { t: 'lobby' }
    >;
    expect(last.lobby.players.map((p) => p.name).sort()).toEqual(['Mamie', 'bob']);

    const list = await api('rooms', 'bob');
    const rooms = list.body.rooms as { code: string; players: number; mine: boolean }[];
    expect(rooms.find((r) => r.code === code)).toMatchObject({ players: 2, mine: false });

    // Started, then Bob's tab closes: his account finds his nation again.
    mamie.ws.send(JSON.stringify({ t: 'start' }));
    await until(() => bob.inbox.some((m) => m.t === 'start'), 8000);
    const pid = (bob.inbox.find((m) => m.t === 'start') as Extract<ServerMsg, { t: 'start' }>).playerId;
    bob.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const again = await enter(code, 'bob');
    await until(() => again.inbox.some((m) => m.t === 'start'), 8000);
    const back = again.inbox.find((m) => m.t === 'start') as Extract<ServerMsg, { t: 'start' }>;
    expect(back.playerId).toBe(pid);
    expect(back.snapshot).toBeTruthy();
    const seat = ((await api('rooms', 'bob')).body.rooms as { code: string; seat: boolean }[]).find(
      (r) => r.code === code,
    );
    expect(seat?.seat).toBe(true);
    again.ws.close();
    mamie.ws.close();
  }, 20000);

  it('turns away an unknown room and an older page', async () => {
    const x = await enter('ZZZZZZ', 'bob');
    await until(() => x.inbox.length > 0);
    expect(x.inbox[0]).toMatchObject({ t: 'reject', reason: 'code' });
    const opened = await api('rooms', 'papy', { config: { ...defaultConfig(2), mapId: 'black-sea' } });
    const code = String(opened.body.code);
    const ws = new WebSocket(`ws://${base}/online/ws?code=${code}`, {
      headers: { ...who('papy'), Origin: ORIGIN },
    });
    const inbox: ServerMsg[] = [];
    ws.on('message', (raw) => inbox.push(JSON.parse(String(raw)) as ServerMsg));
    await new Promise((r) => ws.on('open', r));
    ws.send(
      JSON.stringify({
        t: 'hello',
        name: 'p',
        version: NET_VERSION,
        spectator: false,
        code,
        game: 'index-old',
      }),
    );
    await until(() => inbox.length > 0);
    expect(inbox[0]).toMatchObject({ t: 'reject', reason: 'game' });
  });
});
