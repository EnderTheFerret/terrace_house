import { expect, test } from '@playwright/test';

test('creator keeps finished artwork while editing and generates one full-size portrait', async ({ page }) => {
  const requests: Record<string, any>[] = [];
  let finished = false;
  await page.route('**/api/image/portrait', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1) return route.continue();
    await route.fulfill({ json: { key: 'custom-portrait', status: 'queued' } });
  });
  await page.route('**/api/image/status/custom-portrait', (route) => route.fulfill({ json: finished
    ? { key: 'custom-portrait', status: 'ready', url: '/assets/portraits/tel-aviv-player.png' }
    : { key: 'custom-portrait', status: 'running' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'new season', exact: true }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'next', exact: true }).click();
  const portrait = page.getByRole('img', { name: 'portrait', exact: true });
  await expect(page.getByRole('status')).toHaveText('portrait ready');
  await expect(portrait).toBeVisible();
  const sprites = page.getByRole('img', { name: 'Detailed in-world sprite preview: front, back, left and right' });
  await expect(sprites).toBeVisible();
  const beforeSprite = await sprites.evaluate((node: HTMLCanvasElement) => node.toDataURL());
  expect(requests[0].portraitSeed).toBe(85508);
  await page.getByLabel('describe how you look').fill('Light brown mullet, slight tan, mustache and goatee');
  await page.getByRole('combobox', { name: 'outfit', exact: true }).selectOption('hoodie and jeans');
  await page.waitForTimeout(900); // catches the former automatic 600ms generation and palette feedback
  expect(requests).toHaveLength(1);
  expect(await sprites.evaluate((node: HTMLCanvasElement) => node.toDataURL())).not.toBe(beforeSprite);
  await expect(portrait).toBeVisible();
  await expect(page.getByText('Appearance changed. Generate a portrait to preview your new look.')).toBeVisible();
  await page.getByRole('button', { name: 'generate portrait', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('generating portrait…');
  await expect(page.getByRole('button', { name: 'generating…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'reroll', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(2);
  expect(requests[1].lowRes).toBeUndefined();
  expect(requests[1].appearanceText).toContain('mustache and goatee');
  expect(requests[1].appearance.outfit).toBe('hoodie and jeans');
  finished = true;
  await expect(page.getByRole('status')).toHaveText('portrait ready');
  await expect(portrait).toBeVisible();
  await page.waitForTimeout(900);
  expect(requests).toHaveLength(2);
});
