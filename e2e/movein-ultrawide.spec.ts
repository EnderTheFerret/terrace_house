import { expect, test } from '@playwright/test';

test('ultrawide view and gradual move-in conversations', async ({ page, request }, info) => {
  await page.setViewportSize({ width: 3440, height: 1440 });
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, tutorial: false })));
  await request.post('/api/game/new', { data: { seed: 7, moveInDay: true } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  const input = page.getByLabel('say something in your own words');
  await expect(input).toBeVisible();
  let game = await (await request.get('/api/game')).json();
  expect(game.view.characters).toHaveLength(2);
  const original = game.view.characters.find((c: any) => !c.isPlayer).name.split(' ')[0];
  for (let n = 0; n < 8 && game.view.characters.length === 2; n++) {
    await input.fill('Hello! What do you enjoy on a free day?');
    await page.getByRole('button', { name: 'say', exact: true }).click();
    await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible();
    game = await (await request.get('/api/game')).json();
  }
  expect(game.view.characters).toHaveLength(3);
  const joined = game.view.characters.find((c: any) => !c.isPlayer && c.name.split(' ')[0] !== original).name.split(' ')[0];
  const locations = game.view.characters.map((c: any) => [c.id, c.location]);
  await page.getByRole('button', { name: "that's all", exact: true }).click();
  const canvas = page.getByLabel(/^top-down view of the share house/);
  await expect(canvas).toBeVisible();
  await expect(input).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'skip to next block', exact: true })).toBeEnabled();
  const afterChat = await (await request.get('/api/game')).json();
  expect(afterChat.scenes).toHaveLength(0);
  expect(afterChat.view.characters.map((c: any) => [c.id, c.location])).toEqual(locations);
  const width = await canvas.evaluate(el => el.getBoundingClientRect().width);
  const nativeWidth = await canvas.evaluate(el => (el as HTMLCanvasElement).width / 2);
  expect(width / nativeWidth).toBeGreaterThanOrEqual(3);
  await page.getByRole('button', { name: 'zoom in', exact: true }).click();
  await expect.poll(() => canvas.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(width);
  await page.getByRole('button', { name: 'reset view', exact: true }).click();
  await expect.poll(() => canvas.evaluate(el => el.getBoundingClientRect().width)).toBe(width);
  await page.screenshot({ path: info.outputPath('ultrawide-house.png') });
  await page.evaluate(() => {
    const samples: { t: number; x: number; y: number }[] = [];
    (window as any).walkSamples = samples;
    const original = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
      if (this.fillStyle === '#e07a6a' && w === 2 && h === 2) samples.push({ t: performance.now(), x, y });
      original.call(this, x, y, w, h);
    };
  });
  await canvas.focus();
  let speed = 0;
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
    await page.evaluate(() => { (window as any).walkSamples.length = 0; });
    await page.keyboard.down(key);
    await page.waitForTimeout(600);
    await page.keyboard.up(key);
    await page.waitForTimeout(350);
    speed = await page.evaluate(axis => {
      const samples = (window as any).walkSamples as { t: number; x: number; y: number }[];
      let pixels = 0, ms = 0;
      for (let i = 1; i < samples.length; i++) {
        const distance = Math.abs(samples[i][axis] - samples[i - 1][axis]);
        const elapsed = samples[i].t - samples[i - 1].t;
        if (distance >= 2 && elapsed > 0 && elapsed < 100) { pixels += distance; ms += elapsed; }
      }
      return pixels >= 24 ? pixels / ms * 1000 / 32 : 0;
    }, key === 'ArrowLeft' || key === 'ArrowRight' ? 'x' : 'y');
    if (speed) break;
  }
  expect(speed).toBeGreaterThan(2.5);
  expect(speed).toBeLessThan(4.5);
  await page.getByRole('button', { name: 'skip to next block', exact: true }).click();
  await expect.poll(async () => (await (await request.get('/api/game')).json()).view.slot).toBe('slot1');
  const digest = page.getByRole('dialog', { name: 'while you were out' });
  if (await digest.isVisible()) await digest.getByRole('button', { name: 'ok', exact: true }).click();
  await page.getByRole('button', { name: `talk to ${joined}`, exact: true }).click();
  await page.getByRole('dialog', { name: `talk to ${joined}?` }).getByRole('button', { name: 'yes', exact: true }).click();
  for (let n = 0; n < 8 && !(await page.getByRole('button', { name: /^meet / }).isVisible()); n++) {
    await expect(input).toBeVisible();
    await input.fill('Tell me more about yourself.');
    await page.getByRole('button', { name: 'say', exact: true }).click();
    await expect(page.getByRole('button', { name: "that's all", exact: true }).or(page.getByRole('button', { name: /^meet / }))).toBeVisible();
  }
  await expect(page.getByRole('status').filter({ hasText: 'Your conversation pauses' })).toBeVisible();
  await page.getByRole('button', { name: /^meet / }).click();
  await expect(input).toBeVisible();
  await page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first().click();
  await page.getByRole('button', { name: `keep talking with ${original}`, exact: true }).click();
  await expect(input).toBeVisible();
  expect((await (await request.get('/api/game')).json()).scenes[0].participants).toContain(game.view.characters.find((c: any) => c.name.split(' ')[0] === original).id);
});
