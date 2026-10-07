import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFact, recordCommentary, type LlmRequest } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';

it('streams narration separately, retries without extra time or messages, and tolerates duplicate panel requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-playability-'));
  const store = new Store(openDb(':memory:'));
  let turn = 0;
  const linesLlm = { name: 'test', health: async () => true, complete: async () => `phone reply ${++turn}`, async *stream(req: LlmRequest) {
    const speakers = [...req.prompt.matchAll(/^\d+\. ([\w-]+) \(/gm)].map(m => m[1]);
    for (const id of speakers) yield `${id}: *Ron nods and Maya sets down her mug.* "Reply ${++turn}: I will help with the dishes."\n`;
  } };
  const { app, session } = await buildApp({ llm: new MockLlm(), linesLlm, image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 7, moveInDay: false });
    await session.act({ type: 'talk', target: 'ren', room: 'living', guests: ['mio'] });
    const run = [...session.runs.values()].find(r => r.rendered)!;
    const events: { event: string; data: any }[] = [];
    const stream = () => session.stream(run.id, (event, data) => events.push({ event, data }));
    await stream();
    session.choose(run.id, { text: 'Please help me wash up.', recipient: 'ren' });
    await stream();
    expect(run.transcript.slice(-2).map(l => l.speaker)).toEqual(['narrator', 'ren']);
    expect(events.filter(e => e.event === 'line-start' && e.data.speaker === 'narrator').every(e => e.data.name === 'Narration')).toBe(true);
    const state = structuredClone(session.state);
    const oldReply = run.transcript.at(-1)!.text;
    session.choose(run.id, { retry: true });
    await stream();
    expect(session.state).toEqual(state);
    expect(run.transcript.at(-1)!.text).not.toBe(oldReply);
    expect(run.transcript.filter(l => l.source === 'player')).toHaveLength(1);
    expect(events.some(e => e.event === 'reset')).toBe(true);
    session.choose(run.id, { done: true });
    await stream();
    await session.act({ type: 'text', target: 'ren', text: 'See you soon?' });
    const beforeTextRetry = structuredClone(session.state);
    const key = [session.state!.playerId, 'ren'].sort().join('|');
    await session.retryText('ren');
    expect(session.state!.world).toEqual(beforeTextRetry!.world);
    expect(session.state!.chats[key]).toHaveLength(beforeTextRetry!.chats[key].length);
    expect(session.state!.chats[key].at(-1)!.text).not.toBe(beforeTextRetry!.chats[key].at(-1)!.text);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    session.pendingIntermission = 'end';
    const beforePanel = structuredClone(session.state!.world);
    const beforeRemarks = session.state!.panelRemarks.length;
    const [a, b] = await Promise.all([session.intermission(), session.intermission()]);
    expect(a.lines.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(session.state!.world).toEqual(beforePanel);
    expect(session.state!.panelRemarks.slice(beforeRemarks).map(r => ({ speaker: r.speaker, text: r.text }))).toEqual(a.lines.map(l => ({ speaker: l.speaker, text: l.text })));
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const saved = session.save(2, 'after studio commentary');
    session.load(saved);
    expect(session.state!.panelRemarks.slice(beforeRemarks).map(r => r.text)).toEqual(a.lines.map(l => l.text));
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('replays important scenes across three recorded days and preserves the delayed watch through a save', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-broadcast-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 7, moveInDay: false });
    for (const day of [1, 2, 3, 4]) {
      session.state!.world.episode = day;
      addFact(session.state!, { subject: 'ren', kind: 'event', content: `highlight from day ${day}`, sensitivity: 0.5, truth: true });
      session.state = recordCommentary(session.state!, { calledBack: [], remarks: { episode: day, participants: ['ren'], lines: [{ speaker: 'nagumo', text: `panel comment from day ${day}` }, { speaker: 'otaru', text: `second panel comment from day ${day}` }] } });
      store.appendEvent(session.state!.gameId, 'scene', { episode: day, event: { salience: 0.8 }, title: `scene from day ${day}`, location: 'living', participants: ['ren', 'mio'], transcript: [{ speaker: 'ren', text: `words from day ${day}` }] });
    }
    session.state!.world.episode = 6; session.state!.world.slot = 'evening';
    for (const c of Object.values(session.state!.characters)) { c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 180; }
    await session.act({ type: 'talk', target: 'ren', room: 'kitchen', guests: ['mio'] });
    const chat = session.summaries().find(scene => scene.location === 'kitchen' && scene.isPlayerScene)!;
    const watch = [...session.runs.values()].find(run => run.ev.templateId === 'broadcast-watch')!;
    expect(session.state!.characters[session.state!.playerId].location).toBe('kitchen');
    expect(session.state!.world.flags.aired).toBeUndefined();
    await session.stream(chat.id, () => {});
    session.choose(chat.id, { text: 'Let us finish the dishes before watching TV.' });
    await session.stream(chat.id, () => {});
    session.choose(chat.id, { done: true });
    await session.stream(chat.id, () => {});
    expect(watch.phase).toBe('new');
    expect(session.state!.world.flags.aired).toBeUndefined();
    let header: any;
    await session.stream(watch.id, (event, data) => { if (event === 'scene') header = data; });
    expect(header.broadcast.days).toEqual({ start: 1, end: 3, airs: 6 });
    expect(header.broadcast.panel).toHaveLength(6);
    expect(header.broadcast.panel.map((r: any) => r.day)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(header.broadcast.panel.every((r: any) => r.name !== 'Panel')).toBe(true);
    expect(session.state!.memory[session.state!.playerId].some(m => m.text.includes('second panel comment from day 3'))).toBe(true);
    expect(session.state!.characters[session.state!.playerId].location).toBe('living');
    if (watch.phase === 'awaiting-choice') {
      session.choose(watch.id, { text: 'It is strange seeing those days on TV.' });
      await session.stream(watch.id, () => {});
      session.choose(watch.id, { done: true });
      await session.stream(watch.id, () => {});
    }
    const before = structuredClone(session.state);
    const broadcast = session.broadcast();
    expect(broadcast).toMatchObject({ episode: 1, days: { start: 1, end: 3, airs: 6 } });
    expect(broadcast.scenes.map(scene => scene.day)).toEqual([1, 2, 3]);
    expect(broadcast.highlights.map(moment => moment.day)).toEqual([1, 2, 3]);
    expect(JSON.stringify(broadcast)).not.toContain('day 4');
    expect(session.state).toEqual(before);
    const save = store.save(1, session.state!, 'delayed watch', store.events(session.state!.gameId).at(-1)!.seq);
    session.load(save);
    expect(session.broadcast()).toEqual(broadcast);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
