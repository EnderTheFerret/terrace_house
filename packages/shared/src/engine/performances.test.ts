import { describe, expect, it } from 'vitest';
import { GameState } from '../model';
import { mulberry32 } from '../rng';
import { mockBeatSheet, mockLine } from '../gen/mock';
import { createGame, finishSlot, passTime, planSlot } from './loop';
import { offerPerformances, performanceKind, startPerformances } from './performances';
import { settlePlans } from './living';
import { projectForPlayer } from './view';
import { DEFAULT_PLAYER } from './castgen';

function setup() {
  const s = createGame({ seed: 11, player: { ...DEFAULT_PLAYER, gender: 'man' } });
  s.world.episode = 2;
  s.world.slot = 'morning';
  s.world.minutes = 0;
  for (const c of Object.values(s.characters)) {
    s.world.flags[`introduced_${c.id}`] = true;
    c.persona.keepsShabbat = false;
    c.persona.routine.jobSlots = [];
    c.lastAction = 'hobby';
    c.activityUntil = 180;
    c.location = 'living';
    for (const other of Object.values(s.characters)) if (other.id !== c.id) s.rel[c.id][other.id] = { affinity: 15, romance: 0, tension: 0, trust: 35, closeness: 0 };
  }
  return s;
}

function invite(s = setup(), group = true) {
  const rng = mulberry32(4);
  rng.chance = () => group;
  offerPerformances(s, rng);
  return s;
}

function showTime(s = invite()) {
  const p = s.invitations.find(p => p.from === 'sora' && p.to === s.playerId)!;
  s.world.weekday = (s.world.weekday + p.episode - s.world.episode) % 7;
  s.world.episode = p.episode;
  s.world.slot = p.slot;
  s.world.minutes = 0;
  p.status = 'accepted';
  return { s, p };
}

describe('character performances', () => {
  it('recognizes actual dual occupations, actors and comedians without confusing unrelated jobs', () => {
    const s = setup();
    expect(performanceKind(s.characters.sora)).toBe('concert');
    expect(performanceKind(s.characters.hana)).toBe('dj');
    for (const [occupation, kind] of [['theater actor', 'play'], ['theatre actress', 'play'], ['stand-up comedian', 'comedy'], ['DJ', 'dj'], ['indie musician', 'concert'], ['tractor mechanic', undefined], ['music teacher', undefined]] as const) {
      expect(performanceKind({ ...s.characters.ren, occupation })).toBe(kind);
    }
  });

  it('sends house invitations with a shared show id, individual decisions, phone messages and save data', () => {
    const s = invite();
    const shira = s.invitations.filter(p => p.from === 'sora');
    expect(shira).toHaveLength(5);
    expect(new Set(shira.map(p => p.performance?.id)).size).toBe(1);
    expect(shira.find(p => p.to === s.playerId)?.status).toBe('pending');
    expect(shira.filter(p => p.to !== s.playerId).every(p => p.status === 'accepted')).toBe(true);
    const noga = s.invitations.find(p => p.from === 'hana');
    expect(noga?.performance?.kind).toBe('dj');
    expect(noga?.episode).not.toBe(shira[0].episode);
    expect(Object.values(s.chats).flat().some(m => m.text.includes('my live concert'))).toBe(true);
    expect(s.house.groupChat.messages.some(m => m.text.includes("Shira's live concert"))).toBe(true);
    const loaded = GameState.parse(JSON.parse(JSON.stringify(s)));
    expect(loaded.invitations).toEqual(s.invitations);
    expect(projectForPlayer(loaded).invitations.some(p => p.performance?.kind === 'concert')).toBe(true);
    const count = s.invitations.length;
    offerPerformances(s, mulberry32(18));
    expect(s.invitations).toHaveLength(count);
  });

  it('can invite a particular character, including an NPC, without inviting the rest of the house', () => {
    const s = setup();
    s.rel.sora.ren.affinity = 90;
    invite(s, false);
    const plans = s.invitations.filter(p => p.from === 'sora');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ to: 'ren', performance: { audience: 'personal' } });
  });

  it('makes occupational invitations through normal world time', () => {
    const s = setup();
    const next = passTime(s, 10);
    expect(next.invitations.some(p => p.performance?.kind === 'concert')).toBe(true);
    expect(next.invitations.some(p => p.performance?.kind === 'dj')).toBe(true);
  });

  it('creates a show scene with the performer and accepted audience, even when the host is working', () => {
    const { s, p } = showTime();
    s.characters.sora.persona.routine.jobSlots = [{ slot: 'evening', weekdays: [s.world.weekday] }];
    s.characters.sora.occupation = 'indie musician';
    const result = planSlot(s, { type: 'goOut', node: p.node, activity: 'invite' });
    const show = result.plan.scenes.find(scene => scene.event.type === 'performance')!.event;
    expect(show.title).toBe("Shira's live concert");
    expect(show.participants).toContain(s.playerId);
    expect(show.participants).toContain('sora');
    expect(show.participants.length).toBeGreaterThan(2);
    expect(show.premise).toContain('audience');
    const beat = mockBeatSheet(result.state, mulberry32(7), show).sheet.beats[0];
    const line = mockLine(result.state, mulberry32(7), beat, { event: show, listener: 'Noa', place: 'Florentin Basement', lineCounts: {}, catchphraseUses: {} });
    expect(line).toMatch(/concert|audience/);
    const before = result.state.rel.sora[s.playerId].trust;
    const settled = finishSlot(result.state);
    expect(settled.invitations.find(other => other.id === p.id)?.status).toBe('kept');
    expect(settled.rel.sora[s.playerId].trust).toBeGreaterThan(before);
    expect(settled.memory.sora.some(m => m.text.includes("Shira's live concert"))).toBe(true);
    expect(GameState.safeParse(settled).success).toBe(true);
  });

  it('lets NPC guests attend without the player and distinguishes declining from breaking a promise', () => {
    const { s, p } = showTime();
    p.status = 'declined';
    startPerformances(s);
    expect(s.characters.sora.location).toBe('livehouse');
    expect(s.characters.ren.location).toBe('livehouse');
    expect(s.characters[s.playerId].location).toBe('living');
    const before = s.rel.sora[s.playerId].trust;
    settlePlans(s);
    expect(p.status).toBe('declined');
    expect(s.rel.sora[s.playerId].trust).toBe(before);
    const missed = showTime();
    startPerformances(missed.s);
    settlePlans(missed.s);
    expect(missed.p.status).toBe('broken');
  });

  it('stages actors in their own play and preserves the theatrical premise', () => {
    const s = setup();
    s.characters.ren.occupation = 'theater actor';
    invite(s);
    const p = s.invitations.find(p => p.from === 'ren' && p.to === s.playerId)!;
    expect(p.performance?.kind).toBe('play');
    s.world.episode = p.episode;
    s.world.slot = p.slot;
    p.status = 'accepted';
    const result = planSlot(s, { type: 'goOut', node: p.node, activity: 'invite' });
    expect(result.plan.scenes.find(scene => scene.event.type === 'performance')?.event.premise).toContain('curtain call');
  });

  it('does not pull busy, away or Shabbat guests into a show and cancels unavailable hosts', () => {
    const { s, p } = showTime();
    s.characters.ren.lastAction = 'work';
    s.characters.ren.location = 'station';
    s.world.flags.away_kaito = 'galilee';
    s.characters.kaito.location = 'galilee';
    s.world.weekday = 5;
    s.characters.mio.persona.keepsShabbat = true;
    startPerformances(s);
    expect(s.characters.ren.location).toBe('station');
    expect(s.characters.kaito.location).toBe('galilee');
    expect(s.characters.mio.location).toBe('living');
    s.characters.sora.status = 'left';
    startPerformances(s);
    expect(p.status).toBe('declined');
  });
});
