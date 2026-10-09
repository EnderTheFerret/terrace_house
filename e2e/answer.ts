import type { Page } from '@playwright/test';

/**
 * Stand-in for "click the first response" now that replies are typed: say something once, then end the talk with
 * "that's all" (a typed talk stays open until the player ends it).
 */
export const answerer = (page: Page, text = 'Sounds good, thanks.') => {
  const input = page.getByLabel('say something in your own words');
  const done = page.getByRole('button', { name: "that's all", exact: true });
  return {
    isVisible: async () => (await done.isVisible()) || (await input.isVisible()),
    click: async () => {
      if (await done.isVisible()) return done.click();
      await input.fill(text);
      await page.getByRole('button', { name: 'say', exact: true }).click();
    },
  };
};
