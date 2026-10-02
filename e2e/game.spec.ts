// End-to-end: the real UI in a real browser against the mock-mode server (deterministic, SEED=7).
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // instant text so the driver doesn't wait on the typewriter
  await page.addInitScript(() => localStorage.setItem('shared-roof-settings', JSON.stringify({ typewriter: false, reducedMotion: true, sound: false })));
});

const btn = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
/** Present and clickable right now (no auto-wait). */
const ready = async (page: Page, name: string | RegExp) => !(await page.getByRole('dialog').isVisible()) && (await btn(page, name).count()) > 0 && (await btn(page, name).first().isEnabled());

/**
 * Click through whatever the game puts in front of the player (scenes, choices, freeze-frames, digests) until
 * `until` is visible. Returns every studio intermission kind seen on the way.
 */
async function playUntil(page: Page, until: () => Promise<boolean>, maxSteps = 200) {
  const studio: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    if (await until()) return studio;
    const choice = page.getByRole('group', { name: 'how do you respond?' }).getByRole('button').first();
    const steps: [() => Promise<boolean>, () => Promise<void>][] = [
      [() => choice.isVisible(), () => choice.click()],
      [() => btn(page, 'leave them be').isVisible(), () => btn(page, 'leave them be').click()],
      [() => btn(page, 'to the studio').isVisible(), () => btn(page, 'to the studio').click()],
      [() => btn(page, 'continue').isVisible(), () => btn(page, 'continue').click()],
      [() => btn(page, 'ok').isVisible(), () => btn(page, 'ok').click()],
      [
        () => btn(page, /back to the house|roll credits/).isVisible(),
        async () => {
          studio.push((await page.locator('header').first().innerText()).includes('after the episode') ? 'end' : 'mid');
          await btn(page, /back to the house|roll credits/).click();
        },
      ],
      [() => btn(page, 'next episode').isVisible(), () => btn(page, 'next episode').click()],
      [() => btn(page, 'begin').isVisible(), () => btn(page, 'begin').click()],
      [
        () => ready(page, 'let time pass'),
        async () => {
          // the house may have only just rendered: give `until` a fair look before spending the slot
          await page.waitForTimeout(300);
          if (!(await until())) await btn(page, 'let time pass').click();
        },
      ],
    ];
    let acted = false;
    for (const [visible, run] of steps) {
      if (await visible().catch(() => false)) {
        if (await until()) return studio; // the screen we want may have appeared since the top of the loop
        // the UI can move on under the click (a stream finishing); just look again
        await run().catch(() => {});
        acted = true;
        break;
      }
    }
    if (!acted) await page.waitForTimeout(150); // streaming / loading
  }
  throw new Error('playUntil: gave up');
}

test('creator → episode 1 → studio intermissions → episode 2', async ({ page }) => {
  await page.goto('/');
  await btn(page, 'new season').click();
  await page.getByLabel('name').fill('Aki Tanaka');
  // every character is an adult: the creator refuses under-20s
  await page.getByLabel('age (20–35)').fill('19');
  await expect(page.getByText('housemates are 20–35')).toBeVisible();
  await expect(btn(page, 'next')).toBeDisabled();
  await page.getByLabel('age (20–35)').fill('24');
  for (let i = 0; i < 4; i++) await btn(page, 'next').click();
  await btn(page, 'move in').click();

  await expect(page.getByRole('heading', { name: 'EPISODE 1' })).toBeVisible();
  await btn(page, 'begin').click();
  await expect(page.getByRole('region', { name: /what will you do\?/ })).toBeVisible();
  await expect(page.getByLabel(/top-down view of the share house/)).toBeVisible();

  // play the whole first day: the panel cuts in mid-episode and again at the end
  const studio = await playUntil(page, () => page.getByRole('heading', { name: 'EPISODE 2' }).isVisible());
  expect(studio).toEqual(['mid', 'end']);
  await btn(page, 'begin').click();
  await expect(page.getByText('ep 2')).toBeVisible();
});

test('studio intermission shows panel lines', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 11 } });
  await page.goto('/');
  await btn(page, /continue · episode 1/).click();
  await playUntil(page, () => btn(page, 'back to the house').isVisible());
  await expect(page.getByText('intermission')).toBeVisible();
  const lines = page.locator('main [aria-live="polite"] > div');
  expect(await lines.count()).toBeGreaterThanOrEqual(2);
  await expect(lines.first()).toContainText('Tetsu Nagumo'); // the host always opens
});

test('type your own words: the housemate answers, then you end the conversation', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 9 } });
  await page.goto('/');
  await btn(page, /continue · episode 1/).click();
  // morning arrival scene: wait for the response panel, then speak for yourself
  await playUntil(page, () => page.getByLabel('say something in your own words').isVisible());
  await page.getByLabel('say something in your own words').fill('I brought snacks from home, want some?');
  await btn(page, 'say').click();
  await expect(page.getByText('I brought snacks from home, want some?')).toBeVisible();
  await expect(btn(page, "that's all")).toBeVisible();
  const lines = page.locator('main p');
  const after = await lines.count();
  expect(after).toBeGreaterThanOrEqual(2); // your line + their answer
  await btn(page, "that's all").click();
  await playUntil(page, async () => (await page.getByRole('region', { name: /what will you do\?/ }).isVisible()) || (await btn(page, 'continue').isVisible()));
});

test('graduate from the house and move in as someone new', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 12 } });
  await page.goto('/');
  await btn(page, /continue · episode 1/).click();
  await playUntil(page, () => btn(page, 'leave the house').isVisible());
  await btn(page, 'leave the house').click();
  await btn(page, 'yes').click();
  await playUntil(page, () => page.getByRole('heading', { name: 'your next housemate moves in' }).isVisible());
  await page.getByLabel('name').fill('Riku Hoshino');
  for (let i = 0; i < 3; i++) await btn(page, 'next').click();
  await btn(page, 'move in').click();
  await expect(page.getByRole('region', { name: /what will you do\?/ })).toBeVisible();
  const g = await (await request.get('/api/game')).json();
  expect(g.view.awaitingPlayer).toBe(false);
  expect(g.view.characters.find((c: any) => c.id === g.view.playerId).name).toBe('Riku Hoshino');
});

test('part-time job: sign a contract on the city map', async ({ page, request }) => {
  await request.post('/api/game/new', { data: { seed: 5 } });
  await page.goto('/');
  await btn(page, /continue · episode 1/).click();
  // mornings are house-only; pass the morning, then head out
  await playUntil(page, async () => (await page.getByText('late morning').first().isVisible()) && (await ready(page, 'go out')));
  await btn(page, 'go out').click();
  await page.getByRole('button', { name: /^Corner Makolet/ }).click();
  await btn(page, /work a shift/).click();
  await page.getByLabel(/sign a contract/).check();
  await btn(page, 'go').click();
  await playUntil(page, async () => (await ready(page, 'go out')) || (await page.getByText('shared car:').isVisible()));
  const view = await (await request.get('/api/game')).json();
  expect(view.view.job).toMatchObject({ nodeId: 'konbini', slot: 'slot1' });
  expect(view.view.job.weekdays).toHaveLength(3);
});
