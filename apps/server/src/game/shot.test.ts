import { expect, it } from 'vitest';
import { createGame, eventTemplate, makeEvent, type LlmRequest } from '@shared-roof/shared';
import { Generator } from './generate';
import { MockLlm } from '../llm/mock';
import { freezeRequest } from '../image/requests';

it('stages current dialogue by participant ID and ignores invalid or unknown poses', async () => {
  const s = createGame({ seed: 21 });
  const ev = makeEvent(s, eventTemplate('casual-chat'), { a: s.playerId, b: 'ren' }, 'kitchen');
  let request: LlmRequest | undefined;
  let answer = JSON.stringify({ [s.playerId]: 'kneading bread dough at the counter', ren: 'watching the oven', stranger: 'walking in' });
  const mock = new MockLlm();
  const gen = new Generator({ name: 'test', health: async () => true, complete: async (r) => { request = r; return answer; }, stream: (r) => mock.stream(r) });
  const lines = [{ speaker: s.playerId, text: 'Could we bake bread together?', source: 'player' as const }];
  const poses = await gen.shot(s, ev, lines);
  expect(poses).toEqual({ [s.playerId]: 'kneading bread dough at the counter' });
  expect(request?.prompt).toContain('Could we bake bread together?');
  expect(request?.schema).toMatchObject({ required: [s.playerId], additionalProperties: false });
  answer = JSON.stringify({ [s.playerId]: 'x'.repeat(181), ren: 42 });
  expect(await gen.shot(s, ev, lines)).toEqual({});
  answer = 'not JSON';
  expect(await gen.shot(s, ev, lines)).toEqual({});
  expect(await new Generator(mock).shot(s, ev, lines)).toEqual({});
});

it("stages the player's typed action alongside the NPC who answered", async () => {
  const s = createGame({ seed: 21 });
  const ev = makeEvent(s, eventTemplate('casual-chat'), { a: s.playerId, b: 'ren' }, 'kitchen');
  let request: LlmRequest | undefined;
  const mock = new MockLlm();
  const gen = new Generator({ name: 'test', health: async () => true, complete: async (r) => { request = r; return JSON.stringify({ ren: 'shrugging', [s.playerId]: 'lighting a cigarette' }); }, stream: (r) => mock.stream(r) });
  const lines = [{ speaker: s.playerId, text: 'I light up a cigarette. "You smoke?"', source: 'player' as const }, { speaker: 'ren', text: 'No, go ahead.', source: 'llm' as const }];
  expect(await gen.shot(s, ev, lines)).toEqual({ ren: 'shrugging', [s.playerId]: 'lighting a cigarette' });
  expect(request?.schema).toMatchObject({ required: ['ren', s.playerId] });
  expect(request?.prompt).toContain('own typed action');
});

it('describes six distinct characters exactly once, with actions inline and only the room referenced', () => {
  const s = createGame({ seed: 21 });
  const ev = makeEvent(s, eventTemplate('casual-chat'), { a: s.playerId, b: 'ren' }, 'backyard');
  ev.participants = [s.playerId, ...Object.keys(s.characters).filter((id) => id !== s.playerId)];
  expect(ev.participants).toHaveLength(6);
  ev.participants.push(s.playerId);
  const lookedUp: string[] = [];
  const req = freezeRequest(s, ev, (r) => { lookedUp.push(r.kind); return '/pool.png'; }, '', [], { [s.playerId]: 'laughing and gesturing with one hand' });
  expect(req.references).toBeUndefined();
  expect(req.reference2).toBe('/pool.png');
  expect(lookedUp).toEqual(['location']);
  expect(req.meta?.people).toHaveLength(6);
  expect(req.prompt).toContain('exactly 6 people, each of them appears once');
  expect(req.prompt.match(/laughing and gesturing with one hand/g)).toHaveLength(1);
  expect(req.prompt.indexOf('laughing and gesturing with one hand')).toBeLessThan(req.prompt.indexOf(';'));
  for (const c of Object.values(s.characters)) {
    expect(req.prompt.split(`${c.name.split(' ')[0]} (`)).toHaveLength(2);
    expect(req.prompt).toContain(c.appearance.hairColor);
  }
});
