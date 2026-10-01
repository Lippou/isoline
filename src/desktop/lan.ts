// LAN hosting bridge for the Electron main process: starts the embedded server,
// loads maps from the packaged resources, and exposes discovery to the renderer.
import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { LanServer, discover, localAddresses } from '../server/server';
import { loadMap } from '../core/map/format';
import { generateMap } from '../core/map/generator';
import type { GameConfig } from '../core/game/config';
import type { MapMeta } from '../core/map/gamemap';
import { parseIsoMap } from '../core/map/format';
import { appendErrorLog } from './storage';

let server: LanServer | null = null;

function mapsDir(): string {
  const packaged = path.join(process.resourcesPath, 'maps');
  return app.isPackaged && fs.existsSync(packaged) ? packaged : path.join(app.getAppPath(), 'assets', 'maps');
}

async function loadMapFor(config: GameConfig) {
  if (config.procedural) return generateMap(config.procedural);
  if (config.mapId.startsWith('custom:')) {
    const file = path.join(
      app.getPath('userData'),
      'maps',
      path.basename(config.mapId.slice('custom:'.length)),
    );
    const m = parseIsoMap(fs.readFileSync(file, 'utf8'));
    return loadMap(m.meta, m.terrainPng, m.elevPng);
  }
  const dir = mapsDir();
  const id = path.basename(config.mapId);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8')) as MapMeta;
  return loadMap(
    meta,
    fs.readFileSync(path.join(dir, `${id}.png`)),
    fs.readFileSync(path.join(dir, `${id}.elev.png`)),
  );
}

export function registerLanIpc(): void {
  ipcMain.handle('lan:host', async (_e, opts: { name: string; config: GameConfig }) => {
    try {
      server?.stop();
      server = new LanServer({
        name: String(opts.name).slice(0, 40),
        config: opts.config,
        loadMap: loadMapFor,
        log: (m) => appendErrorLog(m),
      });
      const { port, code } = await server.start();
      return { port, code, addresses: localAddresses() };
    } catch (e) {
      return { error: String(e) };
    }
  });
  ipcMain.handle('lan:stop', () => {
    server?.stop();
    server = null;
    return true;
  });
  ipcMain.handle('lan:discover', async () =>
    (await discover(1200)).map((b) => ({
      name: b.name,
      host: b.host,
      port: b.port,
      code: b.code,
      players: b.players,
      map: b.map,
      started: b.started,
    })),
  );
  ipcMain.handle('lan:addresses', () => localAddresses());
}

export function shutdownLan(): void {
  server?.stop();
  server = null;
}
