import { expect, test, type Page } from '@playwright/test';

async function reachHouse(page: Page) {
  for (let i = 0; i < 90; i++) {
    if (await page.getByRole('button', { name: /take stairs (upstairs|downstairs)/ }).isVisible()) return;
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(150);
  }
  throw new Error('house did not become available');
}

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(reducedMotion => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion, sound: false })), !info.title.startsWith('stairs'));
});

test('creator maps an appearance and saves dietary choices and fixed season', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'new season', exact: true }).click();
  await page.getByLabel('name', { exact: true }).fill('Noa Test');
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await page.getByLabel('diet', { exact: true }).selectOption('vegetarian');
  await page.getByLabel('kashrut', { exact: true }).selectOption('style');
  await page.getByLabel('keep Shabbat', { exact: true }).check();
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await page.getByLabel('describe how you look').fill('Olive skin, dark curls and a green linen shirt.');
  await page.getByRole('button', { name: 'match description', exact: true }).click();
  await expect(page.getByRole('button', { name: 'match description', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await page.getByLabel('fixed length', { exact: true }).check();
  await page.getByLabel('season episodes').fill('6');
  await page.getByRole('button', { name: 'move in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'EPISODE 1' })).toBeVisible();
  const g = await (await request.get('/api/game')).json();
  expect(g.view.seasonLength).toBe(6);
  expect(g.view.characters.find((c: any) => c.isPlayer).appearanceText).toContain('Olive skin');
});

test('stairs, private balconies and a shared plan are accessible', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 9, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  await page.getByRole('button', { name: 'take stairs upstairs', exact: true }).click();
  await expect(page.getByRole('button', { name: 'take stairs upstairs', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'hang out', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'upstairs', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'take stairs downstairs', exact: true }).click();
  await expect(page.getByRole('region', { name: 'ground floor', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'take stairs upstairs', exact: true })).toBeEnabled();
  const canvas = page.getByLabel(/^top-down view of the share house/);
  const doorPixel = () => canvas.evaluate((node: HTMLCanvasElement) => { const tile = node.width / 52; return [...node.getContext('2d')!.getImageData((16 * tile + 1) * 2, (14 * tile + tile / 2) * 2, 1, 1).data]; });
  await canvas.focus();
  const closedDoor = await doorPixel();
  for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowDown']) { await page.keyboard.down(key); await page.waitForTimeout(50); await page.keyboard.up(key); await page.waitForTimeout(180); }
  await expect.poll(doorPixel).not.toEqual(closedDoor);
  for (const key of ['ArrowUp', 'ArrowRight', 'ArrowRight', 'ArrowRight']) { await page.keyboard.down(key); await page.waitForTimeout(50); await page.keyboard.up(key); await page.waitForTimeout(180); }
  await expect.poll(doorPixel).toEqual(closedDoor);
  await expect(page.getByRole('button', { name: 'backyard', exact: true })).toBeVisible();
  const before = await (await request.get('/api/game')).json();
  const gender = before.view.characters.find((c: any) => c.isPlayer).gender;
  await page.getByRole('button', { name: gender === 'woman' ? "men's balcony" : "women's balcony", exact: true }).click();
  await page.getByRole('button', { name: 'visit balcony', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('invitation');
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  await page.getByRole('button', { name: 'ok', exact: true }).click();
  await page.getByRole('button', { name: 'phone', exact: true }).click();
  await page.getByRole('tab', { name: 'plans', exact: true }).click();
  await page.getByLabel('plan with').selectOption('ren');
  await page.getByLabel('plan episode').fill('2');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/game/action') && r.request().method() === 'POST'), page.getByRole('button', { name: 'make plan', exact: true }).click()]);
  const g = await (await request.get('/api/game')).json();
  expect(g.view.invitations.some((p: any) => p.from === g.view.playerId && p.to === 'ren' && p.episode === 2)).toBe(true);
  if (!(await page.getByRole('tab', { name: 'plans', exact: true }).isVisible())) { await reachHouse(page); await page.getByRole('button', { name: 'phone', exact: true }).click(); }
  await page.getByRole('tab', { name: 'feed', exact: true }).click();
  await page.getByLabel('new social post').fill('First evening in our shared home.');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/game/action') && r.request().method() === 'POST'), page.getByRole('button', { name: 'post', exact: true }).click()]);
  await expect(page.getByText('First evening in our shared home.', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /^photo by/ }).first()).toBeVisible();
});
