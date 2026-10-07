import { expect, test } from '@playwright/test';

test('shows the dialogue model and re-reads all scenes sequentially, continuing after a failure', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  const { view } = await (await request.post('/api/game/new', { data: { seed: 7, moveInDay: false } })).json();
  const other = view.characters.find((c: { isPlayer: boolean }) => !c.isPlayer).id;
  const log = { episode: 1, scenes: [
    { id: 'first', title: 'coffee conversation', location: 'kitchen', reread: true, lines: [{ name: 'you', text: 'Thank you for the coffee.' }] },
    { id: 'second', title: 'notes conversation', location: 'living', reread: false, lines: [{ name: 'you', text: 'Your notes really helped.' }] },
    { id: 'overheard', title: 'overheard conversation', location: 'living', overheard: true, reread: true, lines: [] },
  ] };
  await page.route('**/api/health', route => route.fulfill({ json: { mode: 'real', model: 'gemma4:12b', llm: 'ok', linesModel: 'terrace-rocinante:12b-q4', linesLlm: 'ok', image: 'ok', imageBackend: 'comfyui', imagesOffline: false } }));
  await page.route('**/api/game/log', route => route.fulfill({ json: log }));
  const calls: string[] = [];
  await page.route('**/api/game/reread/*', async route => {
    const id = route.request().url().split('/').at(-1)!;
    calls.push(id);
    if (id === 'first' && calls.length === 1) return route.fulfill({ status: 400, json: { error: 'the dialogue model did not answer; nothing changed' } });
    log.scenes.find(sc => sc.id === id)!.reread = true;
    const edge = view.board.find((e: { from: string; to: string }) => e.from === other && e.to === view.playerId);
    edge.affinity = 17;
    edge.reliability = 'witnessed';
    await route.fulfill({ json: { view, log } });
  });
  await page.goto('/');
  await expect(page.getByText('dialogue: terrace-rocinante:12b-q4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  await page.getByRole('button', { name: 'chat log', exact: true }).click();
  await page.getByRole('button', { name: 're-read all', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 of 2 conversations re-read.' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('coffee conversation: the dialogue model did not answer');
  expect(calls).toEqual(['first', 'second']);
  await page.getByRole('button', { name: 're-read all', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 of 2 conversations re-read.' })).toBeVisible();
  expect(calls).toEqual(['first', 'second', 'first', 'second']);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'board', exact: true }).click();
  await page.getByRole('button', { name: 'table view', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: view.characters.find((c: { id: string }) => c.id === other).name.split(' ')[0], exact: true }) });
  await expect(row).toContainText('17');
});
