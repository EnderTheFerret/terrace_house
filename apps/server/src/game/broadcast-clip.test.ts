import { expect, it } from 'vitest';
import type { LlmClient } from '@shared-roof/shared';
import { Budget } from '../llm/structured';
import { Generator } from './generate';

const scenes = [{ title: 'a', place: 'kitchen', lines: [{ name: 'Ren', text: 'hi' }] }, { title: 'b', place: 'living', lines: [{ name: 'Mio', text: 'x' }, { name: 'Ren', text: 'y' }] }];
const gen = (reply: string) => new Generator({ name: 'fake', complete: async () => reply, stream: async function* () { /* unused */ } } as unknown as LlmClient);

it('uses the model\'s clip pick, clamps its length, and rejects picks outside the footage', async () => {
  expect(await gen('{"scene":1,"from":1,"count":9}').broadcastClip(1, scenes, [], new Budget(2))).toEqual({ scene: 1, from: 1, count: 4 });
  for (const bad of ['{"scene":2,"from":0,"count":1}', '{"scene":0,"from":1,"count":1}', '{"scene":0,"from":0,"count":0}', 'not json']) {
    expect(await gen(bad).broadcastClip(1, scenes, [], new Budget(2))).toBeNull();
  }
  expect(await gen('{"scene":0,"from":0,"count":1}').broadcastClip(1, scenes, [], new Budget(0))).toBeNull();
});
