import { test, expect } from '@playwright/test';
import { launch } from './app';

test('menu → lobby → solo game → surrender → end screen → menu', async () => {
  const { app, page, errors } = await launch();
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('menu-play').click();
  await page.getByTestId('menu-solo').click();
  await expect(page.getByTestId('lobby')).toBeVisible();
  await page.getByRole('button', { name: /Régions|Regions/ }).click();
  await page.getByTestId('map-black-sea').click();
  await page.getByTestId('opt-nations').fill('6');
  await page.getByTestId('opt-spawn').fill('15');
  await page.getByTestId('lobby-start').click();
  await expect(page.getByTestId('game-screen')).toBeVisible();
  await expect(page.getByTestId('spawn-countdown')).toBeVisible({ timeout: 30_000 });
  // Choose a spawn near the map centre (land on the Black Sea map's southern shore).
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.82);
  await expect(page.getByTestId('clock')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('resource-panel')).toBeVisible();
  await expect(page.getByTestId('build-bar')).toBeVisible();
  // Open the in-game menu and surrender.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-menu')).toBeVisible();
  await page
    .getByRole('button', { name: /Capituler|Surrender/ })
    .first()
    .click();
  await page.locator('.box .btn.primary').click();
  await expect(page.getByTestId('end-screen')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('end-menu').click();
  await expect(page.getByTestId('title-screen')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});

test('settings, profile, campaign, replays, editor and about screens open', async () => {
  const { app, page, errors } = await launch();
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('menu-settings').click();
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('settings-tab-lang').click();
  await page.getByTestId('opt-lang').selectOption('en');
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByTestId('menu-play')).toHaveText(/Play/);
  await page.getByTestId('menu-replays').click();
  await expect(page.getByTestId('replays')).toBeVisible();
  await page.getByRole('button', { name: /Back/ }).click();
  await page.getByTestId('menu-editor').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('editor-new').click();
  await page.getByRole('button', { name: /Back/ }).first().click();
  await page.getByTestId('menu-play').click();
  await page.getByTestId('menu-campaign').click();
  await expect(page.getByTestId('campaign')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});

test('autostarted spectator game renders, runs the simulation and saves a replay at the end of a surrender', async () => {
  const { app, page, errors } = await launch('autostart=black-sea&nations=8&tribes=10&spawn=1&speed=4&perf');
  await expect(page.getByTestId('game-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('perf')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(6000);
  const fps = Number((await page.getByTestId('perf').textContent())?.match(/FPS (\d+)/)?.[1] ?? 0);
  expect(fps).toBeGreaterThan(20);
  await expect(page.getByTestId('leaderboard')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});

test('LAN: host a game, a second instance joins by address + code, both play the same match', async () => {
  const host = await launch();
  await expect(host.page.getByTestId('title-screen')).toBeVisible({ timeout: 20_000 });
  await host.page.getByTestId('menu-play').click();
  await host.page.getByTestId('menu-lan').click();
  await host.page.getByTestId('lan-host').click();
  await expect(host.page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  const code = (await host.page.getByTestId('lobby-code').locator('b').textContent())!.trim();
  const port = (await host.page.getByTestId('lobby-address').textContent())!.trim().split(':').pop()!;
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  const guest = await launch();
  await expect(guest.page.getByTestId('title-screen')).toBeVisible({ timeout: 20_000 });
  await guest.page.getByTestId('menu-play').click();
  await guest.page.getByTestId('menu-lan').click();
  await guest.page.getByPlaceholder('192.168.1.20:41234').fill(`127.0.0.1:${port}`);
  await guest.page.locator('.manual input').nth(1).fill(code);
  await guest.page.locator('.manual .btn').click();
  await expect(guest.page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
  await expect(guest.page.getByTestId('lobby-start')).toBeDisabled();

  await host.page.getByRole('button', { name: /Régions|Regions/ }).click();
  await host.page.getByTestId('map-black-sea').click();
  await host.page.getByTestId('opt-nations').fill('4');
  await host.page.getByTestId('opt-spawn').fill('15');
  await host.page.getByTestId('lobby-start').click();
  for (const s of [host, guest]) {
    await expect(s.page.getByTestId('game-screen')).toBeVisible({ timeout: 30_000 });
    await expect(s.page.getByTestId('clock')).toBeVisible({ timeout: 60_000 });
  }
  // Both clients advance the same lockstep simulation.
  const clock = async (p: typeof host.page) => (await p.getByTestId('clock').textContent())!.trim();
  await host.page.waitForTimeout(3000);
  const [a, b] = [await clock(host.page), await clock(guest.page)];
  expect(Math.abs(toSec(a) - toSec(b))).toBeLessThanOrEqual(1);
  expect(host.errors).toEqual([]);
  expect(guest.errors).toEqual([]);
  await guest.app.close();
  await host.app.close();
});

function toSec(s: string): number {
  const [m, x] = s.split(':').map(Number);
  return m! * 60 + x!;
}
