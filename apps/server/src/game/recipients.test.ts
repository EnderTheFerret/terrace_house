import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('routes group messages and intents to the selected housemate, validates targets, and can address everyone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-recipients-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const { scenes } = await session.act({ type: 'talk', target: 'ren', room: 'living' });
    const run = session.runs.get(scenes[0].id)!;
    const state = session.state!;
    const extra = Object.values(state.characters).find(c => !c.isPlayer && !run.ev.participants.includes(c.id))!;
    const original = state.characters[run.ev.participants.find(id => id !== state.playerId)!];
    run.ev.participants.push(extra.id);
    const events: { e: string; d: any }[] = [];
    const stream = () => session.stream(run.id, (e, d) => events.push({ e, d }));
    await stream();
    expect(run.phase).toBe('awaiting-choice');
    expect(events.at(-1)?.d.recipients.map((p: { id: string }) => p.id)).toContain(extra.id);
    const choose = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: `/api/scene/${run.id}/choose`, payload: body });
    const outsider = Object.keys(state.characters).find(id => !run.ev.participants.includes(id))!;
    for (const recipient of [state.playerId, outsider, 'not-a-housemate']) {
      expect((await choose({ text: 'Hello.', recipient })).statusCode).toBe(400);
      expect(run.phase).toBe('awaiting-choice');
    }
    const currentExtra = session.state!.characters[extra.id];
    const lastAction = currentExtra.lastAction;
    currentExtra.lastAction = 'sleep';
    expect((await choose({ text: 'Hello.', recipient: extra.id })).statusCode).toBe(400);
    expect((await choose({ text: 'Hello.', recipient: 'everyone' })).statusCode).toBe(400);
    currentExtra.lastAction = lastAction;

    const prompts: string[] = [];
    session.gen.linesLlm = {
      name: 'test-lines', health: async () => true, complete: async () => '...',
      async *stream(req) {
        prompts.push(req.prompt);
        yield [...req.prompt.matchAll(/^\d+\. ([\w-]+) \(/gm)].map(m => `${m[1]}: Sounds good.`).join('\n');
      },
    };
    let before = run.transcript.length;
    const words = `${original.name.split(' ')[0]}, shall we cook together?`;
    expect((await choose({ text: words, recipient: extra.id })).statusCode).toBe(200);
    await stream();
    expect(run.transcript.slice(before).map(l => l.speaker)).toEqual([state.playerId, extra.id]);
    expect(run.transcript[before].text).toBe(words);
    expect(prompts.at(-1)).toContain(`addressing ${extra.name.split(' ')[0]} directly`);
    expect(run.transcript.at(-1)?.source).toBe('llm');
    expect(run.phase).toBe('awaiting-choice');

    before = run.transcript.length;
    expect((await choose({ intent: run.ev.intents[0], recipient: original.id })).statusCode).toBe(200);
    await stream();
    expect(run.transcript.slice(before).map(l => l.speaker)).toEqual([state.playerId, original.id]);
    expect(prompts.some(p => p.includes(`address ${original.name.split(' ')[0]} directly`))).toBe(true);

    before = run.transcript.length;
    expect((await choose({ text: words, recipient: 'everyone' })).statusCode).toBe(200);
    await stream();
    expect(run.transcript.slice(before).map(l => l.speaker)).toEqual([state.playerId, ...run.ev.participants.filter(id => id !== state.playerId)]);
    expect(run.phase).toBe('awaiting-choice');
    session.choose(run.id, { done: true });
    await stream();
    expect(run.phase).toBe('done');
  } finally {
    await app.close();
    store.db.close();
  }
});
