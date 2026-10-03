import { describe, expect, it } from 'vitest';
import { autoChoices, createGame, finishSlot, planSlot, proposeOutcome, resolveScene } from './loop';
import { housemates, knows } from './core';
import type { GameState } from '../model';
import { tripOffer } from './trips';

const play = (s: GameState, scenes: { event: Parameters<typeof autoChoices>[1] }[]) => {
  for (const p of scenes) {
    const a = autoChoices(s, p.event);
    const pr = proposeOutcome(a.state, p.event, a.choices);
    s = resolveScene(pr.state, p.event, pr.proposal, a.choices).state;
  }
  return s;
};

describe('trips come up on their own', () => {
  it('a friend texts an invite on Thursday evening; a close pair goes without the player on Friday and stays away till Saturday', () => {
    let s = createGame({ seed: 6, seasonLength: 0 });
    for (const c of housemates(s)) c.persona.keepsShabbat = false;
    const [a, b] = housemates(s).filter((c) => !c.isPlayer);
    for (const [x, y] of [[a.id, s.playerId], [a.id, b.id], [b.id, a.id]]) Object.assign(s.rel[x][y], { affinity: 70, romance: 50 });
    s.world.weekday = 4;
    s.world.slot = 'evening';
    let offered = false;
    for (let i = 0; i < 8 && !offered; i++) { s.rngState = i; offered = !!tripOffer(planSlot(s, { type: 'idle' }).state); if (offered) s = planSlot(s, { type: 'idle' }).state; }
    expect(offered).toBe(true);
    expect(tripOffer(s)!.from).toBe(a.id);
    expect(Object.values(s.chats).flat().some((m) => m.text.includes('this weekend'))).toBe(true);
    // Friday late morning, the player stays home: the inviter goes with their closest housemate
    s.world.weekday = 5;
    s.world.slot = 'slot2';
    delete s.world.flags.startedBlock;
    let away: GameState | null = null;
    for (let i = 0; i < 12 && !away; i++) { const t = planSlot({ ...s, rngState: i }, { type: 'idle' }).state; if (t.world.flags.trip) away = t; }
    expect(away).not.toBeNull();
    s = away!;
    expect(String(s.world.flags.trip)).toContain(a.id);
    s = finishSlot(s);
    s = planSlot(s, { type: 'idle' }).state; // next block: still away, not back in the kitchen
    expect(s.characters[a.id].location).toBe(String(s.world.flags.trip).split('|')[0]);
  });
});

describe('overnight trips', () => {
  it('leaves Friday in the car, plays the drive and the night, comes home Saturday morning, and the house knows', () => {
    let s = createGame({ seed: 6, seasonLength: 0 });
    s.world.weekday = 5;
    s.world.slot = 'slot1';
    s.characters[s.playerId].persona.keepsShabbat = false;
    const friend = housemates(s).find((c) => !c.isPlayer && !c.persona.keepsShabbat)!;
    const observer = housemates(s).find((c) => !c.isPlayer && c.id !== friend.id)!;
    observer.persona.keepsShabbat = true;
    expect(() => planSlot(s, { type: 'trip', node: 'galilee', with: [observer.id] })).toThrow(/Shabbat/);
    const p = planSlot(s, { type: 'trip', node: 'galilee', with: [friend.id] });
    expect(p.plan.scenes.slice(0, 2).map((x) => x.event.templateId)).toEqual(['trip-travel', 'trip-night']);
    s = finishSlot(play(p.state, p.plan.scenes));
    expect(s.world.slot).toBe('morning'); // slept through to the next morning
    const home = planSlot(s, { type: 'idle' });
    const back = home.plan.scenes.find((x) => x.event.templateId === 'trip-return');
    expect(back?.event.participants).toEqual(expect.arrayContaining([s.playerId, friend.id]));
    const fact = Object.values(s.facts).find((f) => f.content.includes('went away overnight'))!;
    expect(knows(s, observer.id, fact.id) || observer.location === 'out').toBe(true);
  });
});
