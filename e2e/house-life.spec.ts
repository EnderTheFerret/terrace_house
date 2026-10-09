import { expect, test, type Page } from '@playwright/test';
import { answerer } from './answer';

async function reachHouse(page: Page) {
  for (let i = 0; i < 90; i++) {
    if (await page.getByRole('button', { name: /take stairs (upstairs|downstairs)/ }).isVisible()) return;
    const choice = answerer(page);
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(150);
  }
  throw new Error('house did not become available');
}

test('explains bathroom duty and starts tidying from the chore board', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 9, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  await page.getByRole('button', { name: 'fridge', exact: true }).click();
  await expect(page.getByText(/including bathroom cleaning/)).toBeVisible();
  await expect(page.getByText(/Skipped chores can raise housemate tension/)).toBeVisible();
  const before = await (await request.get('/api/game')).json();
  const done = before.view.house.choreLedger[before.view.playerId].done;
  await page.getByRole('button', { name: 'tidy up', exact: true }).click();
  await expect.poll(async () => {
    const after = await (await request.get('/api/game')).json();
    return after.view.house.choreLedger[after.view.playerId].done;
  }).toBeGreaterThan(done);
});

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

test('visits the kitchen and moves a housemate conversation between rooms', async ({ page, request }, info) => {
  await request.post('/api/game/new', { data: { seed: 9, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  await page.getByRole('button', { name: 'go to kitchen', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/game')).json()).view.playerLocation).toBe('kitchen');
  await page.getByRole('button', { name: 'go to living room', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/game')).json()).view.playerLocation).toBe('living');
  await page.getByLabel('meet in room').selectOption('kitchen');
  await page.getByLabel('invite housemate', { exact: true }).selectOption('ren');
  await page.getByRole('button', { name: 'go together & talk', exact: true }).click();
  await expect(page.getByLabel('move conversation to')).toBeVisible();
  const kitchen = await (await request.get('/api/game')).json();
  expect(kitchen.view.playerLocation).toBe('kitchen');
  expect(kitchen.view.characters.find((c: any) => c.id === 'ren').location).toBe('kitchen');
  expect(kitchen.scenes.find((s: any) => s.rendered && s.phase !== 'done').location).toBe('kitchen');
  await expect(page.getByRole('img', { name: 'kitchen', exact: true })).toBeVisible();
  await page.getByLabel('move conversation to').selectOption('living');
  await page.getByRole('button', { name: 'go together & talk', exact: true }).click();
  await expect(page.getByLabel('move conversation to')).toBeVisible();
  await expect.poll(async () => (await (await request.get('/api/game')).json()).view.playerLocation).toBe('living');
  const living = await (await request.get('/api/game')).json();
  expect(living.view.characters.find((c: any) => c.id === 'ren').location).toBe('living');
  expect(living.scenes.find((s: any) => s.rendered && s.phase !== 'done').premise).toContain('Pick up this topic');
  await expect(page.getByRole('img', { name: 'living room', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('room-invitation.png') });
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
  const step = async (key: string, x: number, y: number) => {
    await page.keyboard.down(key); await page.waitForTimeout(50); await page.keyboard.up(key);
    await expect.poll(() => canvas.evaluate(node => [Number(node.dataset.playerX), Number(node.dataset.playerY)])).toEqual([x, y]);
  };
  await step('ArrowLeft', 18, 13);
  await step('ArrowLeft', 17, 13);
  await step('ArrowLeft', 16, 13);
  await step('ArrowDown', 16, 14);
  await expect.poll(doorPixel).not.toEqual(closedDoor);
  await step('ArrowUp', 16, 13);
  await step('ArrowRight', 17, 13);
  await step('ArrowRight', 18, 13);
  await step('ArrowRight', 19, 13);
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
  // the plan goes to Ron as a text and he decides: a near-stranger may decline, so only the invitation itself and his answer are certain
  const thread = g.view.chats.find((c: any) => c.with === 'ren').messages;
  expect(thread.some((m: any) => m.from === g.view.playerId && /hang out at .*tomorrow/.test(m.text))).toBe(true);
  expect(thread.at(-1).from).toBe('ren');
  // Ron turned it down: the plans tab keeps it as declined, with his reason
  expect(g.view.invitations.some((p: any) => p.to === 'ren' && p.status === 'declined' && p.reason)).toBe(true);
  await page.getByRole('tab', { name: 'plans', exact: true }).click(); // sending the plan opens Ron's thread
  await expect(page.getByText(/· declined$/)).toBeVisible();
  await expect(page.getByText(/^Ron .+\.$/)).toBeVisible();
  if (!(await page.getByRole('tab', { name: 'plans', exact: true }).isVisible())) { await reachHouse(page); await page.getByRole('button', { name: 'phone', exact: true }).click(); }
  await page.getByRole('tab', { name: 'feed', exact: true }).click();
  await page.getByLabel('new social post').fill('First evening in our shared home.');
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/game/action') && r.request().method() === 'POST'), page.getByRole('button', { name: 'post', exact: true }).click()]);
  // posting takes a few minutes, which can bring in the next housemate: play that scene out, then read the feed
  const posted = page.getByText('First evening in our shared home.', { exact: true });
  await expect(posted.or(page.getByLabel('say something in your own words'))).toBeVisible();
  if (!(await posted.isVisible())) {
    await reachHouse(page);
    await page.getByRole('button', { name: 'phone', exact: true }).click();
    await page.getByRole('tab', { name: 'feed', exact: true }).click();
  }
  await expect(posted).toBeVisible();
  await expect(page.getByRole('img', { name: /^photo by/ }).first()).toBeVisible();
});
