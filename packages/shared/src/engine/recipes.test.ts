import { expect, it } from 'vitest';
import { content } from '../content';
import { availableSteps, beginStep, completeStep, startCooking } from './cooking';

it('makes every recipe with purchasable ingredients and a completable sequence of steps', () => {
  const { recipes, house } = content();
  expect(recipes).toHaveLength(15);
  expect(new Set(recipes.map(r => r.id)).size).toBe(recipes.length);
  const sold = new Set(house.ingredients.map(i => i.id));
  for (const recipe of recipes) {
    for (const [id, count] of Object.entries(recipe.ingredients)) {
      expect(sold.has(id), `${recipe.name}: ${id} must be purchasable`).toBe(true);
      expect(count).toBeGreaterThan(0);
    }
    let cooking = startCooking(recipe);
    for (let n = 0; n < recipe.steps.length; n++) {
      const step = availableSteps(cooking, recipe)[0];
      expect(step, `${recipe.name} has a dependency deadlock`).toBeDefined();
      cooking = completeStep(beginStep(cooking, recipe, step.id), recipe, step.id, 1, step.seconds);
    }
    expect(cooking.done, recipe.name).toBe(true);
    expect(cooking.quality, recipe.name).toBe(1);
  }
});
