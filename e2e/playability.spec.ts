import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spriteSheetPixels } from '../packages/shared/src/sprite-sheet';

test('the generated sprite sheet keeps its face, clothes and full height when rendered', async ({ page }, info) => {
  const url = `data:image/png;base64,${readFileSync('artwork/sprites/shared_roof_sprite_00091_.png').toString('base64')}`;
  await page.setContent('<canvas id="sprite" width="384" height="480"></canvas>');
  const source = await page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixels: Array.from(ctx.getImageData(0, 0, image.width, image.height).data) };
  }, url);
  const frames = spriteSheetPixels(new Uint8ClampedArray(source.pixels), source.width, source.height);
  for (const frame of frames.flat()) {
    const opaque = frame.flat().filter(Boolean);
    expect(opaque.length).toBeGreaterThan(250);
    expect(new Set(opaque).size).toBeGreaterThan(20);
    expect(frame.slice(0, 4).some(row => row.some(Boolean))).toBe(true);
    expect(frame.slice(35, 38).some(row => row.some(Boolean))).toBe(true);
  }
  await page.evaluate(sheet => {
    const ctx = (document.getElementById('sprite') as HTMLCanvasElement).getContext('2d')!;
    ctx.fillStyle = '#8aa7a3'; ctx.fillRect(0, 0, 384, 480);
    sheet.forEach((walk, dir) => walk.forEach((frame, step) => frame.forEach((row, y) => row.forEach((color, x) => {
      if (color) { ctx.fillStyle = color; ctx.fillRect(step * 128 + x * 4, dir * 120 + y * 3, 4, 3); }
    }))));
  }, frames);
  await page.locator('canvas').screenshot({ path: info.outputPath('extracted-sprites.png') });
});

test('title saves stay disabled and artwork never blocks the episode', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: false } });
  await page.route('**/api/image/character/*/sprite*', route => route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"outfit still loading"}' }));
  await page.goto('/');
  await page.getByRole('button', { name: 'load', exact: true }).click();
  const saves = page.getByRole('button', { name: 'save', exact: true });
  await expect(saves).toHaveCount(5);
  for (const save of await saves.all()) await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await expect(page.getByRole('button', { name: 'begin', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  await expect(page.getByRole('button', { name: 'phone', exact: true })).toBeVisible();
});

test('the house watches days 1–3 on day 6 after finishing a conversation', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, tutorial: false })));
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: false, seasonLength: 0 } });
  let game: any;
  for (let step = 0; step < 60; step++) {
    game = await (await request.get('/api/game')).json();
    if (game.view.episode === 6 && game.view.slot === 'evening') break;
    const action = await request.post('/api/game/action', { data: { action: { type: 'skip' } } });
    expect(action.ok()).toBe(true);
    for (const scene of (await action.json()).scenes) {
      if (scene.phase === 'done') continue;
      if (scene.phase === 'awaiting-response') {
        await request.post(`/api/scene/${scene.id}/respond`, { data: { response: 'ignore' } });
        continue;
      }
      await request.get(`/api/scene/${scene.id}/stream`);
      const pending = (await (await request.get('/api/game')).json()).scenes.find((s: any) => s.id === scene.id);
      if (pending.phase === 'awaiting-choice') {
        await request.post(`/api/scene/${scene.id}/choose`, { data: { done: true, hangout: true } });
        await request.get(`/api/scene/${scene.id}/stream`);
      }
    }
    expect((await request.post('/api/game/end-slot')).ok()).toBe(true);
    const panel = await request.post('/api/studio/intermission');
    if (panel.ok()) expect((await panel.json()).lines.length).toBeGreaterThan(0);
  }
  expect(game.view.episode).toBe(6);
  expect(game.view.slot).toBe('evening');
  expect(game.view.aired).toBeNull();
  const target = game.view.characters.find((c: any) => c.id !== game.view.playerId && c.status === 'inHouse' && ['living', 'kitchen', 'bedroomM', 'bedroomW', 'backyard'].includes(c.location) && !['work', 'sleep', 'nap', 'shower'].includes(c.activity));
  expect(target).toBeDefined();
  expect((await request.post('/api/game/action', { data: { action: { type: 'talk', target: target.id, room: 'kitchen' } } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 6/ }).click();
  const say = page.getByLabel('say something in your own words');
  await expect(say).toBeVisible();
  await say.fill('Let us finish the dishes before watching TV.');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible();
  await page.getByRole('button', { name: "that's all", exact: true }).click();
  const highlights = page.getByRole('complementary', { name: 'episode highlights on TV' });
  await expect(highlights).toBeVisible();
  await expect(highlights.getByRole('heading', { level: 2 })).toHaveText('episode 1 · days 1–3');
  const tvPanel = highlights.getByRole('region', { name: 'panel commentary on TV' });
  await expect(tvPanel).toBeVisible();
  expect(await tvPanel.locator('.reply-text').count()).toBeGreaterThan(3);
  await expect(tvPanel).toContainText('day 1');
  await expect(tvPanel).toContainText('day 2');
  await expect(tvPanel).toContainText('day 3');
  expect((await (await request.get('/api/game')).json()).view.aired).toBe(1);
});

test('group chats, reply retry and reading phone notifications work in the browser', async ({ page, request }, info) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, tutorial: false })));
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: false } });
  const action = await request.post('/api/game/action', { data: { action: { type: 'talk', target: 'ren', room: 'living', guests: ['mio'] } } });
  expect(action.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  const say = page.getByLabel('say something in your own words');
  await expect(say).toBeVisible();
  await say.fill('Ron, Maya, shall we wash the dishes together?');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(page.getByRole('button', { name: 'retry reply', exact: true })).toBeVisible();
  const before = (await (await request.get('/api/game')).json()).view;
  const retryResponse = page.waitForResponse(r => /\/api\/scene\/[^/]+\/stream$/.test(r.url()));
  await page.getByRole('button', { name: 'retry reply', exact: true }).click();
  await (await retryResponse).text();
  await expect(say).toBeVisible();
  const after = (await (await request.get('/api/game')).json()).view;
  expect(after.clock).toBe(before.clock);
  const reply = page.locator('.reply-text').last();
  expect(await reply.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(18);
  await page.screenshot({ path: info.outputPath('conversation.png') });
  await page.getByRole('button', { name: "that's all", exact: true }).click();
  await expect(page.getByLabel('invite housemate', { exact: true })).toBeVisible();
  const available = page.getByLabel('invite housemate', { exact: true }).locator('option[value]:not([value=""])');
  expect(await available.count()).toBeGreaterThanOrEqual(2);
  const target = (await available.first().getAttribute('value'))!;
  await page.getByLabel('invite housemate', { exact: true }).selectOption(target);
  const invited = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: 'also invite' }) }).getByRole('checkbox').first();
  await invited.check();
  await expect(invited).toBeChecked();
  const groupRequest = page.waitForRequest(r => r.url().endsWith('/api/game/action') && r.method() === 'POST');
  await page.getByRole('button', { name: 'go together & talk', exact: true }).click();
  const chosen = (await groupRequest).postDataJSON().action;
  expect(chosen.guests).toHaveLength(1);
  await expect(say).toBeVisible();
  const group = (await (await request.get('/api/game')).json()).scenes.find((s: any) => s.isPlayerScene && s.phase !== 'done');
  expect(group.participants).toEqual(expect.arrayContaining([chosen.target, ...chosen.guests]));
  expect(group.participants).toHaveLength(3);
  await expect(page.getByRole('group', { name: 'people in this conversation' }).locator(':scope > div')).toHaveCount(2);
  await page.getByRole('button', { name: 'phone', exact: true }).click();
  await page.getByRole('tab', { name: /^Ron/ }).click();
  await page.getByLabel('message to Ron').fill('See you at breakfast?');
  await page.getByRole('button', { name: 'send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'retry reply', exact: true })).toBeVisible();
  const messages = (await (await request.get('/api/game')).json()).view.chats.find((t: any) => t.with === 'ren').messages;
  await page.getByRole('button', { name: 'retry reply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'retry reply', exact: true })).toBeEnabled();
  const retried = (await (await request.get('/api/game')).json()).view.chats.find((t: any) => t.with === 'ren').messages;
  expect(retried).toHaveLength(messages.length);
  for (const tab of await page.getByRole('tab').all()) await tab.click();
  await expect(page.getByRole('button', { name: 'phone', exact: true })).toHaveAttribute('title', 'phone (p)');
  await page.screenshot({ path: info.outputPath('phone.png') });
});
