import { expect, test } from '@playwright/test';

test('the house clock advances while watching and pauses for an open dialog', async ({ page, request }, info) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: false, sound: false })));
  await request.post('/api/game/new', { data: { seed: 9, moveInDay: false, seasonLength: 0 } });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  for (let n = 0; n < 90; n++) {
    if (await page.getByRole('button', { name: 'take stairs upstairs', exact: true }).isVisible()) break;
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await next.isVisible()) await next.click(); else await page.waitForTimeout(150);
  }
  await expect(page.getByRole('button', { name: 'take stairs upstairs', exact: true })).toBeVisible();
  const before = await (await request.get('/api/game')).json();
  const pulse = page.waitForResponse(r => r.url().endsWith('/api/game/world-pulse'));
  await page.clock.fastForward(20001);
  expect((await pulse).ok()).toBe(true);
  const after = await (await request.get('/api/game')).json();
  expect(after.view.minutesLeft).toBe(before.view.minutesLeft - 5);
  expect(after.view.playerLocation).toBe(before.view.playerLocation);
  expect(after.view.characters.filter((c: { isPlayer: boolean; activityUntil: number; cityLocation?: string }) => !c.isPlayer && (c.activityUntil > 0 || c.cityLocation)).length).toBeGreaterThan(0);
  await page.clock.runFor(1500);
  await page.screenshot({ path: info.outputPath('housemates-moving.png') });
  let pulses = 0;
  page.on('request', r => { if (r.url().endsWith('/api/game/world-pulse')) pulses++; });
  await page.getByRole('button', { name: 'sleep until morning', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.clock.fastForward(40001);
  expect(pulses).toBe(0);
  expect((await (await request.get('/api/game')).json()).view.minutesLeft).toBe(after.view.minutesLeft);
});
