import { describe, expect, it } from 'vitest';
import { INTENTS, type Intent } from '../model';
import { mulberry32 } from '../rng';
import { mockReply } from '../gen/mock';
import { classifyIntent, inviteDecision, recordChat, recordPlayerWords, typedResponders } from './talk';
import { blockOver, createGame, finishSlot, joinNewPlayer, passTime, planSlot } from './loop';
import { DEFAULT_PLAYER, editPlayer } from './castgen';
import { depart, markLeaving } from './leave';
import { housemates, MINUTES_PER_LINE } from './core';

const all = [...INTENTS] as Intent[];

describe('group conversations', () => {
  it('routes typed words to whoever is addressed and lets the group chime in', () => {
    const s = createGame({ seed: 1 });
    const group = [s.playerId, 'ren', 'mio', 'kaito'];
    const name = (id: string) => s.characters[id].name.split(' ')[0];
    const said = [{ speaker: 'mio' }];
    expect(typedResponders(s, group, said, 'that sounds fun')[0]).toBe('mio');
    expect(typedResponders(s, group, said, `${name('kaito')}, what do you think?`)[0]).toBe('kaito');
    expect(typedResponders(s, group, said, `${name('ren')} and ${name('kaito')}, come with us`)).toEqual(['ren', 'kaito']);
    const [first, chimer] = typedResponders(s, group, said, 'what are you guys doing tonight?');
    expect(first).toBe('mio');
    expect(chimer && chimer !== 'mio' && group.includes(chimer)).toBe(true);
    expect(typedResponders(s, [s.playerId, 'ren'], [], 'hey everyone')).toEqual(['ren']);
    expect(typedResponders(s, group, said, `${name('kaito')}, ${name('mio')}, ${name('ren')}: thoughts?`)).toEqual(['kaito', 'mio', 'ren']);
    expect(new Set(typedResponders(s, group, said, 'hello everyone')).size).toBe(3);
    s.characters.kaito.lastAction = 'sleep';
    expect(typedResponders(s, group, said, 'hello everyone')).not.toContain('kaito');
  });
});

describe('invitations', () => {
  it('a housemate who likes you, and is free, says yes; one who is busy or cold says no', () => {
    const s = createGame({ seed: 1 });
    const id = 'ren';
    s.characters[id].lastAction = 'wander';
    s.rel[id][s.playerId].affinity = 60;
    expect(inviteDecision(s, id, [], { date: false, seed: 'a' }).accept).toBe(true);
    s.characters[id].lastAction = 'work';
    expect(inviteDecision(s, id, [], { date: false, seed: 'a' })).toMatchObject({ accept: false });
    s.characters[id].lastAction = 'wander';
    s.rel[id][s.playerId].affinity = -80;
    expect(inviteDecision(s, id, [{ speaker: id, text: 'I hate this, shut up' }], { date: false, seed: 'a' }).accept).toBe(false);
  });
  it('a date needs romance and interest in you', () => {
    const s = createGame({ seed: 1 });
    const c = s.characters.ren;
    c.lastAction = 'wander';
    c.interestedIn = [];
    expect(inviteDecision(s, 'ren', [], { date: true, seed: 'a' }).accept).toBe(false);
    c.interestedIn = [s.characters[s.playerId].gender];
    s.rel.ren[s.playerId].affinity = 50;
    s.rel.ren[s.playerId].romance = 70;
    expect(inviteDecision(s, 'ren', [], { date: true, seed: 'a' }).accept).toBe(true);
  });
});

describe('editing your character', () => {
  it('changes job, home town and looks mid-season and drops the sampled palette', () => {
    const s = createGame({ seed: 1 });
    s.characters[s.playerId].appearance.palette = { hair: '#111111', skin: '#222222', outfit: '#333333' };
    const e = editPlayer(s, { occupation: 'fisherman', hometown: 'Jaffa', appearance: { ...s.characters[s.playerId].appearance, hairColor: 'silver' } });
    const me = e.characters[e.playerId];
    expect(me).toMatchObject({ occupation: 'fisherman', hometown: 'Jaffa' });
    expect(me.appearance.hairColor).toBe('silver');
    expect(me.appearance.palette).toBeUndefined();
    expect(me.persona.backstory).toContain('fisherman');
    expect(s.characters[s.playerId].occupation).not.toBe('fisherman'); // the input is untouched
    expect(() => editPlayer(s, { age: 12 })).toThrow(/20/);
  });
});

describe('typed talk', () => {
  it('never appends an arbitrary echoed word to a fallback reply', () => {
    const s = createGame({ seed: 1 });
    for (let seed = 0; seed < 50; seed++) {
      const reply = mockReply(s, mulberry32(seed), 'kaito', { text: "We're already filmed. Anyone want coffee?", intent: 'joke' });
      expect(reply).not.toMatch(/About \w+\.\.\. yeah|^Already\?/i);
    }
  });
  it('reads an intent from free text, limited to what the scene offers', () => {
    expect(classifyIntent('I really like you. I have for weeks.', all)).toBe('confess');
    expect(classifyIntent("I'm sorry about yesterday, that was my fault", all)).toBe('apologize');
    expect(classifyIntent('Why did you tell everyone? That is not okay.', all)).toBe('confront');
    expect(classifyIntent('you look really nice today', all)).toBe('flirt');
    expect(classifyIntent('haha you are ridiculous lol', all)).toBe('joke');
    expect(classifyIntent('what happened? tell me', all)).toBe('listen');
    expect(classifyIntent('I like you', ['joke', 'listen'])).toBe('listen'); // confess not offered → a safe offered intent
    expect(classifyIntent('No, I do not want to go on a date. Please respect that.', all)).toBe('decline');
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

describe('time in a block', () => {
  it('keeps conversation participants present when their activity expires', () => {
    const s = createGame({ seed: 3 });
    s.characters.mio.location = 'living';
    s.characters.mio.lastAction = 'hangout';
    s.characters.mio.activityUntil = 0;
    const talked = passTime(s, 25, [s.playerId, 'mio']);
    expect(talked.characters.mio.location).toBe('living');
    expect(talked.characters.mio.lastAction).toBe('hangout');
    expect(talked.world.minutes).toBe(150);
    expect(Object.values(talked.characters).some(c => !c.isPlayer && c.id !== 'mio' && c.activityUntil > 0)).toBe(true);
  });

  it('talk lasts as long as the conversation; short actions do not repeat the block needs decay', () => {
    const s0 = createGame({ seed: 3 });
    s0.world.slot = 'slot1';
    // Ren has an unfinished activity; other housemates may now independently replan at their deadlines.
    s0.characters.ren.lastAction = 'hobby'; s0.characters.ren.activityUntil = 180;
    const first = planSlot(s0, { type: 'talk', target: 'mio' }).state;
    expect(blockOver(first)).toBe(false);
    const talked = passTime(first, 8);
    expect(talked.world.minutes).toBe(first.world.minutes + 8 * MINUTES_PER_LINE);
    // a second action in the same block: NPCs keep what they were doing, needs don't decay again
    const second = planSlot(talked, { type: 'house', activity: 'hangout' }).state;
    expect(second.characters.ren.needs).toEqual(talked.characters.ren.needs);
    expect(second.world.slot).toBe('slot1');
    const out = planSlot(second, { type: 'goOut', node: 'konbini', activity: 'shop' }).state;
    expect(blockOver(out)).toBe(true);
    const next = finishSlot(out);
    expect([next.world.slot, next.world.minutes]).toEqual(['slot2', 0]);
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

describe('local emotion read (S7)', () => {
  it('reads typed lines and picks the listener face', async () => {
    const { feltEmotion, reactionTo } = await import('./talk');
    expect(feltEmotion('I think I like you')).toBe('shy');
    expect(feltEmotion('you ate my food again? seriously?')).toBe('annoyed');
    expect(feltEmotion('I miss home so much')).toBe('sad');
    expect(feltEmotion('what are you doing tonight')).toBeNull();
    expect(reactionTo('I love you')).toBe('shy');
    expect(reactionTo('I hate this, liar')).toBe('annoyed');
  });
});
