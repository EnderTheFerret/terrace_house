import { describe, expect, it } from 'vitest';
import { eventTemplate } from '../content';
import { mulberry32 } from '../rng';
import { chooseAction, routineNow, weeklyRoutine } from './agents';
import { evalCond } from './conditions';
import { housemates, rel, traitsOf } from './core';
import { soberUp } from './drink';
import { followUpsDue, planConflict, queueFollowUps, sendFollowUp } from './living';
import { createGame, makeEvent, resolveScene } from './loop';

const empty = () => ({ affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [], moodDeltas: [] });

describe('the morning after and a bad shift', () => {
  it('bonds people who got drunk together, tells the house, and a sober orderly housemate is less impressed', () => {
    const s = createGame({ seed: 5 });
    s.world.episode = 3;
    const [a, b, c] = housemates(s).filter((h) => !h.isPlayer);
    for (const x of [a, b]) { x.drunkPeak = 2; s.world.flags[`drank_${x.id}`] = '3:evening'; }
    c.persona.traits[1] = 0.9; // conscientious, and stayed sober
    const before = { close: rel(s, a.id, b.id).closeness, judge: rel(s, c.id, a.id).affinity };
    soberUp(s, true);
    expect(rel(s, a.id, b.id).closeness).toBe(before.close + 3);
    expect(a.hangover).toBe(1);
    const fact = Object.values(s.facts).find((f) => f.subject === a.id && f.content.includes('paying for it'))!;
    expect(s.knowledge[c.id][fact.id].source).toBe('witnessed');
    expect(traitsOf(c).C).toBeGreaterThanOrEqual(0.7);
    expect(rel(s, c.id, a.id).affinity).toBe(before.judge - 1);
  });

  it('makes a mishap likelier when hungover, and close housemates hear about the shift', () => {
    const s = createGame({ seed: 5 });
    const P = s.playerId;
    expect(evalCond(s, { chance: 0, hungoverChance: 1 }, { a: P }, mulberry32(1), [])).toBe(false);
    s.characters[P].hangover = 1;
    expect(evalCond(s, { chance: 0, hungoverChance: 1 }, { a: P }, mulberry32(1), [])).toBe(true);
    const [close, far] = housemates(s).filter((h) => !h.isPlayer);
    rel(s, P, close.id).closeness = 30;
    rel(s, P, far.id).closeness = 0;
    const ev = makeEvent(s, eventTemplate('job-mishap'), { a: P }, 'konbini');
    const n = resolveScene(s, ev, {}, {}).state;
    const fact = Object.values(n.facts).find((f) => f.subject === P && f.content.includes('rough shift'))!;
    expect(fact.content).toContain('while hungover');
    expect(n.knowledge[close.id][fact.id]).toMatchObject({ source: 'told', from: P });
    expect(n.knowledge[far.id]?.[fact.id]).toBeUndefined();
  });
});

describe('follow-up texts', () => {
  it('queues a text from someone who clearly enjoyed the scene, sends it once, and not again that day', () => {
    const s = createGame({ seed: 5 });
    const P = s.playerId;
    const [fan, meh] = housemates(s).filter((h) => !h.isPlayer);
    const ev = { participants: [P, fan.id, meh.id], location: 'backyard', title: 'a conversation in the pool' };
    queueFollowUps(s, ev, { ...empty(), affinityDeltas: [{ from: fan.id, to: P, delta: 4 }, { from: meh.id, to: P, delta: 1 }] });
    expect(followUpsDue(s)).toEqual([{ id: fan.id, title: 'a conversation in the pool', place: 'backyard', romance: false }]);
    const sent = sendFollowUp(s, fan.id, 'that was fun at the pool earlier');
    expect(sent.chats[[P, fan.id].sort().join('|')].at(-1)).toMatchObject({ from: fan.id, text: 'that was fun at the pool earlier' });
    expect(followUpsDue(sent)).toEqual([]);
    queueFollowUps(sent, ev, { ...empty(), affinityDeltas: [{ from: fan.id, to: P, delta: 5 }] });
    expect(followUpsDue(sent)).toEqual([]);
  });
});

describe('weekly routines', () => {
  it('gives everyone one fixed weekly thing; plans on it clash unless they join them there', () => {
    const s = createGame({ seed: 5 });
    const c = housemates(s).find((h) => !h.isPlayer && !h.persona.keepsShabbat && !h.persona.routine.jobSlots.length) ?? housemates(s).find((h) => !h.isPlayer)!;
    c.persona.routine.jobSlots = [];
    const r = weeklyRoutine(c);
    expect(weeklyRoutine(structuredClone(c))).toEqual(r);
    if (c.persona.keepsShabbat) expect(r.weekday === 5 && r.slot === 'evening').toBe(false);
    // find an episode that falls on the routine's weekday
    const ep = Array.from({ length: 7 }, (_, i) => s.world.episode + 1 + i).find((e) => (s.world.weekday + e - s.world.episode) % 7 === r.weekday)!;
    const other = r.node === 'cafe' ? 'beach' : 'cafe';
    expect(planConflict(s, c.id, { node: other, episode: ep, slot: r.slot })).toContain(r.what);
    expect(planConflict(s, c.id, { node: r.node, episode: ep, slot: r.slot })).toBe('');
  });

  it('sends them out to it when it comes round, and the house learns the habit', () => {
    const s = createGame({ seed: 5 });
    const c = housemates(s).find((h) => !h.isPlayer)!;
    c.persona.routine.jobSlots = [];
    c.persona.keepsShabbat = false;
    const r = weeklyRoutine(c);
    Object.assign(s.world, { episode: 4, weekday: r.weekday, slot: r.slot, weather: 'sunny' });
    expect(routineNow(s, c)).toEqual(r);
    expect(chooseAction(s, mulberry32(1), c)).toMatchObject({ kind: 'goOut', node: r.node });
    expect(s.observedRoutines[c.id].some((t) => t.startsWith(r.what))).toBe(true);
  });
});
