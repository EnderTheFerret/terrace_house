import { describe, expect, it } from 'vitest';
import { addMemory, createGame, pairSummaryText, recordDiary, type LlmClient, type LlmRequest } from '@shared-roof/shared';
import { Generator } from './generate';

describe('end-of-episode diaries', () => {
  it('writes a diary and pair notes from only what the housemate lived, and prompts then use them', async () => {
    let s = createGame({ seed: 2 });
    addMemory(s, 'ren', 'burned the shakshuka while everyone watched', ['ren'], 0.6);
    addMemory(s, 'mio', 'a secret phone call nobody else heard', ['mio'], 0.9);
    let prompt = '';
    const llm: LlmClient = {
      name: 'ollama', health: async () => true,
      complete: async (r: LlmRequest) => { prompt = r.prompt; return JSON.stringify({ diary: 'I burned dinner. Tomorrow I try again.', pairs: [{ name: s.characters.mio.name.split(' ')[0], summary: 'Mio laughed kindly at my cooking.' }] }); },
      // eslint-disable-next-line require-yield
      async *stream() { throw new Error('unused'); },
    };
    const out = await new Generator(llm).diary(s, 'ren', 1);
    expect(prompt).toContain('burned the shakshuka');
    expect(prompt).not.toContain('secret phone call'); // someone else's memory never reaches this diary
    s = recordDiary(s, 'ren', 1, out!.diary, out!.pairs);
    expect(s.diaries.ren.at(-1)!.text).toContain('burned dinner');
    expect(pairSummaryText(s, 'ren', 'mio')).toBe('Mio laughed kindly at my cooking.');
  });
});
