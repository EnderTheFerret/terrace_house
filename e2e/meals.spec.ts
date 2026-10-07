import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function settle(page: Page, stopAt?: string) {
  for (let i = 0; i < 240; i++) {
    if (stopAt && await page.getByText(stopAt, { exact: true }).isVisible()) {
      if (stopAt !== 'after the episode') await expect(page.getByLabel('say something in your own words')).toBeVisible();
      return true;
    }
    const digest = page.getByRole('dialog', { name: 'while you were out' });
    if (await digest.isVisible()) { await digest.getByRole('button', { name: 'ok', exact: true }).click(); continue; }
    const ready = page.getByRole('button', { name: 'skip to next block', exact: true });
    if (await ready.evaluateAll(els => els.some(e => !e.hasAttribute('disabled') && (e as HTMLElement).offsetParent !== null))) {
      await page.waitForTimeout(600);
      if (!await digest.isVisible() && await ready.isVisible() && await ready.isEnabled()) return false;
    }
    const end = page.getByRole('button', { name: "that's all", exact: true });
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode|roll credits)$/ }).first();
    if (await end.isVisible()) await end.click();
    else if (await choice.isVisible()) {
      if (stopAt && await page.getByText(stopAt, { exact: true }).isVisible()) return true;
      await choice.click();
    }
    else if (await next.isVisible()) {
      if (stopAt === 'after the episode' && await next.innerText() === 'roll credits') {
        await expect(page.getByText(stopAt, { exact: true })).toBeVisible();
        return true;
      }
      await next.click();
    }
    else await page.waitForTimeout(100);
  }
  throw new Error('meal/house did not become ready');
}

test('welcome dinner gathers six, followed by small breakfasts and scheduled evening dinners', async ({ page, request }, info) => {
  test.setTimeout(180000);
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, tutorial: false })));
  const shot = async (name: string) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
    if (process.env.UPDATE_GUIDE_SCREENSHOTS) {
      mkdirSync('apps/web/public/assets/guide', { recursive: true });
      await page.screenshot({ path: `apps/web/public/assets/guide/${name}.png`, animations: 'disabled' });
    }
  };
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: true, seasonLength: 0 } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await settle(page);
  let welcome = false;
  for (let n = 0; n < 14 && !welcome; n++) {
    await page.getByRole('button', { name: 'skip to next block', exact: true }).click();
    welcome = await settle(page, 'welcome dinner · the whole house');
  }
  expect(welcome).toBe(true);
  const first = await (await request.get('/api/game')).json();
  expect(first.scenes.find((s: { title: string }) => s.title === 'welcome dinner · the whole house').participants).toHaveLength(6);
  await expect(page.getByLabel('reply to').locator('option')).toHaveCount(7);
  await expect(page.getByLabel('shared dining table')).toHaveCount(0);
  await shot('meal-welcome');
  await page.getByLabel('reply to').selectOption('everyone');
  await page.getByLabel('say something in your own words').fill('Here is to our first dinner together. What brought everyone to this house?');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible();
  await page.getByRole('button', { name: "that's all", exact: true }).click();
  await settle(page);
  await page.getByRole('button', { name: 'sleep until morning', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'yes', exact: true }).click();
  expect(await settle(page, 'after the episode')).toBe(true);
  await expect(page.locator('.reply-text').first()).toBeVisible();
  await settle(page);
  expect((await (await request.get('/api/game')).json()).view.episode).toBe(2);
  await page.getByRole('button', { name: 'hang out', exact: true }).click();
  expect(await settle(page, 'breakfast together')).toBe(true);
  const breakfast = (await (await request.get('/api/game')).json()).scenes.find((s: { title: string }) => s.title === 'breakfast together');
  expect(breakfast.participants.length).toBeGreaterThanOrEqual(2);
  expect(breakfast.participants.length).toBeLessThanOrEqual(3);
  await shot('meal-breakfast');
  await page.getByRole('button', { name: 'keep listening…', exact: true }).click();
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible();
  await page.getByRole('button', { name: "that's all", exact: true }).click();
  await settle(page);
  for (let n = 0; n < 8; n++) {
    const g = await (await request.get('/api/game')).json();
    if (g.view.slot === 'evening') break;
    await page.getByRole('button', { name: 'skip to next block', exact: true }).click();
    await settle(page);
  }
  await page.getByRole('button', { name: 'hang out', exact: true }).click();
  expect(await settle(page, 'house dinner')).toBe(true);
  const dinner = (await (await request.get('/api/game')).json()).scenes.find((s: { title: string }) => s.title === 'house dinner');
  expect(dinner.participants.length).toBeGreaterThanOrEqual(2);
  expect(dinner.participants.length).toBeLessThanOrEqual(6);
  await shot('meal-dinner');
  await page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first().click();
  await settle(page);
  await expect(page.getByRole('button', { name: 'skip to next block', exact: true })).toBeEnabled();
});
