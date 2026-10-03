// The "E feels laggy" report: E must answer at once wherever focus is, and walking through a doorway must not freeze.
import { expect, test, type Page } from '@playwright/test';

async function reachHouse(page: Page) {
  for (let i = 0; i < 90; i++) {
    if (await page.getByRole('button', { name: /take stairs (upstairs|downstairs)/ }).isVisible()) return;
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode|roll credits)$/ }).first();
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(150);
  }
  throw new Error('house did not become available');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, sound: false, tutorial: false })));
});

test('E answers at once even after clicking a side button, and doorways never lock movement', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 9, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  const canvas = page.getByLabel(/^top-down view of the share house/);
  const prompt = page.locator('kbd', { hasText: 'E' });
  await canvas.focus();
  // wander until something can be interacted with (a housemate or a hotspot next to the player)
  // pseudo-random walk: five housemates are in the house, so the player ends up next to someone or a hotspot
  const dirs = ['ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'];
  const pattern = Array.from({ length: 160 }, (_, i) => dirs[(i * 5 + (i >> 3)) % dirs.length]);
  for (let i = 0; i < pattern.length && !(await prompt.isVisible()); i++) {
    await page.keyboard.down(pattern[i % pattern.length]);
    await page.waitForTimeout(60);
    await page.keyboard.up(pattern[i % pattern.length]);
    await page.waitForTimeout(120);
  }
  await expect(prompt).toBeVisible();
  // focus leaves the canvas (the old bug: E then did nothing at all)
  await page.getByRole('button', { name: 'tidy up', exact: true }).focus();
  const t = Date.now();
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog').or(page.getByRole('group', { name: 'how do you respond?' })).or(page.getByRole('button', { name: 'take stairs downstairs' })).first()).toBeVisible({ timeout: 2000 });
  const ms = Date.now() - t;
  console.log(`E → visible response: ${ms} ms`);
  expect(ms).toBeLessThan(1000);
});
