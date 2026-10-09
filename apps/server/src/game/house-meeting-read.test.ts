import { expect, it } from 'vitest';
import { createGame, type LlmClient, type LlmRequest } from '@shared-roof/shared';
import { Generator } from './generate';

/** A model that answers the plan-read prompt with a fixed JSON reply. */
const model = (reply: object): LlmClient & { prompts: string[] } => ({
  name: 'ollama',
  prompts: [] as string[],
  async health() { return true; },
  async complete(r: LlmRequest) { this.prompts.push(r.prompt); return JSON.stringify(reply); },
  async *stream() { /* the plan reader never streams */ },
});

const talk = [
  { speaker: 'player', text: "Let's talk about it one evening, maybe over some beer?" },
  { speaker: 'ren', text: "Tuesday evening after the football thing works. I'll run it by everyone." },
];

it('turns a model-reported house meeting into a living-room plan with its topic, even with no place said', async () => {
  const s = createGame({ seed: 7, moveInDay: false });
  s.world.weekday = 6;
  const llm = model({ agreed: true, place: '', when: 'Tuesday at 20:00', date: false, cancel: false, meeting: true, topic: 'the grocery budget' });
  const read = await new Generator(llm).planRead(s, s.playerId, 'ren', talk);
  expect(read?.plan).toMatchObject({ node: 'living', episode: s.world.episode + 3, slot: 'evening', meeting: 'the grocery budget' });
  expect(llm.prompts[0]).toMatch(/house meeting/i); // the model is told this is a thing to report
});

it('still ignores an unplaced plan that is not a house meeting', async () => {
  const s = createGame({ seed: 7, moveInDay: false });
  const llm = model({ agreed: true, place: '', when: 'Tuesday at 20:00', date: false, cancel: false, meeting: false, topic: '' });
  expect(await new Generator(llm).planRead(s, s.playerId, 'ren', talk)).toBeNull();
});
