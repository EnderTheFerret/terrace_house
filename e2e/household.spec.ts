import { expect, test, type Page } from '@playwright/test';
import { answerer } from './answer';

async function reachHouse(page: Page) {
  for (let i = 0; i < 90; i++) {
    const digest = page.getByRole('dialog', { name: 'while you were out' });
    if (await digest.isVisible()) { await digest.getByRole('button', { name: 'ok', exact: true }).click(); continue; }
    if (await page.getByLabel('household activity').isVisible()) return;
    const choice = answerer(page);
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(150);
  }
  throw new Error('house did not become available');
}

test('everyday activities work alone and together through the real house menu', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  await request.post('/api/game/new', { data: { seed: 9, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  await expect(page.getByLabel('household activity').locator('option')).toHaveCount(15);
  await page.getByLabel('household activity').selectOption('laundry');
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/game/end-slot') && r.request().method() === 'POST'), page.getByRole('button', { name: 'start activity', exact: true }).click()]);
  const digest = page.getByRole('dialog', { name: 'while you were out' });
  await expect(digest).toBeVisible();
  await digest.getByRole('button', { name: 'ok', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/game')).json()).view.log.some((l: any) => l.text.includes('fold & sort laundry'))).toBe(true);
  await reachHouse(page);
  await page.getByLabel('household activity').selectOption('dishes');
  const option = page.getByLabel('household company').locator('option').nth(1);
  const target = await option.getAttribute('value');
  expect(target).toBeTruthy();
  await page.getByLabel('household company').selectOption(target!);
  await page.getByRole('button', { name: 'invite & start together', exact: true }).click();
  await expect(page.getByText('wash dishes together', { exact: true }).first()).toBeVisible();
  const game = await (await request.get('/api/game')).json();
  expect(game.scenes.some((s: any) => s.title === 'wash dishes together' && s.participants.includes(target))).toBe(true);
  await reachHouse(page);
  const after = await (await request.get('/api/game')).json();
  const me = after.view.characters.find((c: any) => c.isPlayer).name.split(' ')[0];
  expect(after.view.log.some((l: any) => l.text.includes('wash dishes') && l.text.includes(me))).toBe(true);
});
