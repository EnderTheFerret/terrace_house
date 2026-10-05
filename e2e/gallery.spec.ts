import { expect, test } from '@playwright/test';

test('gallery opens original scenes, handles loading errors, and returns to the main menu', async ({ page, request }) => {
  let failed = false;
  await page.route('**/api/gallery', (route) => failed ? route.fulfill({ status: 503, json: { error: 'temporarily unavailable' } }) : route.fulfill({ json: { scenes: [{ url: '/images/detail.png', createdAt: '2026-10-04 10:00:00' }] } }));
  const source = await request.get('/assets/portraits/finished-ren-thigh-up-v1.png');
  expect(source.ok()).toBe(true);
  await page.route('**/images/detail.png', (route) => route.fulfill({ response: source }));
  await page.goto('/');
  await page.getByRole('button', { name: 'scene gallery', exact: true }).click();
  await page.getByRole('button', { name: 'view scene 1', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'gallery scene' });
  const image = preview.getByRole('img', { name: 'selected generated scene' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(720);
  expect(await image.evaluate((el: HTMLImageElement) => [el.tagName, el.naturalWidth > 720, getComputedStyle(el).imageRendering])).toEqual(['IMG', true, 'auto']);
  await expect(preview.getByRole('link', { name: 'open original' })).toHaveAttribute('href', '/images/detail.png');
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  failed = true;
  await page.getByRole('button', { name: 'refresh', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  failed = false;
  await page.getByRole('button', { name: 'refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'view scene 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'main menu' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'scene gallery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'view scene 1', exact: true })).toBeVisible();
});

test('gallery explains where scenes come from when empty', async ({ page }) => {
  await page.route('**/api/gallery', (route) => route.fulfill({ json: { scenes: [] } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'scene gallery', exact: true }).click();
  await expect(page.getByText(/No generated scenes yet/)).toBeVisible();
});
