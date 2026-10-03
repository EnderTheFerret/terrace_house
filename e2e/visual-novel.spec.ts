import { expect, test } from '@playwright/test';

test('visual novel shows the group, answers every mention, and preserves typed words', async ({ page, request }, info) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  await request.post('/api/game/new', { data: { seed: 8, moveInDay: false } });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  await page.getByRole('button', { name: 'talk to Kai', exact: true }).click();
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  // The first talk is the arrival introduction; finish it before arranging a group.
  const houseDeadline = Date.now() + 240_000;
  while (Date.now() < houseDeadline) {
    const hangout = page.getByRole('button', { name: 'hang out', exact: true });
    if (await hangout.and(page.locator('button:enabled')).isVisible()) break;
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    if (await choice.isVisible()) { await choice.click(); continue; }
    const next = page.getByRole('button', { name: /^(begin|continue|ok|leave them be|to the studio|back to the house|next episode)$/ }).first();
    if (await next.and(page.locator('button:enabled')).isVisible()) await next.click();
    else await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: 'hang out', exact: true }).click();
  const say = page.getByLabel('say something in your own words');
  await expect(say).toBeVisible();
  const stage = page.getByRole('group', { name: 'people in this conversation' });
  const figures = stage.locator(':scope > div > img');
  await expect(figures).toHaveCount(2); // Both cutouts must finish; a portrait fallback is insufficient.
  const names = await figures.evaluateAll(nodes => nodes.map(n => n.getAttribute('alt')!.split(',')[0]));
  expect(names.length).toBeGreaterThanOrEqual(2);
  const words = `${[...names].reverse().join(', ')}, remember the bread we talked about?`;
  await say.fill(words);
  const replyStream = page.waitForResponse(r => /\/api\/scene\/[^/]+\/stream$/.test(r.url()));
  const started = Date.now();
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(page.getByRole('button', { name: "that's all", exact: true })).toBeVisible();
  const replyMs = Date.now() - started;
  const raw = await (await replyStream).text();
  const replies = [...raw.matchAll(/event: line-end\r?\ndata: ([^\r\n]+)/g)].map(m => JSON.parse(m[1]));
  const game = await (await request.get('/api/game')).json();
  const expected = [...names].reverse().map(name => game.view.characters.find((c: any) => c.name === name).id);
  expect(replies.filter(r => r.source !== 'player').map(r => r.speaker)).toEqual(expected);
  expect(replies.find(r => r.source === 'player')?.text).toBe(words);
  await info.attach('reply timing', { body: JSON.stringify({ replyMs, responders: expected, sources: replies.map(r => r.source), figures: await figures.evaluateAll(nodes => nodes.map(n => n.getAttribute('src'))) }), contentType: 'application/json' });
  await expect(page.locator('main')).toContainText(words);
  for (const name of names) await expect(page.locator('main')).toContainText(name);
  const novel = await stage.boundingBox();
  const dialogue = await say.boundingBox();
  expect(novel!.width).toBeGreaterThan(500);
  expect(dialogue!.y).toBeGreaterThan(novel!.y);
  await page.screenshot({ path: info.outputPath('visual-novel-group.png') });
});
