import { expect, it } from 'vitest';
import { createGame, passTime, planSlot } from './loop';
import { autonomyOptions, chooseAction, queueNpcPlans } from './agents';
import { mulberry32 } from '../rng';
import { npcs } from './core';
import { projectForPlayer } from './view';
import { content } from '../content';

function fixture() {
  const s = createGame({ seed: 9, moveInDay: false }); s.world.slot = 'slot1';
  for (const c of npcs(s)) { c.persona.routine.jobSlots = []; c.location = 'living'; c.activityUntil = 0; c.lastAction = 'hobby'; }
  return s;
}

it('honours work and overnight trips and revalidates a queued outing when circumstances change', () => {
  const s = fixture(), c = s.characters.ren;
  const trip = autonomyOptions(s, c).find(a => a.kind === 'goOut')!;
  queueNpcPlans(s, { ren: trip });
  c.persona.routine.jobSlots = [{ slot: 'slot1', weekdays: [s.world.weekday] }];
  expect(chooseAction(s, mulberry32(1), c).kind).toBe('work');
  s.world.flags.away_ren = 'onsen';
  expect(chooseAction(s, mulberry32(1), c)).toMatchObject({ kind: 'goOut', node: 'onsen' });
});

it('offers only accessible house company and never follows the player or a sleeping housemate', () => {
  const s = fixture();
  s.characters.mio.location = 'bedroomW'; s.characters.sora.lastAction = 'sleep'; s.characters.sora.activityUntil = 90;
  const actions = autonomyOptions(s, s.characters.ren);
  expect(actions.some(a => a.kind === 'seek' && [s.playerId, 'mio', 'sora'].includes(a.target!))).toBe(false);
  s.world.weather = 'typhoon';
  expect(autonomyOptions(s, s.characters.ren).some(a => a.room === 'backyard' || a.kind === 'exercise')).toBe(false);
});

it('travels together only with reciprocal consent, and leaves the player in place', () => {
  const s = fixture();
  const a = autonomyOptions(s, s.characters.ren).find(a => a.kind === 'goOut' && a.companion === 'mio' && !a.useCar)!;
  const b = autonomyOptions(s, s.characters.mio).find(b => b.kind === 'goOut' && b.companion === 'ren' && b.node === a.node)!;
  expect(a).toBeDefined(); expect(b).toBeDefined();
  queueNpcPlans(s, { ren: a, mio: b });
  const next = passTime(s, 1, [], 5);
  expect(next.characters.ren.location).toBe(a.node);
  expect(next.characters.mio.location).toBe(a.node);
  expect(next.characters.ren.actionCompanion).toBe('mio');
  expect(next.characters.mio.actionCompanion).toBe('ren');
  expect(next.characters.ren.activityUntil).toBe(next.characters.mio.activityUntil);
  expect(next.characters[s.playerId].location).toBe(s.characters[s.playerId].location);
  queueNpcPlans(s, { ren: a, mio: { kind: 'hobby', room: 'kitchen' } });
  expect(passTime(s, 1, [], 5).characters.ren.actionCompanion).toBeUndefined();
});

it('does not let a seeker follow a solo outing into the city', () => {
  const s = fixture();
  const trip = autonomyOptions(s, s.characters.mio).find(a => a.kind === 'goOut' && !a.companion)!;
  queueNpcPlans(s, { ren: { kind: 'seek', target: 'mio' }, mio: trip });
  const next = passTime(s, 1, [], 5);
  expect(next.characters.mio.location).toBe(trip.node);
  expect(next.characters.ren.location).toBe('living');
  expect(next.characters.ren.actionCompanion).toBeUndefined();
});

it('shows the actual gossip listener and only a public threshold for private activities', () => {
  const s = fixture();
  s.characters.ren.lastAction = 'gossip'; s.characters.ren.actionTarget = 'kaito'; s.characters.ren.actionThird = 'mio';
  expect(projectForPlayer(s).characters.find(c => c.id === 'ren')?.talkingTo).toBe('mio');
  for (const room of content().house.rooms.filter(r => r.private)) {
    s.characters.ren.location = room.id;
    const c = projectForPlayer(s).characters.find(c => c.id === 'ren')!;
    expect(c.location).toBeNull(); expect(c.activity).toBeNull();
    expect(c.doorway).toBeDefined();
    const { x, y, floor } = c.doorway!;
    expect(content().house.rooms.find(r => r.floor === floor && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)?.private).toBe(false);
  }
});

it('preserves mutual consent and the shared car when a fresh block chooses actions', () => {
  const s = fixture();
  s.world.episode = 2;
  for (const c of npcs(s)) if (!['ren', 'mio'].includes(c.id)) c.activityUntil = 100;
  const a = autonomyOptions(s, s.characters.ren).find(a => a.kind === 'goOut' && a.companion === 'mio' && a.useCar)!;
  const b = autonomyOptions(s, s.characters.mio).find(b => b.kind === 'goOut' && b.companion === 'ren' && b.node === a.node)!;
  expect(a).toBeDefined(); expect(b).toBeDefined();
  queueNpcPlans(s, { ren: a, mio: b });
  const next = planSlot(s, { type: 'post', text: 'Quiet morning.' }).state;
  expect(next.characters.ren.location).toBe(a.node);
  expect(next.characters.mio.location).toBe(a.node);
  expect(next.characters.ren.actionCompanion).toBe('mio');
  expect(next.characters.mio.actionCompanion).toBe('ren');
  expect(next.characters.ren.activityUntil).toBe(next.characters.mio.activityUntil);
  expect(['ren', 'mio']).toContain(next.world.carUsedBy);
});
