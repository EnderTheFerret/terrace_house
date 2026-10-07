import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';

it('shares an activity, responds to typed words, completes it, saves it and replays exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-household-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  const lines: any[] = [];
  const stream = (id: string) => session.stream(id, (kind, data) => { if (kind === 'line-end') lines.push(data); });
  try {
    await session.newGame({ seed: 9, moveInDay: false });
    const r = await session.act({ type: 'household', activity: 'dishes', target: 'ren' });
    expect(r.scenes).toHaveLength(1);
    const id = r.scenes[0].id;
    expect(r.scenes[0].title).toBe('wash dishes together');
    await stream(id);
    if (session.runs.get(id)?.phase === 'awaiting-choice') {
      session.choose(id, { text: 'Thanks for helping. How was your day at work?', recipient: 'ren' });
      await stream(id);
    }
    expect(lines.some(l => l.speaker === session.state!.playerId && l.text.includes('Thanks for helping'))).toBe(true);
    expect(lines.some(l => l.speaker === 'ren')).toBe(true);
    if (session.runs.get(id)?.phase === 'awaiting-choice') { session.choose(id, { done: true }); await stream(id); }
    await session.endSlot();
    expect(session.state!.log.some(l => l.templateId === 'household-dishes')).toBe(true);
    expect(session.state!.characters.ren.actionHousehold).toBeUndefined();
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const saved = session.save(1, 'shared chores');
    session.load(saved);
    expect(session.state!.memory.ren.some(m => m.text.includes('wash dishes'))).toBe(true);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
