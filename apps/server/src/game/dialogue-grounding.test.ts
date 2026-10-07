import { expect, it, vi } from 'vitest';
import { createGame, eventTemplate, makeEvent, type Beat, type LlmClient } from '@shared-roof/shared';
import { Budget } from '../llm/structured';
import { Generator } from './generate';
import { linesPrompt } from '../prompts/scene';

const bad = 'mio: As an AI, I cannot answer that.';
const beat: Beat = { speaker: 'mio', intent: 'answer the player', emotion: 'neutral', beatType: 'smalltalk', subtext: '', depth: 'smalltalk', topic: 'crowding' };
const setup = (retry: string) => {
  const s = createGame({ seed: 20 });
  const ev = makeEvent(s, eventTemplate('backyard-talk'), { a: 'mio', b: s.playerId }, 'backyard');
  const complete = vi.fn(async () => retry);
  const llm: LlmClient = { name: 'test', health: async () => true, complete, stream: async function* () { yield bad; } };
  return { s, ev, complete, gen: new Generator(llm) };
};

it('retries out-of-character meta commentary before displaying anything', async () => {
  const { s, ev, complete, gen } = setup('mio: I just hope there is room in the fridge.');
  const emitted: string[] = [];
  const lines = await gen.lines(s, ev, [beat], [], [undefined], { place: 'backyard', catchphraseUses: {}, lineCounts: {} }, new Budget(2), () => {}, (_i, token) => emitted.push(token));
  expect(complete).toHaveBeenCalledTimes(1);
  expect(lines[0]).toMatchObject({ source: 'llm', text: 'I just hope there is room in the fridge.' });
  expect(emitted.join('')).toBe(lines[0].text);
});

it('falls back after an invalid retry without flashing meta commentary', async () => {
  const { s, ev, complete, gen } = setup(bad);
  const emitted: string[] = [];
  const lines = await gen.lines(s, ev, [beat], [], [undefined], { place: 'backyard', catchphraseUses: {}, lineCounts: {} }, new Budget(2), () => {}, (_i, token) => emitted.push(token));
  expect(complete).toHaveBeenCalledTimes(1);
  expect(lines[0].source).toBe('mock');
  expect(emitted.join('')).not.toContain('As an AI');
});

it('preserves scene actions and the complete explanation through emitted tokens', async () => {
  const { s, ev, complete, gen } = setup('');
  const text = 'I look up. Maya sets down her plate. I meant the music. Not the cameras. Getting heard helps. But it does not mean every conversation is a performance.';
  gen.linesLlm.stream = async function* () { yield `mio: ${text}`; };
  const emitted: string[] = [];
  const lines = await gen.lines(s, ev, [beat], [], [undefined], { place: 'backyard', catchphraseUses: {}, lineCounts: {} }, new Budget(2), () => {}, (i, token) => { emitted[i] = (emitted[i] ?? '') + token; });
  expect(lines.map(line => line.text).join(' ')).toBe(text);
  expect(lines.find(line => line.speaker === 'narrator')).toMatchObject({ source: 'llm', text: 'Maya sets down her plate.' });
  expect(emitted).toEqual(lines.map(line => line.text));
  expect(complete).not.toHaveBeenCalled();
});

it('keeps Shira\'s motives and prior claims available when the player challenges her', () => {
  const { s, ev } = setup('');
  const shira = s.characters.sora;
  const claim = "Besides, the cameras don't like drama that easy to resolve.";
  const words = "So you're looking for the cameras?";
  const history = [{ speaker: 'sora', text: claim }, ...Array.from({ length: 6 }, (_, i) => ({ speaker: i % 2 ? 'sora' : s.playerId, text: 'We keep talking about the meal.' })), { speaker: s.playerId, text: words }];
  const prompt = linesPrompt(s, { ...ev, participants: [s.playerId, 'sora'] }, [{ ...beat, speaker: 'sora' }], history, [undefined], words);
  expect(prompt).toContain(shira.persona.goals.long.text);
  expect(prompt).toContain(shira.persona.goals.short.text);
  expect(prompt).toContain(claim);
  expect(prompt).toContain('explain, qualify or retract it');
  expect(prompt).toContain('Put physical actions and narration in *asterisks*');
});

it('acknowledges the offered meal when the cooking opening needs a fallback', async () => {
  const { s, gen } = setup('');
  const ev = makeEvent(s, eventTemplate('cook-for-someone'), { a: s.playerId, b: 'sora' }, 'kitchen');
  const lines = await gen.lines(s, ev, [{ ...beat, speaker: 'sora', beatType: 'comfort' }], [], [undefined], { place: 'kitchen', catchphraseUses: {}, lineCounts: {} }, new Budget(0), () => {}, () => {});
  expect(lines[0].source).toBe('mock');
  expect(lines[0].text).toMatch(/plate|make|some/i);
  expect(lines[0].text).not.toContain('hard');
});

it('keeps a speaker\'s family out of a question about the player\'s sister, but supplies it when asked about their own', () => {
  const { s, ev } = setup('');
  const prompt = (words: string) => linesPrompt(s, ev, [beat], [{ speaker: s.playerId, text: words }], [undefined], words);
  expect(prompt('Have you met my sister before?')).not.toContain('older sister Dana');
  expect(prompt('What is your sister like?')).toContain("Maya's own contacts: older sister Dana");
});
