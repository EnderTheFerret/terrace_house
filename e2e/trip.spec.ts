// Vacations end to end: sleep to Friday, take a weekend trip from the house panel, live the drive and the night,
// come home Saturday morning to the return scene.
import { expect, test, type Page } from '@playwright/test';

const seen: string[] = [];
async function reachHouse(page: Page) {
  for (let i = 0; i < 120; i++) {
    const sleep = page.getByRole('button', { name: 'sleep until morning', exact: true });
    if (await sleep.isVisible() && await sleep.isEnabled()) { await page.waitForTimeout(400); if (await sleep.isVisible() && await sleep.isEnabled()) return; }
    const title = page.locator('main >> text=/^(road trip|late night, far from the house|back from the trip)$/').first();
    if (await title.isVisible()) seen.push((await title.textContent())!.trim());
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode|roll credits|that's all)$/ }).first();
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(150);
  }
  throw new Error('house did not become available');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, sound: false, tutorial: false, reducedMotion: true })));
});

test('a weekend trip: Friday panel, drive and night scenes, back Saturday morning', async ({ page, request }) => {
  test.setTimeout(240_000);
  await request.post('/api/game/new', { data: { seed: 12, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  // Wednesday -> Friday morning
  for (let d = 0; d < 2; d++) {
    await page.getByRole('button', { name: 'sleep until morning', exact: true }).click();
    await page.getByRole('button', { name: 'yes', exact: true }).click();
    await reachHouse(page);
  }
  const panel = page.getByRole('region', { name: 'weekend trip' });
  await expect(panel).toBeVisible();
  await panel.getByRole('checkbox', { disabled: false }).first().check();
  await panel.getByRole('button', { name: 'leave in the shared car' }).click();
  await page.getByRole('button', { name: 'yes', exact: true }).click();
  await reachHouse(page);
  const g = await (await request.get('/api/game')).json();
  expect(g.view.weekday).toBe(6); // Saturday
  expect(seen).toEqual(expect.arrayContaining(['road trip', 'late night, far from the house']));
  // the trip is common knowledge and the return happened at the door (scene seen, or logged)
  expect(seen.includes('back from the trip') || g.view.log.some((l: { text: string }) => /left for/.test(l.text))).toBe(true);
});
