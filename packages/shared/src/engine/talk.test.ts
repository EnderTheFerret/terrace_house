import { describe, expect, it } from 'vitest';
import { INTENTS, type Intent } from '../model';
import { mulberry32 } from '../rng';
import { mockReply } from '../gen/mock';
import { classifyIntent, recordChat, recordPlayerWords } from './talk';
import { createGame, finishSlot, joinNewPlayer, planSlot } from './loop';
import { DEFAULT_PLAYER } from './castgen';
import { depart, markLeaving } from './leave';
import { housemates } from './core';

const all = [...INTENTS] as Intent[];

describe('typed talk', () => {
  it('reads an intent from free text, limited to what the scene offers', () => {
    expect(classifyIntent('I really like you. I have for weeks.', all)).toBe('confess');
    expect(classifyIntent("I'm sorry about yesterday, that was my fault", all)).toBe('apologize');
    expect(classifyIntent('Why did you tell everyone? That is not okay.', all)).toBe('confront');
    expect(classifyIntent('you look really nice today', all)).toBe('flirt');
    expect(classifyIntent('haha you are ridiculous lol', all)).toBe('joke');
    expect(classifyIntent('what happened? tell me', all)).toBe('listen');
    expect(classifyIntent('I like you', ['joke', 'listen'])).toBe('listen'); // confess not offered → a safe offered intent
    expect(classifyIntent('hmm', ['support', 'listen'])).toBe('listen');
  });

  it('answers typed words in character, colored by how they feel about the player', () => {
    const s = createGame({ seed: 3 });
    const P = s.playerId;
    const ren = 'ren';
    s.rel[ren][P].romance = 60;
    const keen = mockReply(s, mulberry32(1), ren, { text: 'you look nice today', intent: 'flirt' });
    s.rel[ren][P].romance = 0;
    const cool = mockReply(s, mulberry32(1), ren, { text: 'you look nice today', intent: 'flirt' });
    expect(keen).not.toBe(cool);
    expect(keen.length).toBeGreaterThan(0);
  });

  it('housemates remember what you said; phone talk lands in the thread', () => {
    const s0 = createGame({ seed: 3 });
    const s1 = recordPlayerWords(s0, [s0.playerId, 'mio'], ['I think the fridge is haunted']);
    expect(s1.memory.mio.at(-1)!.text).toContain('the fridge is haunted');
    expect(s1.memory[s0.playerId].length).toBe(s0.memory[s0.playerId].length); // not your own memory
    const s2 = recordChat(s1, s0.playerId, 'mio', [{ speaker: s0.playerId, text: 'you home?' }, { speaker: 'mio', text: 'omw' }]);
    expect(s2.chats[[s0.playerId, 'mio'].sort().join('|')].map((m) => m.text)).toEqual(['you home?', 'omw']);
  });
});

describe('graduations and arrivals', () => {
  it('the player graduates (with their partner), then their next character moves in as a stranger', () => {
    let s = createGame({ seed: 5 });
    s.world.slot = 'slot1';
    s.couples.push({ a: s.playerId, b: 'ren', since: 1, status: 'dating' });
    const old = s.playerId;
    s = planSlot(s, { type: 'graduate', with: 'ren' }).state;
    s = finishSlot(s);
    expect(s.awaitingPlayer).toBe(true);
    expect(s.seasonOver).toBe(false);
    expect(s.characters[old].status).toBe('left');
    expect(s.characters.ren.status).toBe('left');
    expect(s.couples[0].status).toBe('left-together');
    expect(s.pendingArrivals.some((p) => p.gender === 'man')).toBe(true); // ren's place is refilled
    expect(() => joinNewPlayer(createGame({ seed: 5 }), DEFAULT_PLAYER)).toThrow(/nobody is waiting/);
    const n = joinNewPlayer(s, { ...DEFAULT_PLAYER, name: 'Aki Mori' });
    expect(n.playerId).not.toBe(old);
    expect(Object.values(n.characters).filter((c) => c.isPlayer).map((c) => c.id)).toEqual([n.playerId]);
    expect(n.rel['mio'][n.playerId]).toMatchObject({ affinity: 0, romance: 0, trust: 25 });
    expect(n.world.flags[`new_${n.playerId}`]).toBe(n.world.episode);
    // greeted at the door when the evening comes
    let t = n;
    while (t.world.slot !== 'evening') t = finishSlot(planSlot(t, { type: 'idle' }).state);
    const { plan } = planSlot(t, { type: 'idle' });
    expect(plan.scenes.some((sc) => sc.event.templateId === 'arrival-intro' && sc.event.participants.includes(n.playerId))).toBe(true);
  });

  it('graduating "with" someone who is not your partner means leaving alone', () => {
    let s = createGame({ seed: 5 });
    s.world.slot = 'slot1';
    s = finishSlot(planSlot(s, { type: 'graduate', with: 'ren' }).state);
    expect(s.characters.ren.status).toBe('inHouse');
    expect(s.awaitingPlayer).toBe(true);
  });

  it('whoever leaves is replaced, right up to the last episode', () => {
    const s = createGame({ seed: 5, seasonLength: 10 });
    s.world.episode = 9;
    markLeaving(s, 'kaito', 'left');
    depart(s, s.characters.kaito);
    expect(s.pendingArrivals).toEqual([{ gender: 'man', ep: 9 }]);
    expect(housemates(s).length).toBe(5);
  });
});
