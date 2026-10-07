import { describe, expect, it } from 'vitest';
import { beginBroadcast, createGame, planSlot } from './loop';
import { addFact, learn, rel } from './core';
import { airEpisode, airingTonight, broadcastDays, broadcastHighlights, broadcastPanel } from './broadcast';
import { pruneFacts } from './knowledge';
import { recordCommentary } from './predictions';

describe('broadcast lag', () => {
  it('airs days 1–3 on day 6: the house learns what was said behind their backs and hears the panel', () => {
    let s = createGame({ seed: 5, seasonLength: 0 });
    const f = addFact(s, { subject: 'ren', about: s.playerId, kind: 'opinion', content: 'Ren said the newcomer is fake', truth: true, sensitivity: 0.5 });
    learn(s, 'ren', f.id, 'self');
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 1, participants: [s.playerId], lines: [{ text: 'the newcomer has no idea' }] } });
    expect(airingTonight(s)).toBeNull();
    for (let day = 1; day < 6; day++) { s.world.episode = day; expect(airingTonight(s)).toBeNull(); }
    s.world.episode = 6;
    for (const slot of ['morning', 'slot1', 'slot2', 'slot3', 'lateNight'] as const) { s.world.slot = slot; expect(airingTonight(s)).toBeNull(); }
    s.world.slot = 'evening';
    expect(airingTonight(s)).toBe(1);
    const before = rel(s, s.playerId, 'ren').tension;
    const summary = airEpisode(s, 1);
    expect(s.knowledge[s.playerId][f.id].source).toBe('broadcast');
    expect(rel(s, s.playerId, 'ren').tension).toBeGreaterThan(before);
    expect(s.memory[s.playerId].some((m) => m.text.includes('the newcomer has no idea'))).toBe(true);
    expect(summary).toContain('fake');
    expect(airingTonight(s)).toBeNull(); // watched once
    s.world.episode = 8;
    expect(airingTonight(s)).toBeNull();
    s.world.episode = 9;
    expect(airingTonight(s)).toBe(2);
    expect(broadcastDays(2)).toEqual({ start: 4, end: 6, airs: 9 });
  });
  it('records complete panel commentary and lets every watcher hear comments about other people', () => {
    let s = createGame({ seed: 7, moveInDay: false });
    const lines = Array.from({ length: 24 }, (_, i) => ({ speaker: 'nagumo', text: `panel remark ${i}: ${'the housemates kept talking. '.repeat(8)}` }));
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 1, participants: ['ren'], lines } });
    expect(s.panelRemarks.map(r => ({ speaker: r.speaker, text: r.text }))).toEqual(lines);
    expect(s.memory[s.playerId].some(m => m.text.includes('panel remark'))).toBe(false);
    s.world.episode = 6; s.world.slot = 'evening';
    airEpisode(s, 1, [s.playerId, 'ren']);
    expect(s.memory[s.playerId].some(m => m.text.includes('panel remark 23'))).toBe(true);
    expect(s.memory.mio.some(m => m.text.includes('panel remark'))).toBe(false);
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 6, participants: ['mio'], lines: [{ text: 'future episode panel' }] } });
    expect(broadcastPanel(s, 1).map(r => ({ speaker: r.speaker, text: r.text }))).toEqual(lines);
  });
  it('keeps highlights from every covered day, retains them until air time, and excludes future days', () => {
    let s = createGame({ seed: 7, moveInDay: false });
    const ids: string[] = [];
    for (const day of [1, 2, 3, 4]) {
      s.world.episode = day;
      ids.push(addFact(s, { subject: 'ren', kind: 'event', content: `important day ${day}`, truth: true, sensitivity: 0.25 }).id);
      s = recordCommentary(s, { calledBack: [], remarks: { episode: day, participants: ['ren'], lines: [{ text: `panel day ${day}` }] } });
    }
    s.world.episode = 6;
    pruneFacts(s);
    expect(ids.every(id => !!s.facts[id])).toBe(true);
    expect(broadcastHighlights(s, 1).map(m => m.day)).toEqual([1, 2, 3]);
    const summary = airEpisode(s, 1, ['ren', s.playerId]);
    for (const day of [1, 2, 3]) { expect(summary).toContain(`important day ${day}`); expect(summary).toContain(`panel day ${day}`); }
    expect(summary).not.toContain('important day 4');
    expect(s.knowledge[s.playerId][ids[0]].source).toBe('broadcast');
    expect(s.knowledge.mio[ids[0]]).toBeUndefined();
    expect(s.memory[s.playerId].some(m => m.text.includes('important day 3'))).toBe(true);
  });
  it('queues the watch alongside a requested group conversation and includes all six available residents', () => {
    const s = createGame({ seed: 7, moveInDay: false });
    s.world.episode = 6; s.world.slot = 'evening';
    for (const c of Object.values(s.characters)) { c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 180; }
    const result = planSlot(s, { type: 'talk', target: 'ren', room: 'kitchen', guests: ['mio'] });
    const watch = result.plan.scenes.find(scene => scene.event.templateId === 'broadcast-watch')!;
    expect(result.plan.scenes).toHaveLength(2);
    expect(watch.event.participants).toHaveLength(6);
    expect(watch.event.premise).toContain('days 1–3');
    expect(result.state.world.flags.aired).toBeUndefined();
    expect(result.state.characters[s.playerId].location).toBe('kitchen');
    expect(result.state.characters.ren.location).toBe('kitchen');
    beginBroadcast(result.state, watch.event);
    expect(result.state.world.flags.aired).toBe(1);
    expect(result.state.characters[s.playerId].location).toBe('living');
    expect(s.world.flags.aired).toBeUndefined();
  });
  it('the panel coins one nickname per housemate from a memorable moment and keeps it', () => {
    let s = createGame({ seed: 5, seasonLength: 0 });
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 1, participants: ['ren'], lines: [], moment: 'ix-confess a confession' } });
    expect(s.panelNicknames.ren.name).toBe(`Confession ${s.characters.ren.name.split(' ')[0]}`);
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 2, participants: ['ren'], lines: [], moment: 'cooking-duel dinner' } });
    expect(s.panelNicknames.ren.name).toBe(`Confession ${s.characters.ren.name.split(' ')[0]}`);
  });
});
