import { describe, expect, it } from 'vitest';
import { eventTemplate } from '../content';
import { GameState } from '../model';
import { mockBeatSheet } from '../gen/mock';
import { mulberry32 } from '../rng';
import { DEFAULT_PLAYER } from './castgen';
import { addFact, addMemory, housemates, learn, rel } from './core';
import { candidates } from './director';
import { epilogueFor } from './epilogue';
import { agreesToLeave, askBack, depart, departLeaving, evaluateLeaves, invitePartnerToLeave, leaveReasons, markLeaving, processArrivals, RETURN_AFTER } from './leave';
import { settlePlans, startPlans } from './living';
import { nameMemories } from './relationships';
import { createGame, finishSlot, joinNewPlayer, makeEvent, planSlot, resolveScene } from './loop';
import { resolveConfession } from './outcome';
import { pastResidents, returningResident } from './outsiders';

function couple(a = 'ren', b = 'mio') {
  const s = createGame({ seed: 5 });
  s.world.episode = 6;
  for (const c of housemates(s)) c.contractEp = 999;
  s.couples.push({ a, b, since: 2, status: 'dating' });
  for (const [from, to] of [[a, b], [b, a]]) Object.assign(rel(s, from, to), { affinity: 60, romance: 80, tension: 0 });
  return s;
}

describe('mutual graduation', () => {
  it('lets settled couples stay, including residents with no fixed departure', () => {
    const s = couple();
    expect(leaveReasons(s, s.characters.ren)).toEqual([]);
    expect(evaluateLeaves(s, mulberry32(5))).toEqual([]);
    s.world.episode = 1000;
    expect(leaveReasons(s, s.characters.ren)).toEqual([]);
    expect(epilogueFor(s, s.characters.ren)).toContain('stayed until the final episode');
    expect(epilogueFor(s, s.characters.ren)).not.toContain('left together');
  });

  it('lets one partner stay without breaking up or booking a replacement for them', () => {
    const s = couple();
    s.characters.ren.contractEp = 6;
    expect(evaluateLeaves(s, mulberry32(5))).toEqual(['ren']);
    expect(s.world.flags.leaving_mio).toBeUndefined();
    expect(s.log.at(-1)?.text).toContain('wants to stay');
    s.world.episode += 2;
    departLeaving(s);
    expect(s.characters.ren.status).toBe('left');
    expect(s.characters.mio.status).toBe('inHouse');
    expect(s.couples[0].status).toBe('dating');
    expect(s.pendingArrivals).toHaveLength(1);
    expect(epilogueFor(s, s.characters.ren)).toContain('Still dating');
  });

  it('departs together only when both are ready, retaining dating status until the farewell', () => {
    const s = couple();
    s.characters.ren.contractEp = s.characters.mio.contractEp = 6;
    expect(new Set(evaluateLeaves(s, mulberry32(5)))).toEqual(new Set(['ren', 'mio']));
    expect(s.couples[0].status).toBe('dating');
    expect(s.log.filter((l) => l.text.includes('both agreed'))).toHaveLength(1);
    s.world.episode += 2;
    departLeaving(s);
    expect(s.couples[0].status).toBe('left-together');
    expect(s.pendingArrivals).toHaveLength(2);
    expect(epilogueFor(s, s.characters.ren)).toContain('left together');
  });

  it('does not interpret yes to a last-day confession as consent to leave', () => {
    const s = couple();
    s.couples = [];
    markLeaving(s, 'ren', 'graduating');
    s.characters.mio.interestedIn = ['man'];
    expect(resolveConfession(s, mulberry32(5), 'ren', 'mio', {})).toBe('accepted');
    expect(s.couples[0].status).toBe('dating');
    expect(s.world.flags.leaving_mio).toBeUndefined();
  });

  it('lets a player accept or decline a leaver invitation explicitly', () => {
    const s = couple('ren', 'player');
    s.characters.ren.contractEp = 6;
    evaluateLeaves(s, mulberry32(5));
    expect(s.world.flags.canGraduate).toBe('ren');
    expect(s.world.flags.leaving_player).toBeUndefined();
    const alone = finishSlot(planSlot(s, { type: 'graduate' }).state);
    expect(alone.characters.ren.status).toBe('inHouse');
    const together = finishSlot(planSlot(s, { type: 'graduate', with: 'ren' }).state);
    expect(together.characters.ren.status).toBe('left');
    expect(together.characters.player.status).toBe('left');
    expect(together.couples[0].status).toBe('left-together');
  });

  it('lets an NPC decline the player and rejects tense or one-sided departure requests', () => {
    const s = couple('player', 'ren');
    const n = finishSlot(planSlot(s, { type: 'graduate', with: 'ren' }).state);
    expect(n.characters.player.status).toBe('left');
    expect(n.characters.ren.status).toBe('inHouse');
    expect(n.couples[0].status).toBe('dating');
    s.characters.ren.contractEp = 6;
    rel(s, 'ren', 'player').tension = 80;
    expect(agreesToLeave(s, 'ren', 'player')).toBe(false);
    rel(s, 'ren', 'player').tension = 0;
    rel(s, 'ren', 'player').romance = 5;
    expect(agreesToLeave(s, 'ren', 'player')).toBe(false);
  });

  it('requires the NPC initiating the departure to want the partnership too', () => {
    const s = couple();
    s.characters.mio.contractEp = 6;
    rel(s, 'ren', 'mio').romance = 5;
    markLeaving(s, 'ren', 'graduating');
    expect(invitePartnerToLeave(s, 'ren')).toBeNull();
    expect(s.world.flags.leaving_mio).toBeUndefined();
  });

  it('removes an expired player invitation when the leaver departs', () => {
    const s = couple('ren', 'player');
    markLeaving(s, 'ren', 'graduating');
    invitePartnerToLeave(s, 'ren');
    depart(s, s.characters.ren);
    expect(s.world.flags.canGraduate).toBeUndefined();
  });
});

describe('graduates moving back', () => {
  function gone(id = 'ren') {
    const s = createGame({ seed: 5 });
    for (const c of housemates(s)) c.contractEp = 999;
    s.world.episode = 3;
    markLeaving(s, id, 'decided the house was not for them');
    depart(s, s.characters[id]);
    s.pendingArrivals = [];
    s.world.episode = 3 + RETURN_AFTER;
    return s;
  }

  it('lets the player ask a graduate back once a same-gender housemate is leaving, and they take that room', () => {
    const s = gone();
    for (const k of ['affinity', 'trust'] as const) rel(s, 'ren', s.playerId)[k] = 40;
    expect(() => askBack(s, 'ren')).toThrow(/no room/);
    const leaver = housemates(s).find((c) => !c.isPlayer && c.gender === s.characters.ren.gender)!;
    markLeaving(s, leaver.id, 'reached the end of their stay');
    const asked = askBack(s, 'ren');
    expect(asked.world.flags[`askedBack_${s.characters.ren.gender}`]).toBe('ren');
    expect(asked.chats[[s.playerId, 'ren'].sort().join('|')].at(-1)?.text).toMatch(/I'm in/);
    depart(asked, asked.characters[leaver.id]);
    expect(asked.pendingArrivals.at(-1)).toMatchObject({ returning: 'ren' });
    const arrived = processArrivals(asked, mulberry32(1));
    expect(arrived.map((c) => c.id)).toEqual(['ren']);
    const ren = asked.characters.ren;
    expect(ren).toMatchObject({ status: 'inHouse', returnedEp: asked.world.episode, location: 'entrance' });
    expect(ren.returnReason).toContain('asked them to come back');
    expect(leaveReasons(asked, ren)).toEqual([]); // no instant re-departure from the old contract or mood
    expect(asked.house.groupChat.members).toContain('ren');
    expect(asked.memory.ren.at(-1)?.text).toContain('moved back');
  });

  it('declines when they no longer like the player, and refuses graduates who only just left', () => {
    const s = gone();
    rel(s, 'ren', s.playerId).affinity = -30;
    s.pendingArrivals.push({ gender: s.characters.ren.gender, ep: s.world.episode });
    expect(askBack(s, 'ren').pendingArrivals[0].returning).toBeUndefined();
    s.world.episode = s.characters.ren.leftEp! + 1;
    expect(() => askBack(s, 'ren')).toThrow(/can't move back/);
  });

  it('sometimes comes back on their own, sooner for someone still in the house, with a "back" arrival scene', () => {
    const s = gone();
    const pull = housemates(s).find((c) => !c.isPlayer && s.characters.ren.interestedIn.includes(c.gender))!;
    rel(s, 'ren', pull.id).romance = 60;
    const backs = Array.from({ length: 20 }, (_, i) => {
      const t = structuredClone(s);
      t.pendingArrivals.push({ gender: t.characters.ren.gender, ep: t.world.episode });
      return processArrivals(t, mulberry32(i + 1))[0];
    }).filter((c) => c.id === 'ren');
    expect(backs.length).toBeGreaterThan(5);
    expect(backs[0].returnReason).toContain(`thinking about ${pull.name.split(' ')[0]}`);
    const t = structuredClone(s);
    t.pendingArrivals.push({ gender: t.characters.ren.gender, ep: t.world.episode, returning: 'ren' });
    processArrivals(t, mulberry32(1));
    for (const c of housemates(t)) if (c.id !== 'ren') t.world.flags[`introduced_${c.id}`] = true;
    t.world.slot = 'evening';
    const { plan } = planSlot(t, { type: 'idle' });
    const intro = plan.scenes.find((sc) => sc.event.templateId === 'arrival-intro' && sc.event.participants.includes('ren'))?.event;
    expect(intro?.title).toContain('is back');
    expect(intro?.premise).toContain('moving back in');
  });
});

describe('plans in texts and memories by name', () => {
  it('texts the player when a shared plan starts without them, and again when they no-show', () => {
    const s = createGame({ seed: 5 });
    s.world.episode = 2; s.world.slot = 'slot1'; s.world.weekday = 0;
    const friend = housemates(s).find((c) => !c.isPlayer && !c.persona.routine.jobSlots.some((j) => j.slot === 'slot1'))!;
    s.invitations.push({ id: 'plan-t', from: s.playerId, to: friend.id, episode: 2, slot: 'slot1', node: 'cafe', status: 'accepted' });
    startPlans(s);
    const thread = () => s.chats[[s.playerId, friend.id].sort().join('|')] ?? [];
    expect(thread().at(-1)?.text).toContain('Rothschild Coffee');
    settlePlans(s); // end of the block: the player stayed home
    expect(s.invitations[0].status).toBe('broken');
    expect(thread().at(-1)?.text).toMatch(/waited|sorry/);
  });

  it('writes model memories with real first names instead of ids', () => {
    const s = createGame({ seed: 5 });
    const empty = { affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], moodDeltas: [] };
    const [a, b] = housemates(s).filter((c) => !c.isPlayer);
    const cap = (id: string) => id[0].toUpperCase() + id.slice(1);
    const out = nameMemories(s, { ...empty, newMemories: [{ charId: a.id, text: `${cap(a.id)} and the player make plans; ${b.id} laughed.`, salience: 0.5 }] });
    const first = (id: string) => s.characters[id].name.split(' ')[0];
    expect(out.newMemories[0].text).toBe(`${first(a.id)} and ${first(s.playerId)} make plans; ${first(b.id)} laughed.`);
  });
});

function departedPlayer() {
  let s = createGame({ seed: 5 });
  addMemory(s, s.playerId, 'Mio and I cooked dinner together.', [s.playerId, 'mio'], 0.9);
  rel(s, s.playerId, 'mio').affinity = 61;
  s = finishSlot(planSlot(s, { type: 'graduate' }).state);
  s = joinNewPlayer(s, { ...DEFAULT_PLAYER, name: 'New Resident' });
  s.world.episode = 6;
  s.world.slot = 'evening';
  s.world.minutes = 0;
  for (const c of housemates(s)) {
    c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 180;
    delete s.world.flags[`new_${c.id}`];
  }
  s.world.flags.aired = s.world.episode - 2;
  return s;
}

describe('returning residents', () => {
  it('retains the old player, their memories and relationships through saving and a real visit plan', () => {
    const departed = departedPlayer();
    const relationship = structuredClone(departed.rel.player.mio);
    const s = GameState.parse(JSON.parse(JSON.stringify(departed)));
    expect(s.rel.player.mio).toEqual(relationship);
    expect(pastResidents(s).map((c) => c.id)).toEqual(['player']);
    // The slot loop must schedule the real saved character, not a fixed outsider identity.
    const planned = Array.from({ length: 100 }, (_, i) => planSlot({ ...structuredClone(s), rngState: i + 1 }, { type: 'idle' })).find((p) => p.plan.scenes.some((sc) => sc.event.templateId === 'former-housemate'))!;
    expect(planned).toBeDefined();
    const ev = planned.plan.scenes.find((sc) => sc.event.templateId === 'former-housemate')!.event;
    expect(ev.participants).toContain('player');
    expect(ev.participants).toContain(s.playerId);
    expect(ev.roles.a).toBe('player');
    expect(ev.premise).toContain('not a move-in');
    expect(planned.state.characters.player.status).toBe('left');
    expect(planned.state.memory.player.some((m) => m.text.includes('cooked dinner'))).toBe(true);
    expect(planned.state.rel.player.mio).toEqual(relationship);
    const sheet = mockBeatSheet(planned.state, mulberry32(1), ev).sheet;
    expect(sheet.beats.some((b) => b.speaker === 'player')).toBe(true);
    const finished = resolveScene(planned.state, ev, {}, {}).state;
    expect(finished.characters.player.status).toBe('left');
    expect(finished.house.groupChat.members).not.toContain('player');
    expect(finished.memory.player.some((m) => m.text.includes('rings the doorbell'))).toBe(true);
    const visitFact = Object.values(finished.facts).find((f) => f.content.startsWith(ev.title))!;
    expect(visitFact).toBeDefined();
    for (const id of ev.participants) expect(finished.knowledge[id][visitFact.id].source).toBe('witnessed');
    expect(finished.pendingArrivals).toEqual(planned.state.pendingArrivals);
  });

  it('has a departure/return cooldown and never substitutes current residents for the visitor', () => {
    const s = departedPlayer();
    s.world.episode = s.characters.player.leftEp! + 2;
    expect(returningResident(s, mulberry32(1), housemates(s))).toBeNull();
    s.world.episode = 6;
    const visit = Array.from({ length: 100 }, (_, i) => returningResident(s, mulberry32(i + 1), housemates(s))).find(Boolean);
    expect(visit?.guest.id).toBe('player');
    expect(returningResident(s, mulberry32(1), housemates(s))).toBeNull();
    s.world.episode++;
    expect(returningResident(s, mulberry32(1), housemates(s))).toBeNull();
    const currentOnly = createGame({ seed: 1 }); currentOnly.world.slot = 'evening';
    expect(returningResident(currentOnly, mulberry32(1), housemates(currentOnly))).toBeNull();
    expect(candidates(currentOnly, mulberry32(1), { location: 'living', pool: housemates(currentOnly), isPlayerScene: false }).some((c) => c.template.id === 'former-housemate')).toBe(false);
  });

  it('shares only known gossip, recording its source for the returning guest', () => {
    const s = departedPlayer();
    const fact = addFact(s, { subject: 'kaito', about: 'sora', kind: 'couple', content: 'Kai and Shira started dating.', truth: true, sensitivity: 0.6 });
    learn(s, 'mio', fact.id, 'witnessed');
    const hidden = addFact(s, { subject: 'ren', kind: 'world', content: 'A job nobody here knows about.', truth: true, sensitivity: 0.9 });
    const ev = makeEvent(s, eventTemplate('former-housemate'), { a: 'player', b: 'mio' }, 'living');
    const n = resolveScene(s, ev, {}, {}).state;
    const known = Object.keys(n.knowledge.player).map((id) => n.facts[id]);
    expect(known.some((f) => f.id === fact.id || f.parentId === fact.id)).toBe(true);
    const received = known.find((f) => f.id === fact.id || f.parentId === fact.id)!;
    expect(n.knowledge.player[received.id].from).toBe('mio');
    expect(n.knowledge.player[hidden.id]).toBeUndefined();
    expect(resolveScene(s, ev, {}, { player: 'deflect' }).state.knowledge.player[fact.id]).toBeUndefined();
  });

  it('plans NPC reunions while the player is away and keeps explicit talks with their chosen partner', () => {
    const s = departedPlayer();
    s.characters[s.playerId].location = 'cafe';
    const npcVisit = Array.from({ length: 100 }, (_, i) => planSlot({ ...structuredClone(s), rngState: i + 1 }, { type: 'idle' })).find((p) => p.plan.scenes.some((sc) => sc.event.templateId === 'former-housemate'))!;
    const ev = npcVisit.plan.scenes.find((sc) => sc.event.templateId === 'former-housemate')!.event;
    expect(ev.participants).not.toContain(s.playerId);
    expect(ev.participants).toContain('player');
    expect(ev.isPlayerScene).toBe(false);
    s.characters[s.playerId].location = 'living';
    s.arcs = {}; // Isolate visits from the existing arc director's scene substitutions.
    for (let seed = 1; seed <= 15; seed++) {
      const { plan } = planSlot({ ...structuredClone(s), rngState: seed }, { type: 'talk', target: 'ren' });
      const talk = plan.scenes.find((sc) => sc.event.isPlayerScene)!;
      expect(talk.event.participants).toContain('ren');
      expect(talk.event.templateId).not.toBe('former-housemate');
      const visit = plan.scenes.find((sc) => sc.event.templateId === 'former-housemate');
      if (visit) expect(visit.event.participants.some((id) => talk.event.participants.includes(id))).toBe(false);
    }
  });
});
