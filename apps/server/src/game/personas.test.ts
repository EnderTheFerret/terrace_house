import { describe, expect, it } from 'vitest';
import { createGame, makeEvent, eventTemplate, Character, Persona, type LlmClient } from '@shared-roof/shared';
import { applyCharacterSnapshot, contentCheck, describeAppearance, enrichCharacter, validatedFields } from './personas';
import { parseLines } from '../prompts/scene';
import { replayEvents } from './replay';
import { Generator } from './generate';
import { Budget } from '../llm/structured';

describe('generated characters and safe dialogue', () => {
  it('uses constraints without priming the model to copy editable seed content', async () => {
    const c = createGame({ seed: 811, randomizeCast: true }).characters;
    const seed = Object.values(c).find(c => !c.isPlayer)!;
    const prompts: string[] = [];
    const llm: LlmClient = { name: 'test', health: async () => true, complete: async req => { prompts.push(req.prompt); return JSON.stringify({ persona: { backstory: 'A fresh local bakery story.' } }); }, stream: async function* () {} };
    await enrichCharacter(llm, seed, []);
    expect(prompts[0]).toContain(seed.name);
    expect(prompts[0]).not.toContain(seed.persona.backstory);
    expect(prompts[0]).not.toContain(seed.persona.speech.exemplars[0]);
    const appearance = await describeAppearance({ ...llm, complete: async req => { prompts.push(req.prompt); return JSON.stringify({ hairColor: 'auburn', eyeColor: 'green' }); } }, 'auburn hair and green eyes', seed.appearance);
    expect(prompts.at(-1)).toContain('auburn hair and green eyes');
    expect(prompts.at(-1)).not.toContain(JSON.stringify(seed.appearance));
    expect(appearance.hairColor).toBe('auburn');
    expect(appearance.eyeColor).toBe('green');
    expect(appearance.build).toBe(seed.appearance.build);
  });

  it('keeps invalid fields but accepts valid sibling fields', () => {
    const c = createGame({ seed: 7 }).characters.ren;
    const p = Persona.parse(validatedFields(Persona, c.persona, { backstory: 'A specific local restaurant story.', speech: { formality: 9, fillers: ['well'], sentenceLen: { mean: 8, sd: -4 } } }));
    expect(p.backstory).toContain('local restaurant');
    expect(p.speech.formality).toBe(c.persona.speech.formality);
    expect(p.speech.fillers).toEqual(['well']);
    expect(p.speech.sentenceLen).toEqual({ mean: 8, sd: c.persona.speech.sentenceLen.sd });
  });

  it('pins age, identity, schedules and secrets, then replays generated snapshots without a model', async () => {
    const opts = { seed: 7, randomizeCast: true, gameId: 'generated-test' };
    const s = createGame(opts);
    const c = Object.values(s.characters).find(c => !c.isPlayer)!;
    const llm: LlmClient = { name: 'test', health: async () => true, complete: async () => JSON.stringify({ age: 12, name: 'Changed', persona: { ...c.persona, backstory: 'A particular Jaffa home.', secret: { factId: 'wrong', content: 'Keeps an old family recipe hidden.', exposureCost: 0.7 }, traits: [0, 0, 0, 0, 0] }, appearance: c.appearance, appearanceText: 'Curly black hair, blue shirt.', voiceNotes: 'Speaks quietly.' }), stream: async function* () {} };
    const generated = await enrichCharacter(llm, c, []);
    expect(Character.safeParse(generated).success).toBe(true);
    expect(generated.age).toBe(c.age);
    expect(generated.name).toBe(c.name);
    expect(generated.traits).toEqual(c.traits);
    expect(generated.persona.secret!.factId).toBe(c.persona.secret!.factId);
    applyCharacterSnapshot(s, generated);
    const replayed = replayEvents([{ seq: 1, kind: 'new', payload: opts }, { seq: 2, kind: 'generated-character', payload: { character: generated } }]);
    expect(replayed).toEqual(s);
    expect(replayed.facts[generated.persona.secret!.factId].content).toBe(generated.persona.secret!.content);
  });

  it('rejects unrequested speakers and never emits unsafe model text before falling back', async () => {
    const s = createGame({ seed: 7 });
    const beat = { speaker: 'ren', intent: 'chat', emotion: 'neutral' as const, beatType: 'smalltalk' as const, subtext: '', depth: 'smalltalk' as const, topic: 'dinner' };
    expect(parseLines('player: I agree.\nren: Rice is ready.', [beat])).toEqual(['Rice is ready.']);
    expect(parseLines('player: I agree.', [beat])).toEqual([null]);
    expect(contentCheck('Let us watch porn.')).toBe(false);
    const llm: LlmClient = { name: 'test', health: async () => true, complete: async () => 'ren: porn', stream: async function* () { yield 'ren: porn'; } };
    const gen = new Generator(llm);
    const ev = makeEvent(s, eventTemplate('late-night-kitchen'), { a: 'ren', b: 'mio' }, 'kitchen');
    const emitted: string[] = [];
    const lines = await gen.lines(s, ev, [beat], [], [undefined], { place: 'kitchen', catchphraseUses: {}, lineCounts: {} }, new Budget(2), () => {}, (_i, t) => emitted.push(t));
    expect(lines[0].source).toBe('mock');
    expect(emitted.join('')).not.toContain('porn');
  });
});
