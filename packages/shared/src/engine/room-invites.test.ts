import { expect, it } from 'vitest';
import { GameState, PlayerAction } from '../model';
import { createGame, planSlot } from './loop';
import { projectForPlayer } from './view';

it('invites available housemates into a shared room without advancing the whole block', () => {
  for (const moveInDay of [false, true]) {
    const s = createGame({ seed: 7, moveInDay });
    const guests = Object.values(s.characters).filter(c => !c.isPlayer).slice(0, 2);
    for (const c of guests) { c.status = 'inHouse'; c.location = 'living'; c.lastAction = 'seek'; c.activityUntil = 0; }
    s.characters[s.playerId].location = 'living';
    const before = structuredClone(s);
    const action = PlayerAction.parse({ type: 'talk', target: guests[0].id, room: 'kitchen', guests: [guests[1].id] });
    if (action.type !== 'talk') throw new Error('expected talk');
    const { state, plan } = planSlot(s, action);
    expect(s).toEqual(before);
    expect(state.world.minutes).toBe(s.world.minutes + 5);
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0].event).toMatchObject({ location: 'kitchen', participants: [s.playerId, ...guests.map(c => c.id)] });
    expect(projectForPlayer(state).occupancy?.kitchen).toEqual(expect.arrayContaining([s.playerId, ...guests.map(c => c.id)]));
    expect(GameState.safeParse(state).success).toBe(true);
    for (const room of ['bedroomM', 'bathroom', 'balconyW'] as const) expect(() => planSlot(s, { ...action, room })).toThrow(/shared room/);
    expect(PlayerAction.safeParse({ ...action, room: 'not-a-room' }).success).toBe(false);
    expect(PlayerAction.safeParse({ ...action, guests: [guests[1].id, guests[1].id] }).success).toBe(false);
    expect(() => planSlot(s, { ...action, guests: [s.playerId] })).toThrow(/unavailable/);
    expect(() => planSlot(s, { ...action, guests: [action.target] })).toThrow(/unavailable/);
    guests[1].lastAction = 'work';
    guests[1].activityUntil = s.world.minutes + 60;
    expect(() => planSlot(s, action)).toThrow(/unavailable/);
    guests[0].lastAction = 'sleep';
    guests[0].activityUntil = s.world.minutes + 60;
    expect(() => planSlot(s, { ...action, guests: [] })).toThrow(/busy/);
  }
});

it('keeps bedroom conversations local and excludes housemates in other rooms', () => {
  const s = createGame({ seed: 7, moveInDay: false });
  for (const c of Object.values(s.characters)) { c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 60; }
  s.characters.ren.location = s.characters.kaito.location = 'bedroomM';
  const { state, plan } = planSlot(s, { type: 'talk', target: 'kaito' });
  expect(plan.scenes.find(scene => scene.event.isPlayerScene)?.event).toMatchObject({ location: 'bedroomM', participants: [s.playerId, 'kaito', 'ren'] });
  expect(state.characters.sora.location).toBe('living');
  expect(state.characters[s.playerId].location).toBe('bedroomM');
});
