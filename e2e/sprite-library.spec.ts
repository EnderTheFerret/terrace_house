import { expect, test } from '@playwright/test';

test('sprite library groups character art, saves requested fixes and explains offline generation', async ({ page, request }, info) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ reducedMotion: true, sound: false })));
  const initial = (await (await request.post('/api/game/new', { data: { seed: 21, moveInDay: false } })).json()).view;
  const name = (id: string) => initial.characters.find((c: { id: string }) => c.id === id).name;
  await page.goto('/');
  await page.getByRole('button', { name: 'sprite library', exact: true }).click();
  await page.getByRole('combobox', { name: 'character', exact: true }).selectOption('ren');
  const sprites = page.getByRole('group', { name: `sprites for ${name('ren')}`, exact: true });
  await expect(sprites.getByRole('button')).toHaveCount(11);
  await page.getByLabel('describe a sprite edit', { exact: true }).fill('Keep the glasses visible');
  await page.getByRole('button', { name: 'apply edit', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Images are offline');
  await expect(sprites.getByRole('button', { name: /walking sheet/ })).toContainText('temporary preview');
  const game = (await (await request.get('/api/game')).json()).view;
  expect(game.characters.find((c: { id: string }) => c.id === 'ren').spriteInstructions).toBe('Keep the glasses visible');
  await sprites.getByRole('button', { name: /happy expression/ }).click();
  await page.getByLabel('describe a sprite edit', { exact: true }).fill('Make the smile softer');
  await page.getByRole('button', { name: 'apply edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'apply edit', exact: true })).toBeEnabled();
  const edited = (await (await request.get('/api/game')).json()).view;
  expect(edited.characters.find((c: { id: string }) => c.id === 'ren').expressionEdits.happy.instructions).toBe('Make the smile softer');
  await page.screenshot({ path: info.outputPath('sprite-library.png') });
  await page.getByRole('button', { name: 'back', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'main menu' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'sprite library', exact: true }).click();
  await page.getByRole('combobox', { name: 'character', exact: true }).selectOption('ren');
  await page.getByRole('group', { name: `sprites for ${name('ren')}`, exact: true }).getByRole('button', { name: /happy expression/ }).click();
  await expect(page.getByLabel('describe a sprite edit', { exact: true })).toHaveValue('Make the smile softer');
  await page.getByRole('combobox', { name: 'character', exact: true }).selectOption('mio');
  await expect(page.getByLabel('describe a sprite edit', { exact: true })).toHaveValue('');
  await page.getByRole('combobox', { name: 'outfit', exact: true }).selectOption('beach');
  await expect(page.getByRole('group', { name: `sprites for ${name('mio')}`, exact: true })).toBeVisible();
});

test('dialogue selects its expression and uses neutral while the next face is pending', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
  const game = (await (await request.post('/api/game/new', { data: { seed: 21, moveInDay: false } })).json()).view;
  let turn = 0;
  let sadReady = false;
  const figureUrl = (emotion: string) => `/assets/portraits/finished-ren-thigh-up-v1.png?face=${emotion}`;
  await page.route('**/api/image/character/ren/stand?*', route => {
    const emotion = new URL(route.request().url()).searchParams.get('emotion')!;
    return route.fulfill({ json: emotion === 'sad' && !sadReady ? { key: 'sad-face', status: 'queued' } : { key: emotion, status: 'ready', url: figureUrl(emotion) } });
  });
  await page.route('**/api/image/status/sad-face', route => route.fulfill({ json: sadReady ? { key: 'sad-face', status: 'ready', url: figureUrl('sad') } : { key: 'sad-face', status: 'queued' } }));
  await page.route('**/api/scene/*/choose', route => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/scene/*/stream', route => {
    const emotion = ['happy', 'sad', 'neutral'][turn];
    const index = turn++;
    const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    return route.fulfill({ contentType: 'text/event-stream', body:
      event('scene', { title: 'A conversation', premise: 'Ren shares how he feels.', location: 'kitchen', locationName: 'kitchen', occasion: 'daily', participants: [{ id: 'ren', name: 'Ren' }, { id: game.playerId, name: 'you' }], outsiders: [], isPlayerScene: true, eavesdrop: false, chat: false, intro: null, background: { key: '', status: 'failed' } }) +
      event('line-start', { index, speaker: 'ren', name: 'Ren', caption: null, emotion }) +
      event('line-end', { index, speaker: 'ren', text: ['That makes me happy.', 'I feel sad about it.', 'Let us make breakfast.'][index], caption: null, source: 'mock' }) +
      event('choice', { intents: ['joke', 'confront', 'listen'], recipients: [], canType: true, canEnd: true }) + event('end', {}) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: /continue · episode 1/ }).click();
  await page.getByRole('button', { name: 'begin', exact: true }).click();
  await page.getByRole('button', { name: 'talk to Kai', exact: true }).click();
  await page.getByRole('dialog', { name: 'talk to Kai?' }).getByRole('button', { name: 'yes', exact: true }).click();
  const figure = page.getByRole('group', { name: 'people in this conversation' }).locator(':scope > div > img');
  await expect(figure).toHaveAttribute('data-emotion', 'happy');
  await expect(figure).toHaveAttribute('src', figureUrl('happy'));
  await page.getByRole('button', { name: '2. confront', exact: true }).click();
  await expect(figure).toHaveAttribute('data-emotion', 'neutral');
  await expect(figure).toHaveAttribute('src', figureUrl('neutral'));
  sadReady = true;
  await expect(figure).toHaveAttribute('data-emotion', 'sad');
  await expect(figure).toHaveAttribute('src', figureUrl('sad'));
  await page.getByRole('button', { name: '3. just listen', exact: true }).click();
  await expect(figure).toHaveAttribute('data-emotion', 'neutral');
  await expect(figure).toHaveAttribute('src', figureUrl('neutral'));
});
