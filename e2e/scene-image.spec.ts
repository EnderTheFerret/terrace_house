import { expect, test } from '@playwright/test';

// Texts stay on the phone as instant messages, so only a talk has a scene to illustrate.
test('generate scene during talk preserves the conversation', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  await request.post('/api/game/new', { data: { seed: 21, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  await page.getByRole('button', { name: 'talk to Kai', exact: true }).click();
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  const generate = page.getByRole('button', { name: 'generate scene', exact: true });
  await expect(generate).toBeEnabled();
  const say = page.getByLabel('say something in your own words');
  await say.fill('We should bake bread together.');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(generate).toBeEnabled();
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible(); // replies finished: talk time is booked per line
  const before = (await (await request.get('/api/game')).json()).view;
  await generate.click();
  const preview = page.getByRole('dialog', { name: 'generated scene' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('img', { name: 'illustration of the current conversation' })).toBeVisible();
  expect(await preview.getByRole('img', { name: 'illustration of the current conversation' }).evaluate((el) => el.tagName)).toBe('IMG');
  await expect(preview.getByText('Temporary preview: image service unavailable.')).toBeVisible();
  const after = (await (await request.get('/api/game')).json()).view;
  expect([after.clock, after.tick, after.episode]).toEqual([before.clock, before.tick, before.episode]);
  await preview.getByRole('button', { name: 'close', exact: true }).click();
  await expect(preview).not.toBeVisible();
  await expect(say).toBeVisible();
  await page.getByRole('button', { name: 'scene gallery', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'scene gallery', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await expect(say).toBeVisible();
  await say.fill('I will bring the flour.');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(page.getByText('I will bring the flour.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible();
});
