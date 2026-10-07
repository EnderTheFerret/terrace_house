import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, eventTemplate, makeEvent } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockImageBackend } from '../image/mock';
import { Generator } from './generate';
import { MockLlm } from '../llm/mock';
import { replayEvents } from './replay';
import { overheardPrompt } from '../prompts/studio';

const make = (answer: string) => {
  const mock = new MockLlm();
  return new Generator({ name: 'test', health: async () => true, complete: async () => answer, stream: (r) => mock.stream(r) });
};
const pair = () => {
  const s = createGame({ seed: 21 });
  makeEvent(s, eventTemplate('casual-chat'), { a: s.playerId, b: 'ren' }, 'kitchen');
  const [a, b] = Object.values(s.characters).filter((c) => !c.isPlayer).map((c) => c.id);
  return { s, a, b };
};

it('voices the four steps, tolerating roleplay formatting, and stops at the first unusable line', async () => {
  const { s, a, b } = pair();
  const raw = `${a}: "You left the dishes again." *glares*\n\n${b}: *shrugs* "I was going to do them."\n\n${a}: let's watch porn\n${b}: fine`;
  const lines = await make(raw).overheard(s, a, b, 'bicker', 'kitchen');
  expect(lines?.map((l) => l.text)).toEqual(['You left the dishes again.', 'I was going to do them.']);
});

it('drops third-person narration sentences but keeps speech that addresses someone by name', async () => {
  const { s, a, b } = pair();
  const [an, bn] = [s.characters[a].name.split(' ')[0], s.characters[b].name.split(' ')[0]];
  const raw = `${a}: ${an} glances at the clock, jaw tight. ${bn}, you've been in there forever.\n${b}: He steps out drying his hair. Chill, I was brushing my teeth.\n${a}: Door opens abruptly.`;
  const lines = await make(raw).overheard(s, a, b, 'bicker', 'kitchen');
  expect(lines?.map((l) => l.text)).toEqual([`${bn}, you've been in there forever.`, 'Chill, I was brushing my teeth.']);
});

it('returns nothing instead of a template when the answer is unusable or the model is off', async () => {
  const { s, a, b } = pair();
  expect(await make('no labels at all').overheard(s, a, b, 'flirt', 'kitchen')).toBeNull();
  expect(await new Generator(new MockLlm()).overheard(s, a, b, 'flirt', 'kitchen')).toBeNull();
});

it('turns a block\'s most telling background interaction into memory, shows it only if you witnessed it, and replays exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-overheard-'));
  const store = new Store(openDb(':memory:'));
  const { session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  await session.newGame({ seed: 7 });
  const s = session.state!;
  const [a, b, c] = Object.values(s.characters).filter((x) => !x.isPlayer).map((x) => x.id);
  const entry = (who: string[], factId: string, salience: number) => ({ tick: s.world.tick, episode: s.world.episode, slot: s.world.slot, kind: 'summary' as const, text: 'x', participants: who, salience, location: 'kitchen', factId, templateId: 'flirt' });
  s.knowledge[s.playerId] = { seen: { source: 'witnessed', learnedAt: 0, confidence: 1 } } as never;
  s.log.push(entry([a, b], 'seen', 0.9), entry([a, c], 'unseen', 0.5));
  const lines = [{ speaker: a, text: 'You look nice today.', source: 'llm' as const }, { speaker: b, text: 'Oh, thanks.', source: 'llm' as const }];
  vi.spyOn(session.gen, 'real', 'get').mockReturnValue(true);
  vi.spyOn(session.gen, 'overheard').mockResolvedValue(lines);
  const before = s.memory[a]?.length ?? 0;
  await (session as unknown as { overheard(e: number, sl: string): Promise<void> }).overheard(s.world.episode, s.world.slot);
  expect(session.state!.memory[a].length).toBeGreaterThan(before);
  const log = session.dayLog().scenes.filter((x) => x.overheard);
  expect(log).toHaveLength(1); // the second pair also got dialogue, but you were not there
  expect(log[0].lines[0].text).toBe('You look nice today.');
  const replayed = replayEvents(store.events(session.state!.gameId)).memory;  for (const id of Object.keys(session.state!.memory)) expect(replayed[id], id).toEqual(session.state!.memory[id]);
  // the log/knowledge above were injected by hand, so only memory is comparable
});

it('bakes the engine outcome into the prompt', () => {
  const { s, a, b } = pair();
  expect(overheardPrompt(s, a, b, 'confess', 'kitchen')).toContain('do not feel the same way');
  s.couples.push({ a, b, status: 'dating' } as never);
  expect(overheardPrompt(s, a, b, 'confess', 'kitchen')).toContain('feel the same');
});

it('shows witnessed late-night conversations the next day, with their original day clearly labeled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-overheard-night-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 7 });
    const s = session.state!;
    const [a, b] = Object.values(s.characters).filter(c => !c.isPlayer).map(c => c.id);
    const payload = { episode: 1, slot: 'lateNight', a, b, type: 'household', location: 'kitchen', seen: true, lines: [{ speaker: a, text: 'I will wash, you dry?' }] };
    store.appendEvent(s.gameId, 'overheard', payload);
    store.appendEvent(s.gameId, 'overheard', { ...payload, slot: 'slot2', lines: [{ speaker: a, text: 'Earlier afternoon.' }] });
    store.appendEvent(s.gameId, 'overheard', { ...payload, seen: false });
    s.world.episode = 2;
    const chats = session.dayLog().scenes.filter(c => c.overheard);
    expect(chats).toHaveLength(1);
    expect(chats[0].title).toMatch(/^last night/);
    expect(chats[0].lines[0].text).toBe('I will wash, you dry?');
    s.world.episode = 3;
    expect(session.dayLog().scenes.filter(c => c.overheard)).toHaveLength(0);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('supports everyday and tense exchanges without inventing an unseen cause', () => {
  const { s, a, b } = pair();
  expect(overheardPrompt(s, a, b, 'household', 'kitchen', 'They washed dishes together.')).toContain('They washed dishes together.');
  expect(overheardPrompt(s, a, b, 'cold', 'living')).toContain('the tension remains');
  expect(overheardPrompt(s, a, b, 'jealousy', 'living')).toContain('without inventing cheating or an unseen event');
});
