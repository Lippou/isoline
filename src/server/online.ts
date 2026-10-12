// Isoline online (web version on the Binotech server): one Node process serves the game's
// files and hosts several rooms, each one a LanServer without its own port. Players are known
// by their Binotech account: the portal checks the session and Caddy passes the identity in
// the Remote-* headers, believed only when the request comes from the Caddy container.
//
//   GET  /online/api/me              { pseudo }            the name I play under
//   POST /online/api/me              { pseudo }            change it (kept on the server)
//   GET  /online/api/rooms           [ room… ]             the open rooms
//   POST /online/api/rooms           { config } → { code } open a room (I become its host)
//   WS   /online/ws?code=XXXXXX                            a room's lobby, then the game
//
// Environment: ISO_SITE (game files), ISO_DATA (pseudonyms), ISO_PROXY (Caddy's container
// name; empty = trust every caller, local tests only), ISO_ORIGIN (the page's origin), PORT,
// ISO_SELF (this file: when it or the site changes, the process exits once no game is being
// played, and Docker starts the new version).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import dns from 'node:dns/promises';
import { WebSocketServer, type WebSocket } from 'ws';
import { LanServer, type Account } from './server';
import { makeCode, type LobbyState } from './protocol';
import { loadMap } from '../core/map/format';
import { generateMap } from '../core/map/generator';
import type { GameConfig } from '../core/game/config';
import type { GameMap, MapMeta } from '../core/map/gamemap';

declare const __BUILD_ID__: string;
/** The web build this server runs the simulation of (its entry script): players must load it. */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const env = (k: string, d = '') => process.env[k] ?? d;
const SITE = path.resolve(env('ISO_SITE', '/srv/site'));
const DATA = path.resolve(env('ISO_DATA', '/data'));
const PROXY = env('ISO_PROXY');
const ORIGIN = env('ISO_ORIGIN');
const PORT = Number(env('PORT', '8080'));
const SELF = env('ISO_SELF');

const MAX_ROOMS = 8;
const MAX_ROOMS_PER_ACCOUNT = 2;
const EMPTY_LOBBY_MS = 90_000;
const EMPTY_GAME_MS = 180_000;
const HOST_WAIT_MS = 12_000;

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

// ------------------------------------------------------------------ identity
let proxyIps: string[] = [];
let proxyAt = 0;
async function proxyAddresses(): Promise<string[]> {
  if (Date.now() - proxyAt > 30_000) {
    proxyAt = Date.now();
    try {
      proxyIps = (await dns.lookup(PROXY, { all: true })).map((a) => a.address);
    } catch {
      /* keep the last known */
    }
  }
  return proxyIps;
}
const bare = (ip: string | undefined) => (ip ?? '').replace(/^::ffff:/, '');

/** The account behind a request, or null (not through Caddy, or no identity). */
async function accountOf(req: http.IncomingMessage): Promise<Account | null> {
  if (PROXY && !(await proxyAddresses()).includes(bare(req.socket.remoteAddress))) return null;
  const user = header(req, 'remote-user');
  if (!user || !/^[\w.@+-]{1,64}$/.test(user)) return null;
  return { user, name: pseudoOf(user, header(req, 'remote-name')) };
}
/** The portal sends UTF-8 bytes in its headers; Node reads them as Latin-1. */
function header(req: http.IncomingMessage, k: string): string {
  const v = req.headers[k];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? Buffer.from(s, 'latin1').toString('utf8').trim() : '';
}
/** A page of another site cannot use the player's session to act here. */
function sameOrigin(req: http.IncomingMessage): boolean {
  return !ORIGIN || req.headers.origin === ORIGIN;
}

// ------------------------------------------------------------------ pseudonyms
const PSEUDOS = path.join(DATA, 'pseudos.json');
let pseudos: Record<string, string> = {};
try {
  pseudos = JSON.parse(fs.readFileSync(PSEUDOS, 'utf8')) as Record<string, string>;
} catch {
  pseudos = {};
}
export function cleanPseudo(s: unknown): string {
  return String(s ?? '')
    .replace(/[\p{C}<>]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
    .trim();
}
function pseudoOf(user: string, fullName: string): string {
  return pseudos[user] || cleanPseudo(fullName.split(' ')[0]) || cleanPseudo(user.split('@')[0]) || 'Joueur';
}
function savePseudo(user: string, pseudo: string): void {
  pseudos[user] = pseudo;
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(`${PSEUDOS}.tmp`, JSON.stringify(pseudos));
    fs.renameSync(`${PSEUDOS}.tmp`, PSEUDOS);
  } catch (e) {
    log(`pseudonyms not saved: ${String(e)}`);
  }
}

// ------------------------------------------------------------------ maps
const mapsDir = path.join(SITE, 'assets', 'maps');
function builtInMap(id: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(id) && fs.existsSync(path.join(mapsDir, `${id}.json`));
}
/** What a room may be set to: shipped maps or a generated one of a sane size (no custom file). */
export function checkConfig(c: GameConfig, isMap: (id: string) => boolean = builtInMap): boolean {
  if (!c || typeof c !== 'object' || typeof c.mapId !== 'string') return false;
  if (!(c.nations >= 0 && c.nations <= 400 && c.tribes >= 0 && c.tribes <= 400)) return false;
  if (c.mode === 'campaign') return false;
  if (c.procedural) {
    const { width: w, height: h } = c.procedural;
    return Number.isInteger(w) && Number.isInteger(h) && w >= 100 && h >= 100 && w * h <= 2400 * 1600;
  }
  return isMap(c.mapId);
}
async function mapFor(config: GameConfig): Promise<GameMap> {
  if (config.procedural) return generateMap(config.procedural);
  const id = path.basename(config.mapId);
  const meta = JSON.parse(fs.readFileSync(path.join(mapsDir, `${id}.json`), 'utf8')) as MapMeta;
  return loadMap(
    meta,
    fs.readFileSync(path.join(mapsDir, `${id}.png`)),
    fs.readFileSync(path.join(mapsDir, `${id}.elev.png`)),
  );
}

// ------------------------------------------------------------------ rooms
interface Room {
  code: string;
  owner: string;
  server: LanServer;
  createdAt: number;
  emptySince: number;
}
const rooms = new Map<string, Room>();
let updating = false;

export interface RoomInfo {
  code: string;
  name: string;
  host: string;
  players: number;
  spectators: number;
  map: string;
  procedural: boolean;
  mode: string;
  started: boolean;
  spectate: boolean;
  mine: boolean;
  /** I have a nation in this game (to take up again). */
  seat: boolean;
}

function info(r: Room, me: string): RoomInfo {
  const l: LobbyState = r.server.lobby();
  const on = l.players.filter((p) => p.connected);
  return {
    code: r.code,
    name: l.name,
    host: l.players.find((p) => p.host)?.name ?? '',
    players: on.filter((p) => !p.spectator).length,
    spectators: on.filter((p) => p.spectator).length,
    map: l.config.mapId,
    procedural: !!l.config.procedural,
    mode: l.config.mode,
    started: l.started,
    spectate: l.config.allowSpectators,
    mine: r.owner === me,
    seat: !!me && r.server.hasAccount(me),
  };
}

function closeRoom(r: Room, why: string): void {
  r.server.stop();
  rooms.delete(r.code);
  log(`room ${r.code} closed (${why})`);
}

function openRoom(me: Account, config: GameConfig): Room | string {
  if (updating) return 'updating';
  if (!checkConfig(config)) return 'config';
  // My earlier rooms nobody waits in go first.
  for (const r of [...rooms.values()])
    if (r.owner === me.user && !r.server.started && !info(r, '').players) closeRoom(r, 'reopened');
  if ([...rooms.values()].filter((r) => r.owner === me.user).length >= MAX_ROOMS_PER_ACCOUNT) return 'mine';
  if (rooms.size >= MAX_ROOMS) return 'full';
  let code = makeCode(Math.random);
  while (rooms.has(code)) code = makeCode(Math.random);
  const server = new LanServer({
    name: me.name,
    config: { ...config, seed: (Math.random() * 2 ** 31) >>> 0 },
    loadMap: mapFor,
    discovery: false,
    gameVersion: BUILD_ID,
    hostUser: me.user,
    checkConfig: (c) => checkConfig(c),
    code,
    log,
  });
  const room: Room = { code, owner: me.user, server, createdAt: Date.now(), emptySince: Date.now() };
  rooms.set(code, room);
  log(`room ${code} opened by ${me.user} on ${config.procedural ? 'a generated map' : config.mapId}`);
  return room;
}

/** Every 5 s: empty rooms go, a room whose opener never came gets a host. */
function sweep(): void {
  const now = Date.now();
  for (const r of [...rooms.values()]) {
    const l = r.server.lobby();
    const anyone = l.players.some((p) => p.connected);
    if (anyone) r.emptySince = 0;
    else if (!r.emptySince) r.emptySince = now;
    if (!anyone && r.emptySince && now - r.emptySince > (l.started ? EMPTY_GAME_MS : EMPTY_LOBBY_MS))
      closeRoom(r, 'empty');
    else if (!l.started && now - r.createdAt > HOST_WAIT_MS) r.server.ensureHost();
  }
  if (updating && ![...rooms.values()].some((r) => r.server.started && info(r, '').players > 0)) {
    log('new version: restarting');
    process.exit(0);
  }
}

// ------------------------------------------------------------------ files
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.ico', '.txt']);
const packed = new Map<string, { mtime: number; br: Buffer; gz: Buffer }>();

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return end(res, 400);
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(SITE, path.normalize(rel));
  if (!file.startsWith(SITE + path.sep) || /(^|[\\/])\./.test(path.relative(SITE, file)))
    return end(res, 404);
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return end(res, 404);
  }
  if (!st.isFile()) return end(res, 404);
  const ext = path.extname(file).toLowerCase();
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.setHeader(
    'Cache-Control',
    /-[A-Za-z0-9_]{8}\.(js|css|woff2)$/.test(file)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  if (req.headers['if-none-match'] === etag) return end(res, 304);
  const accept = String(req.headers['accept-encoding'] ?? '');
  if (COMPRESS.has(ext) && /\b(br|gzip)\b/.test(accept)) {
    res.setHeader('Vary', 'Accept-Encoding');
    let p = packed.get(file);
    if (!p || p.mtime !== st.mtimeMs) {
      const raw = fs.readFileSync(file);
      p = {
        mtime: st.mtimeMs,
        br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }),
        gz: zlib.gzipSync(raw, { level: 9 }),
      };
      packed.set(file, p);
    }
    const br = /\bbr\b/.test(accept);
    const body = br ? p.br : p.gz;
    res.setHeader('Content-Encoding', br ? 'br' : 'gzip');
    res.setHeader('Content-Length', body.length);
    res.writeHead(200);
    return void res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.setHeader('Content-Length', st.size);
  res.writeHead(200);
  if (req.method === 'HEAD') return void res.end();
  fs.createReadStream(file).pipe(res);
}

function end(res: http.ServerResponse, code: number): void {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(code === 404 ? 'Not found' : String(code));
}
function json(res: http.ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(s);
}
function readBody(req: http.IncomingMessage, max = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let n = 0;
    req.on('data', (b: Buffer) => {
      n += b.length;
      if (n > max) {
        reject(new Error('too large'));
        req.destroy();
      } else parts.push(b);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch (e) {
        reject(e as Error);
      }
    });
    req.on('error', reject);
  });
}

// ------------------------------------------------------------------ API
async function api(req: http.IncomingMessage, res: http.ServerResponse, route: string): Promise<void> {
  const me = await accountOf(req);
  if (!me) return json(res, 403, { error: 'account' });
  const post = req.method === 'POST';
  if (post && (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')))
    return json(res, 403, { error: 'origin' });
  if (route === 'me' && !post) return json(res, 200, { pseudo: me.name, build: BUILD_ID });
  if (route === 'me' && post) {
    const body = (await readBody(req).catch(() => null)) as { pseudo?: unknown } | null;
    const pseudo = cleanPseudo(body?.pseudo);
    if (pseudo.length < 2) return json(res, 400, { error: 'pseudo' });
    savePseudo(me.user, pseudo);
    return json(res, 200, { pseudo });
  }
  if (route === 'rooms' && !post)
    return json(res, 200, {
      rooms: [...rooms.values()].map((r) => info(r, me.user)).sort((a, b) => +a.started - +b.started),
      build: BUILD_ID,
      updating,
    });
  if (route === 'rooms' && post) {
    const body = (await readBody(req).catch(() => null)) as { config?: GameConfig } | null;
    const r = body?.config ? openRoom(me, body.config) : 'config';
    if (typeof r === 'string') return json(res, r === 'config' ? 400 : 409, { error: r });
    return json(res, 200, { code: r.code });
  }
  return json(res, 404, { error: 'route' });
}

// ------------------------------------------------------------------ server
export function startOnline(): http.Server {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname.startsWith('/online/api/')) {
      api(req, res, url.pathname.slice('/online/api/'.length)).catch((e: unknown) => {
        log(`api error ${String(e)}`);
        if (!res.headersSent) json(res, 500, { error: 'server' });
      });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405);
    serveFile(req, res, url.pathname);
  });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const me = await accountOf(req);
      if (url.pathname !== '/online/ws' || !me || !sameOrigin(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        const room = rooms.get(String(url.searchParams.get('code') ?? '').toUpperCase());
        if (!room) {
          ws.send(JSON.stringify({ t: 'reject', reason: 'code' }));
          return ws.close();
        }
        room.server.accept(ws, me);
        ws.on('close', (c) => log(`room ${room.code}: ${me.user} left (${c})`));
      });
    })();
  });
  server.listen(PORT, '0.0.0.0', () => log(`Isoline online on ${PORT}, build ${BUILD_ID}, site ${SITE}`));
  setInterval(sweep, 5000).unref();
  watchForUpdate();
  return server;
}

/** A new version (this file or the site) is in place: restart once no game is being played. */
function watchForUpdate(): void {
  const files = [SELF, path.join(SITE, 'index.html')].filter(Boolean);
  const stamp = () => files.map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0).join(',');
  const first = stamp();
  setInterval(() => {
    if (!updating && stamp() !== first) {
      updating = true;
      log('new version in place: waiting for the games in progress to end');
    }
  }, 15_000).unref();
}
