import { expect, test } from '@playwright/test';

test('enter, invite multiple swimmers, and leave from the house controls', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false, images: false })));
  await request.post('/api/game/new', { data: { seed: 11, seasonLength: 0, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  for (let i = 0; i < 90 && !(await page.getByRole('button', { name: 'swim & invite housemates', exact: true }).isVisible()); i++) {
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await choice.isVisible()) await choice.click();
    else if (await next.isVisible()) await next.click();
    else await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'swim & invite housemates', exact: true }).click();
  await page.getByRole('button', { name: 'enter pool', exact: true }).click();
  await expect(page.getByRole('region', { name: 'pool', exact: true })).toContainText('1 in the water');
  const before = await (await request.get('/api/game')).json();
  const player = before.view.characters.find((c: any) => c.isPlayer);
  expect(player.swimming).toBe(true);
  expect(before.view.playerLocation).toBe('backyard');
  const guests = before.view.characters.filter((c: any) => !c.isPlayer && c.location !== 'out' && !['work', 'sleep', 'nap', 'shower'].includes(c.activity));
  // The authored first morning has at least two available residents without work commitments.
  expect(guests.length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'invite more swimmers', exact: true }).click();
  // the sidebar's "also invite" list has same-named checkboxes behind the modal
  const swim = page.getByRole('dialog', { name: 'swim together' });
  for (const c of guests.slice(0, 2)) await swim.getByRole('checkbox', { name: c.name.split(' ')[0], exact: true }).check();
  await page.getByRole('button', { name: 'invite selected housemates', exact: true }).click();
  await expect(page.getByRole('region', { name: 'pool', exact: true })).toContainText('3 in the water');
  const group = await (await request.get('/api/game')).json();
  expect(group.view.characters.filter((c: any) => c.swimming)).toHaveLength(3);
  expect(group.view.clock).toBe(before.view.clock);
  await page.waitForTimeout(250); // allow the canvas frame following React's occupancy update
  await page.screenshot({ path: 'logs/house-upgrade/pool-browser.png' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'logs/house-upgrade/pool-browser-wide.png' });
  expect(guests).toHaveLength(5);
  await page.getByRole('button', { name: 'invite more swimmers', exact: true }).click();
  for (const c of guests.slice(2)) await swim.getByRole('checkbox', { name: c.name.split(' ')[0], exact: true }).check();
  await page.getByRole('button', { name: 'invite selected housemates', exact: true }).click();
  await expect(page.getByRole('region', { name: 'pool', exact: true })).toContainText('6 in the water');
  await page.waitForTimeout(2000); // guests finish moving to their distinct water places
  await page.screenshot({ path: 'logs/house-upgrade/pool-full.png' });
  await page.getByRole('button', { name: 'everyone out of the pool', exact: true }).click();
  await expect(page.getByRole('button', { name: 'swim & invite housemates', exact: true })).toBeVisible();
  const left = await (await request.get('/api/game')).json();
  expect(left.view.characters.some((c: any) => c.swimming)).toBe(false);
  expect(left.view.playerLocation).toBe('backyard');
});
