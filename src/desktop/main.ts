// Electron main process: window, custom protocol, native menu, persistence IPC,
// embedded LAN server and the `--smoke-test` mode used by `verify:packages`.
import { app, BrowserWindow, protocol, net, ipcMain, Menu, shell, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerStorageIpc, appendErrorLog } from './storage';
import { registerLanIpc, shutdownLan } from './lan';

const SMOKE = process.argv.includes('--smoke-test');
const DEV_URL = process.env.VITE_DEV_SERVER_URL ?? '';

app.setName('Isoline');
// Tests and tooling can isolate user data (saves, settings, replays) in a dedicated folder.
if (process.env.ISOLINE_USER_DATA) app.setPath('userData', process.env.ISOLINE_USER_DATA);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'isoline',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

function rendererRoot(): string {
  return path.join(app.getAppPath(), 'dist-renderer');
}

function mapsRoot(): string {
  // Packaged: maps live in Resources/maps (extraResources). Dev: assets/maps.
  const packaged = path.join(process.resourcesPath, 'maps');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(app.getAppPath(), 'assets', 'maps');
}

function safeJoin(root: string, rel: string): string | null {
  const target = path.normalize(path.join(root, decodeURIComponent(rel)));
  return target.startsWith(root) ? target : null;
}

function registerProtocol(): void {
  protocol.handle('isoline', async (request) => {
    const url = new URL(request.url);
    let file: string | null = null;
    if (url.host === 'app') {
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      file = safeJoin(rendererRoot(), rel);
    } else if (url.host === 'maps') {
      file = safeJoin(mapsRoot(), url.pathname);
    } else if (url.host === 'user') {
      file = safeJoin(app.getPath('userData'), url.pathname);
    }
    if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const display = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1600, display.width),
    height: Math.min(960, display.height),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0B1220',
    title: 'Isoline',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.once('ready-to-show', () => {
    if (!SMOKE) mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    appendErrorLog(`render-process-gone: ${details.reason}`);
    if (SMOKE) app.exit(3);
  });
  const argQuery =
    process.argv.find((a) => a.startsWith('--isoline-query='))?.slice('--isoline-query='.length) ?? '';
  const parts = [SMOKE ? 'smoke=1' : '', process.env.ISOLINE_QUERY ?? argQuery].filter(Boolean);
  const query = parts.length ? `?${parts.join('&')}` : '';
  if (DEV_URL) void mainWindow.loadURL(DEV_URL + query);
  else void mainWindow.loadURL('isoline://app/index.html' + query);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Isoline',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'reload', visible: !app.isPackaged },
        { role: 'toggleDevTools', visible: !app.isPackaged },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

process.on('uncaughtException', (err) => {
  appendErrorLog(`uncaughtException: ${err.stack ?? String(err)}`);
});

app.whenReady().then(() => {
  registerProtocol();
  registerStorageIpc();
  registerLanIpc();
  buildMenu();
  app.setAboutPanelOptions({
    applicationName: 'Isoline',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Isoline Team — MIT',
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    smoke: SMOKE,
    userData: app.getPath('userData'),
  }));
  ipcMain.on('app:smoke-ready', () => {
    if (SMOKE) {
      process.stdout.write('ISOLINE_SMOKE_OK\n');
      app.exit(0);
    }
  });
  // Optional update check (off by default): fetches a small JSON manifest
  // { "version": "x.y.z", "url": "…", "notes": "…" } only when the user enabled it.
  ipcMain.handle('app:checkUpdate', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { error: 'url' };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await net.fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) return { error: `http ${res.status}` };
      const j = (await res.json()) as { version?: unknown; url?: unknown; notes?: unknown };
      if (typeof j.version !== 'string') return { error: 'format' };
      return {
        latest: j.version,
        url: typeof j.url === 'string' && /^https:\/\//.test(j.url) ? j.url : '',
        notes: typeof j.notes === 'string' ? j.notes.slice(0, 400) : '',
        newer: newerVersion(j.version, app.getVersion()),
      };
    } catch (err) {
      return { error: String(err).slice(0, 200) };
    }
  });
  ipcMain.on('app:openExternal', (_e, url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url);
  });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:fullscreen', (_e, on: boolean) => mainWindow?.setFullScreen(on));
  ipcMain.handle('app:screenshot', async () => {
    if (!mainWindow) return null;
    const img = await mainWindow.webContents.capturePage();
    const dir = path.join(app.getPath('userData'), 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `isoline-${Date.now()}.png`);
    fs.writeFileSync(file, img.toPNG());
    return file;
  });

  if (SMOKE) {
    setTimeout(() => {
      process.stdout.write('ISOLINE_SMOKE_TIMEOUT\n');
      app.exit(2);
    }, 45_000);
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  shutdownLan();
  app.quit();
});

/** True when semantic version a is strictly newer than b. */
function newerVersion(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let k = 0; k < 3; k++) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return (pa[k] ?? 0) > (pb[k] ?? 0);
  return false;
}
