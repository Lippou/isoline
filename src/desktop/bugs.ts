// The bug journal (1.23, closed beta: the player and Claude are the testers). A report is a
// folder under the app-data folder's `bugs/` — what the player wrote, a capture of the
// window as it was when the journal opened, the game itself (a save with its replay, to
// replay the bug) and the last lines of the error log — for whoever fixes it to read.
//   macOS   ~/Library/Application Support/Isoline/bugs/<date>/
//   Windows %APPDATA%\Isoline\bugs\<date>\
import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const bugsDir = () => path.join(app.getPath('userData'), 'bugs');
const pending = () => path.join(bugsDir(), '.pending.png');

/** The last `n` lines of the error log. */
function lastErrors(n: number): string[] {
  try {
    const file = path.join(app.getPath('userData'), 'logs', 'errors.log');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n);
  } catch {
    return [];
  }
}

export function registerBugIpc(win: () => BrowserWindow | null): void {
  // The window as the player saw it, before the journal covers part of it.
  ipcMain.handle('bug:capture', async () => {
    const w = win();
    if (!w) return false;
    const img = await w.webContents.capturePage();
    fs.mkdirSync(bugsDir(), { recursive: true });
    fs.writeFileSync(pending(), img.toPNG());
    return true;
  });
  ipcMain.handle('bug:errors', (_e, n: unknown) => lastErrors(typeof n === 'number' ? Math.min(200, n) : 40));
  ipcMain.handle('bug:save', (_e, note: unknown, meta: unknown, save: unknown) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(bugsDir(), stamp);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.txt'), String(note ?? '').slice(0, 20_000));
    const info = { ...(typeof meta === 'object' && meta ? meta : {}), errors: lastErrors(80) };
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(info, null, 2));
    if (typeof save === 'string' && save.length) fs.writeFileSync(path.join(dir, 'game.isosave'), save);
    if (fs.existsSync(pending())) fs.renameSync(pending(), path.join(dir, 'capture.png'));
    return stamp;
  });
  ipcMain.handle('bug:list', () => {
    if (!fs.existsSync(bugsDir())) return [];
    return fs
      .readdirSync(bugsDir())
      .filter((f) => !f.startsWith('.'))
      .sort()
      .reverse();
  });
  ipcMain.handle('bug:reveal', () => {
    fs.mkdirSync(bugsDir(), { recursive: true });
    void shell.openPath(bugsDir());
    return true;
  });
}
