// Shared helpers: launch the built Electron app with an isolated user-data folder.
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function launch(
  query = '',
  /** Optional profile.json written before start (e.g. a chosen flag). */
  profile?: Record<string, unknown>,
): Promise<{ app: ElectronApplication; page: Page; errors: string[] }> {
  const userData = path.join(root, '.cache/e2e-userdata', `${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  fs.mkdirSync(userData, { recursive: true });
  if (profile) {
    fs.mkdirSync(path.join(userData, 'profile'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'profile', 'profile.json'), JSON.stringify(profile));
  }
  const electronPath = (await import('electron')).default as unknown as string;
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root],
    cwd: root,
    env: { ...process.env, ISOLINE_USER_DATA: userData, ISOLINE_QUERY: query },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setContentSize(1600, 900);
    w.show();
  });
  return { app, page, errors };
}
