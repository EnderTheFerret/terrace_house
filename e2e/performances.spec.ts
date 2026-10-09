import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { answerer } from './answer';

async function skipBlock(request: APIRequestContext) {
  const action = await request.post('/api/game/action', { data: { action: { type: 'skip' } } });
  expect(action.ok(), await action.text()).toBe(true);
  const end = await request.post('/api/game/end-slot');
  expect(end.ok(), await end.text()).toBe(true);
}

async function reachHouse(page: Page) {
  for (let i = 0; i < 160; i++) {
    const digest = page.getByRole('dialog', { name: 'while you were out' });
    if (await digest.isVisible()) { await digest.getByRole('button', { name: 'ok', exact: true }).click(); continue; }
    const skip = page.getByRole('button', { name: 'skip to next block', exact: true });
    if (await skip.isVisible() && await skip.isEnabled()) return;
    const end = page.getByRole('button', { name: "that's all", exact: true });
    const choice = answerer(page);
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await end.isVisible()) await end.click();
    else if (await choice.isVisible()) await choice.click();
    else if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(100);
  }
  throw new Error('house did not become ready');
}

test('accepts a character show on the phone and attends with the house through real controls', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, tutorial: false, images: false })));
  const created = await request.post('/api/game/new', { data: { seed: 11, moveInDay: false, player: {
    name: 'Noa Barak', age: 24, gender: 'man', interestedIn: ['woman'], hometown: 'Haifa', occupation: 'graphic designer',
    traits: [0.6, 0.55, 0.55, 0.65, 0.45], quirks: ['foodie', 'night-owl', 'music-lover'], tastes: [0.3, 0.5, 0.2, 0.6, 0.3, 0.4], hobbies: ['sketching', 'karaoke', 'baking'],
    appearance: { hairStyle: 'short', hairColor: 'dark brown', eyeColor: 'brown', build: 'average', outfit: 'cardigan and jeans', accessory: 'none', skinTone: 'light' },
  } } });
  expect(created.ok()).toBe(true);
  let game = await (await request.get('/api/game')).json();
  for (let i = 0; i < 18 && !game.view.invitations.some((p: any) => p.performance && p.to === game.view.playerId && p.status === 'pending'); i++) {
    await skipBlock(request);
    game = await (await request.get('/api/game')).json();
  }
  const invitation = game.view.invitations.find((p: any) => p.performance && p.to === game.view.playerId && p.status === 'pending');
  expect(invitation).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode/ }).click();
  await reachHouse(page);
  await page.getByLabel('meet in room').selectOption('living');
  const contact = await page.getByLabel('invite housemate', { exact: true }).locator('option:not([disabled])').filter({ hasText: /.+/ }).nth(1).getAttribute('value');
  expect(contact).toBeTruthy();
  await page.getByLabel('invite housemate', { exact: true }).selectOption(contact!);
  await page.getByRole('button', { name: 'go together & talk', exact: true }).click();
  await expect(page.getByRole('group', { name: 'how do you respond?' })).toBeVisible();
  await expect(page.locator('main p.reply-text')).toHaveCount(0);
  const active = (await (await request.get('/api/game')).json()).scenes.find((s: any) => s.isPlayerScene && s.phase !== 'done');
  expect(active).toBeTruthy();
  await page.getByRole('button', { name: 'phone', exact: true }).click();
  await page.getByRole('tab', { name: /^plans/ }).click();
  const card = page.getByRole('tabpanel').locator('div.rounded.bg-white').filter({ hasText: invitation.performance.title }).filter({ has: page.getByRole('button', { name: 'accept plan', exact: true }) });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'accept plan', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/game')).json()).view.invitations.find((p: any) => p.id === invitation.id).status).toBe('accepted');
  expect((await (await request.get('/api/game')).json()).scenes.find((s: any) => s.id === active.id).phase).toBe('awaiting-choice');
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByRole('group', { name: 'how do you respond?' })).toBeVisible();
  await expect(page.locator('main p.reply-text')).toHaveCount(0);
  await reachHouse(page);
  game = await (await request.get('/api/game')).json();
  for (let i = 0; i < 48 && !(game.view.episode === invitation.episode && game.view.slot === invitation.slot); i++) {
    await skipBlock(request);
    game = await (await request.get('/api/game')).json();
  }
  expect([game.view.episode, game.view.slot]).toEqual([invitation.episode, invitation.slot]);
  await page.reload();
  await page.getByRole('button', { name: /continue · episode/ }).click();
  await reachHouse(page);
  await page.getByRole('button', { name: 'phone', exact: true }).click();
  await page.getByRole('tab', { name: /^plans/ }).click();
  const attend = page.getByRole('button', { name: /^attend (show|DJ set|play)$/ });
  await expect(attend).toBeEnabled();
  await attend.click();
  await expect(page.getByText(invitation.performance.title, { exact: true }).first()).toBeVisible();
  const attended = await (await request.get('/api/game')).json();
  const scene = attended.scenes.find((scene: any) => scene.title === invitation.performance.title);
  expect(scene).toBeTruthy();
  expect(scene.participants).toContain(invitation.from);
  expect(scene.participants).toContain(game.view.playerId);
  expect(scene.premise).toContain('audience');
  await reachHouse(page);
  const after = await (await request.get('/api/game')).json();
  expect(after.view.invitations.find((p: any) => p.id === invitation.id).status).toBe('kept');
});
