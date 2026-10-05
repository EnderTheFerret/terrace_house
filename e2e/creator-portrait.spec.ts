import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, sound: false, tutorial: false, reducedMotion: false })));
});

test('prebaked season loads finished Klein sheets for the player and cast', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'new season', exact: true }).click();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'next', exact: true }).click();
  const ids = ['player', 'ren', 'kaito', 'shun', 'mio', 'sora'];
  const playerSheet = page.waitForResponse(response => response.url().includes('/api/image/character/player/sprite?day=0&occasion=daily'));
  await page.getByRole('button', { name: 'move in', exact: true }).click();
  await playerSheet;
  // Housemates arrive one at a time; their finished assets must also be ready before each arrival.
  const sheets = await Promise.all(ids.map(id => request.get(`/api/image/character/${id}/sprite?day=0&occasion=daily`)));
  for (const [i, response] of sheets.entries()) {
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready', placeholder: false, url: `/assets/sprites/finished-${ids[i]}-daily-0.png`,
    });
    expect((await response.json()).key).toContain(`sprite:klein-4walk-v1:portrait:${ids[i]}:`);
  }
});


for (const cast of ['prebaked cast', 'random cast']) {
  test(`creator waits for move-in and uses the selected ${cast}`, async ({ page, request }, testInfo) => {
    // Boot with a saved game: its sprites must not start while creating someone new.
    await request.post('/api/game/new', { data: { seed: 7 } });
    const imageRequests: string[] = [];
    const starts: Record<string, any>[] = [];
    page.on('request', req => { if (req.url().includes('/api/image/')) imageRequests.push(req.url()); });
    await page.route('**/api/game/new', async route => {
      starts.push(route.request().postDataJSON());
      await route.continue();
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /continue · episode 1/ })).toBeEnabled();
    await page.getByRole('button', { name: 'new season', exact: true }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'next', exact: true }).click();
    await expect(page.getByRole('img', { name: 'Your character portrait', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Finished walk sprite preview: front, back, left and right', exact: true })).toBeVisible();
    if (cast === 'random cast') {
      await page.getByLabel('describe how you look').fill('Light brown mullet, mustache and goatee, large glasses');
      await page.getByRole('combobox', { name: 'hair style', exact: true }).selectOption('short messy');
      await page.getByRole('combobox', { name: 'outfit', exact: true }).selectOption('hoodie and jeans');
    }
    await page.getByRole('button', { name: 'next', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'prebaked cast', exact: true })).toBeChecked();
    const previews = page.getByRole('img', { name: 'Finished walk sprite preview: front, back, left and right', exact: true });
    await expect(previews).toHaveCount(5);
    for (const canvas of await previews.all()) {
      await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) =>
        node.getContext('2d')!.getImageData(0, 0, 128, 40).data.some((value, i) => i % 4 === 3 && value > 0))).toBe(true);
    }
    const portraits = page.locator('img[src^="/assets/portraits/finished-"]:visible');
    await expect(portraits).toHaveCount(5);
    await expect.poll(() => portraits.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).naturalWidth >= 800))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('prebaked-cast.png') });
    await page.getByRole('radio', { name: 'random cast', exact: true }).check();
    await expect(previews).toHaveCount(0);
    await expect(page.getByText(/Their characters, portraits and walk sprites will be generated after you move in/)).toBeVisible();
    await page.getByRole('radio', { name: cast, exact: true }).check();
    await page.waitForTimeout(1700); // catches previous background sprite retries and automatic portrait requests
    expect(imageRequests).toEqual([]);
    expect(starts).toEqual([]);
    const playerSprite = page.waitForResponse(response => /\/api\/image\/character\/player\/sprite\?/.test(response.url()));
    await page.getByRole('button', { name: 'move in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'EPISODE 1', exact: true })).toBeVisible();
    await playerSprite;
    expect(starts).toHaveLength(1);
    expect(starts[0].randomizeCast).toBe(cast === 'random cast');
    if (cast === 'random cast') {
      expect(starts[0].player.appearanceText).toContain('mustache and goatee');
      expect(starts[0].player.appearance).toMatchObject({ hairStyle: 'short messy', outfit: 'hoodie and jeans' });
    }
    await page.getByRole('button', { name: 'begin', exact: true }).click();
    const input = page.getByLabel('say something in your own words');
    await expect(input).toBeVisible();
    await page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'continue', exact: true }).click();
    await expect(page.getByLabel(/top-down view of the share house/)).toBeVisible();
  });
}

test('creator previews walking animation, changes and fixes it without changing the portrait, and saves the selection', async ({ page, request }, info) => {
  const sprites: any[] = [];
  const portraits: any[] = [];
  page.on('request', req => {
    if (req.url().endsWith('/api/image/sprite')) sprites.push(req.postDataJSON());
    if (req.url().endsWith('/api/image/portrait')) portraits.push(req.postDataJSON());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'new season', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'next', exact: true }).click();
  const artwork = page.getByRole('region', { name: 'portrait and walking sprite' });
  const portrait = artwork.getByRole('img', { name: 'Your character portrait', exact: true });
  const originalPortrait = await portrait.getAttribute('src');
  const preview = artwork.getByRole('img', { name: 'Finished walk sprite preview: front, back, left and right', exact: true });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.getAttribute('data-frame')).not.toBeNull();
  const frame = await preview.getAttribute('data-frame');
  await expect.poll(() => preview.getAttribute('data-frame')).not.toBe(frame);
  await page.screenshot({ path: info.outputPath('creator-artwork.png') });
  const notes = page.getByLabel('What should be fixed in the sprite?');
  await notes.fill('Keep the glasses visible in every walking frame');
  expect(sprites).toHaveLength(0);
  expect(portraits).toHaveLength(0);
  const change = page.getByRole('button', { name: 'change sprite', exact: true });
  await change.click();
  await expect(change).toBeEnabled();
  expect(sprites).toHaveLength(1);
  const firstSeed = sprites[0].spriteSeed;
  expect(portraits).toHaveLength(0);
  await expect(portrait).toHaveAttribute('src', originalPortrait!);
  // A failed edit keeps the previous sprite visible and permits a retry.
  await page.route('**/api/image/sprite', route => route.fulfill({ status: 503, json: { error: 'Image service unavailable; try again.' } }), { times: 1 });
  const fix = page.getByRole('button', { name: 'fix sprite', exact: true });
  await fix.click();
  await expect(page.getByRole('alert')).toHaveText('Image service unavailable; try again.');
  await expect(fix).toBeEnabled();
  await expect(preview).toBeVisible();
  await expect(portrait).toHaveAttribute('src', originalPortrait!);
  await fix.click();
  await expect(fix).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(sprites).toHaveLength(3);
  const selected = sprites.at(-1);
  expect(selected.spriteSeed).toBe(firstSeed);
  expect(selected.spriteInstructions).toBe('Keep the glasses visible in every walking frame');
  expect(portraits).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('creator-walking-sprite.png') });
  await page.getByRole('button', { name: 'next', exact: true }).click();
  await page.getByRole('button', { name: 'move in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'EPISODE 1', exact: true })).toBeVisible();
  const game = await (await request.get('/api/game')).json();
  expect(game.view.characters.find((c: any) => c.isPlayer)).toMatchObject({ spriteSeed: selected.spriteSeed, spriteInstructions: selected.spriteInstructions });
});

test('custom appearance generates a portrait and sprite only when requested, and reduced motion pauses the preview', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ sound: false, tutorial: false, reducedMotion: true })));
  const requests: string[] = [];
  page.on('request', req => { if (/\/api\/image\/(portrait|sprite)$/.test(req.url())) requests.push(req.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'new season', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'next', exact: true }).click();
  const preview = page.getByRole('img', { name: 'Finished walk sprite preview: front, back, left and right', exact: true });
  await expect(preview).toHaveAttribute('data-frame', '1');
  await page.waitForTimeout(350);
  await expect(preview).toHaveAttribute('data-frame', '1');
  await page.getByRole('combobox', { name: 'hair style', exact: true }).selectOption('short messy');
  await page.getByLabel('describe how you look').fill('A red jacket and round glasses');
  await expect(page.getByRole('status')).toHaveText('Appearance changed. Generate updated artwork when you are ready.');
  await expect(page.getByRole('button', { name: 'change sprite', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
  const generate = page.getByRole('button', { name: 'generate portrait + sprite', exact: true });
  await generate.click();
  await expect(generate).toBeEnabled();
  expect(requests.map(url => url.split('/').at(-1))).toEqual(['portrait', 'sprite']);
  await expect(page.getByRole('img', { name: 'Your character portrait', exact: true })).toHaveAttribute('src', /\/images\/ph-/);
  await expect(page.getByText('Temporary portrait', { exact: true })).toBeVisible();
  await expect(preview).toHaveAttribute('data-frame', '1');
  await expect(page.getByRole('button', { name: 'change sprite', exact: true })).toBeEnabled();
});
