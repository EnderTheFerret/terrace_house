import { expect, test, type Page } from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function settle(page: Page) {
  for (let i = 0; i < 180; i++) {
    const home = button(page, 'skip to next block');
    const digest = page.getByRole('dialog', { name: 'while you were out' });
    if (await digest.isVisible()) { await digest.getByRole('button', { name: 'ok', exact: true }).click(); continue; }
    if (await home.isVisible() && await home.isEnabled()) {
      await page.waitForTimeout(600);
      if (!await digest.isVisible() && await home.isVisible() && await home.isEnabled()) return;
      continue;
    }
    const end = button(page, "that's all");
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await end.isVisible()) await end.click();
    else if (await choice.isVisible()) await choice.click();
    else if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(100);
  }
  throw new Error('house did not become ready');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: false, sound: false, tutorial: false, images: false })));
});

test('recipe book and all five cooking mechanics render on desktop and mobile', async ({ page }, info) => {
  await page.goto('/');
  await button(page, 'practice cooking').click();
  await expect(page.locator('.recipe-tile')).toHaveCount(15);
  await page.screenshot({ path: info.outputPath('recipe-desktop.png') });
  await page.getByLabel('recipe diet').selectOption('vegan');
  await expect(page.locator('.recipe-tile')).toHaveCount(6);
  await page.getByLabel('recipe diet').selectOption('all');
  await page.getByLabel('search recipes').fill('mujaddara');
  await expect(page.locator('.recipe-tile')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('recipe-mobile.png') });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Mujaddara/ }).click();
  await page.getByRole('button', { name: 'slice the onions thinly (chop)', exact: true }).click();
  await button(page, 'start').click();
  await button(page, 'chop').click();
  await page.screenshot({ path: info.outputPath('chop-mobile.png') });
  await expect(button(page, 'simmer the rice and lentils (boil)')).toBeVisible({ timeout: 15000 });
  await button(page, 'simmer the rice and lentils (boil)').click();
  await button(page, 'light the stove').click();
  const firstFrame = await page.locator('.cooking-action').evaluate(el => getComputedStyle(el).backgroundPosition);
  await expect.poll(() => page.locator('.cooking-action').evaluate(el => getComputedStyle(el).backgroundPosition)).not.toBe(firstFrame);
  await button(page, 'take it off the heat').click();
  await button(page, 'caramelize the onions (saute)').click();
  await button(page, 'hold to heat').click();
  await expect(button(page, 'add cumin and salt (season)')).toBeVisible({ timeout: 20000 });
  await button(page, 'add cumin and salt (season)').click();
  await button(page, 'taste once').click();
  await button(page, 'done').click();
  await button(page, 'top the rice with onions (plate)').click();
  await page.getByRole('button', { name: 'rice, use arrow keys to move', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: info.outputPath('plate-mobile.png') });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await button(page, 'serve').click();
  await expect(page.getByRole('heading', { name: 'ready to serve', exact: true })).toBeVisible();
  await button(page, 'cook again').click();
  await expect(page.locator('.recipe-tile')).toHaveCount(1);
  for (const name of ['dishes', 'ingredients', 'chop', 'boil', 'saute', 'season', 'plate']) {
    const status = await page.evaluate(async name => {
      const img = new Image(); img.src = `/assets/cooking/${name}.png`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      const colors = new Set<string>(); for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
      return { width: img.width, height: img.height, colors: colors.size };
    }, name);
    expect(status.width).toBeGreaterThan(0); expect(status.colors).toBeGreaterThan(16);
  }
});

test('phone sends brief exchanges in the thread without scenes or elapsed time', async ({ page, request }, info) => {
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await settle(page);
  for (let i = 0; i < 2; i++) {
    await button(page, 'skip to next block').click();
    await settle(page);
  }
  await button(page, 'phone').click();
  const game = await (await request.get('/api/game')).json();
  const contact = game.view.characters.find((c: { isPlayer: boolean; status: string; id: string }) => !c.isPlayer && c.status === 'inHouse' && c.id === 'kaito');
  expect(contact).toBeTruthy();
  const name = contact.name.split(' ')[0];
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
  const before = game.view.clock;
  for (const text of ['Can you bring hummus home?', 'And some warm pita, please.', 'Thanks, see you at dinner.']) {
    await page.getByLabel(`message to ${name}`).fill(text);
    await button(page, 'send').click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByLabel(`message to ${name}`)).toHaveValue('');
    await expect(button(page, 'send')).toBeDisabled();
    const after = await (await request.get('/api/game')).json();
    expect(after.scenes.filter((s: { phase: string }) => s.phase !== 'done')).toEqual([]);
    expect(after.view.clock).toBe(before);
    await expect(page.getByText('scenes still pending', { exact: true })).toHaveCount(0);
  }
  const after = await (await request.get('/api/game')).json();
  expect(after.view.chats.find((t: { with: string }) => t.with === contact.id).messages.slice(-6).map((m: { from: string }) => m.from)).toEqual([game.view.playerId, contact.id, game.view.playerId, contact.id, game.view.playerId, contact.id]);
  await page.screenshot({ path: info.outputPath('phone-reply.png') });
});

test('loading a mid-conversation save reopens its lines and lets you continue', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: false } });
  const opened = await request.post('/api/game/action', { data: { action: { type: 'talk', target: 'mio', room: 'living', guests: ['ren'] } } });
  expect(opened.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  const say = page.getByLabel('say something in your own words');
  await expect(say).toBeVisible();
  await say.fill('Remember this: I want to learn guitar.');
  await say.press('Enter');
  await expect(button(page, "that's all")).toBeVisible();
  const savedGame = await (await request.get('/api/game')).json();
  const scene = savedGame.scenes.find((s: { phase: string }) => s.phase === 'awaiting-choice');
  await button(page, 'save').click();
  const slot = page.getByRole('listitem').filter({ hasText: 'slot 1' });
  await slot.getByRole('button', { name: 'save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('saved to slot 1');
  await button(page, 'back').click();
  await expect(say).toBeVisible();
  await say.fill('This line should disappear when I reload.');
  await say.press('Enter');
  await expect(button(page, "that's all")).toBeVisible();
  await button(page, 'save').click();
  await slot.getByRole('button', { name: 'load', exact: true }).click();
  await expect(say).toBeVisible();
  await expect(page.getByText('Remember this: I want to learn guitar.', { exact: true })).toBeVisible();
  await expect(page.getByText('This line should disappear when I reload.', { exact: true })).toHaveCount(0);
  const restored = await (await request.get('/api/game')).json();
  expect(restored.scenes.find((s: { phase: string }) => s.phase === 'awaiting-choice').id).toBe(scene.id);
  expect(restored.view.clock).toBe(savedGame.view.clock);
  await button(page, 'phone').click();
  for (const id of ['kaito', 'mio']) {
    const contact = restored.view.characters.find((c: { id: string }) => c.id === id);
    const name = contact.name.split(' ')[0];
    await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
    const text = `Popcorn could be nice, ${name}.`;
    await page.getByLabel(`message to ${name}`).fill(text);
    await expect(button(page, 'send')).toBeEnabled();
    await button(page, 'send').click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByLabel(`message to ${name}`)).toHaveValue('');
    const afterText = await (await request.get('/api/game')).json();
    expect(afterText.scenes).toEqual(restored.scenes);
    expect(afterText.view.clock).toBe(restored.view.clock);
  }
  await button(page, 'return to conversation').click();
  await expect(say).toBeVisible();
  await expect(page.getByText('Remember this: I want to learn guitar.', { exact: true })).toBeVisible();
  await say.fill('What should I practice first?');
  await say.press('Enter');
  await expect(page.getByText('What should I practice first?', { exact: true })).toBeVisible();
  await expect(button(page, "that's all")).toBeVisible();
});
