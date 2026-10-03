import { describe, expect, it } from 'vitest';
import { GameState, PlayerAction } from '../model';
import { occasionFor, occasionForCharacter, outfitFor } from '../wardrobe';
import { createGame, finishSlot, passTime, planSlot } from './loop';
import { projectForPlayer } from './view';
import { scheduleActivity } from './living';

function readyHouse() {
  const s = createGame({ seed: 11 });
  s.world.slot = 'slot1';
  s.world.weather = 'sunny';
  for (const c of Object.values(s.characters)) {
    c.lastAction = 'hobby'; c.location = 'living'; c.activityUntil = 180;
    c.persona.routine.jobSlots = [];
    s.world.flags[`introduced_${c.id}`] = true;
  }
  return s;
}

describe('shared pool', () => {
  it('lets all six residents swim immediately, invites more guests later, and restores outfits on exit', () => {
    const s = readyHouse();
    const guests = Object.values(s.characters).filter((c) => !c.isPlayer).map((c) => c.id);
    const original = structuredClone(s);
    const first = planSlot(s, { type: 'pool', mode: 'enter', with: guests.slice(0, 2) });
    expect(first.plan.scenes).toEqual([]);
    expect(first.state.world.minutes).toBe(s.world.minutes);
    const full = planSlot(first.state, { type: 'pool', mode: 'enter', with: guests });
    const view = projectForPlayer(full.state);
    expect(view.characters.filter((c) => c.swimming)).toHaveLength(6);
    expect(view.characters.find((c) => c.isPlayer)?.swimming).toBe(true);
    expect(view.occupancy?.backyard).toHaveLength(6);
    expect(s).toEqual(original);
    for (const c of Object.values(full.state.characters)) expect(c.appearance).toEqual(original.characters[c.id].appearance);
    const left = planSlot(full.state, { type: 'pool', mode: 'leave' }).state;
    expect(Object.values(left.characters).some((c) => c.swimming)).toBe(false);
    expect(Object.values(left.characters).every((c) => c.location === 'backyard')).toBe(true);
    expect(outfitFor(left.characters.mio, 'daily', 0)).toBe(original.characters.mio.appearance.outfit);
  });

  it('rejects duplicate, missing, away, busy or working guests without changing state; rain is allowed', () => {
    expect(PlayerAction.safeParse({ type: 'pool', mode: 'enter', with: ['ren', 'ren'] }).success).toBe(false);
    expect(PlayerAction.safeParse({ type: 'pool', mode: 'enter', with: ['1', '2', '3', '4', '5', '6'] }).success).toBe(false);
    const s = readyHouse();
    const snapshot = structuredClone(s);
    expect(() => planSlot(s, { type: 'pool', mode: 'enter', with: [s.playerId] })).toThrow(/once/);
    expect(() => planSlot(s, { type: 'pool', mode: 'enter', with: ['missing'] })).toThrow(/busy|away/);
    expect(s).toEqual(snapshot);
    for (const busy of ['work', 'sleep', 'nap', 'shower']) {
      s.characters.ren.lastAction = busy;
      expect(() => planSlot(s, { type: 'pool', mode: 'enter', with: ['ren'] })).toThrow(/busy/);
    }
    s.characters.ren.lastAction = 'hobby'; s.characters.ren.location = 'cafe';
    expect(() => planSlot(s, { type: 'pool', mode: 'enter', with: ['ren'] })).toThrow(/away/);
    s.characters.ren.location = 'living';
    s.characters.ren.persona.routine.jobSlots = [{ slot: s.world.slot, weekdays: [s.world.weekday] }];
    expect(() => planSlot(s, { type: 'pool', mode: 'enter', with: ['ren'] })).toThrow(/work commitment/);
    s.world.weather = 'typhoon';
    expect(() => planSlot(s, { type: 'pool', mode: 'enter' })).toThrow(/typhoon/);
    s.world.weather = 'rain';
    expect(planSlot(s, { type: 'pool', mode: 'enter' }).state.characters[s.playerId].swimming).toBe(true);
  });

  it('preserves invited swimmers across the first world tick and group dialogue, then clears on rollover', () => {
    const s = readyHouse();
    const entered = planSlot(s, { type: 'pool', mode: 'enter', with: ['ren', 'mio', 'sora'] }).state;
    const chat = planSlot(entered, { type: 'talk', target: 'ren' });
    const ev = chat.plan.scenes.find((p) => p.event.title === 'a conversation in the pool')!.event;
    expect(new Set(ev.participants)).toEqual(new Set([s.playerId, 'ren', 'mio', 'sora']));
    expect(occasionFor(ev)).toBe('beach');
    for (const id of ev.participants) expect(chat.state.characters[id].swimming).toBe(true);
    const later = passTime(chat.state, 20);
    for (const id of ['ren', 'mio', 'sora']) expect(later.characters[id]).toMatchObject({ swimming: true, location: 'backyard', lastAction: 'swim' });
    const next = finishSlot(later);
    expect(Object.values(next.characters).some((c) => c.swimming)).toBe(false);
  });

  it('rejects current accepted guest plans atomically, while future and pending plans remain available', () => {
    const s = readyHouse();
    s.invitations.push({ id: 'current', from: 'ren', to: 'sora', episode: s.world.episode, slot: s.world.slot, node: 'living', status: 'accepted' });
    const before = structuredClone(s);
    expect(() => planSlot(s, { type: 'pool', mode: 'enter', with: ['mio', 'ren'] })).toThrow(/already has a plan/);
    expect(s).toEqual(before);
    s.invitations[0].episode++;
    expect(planSlot(s, { type: 'pool', mode: 'enter', with: ['ren'] }).state.characters.ren.swimming).toBe(true);
    s.invitations[0].episode--; s.invitations[0].status = 'pending';
    expect(planSlot(s, { type: 'pool', mode: 'enter', with: ['ren'] }).state.characters.ren.swimming).toBe(true);
  });

  it('rejects absent players for entry and exit and selects swimwear individually in mixed pool-deck scenes', () => {
    const s = readyHouse();
    for (const mode of ['enter', 'leave'] as const) {
      s.characters[s.playerId].location = 'cafe';
      expect(() => planSlot(s, { type: 'pool', mode })).toThrow(/player must be at home/);
      s.characters[s.playerId].location = 'living';
      s.characters[s.playerId].status = 'left';
      expect(() => planSlot(s, { type: 'pool', mode })).toThrow(/player must be at home/);
      s.characters[s.playerId].status = 'inHouse';
      const absent = structuredClone(s);
      delete absent.characters[absent.playerId];
      expect(() => planSlot(absent, { type: 'pool', mode })).toThrow(/player must be at home/);
    }
    for (const tags of [[], ['swim']]) {
      const event = { location: 'backyard', type: 'house', tags, templateId: 'casual-chat' };
      expect(occasionForCharacter({ swimming: true }, event)).toBe('beach');
      expect(occasionForCharacter({ swimming: false }, event)).toBe('daily');
    }
  });

  it('clears swimming when leaving the room or changing activity and loads older saves safely', () => {
    const s = readyHouse();
    const entered = planSlot(s, { type: 'pool', mode: 'enter', with: ['ren'] }).state;
    expect(planSlot(entered, { type: 'visit', room: 'backyard' }).state.characters[s.playerId].swimming).toBe(true);
    expect(planSlot(entered, { type: 'visit', room: 'living' }).state.characters[s.playerId].swimming).toBe(false);
    scheduleActivity(entered, entered.characters.ren, { kind: 'hobby' });
    expect(entered.characters.ren.swimming).toBe(false);
    const old = structuredClone(s) as any;
    for (const c of Object.values(old.characters) as any[]) delete c.swimming;
    expect(Object.values(GameState.parse(old).characters).every((c) => c.swimming === false)).toBe(true);
    expect(occasionFor({ location: 'backyard', type: 'house', tags: ['swim'], templateId: 'pool-chat', slot: 'lateNight' })).toBe('beach');
    expect(occasionFor({ location: 'backyard', type: 'house', tags: [], templateId: 'pool-chat', swimming: true })).toBe('beach');
  });
});
