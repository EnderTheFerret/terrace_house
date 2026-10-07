import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Locator } from '@playwright/test';

async function reachHouse(page: Page) {
  for (let i = 0; i < 120; i++) {
    const digest = page.getByRole('dialog', { name: 'while you were out' });
    if (await digest.isVisible()) { await digest.getByRole('button', { name: 'ok', exact: true }).click(); continue; }
    const ready = page.getByRole('button', { name: 'sleep until morning', exact: true });
    const isReady = () => ready.evaluateAll(buttons => buttons.some(b => !b.hasAttribute('disabled') && (b as HTMLElement).offsetParent !== null));
    if (await isReady()) {
      await page.waitForTimeout(400);
      if (await isReady()) return;
    }
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode|roll credits|that's all)$/ }).first();
    const done = page.getByRole('button', { name: "that's all", exact: true }); // talks are open-ended: end yours after one answer
    if (await done.isVisible()) await done.click();
    else if (await choice.isVisible()) await choice.click();
    else if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(150);
  }
  throw new Error('house did not become available');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, tutorial: false })));
});

test('guide works before a season and all its screenshots are available', async ({ page, request }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'activity guide', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'activity guide', exact: true })).toBeVisible();
  const images = await page.locator('main img').evaluateAll(els => els.map(el => el.getAttribute('src')!));
  expect(images.length).toBeGreaterThan(30);
  if (!process.env.UPDATE_GUIDE_SCREENSHOTS) {
    for (const src of images) {
      const response = await request.get(src);
      expect(response.ok(), src).toBe(true);
      expect(response.headers()['content-type'], src).toContain('image/png');
    }
  }
  await page.getByText('Everyday life: all 15 quick activities', { exact: true }).click();
  await expect(page.locator('details details')).toHaveCount(15);
  await page.getByText('wash dishes · 15 min', { exact: true }).click();
  const dishes = page.getByRole('img', { name: 'wash dishes: activity and company selectors, start button', exact: true });
  await dishes.scrollIntoViewIfNeeded();
  await expect.poll(() => dishes.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('guide-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('guide-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'new season', exact: true })).toBeVisible();
});

test('guide pauses the world and returns to the house and an ongoing talk', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 21, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  await page.getByRole('button', { name: 'activity guide', exact: true }).click();
  const before = (await (await request.get('/api/game')).json()).view;
  await page.waitForTimeout(21000); // longer than a normal world pulse
  const after = (await (await request.get('/api/game')).json()).view;
  expect([after.clock, after.tick, after.episode]).toEqual([before.clock, before.tick, before.episode]);
  await page.getByRole('button', { name: 'back to game / menu', exact: true }).click();
  await expect(page.getByLabel('household activity')).toBeVisible();
  await page.getByRole('button', { name: 'phone', exact: true }).click();
  await page.getByRole('button', { name: 'activity guide', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'plans', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'close', exact: true }).click();
  await expect(page.getByLabel('household activity')).toBeVisible();
  await page.getByRole('button', { name: 'talk to Kai', exact: true }).click();
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  await expect(page.getByLabel('say something in your own words')).toBeVisible();
  await page.getByRole('button', { name: 'activity guide', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('say something in your own words').fill('Want to make coffee later?');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(page.getByText('Want to make coffee later?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: "that's all", exact: true }).click();
  await reachHouse(page);
  await page.getByRole('button', { name: 'cook', exact: true }).click();
  // housemates cook from the shared fridge too; lentils last the morning where pita and chickpeas may not
  await page.getByRole('button', { name: /^Lentil Soup/ }).click();
  await page.getByRole('button', { name: 'simmer the lentils (boil)', exact: true }).click();
  await page.getByRole('button', { name: 'light the stove', exact: true }).click();
  await page.getByRole('button', { name: 'activity guide', exact: true }).click();
  await page.waitForTimeout(17000); // would overboil if the timer kept running
  await page.keyboard.press('Space'); // guide input must not stop the hidden boil
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'take it off the heat', exact: true })).toBeVisible();
  await expect(page.getByText('still', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'take it off the heat', exact: true }).click();
  const elapsed = await page.getByRole('meter', { name: /^time \d+s/ }).getAttribute('aria-label');
  expect(Number(elapsed!.match(/^time (\d+)s/)![1])).toBeLessThan(5);
});

test('the guide preserves running chop and sauté steps', async ({ page, request }) => {
  for (const type of ['chop', 'saute']) {
    await request.post('/api/game/new', { data: { seed: 21, seasonLength: 0, moveInDay: false } });
    await page.goto('/');
    await page.getByRole('button', { name: /continue · episode 1/ }).click();
    await reachHouse(page);
    await page.getByRole('button', { name: 'cook', exact: true }).click();
    await page.getByRole('button', { name: type === 'chop' ? /^Friday Mangal/ : /^Shakshuka/ }).click();
    if (type === 'saute') {
      await page.getByRole('button', { name: /\(season\)/ }).click();
      await page.getByRole('button', { name: 'done', exact: true }).click();
    }
    await page.getByRole('button', { name: new RegExp(`\\(${type}\\)`) }).first().click();
    await page.keyboard.press('Space');
    const panTime = page.getByRole('meter', { name: 'time', exact: true });
    if (type === 'saute') await expect.poll(async () => Number(await panTime.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(2);
    const before = type === 'saute' ? await panTime.getAttribute('aria-valuenow') : null;
    await page.getByRole('button', { name: 'activity guide', exact: true }).click();
    await page.waitForTimeout(type === 'chop' ? 9000 : 2500);
    await page.keyboard.press('Escape');
    if (type === 'chop') await expect(page.getByRole('button', { name: 'chop', exact: true })).toBeVisible();
    else expect(await panTime.getAttribute('aria-valuenow')).toBe(before);
  }
});

// Opt-in asset refresh, using only the throwaway mock season from playwright.config.ts.
// PowerShell: $env:UPDATE_GUIDE_SCREENSHOTS='1'; npx playwright test e2e/guide.spec.ts -g 'capture guide'
test('capture guide screenshots from the real activity controls', async ({ page, request }) => {
  test.skip(!process.env.UPDATE_GUIDE_SCREENSHOTS, 'Only run when refreshing the guide artwork.');
  test.setTimeout(300000);
  const dir = 'apps/web/public/assets/guide';
  mkdirSync(dir, { recursive: true });
  const shot = async (id: string, region?: Locator) => {
    if (region) await region.scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);
    await (region ?? page).screenshot({ path: `${dir}/${id}.png`, animations: 'disabled' });
  };
  const menu = async (name: string) => page.getByRole('button', { name, exact: true }).click();
  await request.post('/api/game/new', { data: { seed: 21, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await reachHouse(page);
  await shot('house');
  await shot('house-actions', page.getByRole('region', { name: /what will you do/ }));
  const everyday = page.getByRole('region', { name: 'everyday life', exact: true });
  const ids = await page.getByLabel('household activity').locator('option').evaluateAll(els => els.map(el => el.getAttribute('value')!));
  expect(ids).toHaveLength(15);
  for (const id of ids) {
    await page.getByLabel('household activity').selectOption(id);
    await shot(`everyday-${id}`, everyday);
  }
  await shot('invite-room', page.getByRole('region', { name: 'invite a housemate', exact: true }));
  await menu('swim & invite housemates');
  await shot('pool', page.getByRole('dialog', { name: 'swim together' }));
  await menu('cancel');
  const balcony = page.getByRole('button', { name: /balcony/ }).first();
  await balcony.click();
  await shot('balcony', page.getByRole('dialog', { name: /visit .*balcony/ }));
  await menu('cancel');
  await menu('cook');
  await shot('cooking');
  await menu('back');
  await menu('talk to Kai');
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  await expect(page.getByLabel('say something in your own words')).toBeVisible();
  await menu('character artwork');
  await shot('artwork', page.getByRole('dialog', { name: 'generate character artwork' }));
  await menu('close');
  await page.getByLabel('say something in your own words').fill('I like living here. Thanks for welcoming me.');
  await menu('say');
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeEnabled();
  await shot('talk');
  await menu("that's all");
  await reachHouse(page);
  for (const name of ['chat log', 'fridge', 'board', 'bible', 'save', 'settings']) {
    await menu(name);
    await shot(({ 'chat log': 'chatlog', save: 'saves' } as Record<string, string>)[name] ?? name);
    await menu('back');
  }
  await menu('sprite library');
  await expect(page.getByLabel('describe a sprite edit')).toBeVisible();
  await shot('sprites');
  await menu('back');
  await menu('scene gallery');
  await shot('gallery');
  await menu('back');
  await menu('phone');
  await page.getByRole('tab', { name: /^Kai/ }).click();
  await shot('phone');
  await page.getByRole('tab', { name: 'plans', exact: true }).click();
  await shot('plans');
  await page.getByRole('tab', { name: 'feed', exact: true }).click();
  await shot('feed');
  await menu('close');
  // A student occupation enables the lecture reminder without modifying saved state by hand.
  await menu('edit character');
  await page.getByLabel('custom occupation').fill('university student');
  await menu('save changes');
  await reachHouse(page);
  await menu('skip to next block');
  await reachHouse(page);
  await expect(page.getByRole('button', { name: 'go to class (back after lectures)', exact: true })).toBeVisible();
  await shot('class', page.getByRole('region', { name: /what will you do/ }));
  await menu('go out');
  await shot('city');
  for (const [place, activity, id] of [
    ['Rothschild Coffee', 'go on a date', 'city-social'],
    ['Corner Makolet', 'buy a gift', 'city-gift'],
    ['Corner Makolet', 'work a shift', 'city-work'],
  ]) {
    await page.getByRole('button', { name: new RegExp(`^${place},`) }).click();
    await menu(activity);
    await shot(id, page.getByRole('dialog'));
    await menu('cancel');
  }
  await menu('back home');
  // Advance through actual blocks until the evening karaoke venue opens.
  for (let i = 0; i < 3; i++) { await menu('skip to next block'); await reachHouse(page); }
  await menu('go out');
  await page.getByRole('button', { name: /Karaoke.*,/ }).click();
  await menu('karaoke');
  await shot('city-karaoke', page.getByRole('dialog'));
  await menu('cancel');
  await menu('back home');
  // Wednesday -> Friday through real sleep actions and their scenes.
  for (let i = 0; i < 2; i++) {
    await menu('sleep until morning'); await menu('yes'); await reachHouse(page);
  }
  const trip = page.getByRole('region', { name: 'weekend trip', exact: true });
  await trip.getByRole('checkbox', { disabled: false }).first().check();
  await shot('trip', trip);
  await shot('trip-season', page.getByRole('region', { name: /what will you do/ }));
  for (let i = 0; i < 4; i++) { await menu('skip to next block'); await reachHouse(page); }
  await menu('let time pass');
  await reachHouse(page);
  await menu('watch the episode');
  await shot('broadcast', page.getByRole('dialog', { name: /as aired/ }));
  // Practice mode gives every minigame its own real screenshot without using season ingredients.
  await page.goto('/');
  await menu('practice cooking');
  await page.getByRole('button', { name: /^Lentil Soup/ }).click();
  for (const [type, label] of [['chop', 'chop the onion'], ['chop', 'slice the carrot'], ['boil', 'simmer the lentils'], ['season', 'season the soup'], ['plate', 'ladle and garnish']]) {
    await menu(`${label} (${type})`);
    await shot(`cook-${type}`);
    if (type === 'chop') {
      await menu('start');
      await expect(page.getByRole('button', { name: /\(boil\)/ })).toBeVisible({ timeout: 15000 });
    } else if (type === 'boil') {
      await menu('light the stove'); await page.waitForTimeout(8500); await menu('take it off the heat');
    } else if (type === 'season') await menu('done');
    else await menu('serve');
  }
  await menu('cook again');
  const sauteRecipe = page.getByRole('button').filter({ hasText: /saute/ }).first();
  await sauteRecipe.click();
  // Complete any prerequisite chop steps before the pan becomes available.
  for (let i = 0; i < 6; i++) {
    const pan = page.getByRole('button', { name: /\(saute\)/ }).first();
    if (await pan.isVisible()) { await pan.click(); break; }
    await page.getByRole('button', { name: /\(chop\)/ }).first().click();
    await menu('start');
    await expect(page.getByText('steps without dependencies can be done in any order.')).toBeVisible({ timeout: 15000 });
  }
  await shot('cook-saute');
});
