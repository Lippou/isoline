// In-app updates from the releases of the private GitHub repository.
//
// - Access: a read-only GitHub token, saved encrypted (Keychain / DPAPI through
//   safeStorage) in userData, or else the GitHub CLI's login (`gh auth token`) or the
//   GH_TOKEN / GITHUB_TOKEN environment variables. The token only ever goes to GitHub.
// - Check: the latest release's tag against the running version.
// - Download: the release asset for this platform (macOS: the universal .zip; Windows:
//   the NSIS installer), with progress pushed to the renderer.
// - Install: macOS checks that the new bundle is intact and signed by the same Apple
//   developer team (Developer ID, notarised), swaps it in once the game has quit and
//   relaunches it — Gatekeeper's own checks stay in place; Windows runs the installer
//   silently and relaunches (--force-run).
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

/** owner/name of the repository whose releases carry the game builds. */
export const UPDATE_REPO = 'Lippou/isoline';
/** Apple developer team that signs every macOS build: an update signed by anyone else is refused. */
const TEAM_ID = '2WDB96R7Z3';

export type UpdateState = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
export interface UpdateStatus {
  state: UpdateState;
  current: string;
  version?: string;
  notes?: string;
  /** 0…1 while downloading. */
  progress?: number;
  /** Error code (no-token, unauthorized, not-found, no-asset, readonly, dev, network, …) and detail. */
  error?: string;
  detail?: string;
  /** Where access comes from: a saved token, the GitHub CLI, the environment, or nothing. */
  access: 'saved' | 'gh' | 'env' | 'none';
  /** Updates can be installed from here (packaged app on macOS or Windows). */
  installable: boolean;
}

interface Asset {
  name: string;
  url: string;
  size: number;
}

let status: UpdateStatus = {
  state: 'idle',
  current: app.getVersion(),
  access: 'none',
  installable: false,
};
let asset: Asset | null = null;
let downloaded = '';

const tokenFile = () => path.join(app.getPath('userData'), 'update-token.bin');

function publish(patch: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...patch };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status);
  return status;
}

function installable(): boolean {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
}

// ------------------------------------------------------------------ token
function savedToken(): string {
  try {
    const f = tokenFile();
    if (!fs.existsSync(f)) return '';
    const buf = fs.readFileSync(f);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : '';
  } catch {
    return '';
  }
}

function ghToken(): Promise<string> {
  // GUI apps do not inherit the shell's PATH on macOS: look where Homebrew installs gh.
  const PATH = [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].join(
    path.delimiter,
  );
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { env: { ...process.env, PATH }, timeout: 4000 }, (err, out) =>
      resolve(err ? '' : String(out).trim()),
    );
  });
}

async function token(): Promise<{ token: string; access: UpdateStatus['access'] }> {
  const saved = savedToken();
  if (saved) return { token: saved, access: 'saved' };
  const env = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (env) return { token: env, access: 'env' };
  const gh = await ghToken();
  if (gh) return { token: gh, access: 'gh' };
  return { token: '', access: 'none' };
}

function setToken(t: string): UpdateStatus {
  const clean = String(t ?? '').trim();
  if (!/^[A-Za-z0-9_]{20,255}$/.test(clean)) return publish({ state: 'error', error: 'bad-token' });
  if (!safeStorage.isEncryptionAvailable()) return publish({ state: 'error', error: 'no-keychain' });
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(clean), { mode: 0o600 });
  return publish({ state: 'idle', error: undefined, access: 'saved' });
}

function clearToken(): UpdateStatus {
  try {
    fs.rmSync(tokenFile(), { force: true });
  } catch {
    /* already gone */
  }
  return publish({ state: 'idle', error: undefined, access: 'none' });
}

// ------------------------------------------------------------------ HTTP
/** GET with manual redirects: the Authorization header never leaves api.github.com. */
function get(
  url: string,
  headers: Record<string, string>,
  onData?: (chunk: Buffer, total: number) => void,
  redirects = 5,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = { 'User-Agent': `Isoline/${app.getVersion()}`, ...headers };
    if (u.hostname !== 'api.github.com') delete (h as Record<string, string>).Authorization;
    const req = https.get(u, { headers: h, timeout: 20_000 }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, u).toString(), headers, onData, redirects - 1));
        return;
      }
      const total = Number(res.headers['content-length'] ?? 0);
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        if (onData) onData(c, total);
        else chunks.push(c);
      });
      res.on('end', () => resolve({ status: code, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let k = 0; k < 3; k++) if ((pa[k] ?? 0) !== (pb[k] ?? 0)) return (pa[k] ?? 0) > (pb[k] ?? 0);
  return false;
}

function assetPattern(): RegExp | null {
  if (process.platform === 'darwin') return /-mac-universal\.zip$/;
  if (process.platform === 'win32') return /-win-x64-setup\.exe$/;
  return null;
}

// ------------------------------------------------------------------ steps
async function check(): Promise<UpdateStatus> {
  if (status.state === 'downloading') return status;
  const { token: tk, access } = await token();
  publish({ state: 'checking', error: undefined, detail: undefined, access, installable: installable() });
  if (!tk) return publish({ state: 'error', error: 'no-token' });
  try {
    const res = await get(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      Authorization: `Bearer ${tk}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    if (res.status === 401 || res.status === 403) return publish({ state: 'error', error: 'unauthorized' });
    if (res.status === 404) return publish({ state: 'error', error: 'not-found' });
    if (res.status !== 200)
      return publish({ state: 'error', error: 'network', detail: `HTTP ${res.status}` });
    const rel = JSON.parse(res.body.toString('utf8')) as {
      tag_name?: string;
      body?: string;
      assets?: { name: string; url: string; size: number }[];
    };
    const version = String(rel.tag_name ?? '').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+/.test(version)) return publish({ state: 'error', error: 'format' });
    const notes = String(rel.body ?? '').slice(0, 2000);
    if (!newer(version, app.getVersion())) return publish({ state: 'none', version, notes });
    const pat = assetPattern();
    const a = pat ? rel.assets?.find((x) => pat.test(x.name)) : undefined;
    asset = a ? { name: a.name, url: a.url, size: a.size } : null;
    downloaded = '';
    return publish({ state: 'available', version, notes, error: asset ? undefined : 'no-asset' });
  } catch (err) {
    return publish({ state: 'error', error: 'network', detail: String(err).slice(0, 200) });
  }
}

async function download(): Promise<UpdateStatus> {
  if (status.state !== 'available' || !asset) return status;
  if (!installable()) return publish({ state: 'error', error: 'dev' });
  const { token: tk } = await token();
  if (!tk) return publish({ state: 'error', error: 'no-token' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isoline-update-'));
  const file = path.join(dir, asset.name);
  const out = fs.createWriteStream(file);
  let got = 0;
  let last = 0;
  publish({ state: 'downloading', progress: 0 });
  try {
    const res = await get(
      asset.url,
      { Authorization: `Bearer ${tk}`, Accept: 'application/octet-stream' },
      (chunk, total) => {
        out.write(chunk);
        got += chunk.length;
        const p = (total || asset!.size || 1) > 0 ? got / (total || asset!.size) : 0;
        if (p - last > 0.01) {
          last = p;
          publish({ progress: Math.min(1, p) });
        }
      },
    );
    await new Promise<void>((r) => out.end(r));
    if (res.status !== 200)
      return publish({ state: 'error', error: 'network', detail: `HTTP ${res.status}` });
    if (asset.size && fs.statSync(file).size !== asset.size)
      return publish({ state: 'error', error: 'corrupt' });
    downloaded = file;
    return publish({ state: 'ready', progress: 1 });
  } catch (err) {
    out.destroy();
    return publish({ state: 'error', error: 'network', detail: String(err).slice(0, 200) });
  }
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 120_000 }, (err, out) => (err ? reject(err) : resolve(String(out)))),
  );
}

async function install(): Promise<UpdateStatus> {
  if (status.state !== 'ready' || !downloaded) return status;
  try {
    if (process.platform === 'darwin') {
      // …/Isoline.app/Contents/MacOS/Isoline → …/Isoline.app
      const bundle = path.resolve(process.execPath, '..', '..', '..');
      if (!bundle.endsWith('.app')) return publish({ state: 'error', error: 'dev' });
      try {
        fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
      } catch {
        return publish({ state: 'error', error: 'readonly', detail: path.dirname(bundle) });
      }
      const dir = path.dirname(downloaded);
      await run('/usr/bin/ditto', ['-x', '-k', downloaded, dir]);
      const fresh = fs.readdirSync(dir).find((f) => f.endsWith('.app'));
      if (!fresh) return publish({ state: 'error', error: 'corrupt' });
      const next = path.join(dir, fresh);
      const v = (
        await run('/usr/bin/plutil', [
          '-extract',
          'CFBundleShortVersionString',
          'raw',
          path.join(next, 'Contents', 'Info.plist'),
        ])
      ).trim();
      if (v !== status.version) return publish({ state: 'error', error: 'corrupt', detail: v });
      // Intact, and signed by our own team (codesign prints its details on stderr).
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', next]);
      const team = await new Promise<string>((resolve) =>
        execFile('/usr/bin/codesign', ['-dv', next], (_err, _out, err) =>
          resolve(/TeamIdentifier=(\S+)/.exec(String(err))?.[1] ?? ''),
        ),
      );
      if (team !== TEAM_ID)
        return publish({ state: 'error', error: 'signature', detail: team || 'unsigned' });
      // Swap once we have quit (keeping the old bundle until the new one is in place).
      const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
      const old = `${bundle}.old`;
      const script = [
        `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
        `rm -rf ${q(old)}`,
        `if mv ${q(bundle)} ${q(old)}; then`,
        `  if mv ${q(next)} ${q(bundle)}; then rm -rf ${q(old)}; else mv ${q(old)} ${q(bundle)}; fi`,
        `fi`,
        `open ${q(bundle)}`,
        `rm -rf ${q(dir)}`,
      ].join('\n');
      spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn(downloaded, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    } else return publish({ state: 'error', error: 'dev' });
    setTimeout(() => app.quit(), 300);
    return status;
  } catch (err) {
    return publish({ state: 'error', error: 'install', detail: String(err).slice(0, 200) });
  }
}

export function registerUpdateIpc(): void {
  status = { ...status, installable: installable() };
  void token().then(({ access }) => publish({ access }));
  ipcMain.handle('update:status', () => status);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:download', () => download());
  ipcMain.handle('update:install', () => install());
  ipcMain.handle('update:setToken', (_e, t: string) => setToken(t));
  ipcMain.handle('update:clearToken', () => clearToken());
}
