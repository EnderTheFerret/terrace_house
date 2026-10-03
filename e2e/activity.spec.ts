import { expect, test } from '@playwright/test';

test('acknowledges a stalled interaction, explains stages and clears on stream failure', async ({ page, request }, info) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  const game = await (await request.post('/api/game/new', { data: { seed: 21, moveInDay: false } })).json();
  const kaiId = game.view.characters.find((c: any) => c.name.split(' ')[0] === 'Kai').id;
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  let activity: any = { text: [], image: null };
  await page.route('**/api/activity', route => route.fulfill({ json: activity }));
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await page.route('**/api/game/action', async route => { await gate; await route.continue(); });
  await page.getByRole('button', { name: 'talk to Kai', exact: true }).click();
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  const status = page.getByLabel('Game activity');
  await expect(status).toContainText('Processing interaction');
  await expect(status).toContainText('ETA ≈');
  activity = {
    text: [{ label: 'Generating response', startedAt: Date.now() - 4000, estimatedMs: 1000 }],
    image: { label: 'Generating walk sprite', characterId: kaiId, startedAt: Date.now(), estimatedMs: 35000, progress: 0.4, queued: 2 },
  };
  await expect(status).toContainText('Generating response');
  await expect(status).toContainText('Taking longer than estimated');
  await expect(status).toContainText('Generating walk sprite · Kai');
  await expect(status).toContainText('sampling 40%');
  await expect(status).toContainText('2 more queued');
  await page.screenshot({ path: info.outputPath('activity.png') });
  activity = { text: activity.text, image: { ...activity.image, progress: undefined, waiting: 'Waiting for dialogue to finish', estimatedMs: 8000 } };
  await expect(status).toContainText('Waiting for dialogue to finish');
  await expect(status).toContainText('ETA ≈ 8s once started for this step');
  activity = { text: [], image: null };
  resume();
  const say = page.getByLabel('say something in your own words');
  await expect(say).toBeVisible();
  await expect(status).not.toBeVisible();
  // A response has no REST busy flag while SSE waits; feedback must still appear immediately.
  let releaseStream!: () => void;
  const streamGate = new Promise<void>(resolve => { releaseStream = resolve; });
  await page.route('**/api/scene/*/stream', async route => {
    await streamGate;
    await route.fulfill({ contentType: 'text/event-stream', body: 'event: error\ndata: {"message":"test generation failure"}\n\nevent: end\ndata: {}\n\n' });
  });
  await say.fill('How was your day?');
  await page.getByRole('button', { name: 'say', exact: true }).click();
  await expect(status).toContainText('Generating response');
  releaseStream();
  await expect(page.getByText('(test generation failure)', { exact: true })).toBeVisible();
  await expect(status).not.toBeVisible();
});

test('episode wait explains missing status and recovers when the server returns', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 21, moveInDay: false } });
  // Mock mode normally bypasses the episode gate; emulate a healthy image service with delayed sheets.
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...await response.json(), imagesOffline: false } });
  });
  let resume!: () => void;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  await page.route('**/api/image/character/*/sprite?*', async route => { await gate; await route.continue(); });
  let online = false;
  await page.route('**/api/activity', route => route.fulfill(online ? { json: { text: [], image: null } } : { status: 503, json: { error: 'unavailable' } }));
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  const status = page.getByLabel('Game activity');
  await expect(status).toContainText('Cannot reach server');
  await expect(status).toContainText('ETA unavailable until the server reconnects');
  online = true;
  await expect(status).toContainText('Loading housemate sprites');
  await expect(status).toContainText('ETA estimating');
  resume();
  await expect(page.getByRole('button', { name: 'begin', exact: true })).toBeEnabled();
  await expect(status).not.toBeVisible();
});
