// User-data persistence (settings, profile, saves, replays, custom maps, logs).
// Everything lives under the platform's standard app-data folder:
//   macOS   ~/Library/Application Support/Isoline
//   Windows %APPDATA%\Isoline
import { app, ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const CATEGORIES = ['settings', 'profile', 'saves', 'replays', 'maps', 'stats'] as const;
type Category = (typeof CATEGORIES)[number];

function isCategory(c: unknown): c is Category {
  return typeof c === 'string' && (CATEGORIES as readonly string[]).includes(c);
}

function dirFor(category: Category): string {
  const dir = path.join(app.getPath('userData'), category);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('invalid name');
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_');
  if (!base || base.startsWith('.')) throw new Error('invalid name');
  return base;
}

export function appendErrorLog(line: string): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'errors.log'), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* logging must never throw */
  }
}

export function registerStorageIpc(): void {
  ipcMain.handle('storage:read', (_e, category: unknown, name: unknown) => {
    if (!isCategory(category)) throw new Error('bad category');
    const file = path.join(dirFor(category), cleanName(name));
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  });
  ipcMain.handle('storage:write', (_e, category: unknown, name: unknown, data: unknown) => {
    if (!isCategory(category)) throw new Error('bad category');
    const file = path.join(dirFor(category), cleanName(name));
    const tmp = file + '.tmp';
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as Uint8Array);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, file);
    return true;
  });
  ipcMain.handle('storage:list', (_e, category: unknown) => {
    if (!isCategory(category)) throw new Error('bad category');
    const dir = dirFor(category);
    return fs
      .readdirSync(dir)
      .filter((f) => !f.endsWith('.tmp') && !f.startsWith('.'))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  });
  ipcMain.handle('storage:delete', (_e, category: unknown, name: unknown) => {
    if (!isCategory(category)) throw new Error('bad category');
    const file = path.join(dirFor(category), cleanName(name));
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  });
  ipcMain.handle('storage:log', (_e, line: unknown) => {
    appendErrorLog(String(line).slice(0, 4000));
    return true;
  });
  ipcMain.handle(
    'storage:exportFile',
    async (e, suggested: unknown, data: unknown, filterName: unknown, ext: unknown) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts: Electron.SaveDialogOptions = {
        defaultPath: cleanName(suggested),
        filters: [{ name: String(filterName), extensions: [String(ext)] }],
      };
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return null;
      const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data as Uint8Array);
      fs.writeFileSync(res.filePath, buf);
      return res.filePath;
    },
  );
  ipcMain.handle('storage:importFile', async (e, filterName: unknown, exts: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: String(filterName), extensions: (exts as string[]).map(String) }],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    const file = res.filePaths[0]!;
    return { name: path.basename(file), data: fs.readFileSync(file) };
  });
}
