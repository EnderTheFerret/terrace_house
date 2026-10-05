import { describe, expect, it } from 'vitest';
import { GameState } from '../model';
import { createGame, finishSlot, passTime, planSlot } from './loop';
import { addFeedPost, canVisit, settlePlans, startPlans } from './living';
import { projectForPlayer } from './view';
import { content } from '../content';
import { canUseCar } from './city';

describe('minute-based social life', () => {
  it('reserves one car for a plan, allows its player passenger and requires a private-room resident', () => {
    const s = createGame({ seed: 11 }); s.world.slot = 'slot1';
    for (const c of Object.values(s.characters)) c.lastAction = 'hobby';
    s.invitations.push({ id: 'car-one', from: 'ren', to: s.playerId, episode: 1, slot: 'slot1', node: 'lighthouse', status: 'accepted' }, { id: 'car-two', from: 'kaito', to: 'sora', episode: 1, slot: 'slot1', node: 'lighthouse', status: 'accepted' });
    startPlans(s);
    expect(s.world.carUsedBy).toBe('ren');
    expect(s.characters.ren.location).toBe('lighthouse');
    expect(s.invitations[1].status).toBe('declined');
    expect(canUseCar(s, 'lighthouse')).toBe(true);
    expect(canUseCar(s, 'onsen')).toBe(false);
    s.invitations.push({ id: 'private', from: 'ren', to: 'kaito', episode: 1, slot: 'slot1', node: 'balconyW', status: 'accepted' });
    startPlans(s);
    expect(s.invitations[2].status).toBe('declined');
  });
  it('rejects car trips and messages that cross an observing participant\'s sundown', () => {
    const s = createGame({ seed: 11 }); s.world.weekday = 5; s.world.slot = 'slot3'; s.world.minutes = 119;
    s.characters[s.playerId].persona.keepsShabbat = false;
    s.characters.ren.persona.keepsShabbat = true;
    expect(() => planSlot(s, { type: 'text', target: 'ren' })).toThrow(/recipient/);
    s.characters[s.playerId].persona.keepsShabbat = true;
    s.world.minutes = 50;
    expect(() => planSlot(s, { type: 'goOut', node: 'riverside', activity: 'wander', useCar: true })).toThrow(/sundown/);
  });
  it('keeps social photos and stories stable after a housemate changes appearance', () => {
    const s = createGame({ seed: 7 });
    addFeedPost(s, 'ren', 'Coffee before the shift.', 'mio', 'story');
    const snapshot = structuredClone(s.feed[0]);
    s.characters.ren.appearance.hairColor = 'pink';
    expect(s.feed[0]).toEqual(snapshot);
    expect(snapshot).toMatchObject({ kind: 'story', location: 'living' });
    expect(snapshot.people).toHaveLength(2);
    expect(GameState.safeParse(s).success).toBe(true);
  });
  it('advances identical world state regardless of conversation chunk sizes', () => {
    const s = createGame({ seed: 31, seasonLength: 0 });
    s.world.slot = 'slot1';
    const whole = passTime(s, 20);
    const pieces = passTime(passTime(passTime(s, 5), 5), 10);
    expect(pieces).toEqual(whole);
    expect(whole.world.minutes).toBe(120);
    expect(Object.values(whole.characters).some((c) => !c.isPlayer && c.activityUntil > 120)).toBe(true);
    expect(GameState.safeParse(whole).success).toBe(true);
  });
  it('lets endless seasons continue, wraps after one full final episode, and resolves predictions', () => {
    let s = createGame({ seed: 8 });
    s.world.slot = 'lateNight';
    s = finishSlot(s);
    expect(s.world.episode).toBe(2);
    expect(s.seasonOver).toBe(false);
    expect(() => planSlot(s, { type: 'endSeason' })).toThrow(/episode 3/);
    s.world.episode = 3;
    s.predictions.push({ id: 'future', by: content().panel[0].id, text: 'A future event', madeEp: 3, condition: { kind: 'leave', a: 'ren', byEpisode: 9 }, resolved: null, calledBack: false });
    s = planSlot(s, { type: 'endSeason' }).state;
    expect(s.finaleEpisode).toBe(4);
    s.world.slot = 'lateNight';
    s = finishSlot(s);
    expect(s.seasonOver).toBe(false);
    s.world.slot = 'lateNight';
    s = finishSlot(s);
    expect(s.seasonOver).toBe(true);
    expect(s.predictions.every((p) => p.resolved !== null)).toBe(true);
    expect(s.epilogues?.[s.playerId]).toBeTruthy();
  });
  it('sleep skips world time through late night and still returns a valid living morning', () => {
    const s = createGame({ seed: 17 });
    s.world.slot = 'slot2';
    const morning = finishSlot(planSlot(s, { type: 'sleep' }).state);
    expect([morning.world.episode, morning.world.slot, morning.world.minutes]).toEqual([2, 'morning', 0]);
    expect(morning.world.tick).toBe(4);
    expect(morning.timeline.some((t) => t.slot === 'lateNight')).toBe(true);
    expect(morning.world.flags.sleepUntilMorning).toBeUndefined();
  });
  it('plans, gifts and privacy have consequences and cannot be spoofed', () => {
    let s = createGame({ seed: 7 });
    const other = Object.values(s.characters).find((c) => !c.isPlayer && c.gender !== s.characters[s.playerId].gender)!;
    const room = other.gender === 'man' ? 'balconyM' : 'balconyW';
    other.location = room;
    expect(canVisit(s, room, other.id)).toBe(false);
    expect(() => planSlot(s, { type: 'visit', room, invite: other.id })).toThrow(/invitation/);
    const privateView = projectForPlayer(s).characters.find((c) => c.id === other.id)!;
    expect(privateView.activity).toBeNull();
    expect(privateView.location).toBeNull();
    expect(privateView.floor).toBeNull();
    expect(() => planSlot(s, { type: 'gift', target: other.id, item: 'book' })).toThrow(/buy/);
    s.inventory.push('book');
    const trust = s.rel[other.id][s.playerId].trust;
    s = planSlot(s, { type: 'gift', target: other.id, item: 'book' }).state;
    expect(s.inventory).not.toContain('book');
    expect(s.rel[other.id][s.playerId].trust).toBeGreaterThan(trust);
    s.invitations.push({ id: 'promise', from: other.id, to: s.playerId, episode: s.world.episode, slot: s.world.slot, node: 'cafe', status: 'accepted' });
    const before = s.rel[other.id][s.playerId].trust;
    settlePlans(s);
    expect(s.invitations.at(-1)?.status).toBe('broken');
    expect(s.rel[other.id][s.playerId].trust).toBeLessThan(before);
  });
  it('invalid outings consume neither time nor money', () => {
    const s = createGame({ seed: 11 });
    s.world.slot = 'slot1';
    s.world.minutes = 160;
    const snapshot = structuredClone(s);
    expect(() => planSlot(s, { type: 'goOut', node: 'lighthouse', activity: 'date' })).toThrow();
    expect(s).toEqual(snapshot);
  });
  it('postpones impossible plans and rejects approaches from busy housemates', () => {
    const s = createGame({ seed: 11 });
    s.world.slot = 'lateNight';
    s.invitations.push({ id: 'closed', from: 'ren', to: 'mio', episode: 1, slot: 'lateNight', node: 'cafe', status: 'accepted' });
    startPlans(s);
    expect(s.invitations[0].status).toBe('declined');
    expect(s.characters.ren.location).not.toBe('cafe');
    s.approaches.push({ id: 'stale', from: 'ren', text: 'come sit' });
    s.characters.ren.location = 'grill'; s.characters.ren.lastAction = 'work';
    expect(() => planSlot(s, { type: 'approach', id: 'stale', accept: true })).toThrow(/busy/);
    s.characters.ren.location = 'bathroom'; s.characters.ren.lastAction = 'shower';
    s.characters.ren.activityUntil = s.world.minutes + 40;
    expect(() => planSlot(s, { type: 'talk', target: 'ren' })).toThrow(/busy/);
    expect(() => planSlot(s, { type: 'house', activity: 'hangout', target: 'ren' })).toThrow(/busy/);
  });
  it('does not recruit a napping or showering housemate into an untargeted house scene', () => {
    const s = createGame({ seed: 11 });
    s.world.slot = 'slot1'; s.world.flags.startedBlock = '1:slot1';
    for (const c of Object.values(s.characters).filter((c) => !c.isPlayer)) {
      c.lastAction = c.id === 'ren' ? 'shower' : 'nap';
      c.location = c.id === 'ren' ? 'bathroom' : 'bedroomW';
      c.activityUntil = 180;
    }
    const next = planSlot(s, { type: 'house', activity: 'hangout' });
    expect(next.plan.scenes).toEqual([]);
    expect(next.state.characters.ren.location).toBe('bathroom');
  });
  it('checks a new block\'s work activity before moving an NPC into a plan', () => {
    const s = createGame({ seed: 11 });
    s.world.slot = 'slot1';
    s.characters.ren.lastAction = 'hobby';
    s.characters.ren.persona.routine.jobSlots = [{ slot: 'slot1', weekdays: [s.world.weekday] }];
    s.invitations.push({ id: 'shift-conflict', from: 'ren', to: s.playerId, episode: 1, slot: 'slot1', node: 'market', status: 'accepted' });
    const next = planSlot(s, { type: 'house', activity: 'hangout' });
    expect(next.plan.npcActions.ren.kind).toBe('work');
    expect(next.state.characters.ren.lastAction).toBe('work');
    expect(next.state.characters.ren.location).toBe('grill');
  });
});
