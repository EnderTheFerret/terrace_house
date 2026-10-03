import { describe, expect, it } from 'vitest';
import { createGame } from './loop';
import { addFact, learn, rel } from './core';
import { airEpisode, airingTonight } from './broadcast';
import { recordCommentary } from './predictions';

describe('broadcast lag', () => {
  it('airs an episode two episodes later: the house learns what was said behind their backs and hears the panel', () => {
    let s = createGame({ seed: 5, seasonLength: 0 });
    const f = addFact(s, { subject: 'ren', about: s.playerId, kind: 'opinion', content: 'Ren said the newcomer is fake', truth: true, sensitivity: 0.5 });
    learn(s, 'ren', f.id, 'self');
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 1, participants: [s.playerId], lines: [{ text: 'the newcomer has no idea' }] } });
    expect(airingTonight(s)).toBeNull();
    s.world.episode = 3;
    expect(airingTonight(s)).toBe(1);
    const before = rel(s, s.playerId, 'ren').tension;
    const summary = airEpisode(s, 1);
    expect(s.knowledge[s.playerId][f.id].source).toBe('broadcast');
    expect(rel(s, s.playerId, 'ren').tension).toBeGreaterThan(before);
    expect(s.memory[s.playerId].some((m) => m.text.includes('the newcomer has no idea'))).toBe(true);
    expect(summary).toContain('fake');
    expect(airingTonight(s)).toBeNull(); // watched once
  });
  it('the panel coins one nickname per housemate from a memorable moment and keeps it', () => {
    let s = createGame({ seed: 5, seasonLength: 0 });
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 1, participants: ['ren'], lines: [], moment: 'ix-confess a confession' } });
    expect(s.panelNicknames.ren.name).toBe(`Confession ${s.characters.ren.name.split(' ')[0]}`);
    s = recordCommentary(s, { calledBack: [], remarks: { episode: 2, participants: ['ren'], lines: [], moment: 'cooking-duel dinner' } });
    expect(s.panelNicknames.ren.name).toBe(`Confession ${s.characters.ren.name.split(' ')[0]}`);
  });
});
