import { describe, expect, it } from 'vitest';
import { createGame } from './loop';
import { rel } from './core';
import { applyFavor, favorDecision, missionsToTexts, proposedFavor, queueFavor, readyReports, reportBeats, runMissions, tellMissions, type Favor } from './matchmaker';

/** ren = helper (close to the player, outgoing), mio and kaito = the other two; everyone attracted to everyone. */
function setup() {
  const s = createGame({ seed: 1 });
  const P = s.playerId;
  const [h, a, b] = ['ren', 'mio', 'kaito'];
  for (const id of [h, a, b, P]) { s.characters[id].interestedIn = ['man', 'woman', 'nonbinary'] as never; s.characters[id].status = 'inHouse'; s.characters[id].lastAction = 'wander'; }
  Object.assign(s.characters[h].persona, { gossipiness: 0.6, attachment: 'secure' });
  s.characters[h].persona.traits = [0.5, 0.4, 0.85, 0.6, 0.2];
  Object.assign(rel(s, h, P), { affinity: 60, trust: 60, romance: 0 });
  return { s, P, h, a, b };
}
const match = (a: string, b: string): Favor => ({ kind: 'match', a, b });
const snoop = (a: string, b: string): Favor => ({ kind: 'snoop', a, b });

describe('play matchmaker / snoop around', () => {
  it('an outgoing close friend agrees; a shy one, a stranger or a busy one does not', () => {
    const { s, P, h, a } = setup();
    expect(favorDecision(s, h, match(P, a), 'x').accept).toBe(true);
    s.characters[h].persona.traits = [0.5, 0.5, 0.15, 0.5, 0.8];
    expect(favorDecision(s, h, match(P, a), 'x')).toMatchObject({ accept: false, reason: expect.stringContaining('shy') });
    s.characters[h].persona.traits = [0.5, 0.4, 0.85, 0.6, 0.2];
    rel(s, h, P).affinity = 5;
    expect(favorDecision(s, h, match(P, a), 'x').reason).toContain('close enough');
    rel(s, h, P).affinity = 60;
    s.characters[h].lastAction = 'sleep';
    expect(favorDecision(s, h, match(P, a), 'x').accept).toBe(false);
  });

  it('the helper is never one of the people it is about', () => {
    const { s, P, h, a } = setup();
    expect(favorDecision(s, h, match(P, h), 'x')).toMatchObject({ accept: false });
    expect(favorDecision(s, h, snoop(h, a), 'x')).toMatchObject({ accept: false });
  });

  it('snooping needs a nosy helper: a private, careful one will not pry', () => {
    const { s, P, h, a } = setup();
    expect(favorDecision(s, h, snoop(P, a), 'x').accept).toBe(true);
    s.characters[h].persona.traits = [0.5, 0.5, 0.1, 0.5, 0.9];
    expect(favorDecision(s, h, snoop(P, a), 'x')).toMatchObject({ accept: false, reason: expect.stringContaining('shy') });
    s.characters[h].persona.gossipiness = 0;
    s.characters[h].persona.traits = [0.5, 0.95, 0.1, 0.5, 0.5];
    expect(favorDecision(s, h, snoop(P, a), 'x')).toMatchObject({ accept: false, reason: expect.stringContaining('pry') });
  });

  it('putting in a good word warms the target to the player, and matching two housemates warms both ways', () => {
    const { s, P, h, a, b } = setup();
    const before = rel(s, a, P).affinity;
    const d = favorDecision(s, h, match(P, a), 'x');
    const out = applyFavor(s, h, match(P, a), d, 'x');
    expect(rel(out.state, a, P).affinity).toBeGreaterThan(before);
    expect(rel(out.state, a, P).romance).toBeGreaterThan(0);
    // a second ask on the same day is refused
    expect(favorDecision(queueFavor(s, h, match(P, a), d, 'x').state, h, match(P, a), 'y')).toMatchObject({ accept: false, reason: 'already did that today' });
    const pair = applyFavor(s, h, match(a, b), favorDecision(s, h, match(a, b), 'x'), 'x');
    expect(rel(pair.state, a, b).romance).toBeGreaterThan(0);
    expect(rel(pair.state, b, a).romance).toBeGreaterThan(0);
  });

  it('snooping reports the target\'s real feelings', () => {
    const { s, P, h, a, b } = setup();
    Object.assign(rel(s, h, a), { affinity: 60, trust: 60 });
    Object.assign(rel(s, a, P), { romance: 60, affinity: 50 });
    const out = applyFavor(s, h, snoop(P, a), favorDecision(s, h, snoop(P, a), 'x'), 'x');
    expect(out.note).toContain('crazy about you');
    Object.assign(rel(s, h, b), { affinity: 60, trust: 60 });
    Object.assign(rel(s, a, b), { romance: 50 });
    Object.assign(rel(s, b, a), { romance: 0, affinity: 0 });
    const pair = applyFavor(s, h, snoop(a, b), favorDecision(s, h, snoop(a, b), 'x'), 'x');
    expect(pair.note).toMatch(/crazy about|interested in/);
    expect(pair.note).toContain("doesn't think about");
  });

  describe('love triangles', () => {
    it('a helper in love with the player refuses to set them up (unless very kind), or it stings', () => {
      const { s, P, h, a } = setup();
      s.characters[h].persona.traits = [0.5, 0.4, 0.85, 0.3, 0.2];
      rel(s, h, P).romance = 50;
      const d = favorDecision(s, h, match(P, a), 'x');
      expect(d).toMatchObject({ accept: false, reason: expect.stringContaining('feelings for you') });
      s.characters[h].persona.traits = [0.5, 0.4, 0.85, 0.95, 0.2];
      const hurtSeed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].find((k) => favorDecision(s, h, match(P, a), k).accept)!;
      expect(hurtSeed).toBeDefined();
      const hurt = favorDecision(s, h, match(P, a), hurtSeed);
      const tension = rel(s, h, P).tension;
      expect(rel(applyFavor(s, h, match(P, a), hurt, hurtSeed).state, h, P).tension).toBeGreaterThan(tension);
    });

    it('a helper who likes the target may quietly sabotage: no good word, or a downplayed snoop report', () => {
      const { s, P, h, a } = setup();
      s.characters[h].persona.traits = [0.5, 0.4, 0.85, 0.1, 0.2];
      rel(s, h, a).romance = 60;
      const seed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].find((k) => !favorDecision(s, h, snoop(P, a), k).honest)!;
      expect(seed).toBeDefined();
      Object.assign(rel(s, a, P), { romance: 60, affinity: 50 });
      const d = favorDecision(s, h, snoop(P, a), seed);
      expect(applyFavor(s, h, snoop(P, a), d, seed).note).toContain("doesn't think about you");
      const before = rel(s, a, P).affinity;
      const m = favorDecision(s, h, match(P, a), seed);
      expect(rel(applyFavor(s, h, match(P, a), { ...m, honest: false }, seed).state, a, P).affinity).toBe(before);
    });

    it('a target already taken by someone else: the helper warns, or refuses to wreck a couple', () => {
      const { s, P, h, a, b } = setup();
      s.couples.push({ a, b, since: 1, status: 'dating' });
      expect(favorDecision(s, h, match(P, a), 'x')).toMatchObject({ accept: false, reason: expect.stringContaining('come between') });
      expect(applyFavor(s, h, snoop(P, a), favorDecision(s, h, snoop(P, a), 'x'), 'x').brief).toContain('is with');
    });

    it('matching a housemate who secretly likes the player can hurt them, and the snoop reveals it', () => {
      const { s, P, h, a, b } = setup();
      Object.assign(rel(s, a, P), { romance: 50, affinity: 50 });
      s.characters[h].persona.gossipiness = 1;
      const out = applyFavor(s, h, match(a, b), favorDecision(s, h, match(a, b), 'x'), 'x');
      expect(rel(out.state, a, P).tension).toBeGreaterThan(rel(s, a, P).tension);
      Object.assign(rel(s, h, a), { affinity: 60, trust: 60 });
      expect(applyFavor(s, h, snoop(a, b), favorDecision(s, h, snoop(a, b), 'x'), 'x').brief).toContain('keeps asking about the player');
    });

    it('an interested rival hears about the push and turns on the player', () => {
      const { s, P, h, a, b } = setup();
      Object.assign(rel(s, a, b), { romance: 60 });
      s.characters[h].persona.gossipiness = 1;
      const out = applyFavor(s, h, match(P, a), favorDecision(s, h, match(P, a), 'x'), 'x');
      expect(rel(out.state, b, P).tension).toBeGreaterThan(rel(s, b, P).tension);
    });
  });

  describe('off-screen missions', () => {
    const ask = (s: ReturnType<typeof setup>['s'], h: string, f: Favor, seed = 'x') => queueFavor(s, h, f, favorDecision(s, h, f, seed), seed);

    it('are queued for the next block, then done and reported by the helper, who comes up to the player', () => {
      const { s, P, h, a } = setup();
      s.world.slot = 'slot1';
      s.characters[P].location = 'living';
      s.characters[h].location = 'living';
      const q = ask(s, h, match(P, a));
      expect(q.note).toContain('get back to you');
      expect(rel(q.state, a, P).affinity).toBe(rel(s, a, P).affinity); // nothing has happened yet
      const t = q.state;
      expect(t.missions[0]).toMatchObject({ status: 'pending', dueSlot: 'slot2', dueEpisode: t.world.episode });
      runMissions(t); // still the same block
      expect(t.missions[0].status).toBe('pending');
      t.world.slot = 'slot2';
      runMissions(t);
      expect(t.missions[0].status).toBe('ready');
      expect(rel(t, a, P).affinity).toBeGreaterThan(rel(s, a, P).affinity);
      expect(t.approaches.some((x) => x.from === h)).toBe(true);
      expect(readyReports(t, [P, h])).toHaveLength(1);
      expect(reportBeats(t, readyReports(t, [P, h]), [P, h])[0]).toMatchObject({ speaker: h, beatType: 'reveal' });
      const told = tellMissions(t, [t.missions[0].id]);
      expect(told.missions[0].status).toBe('told');
      expect(told.approaches.some((x) => x.from === h)).toBe(false);
    });

    it('wait for a busy helper, fizzle if they have left, and arrive as a text when the player was never told in person', () => {
      const { s, P, h, a } = setup();
      s.characters[P].location = 'living';
      s.characters[h].location = 'living';
      const t = ask(s, h, snoop(P, a)).state;
      t.world.slot = 'lateNight';
      t.world.episode += 1; // well past due
      t.characters[h].lastAction = 'sleep';
      runMissions(t);
      expect(t.missions[0].status).toBe('pending');
      t.characters[h].lastAction = 'hobby';
      runMissions(t);
      expect(t.missions[0].status).toBe('ready');
      missionsToTexts(t);
      expect(t.missions[0].status).toBe('told');
      expect(t.chats[[h, P].sort().join('|')].at(-1)?.text).toContain('Update on what you asked');
      const gone = ask(setup().s, h, snoop(P, a)).state;
      gone.world.episode += 1;
      gone.characters[a].status = 'left';
      runMissions(gone);
      expect(gone.missions[0].status).toBe('told');
    });

    it('a helper may bring a willing friend along, and then both report', () => {
      const { s, P, h, a, b } = setup();
      const friend = Object.keys(s.characters).find((id) => ![P, h, a, b].includes(id) && s.characters[id].status === 'inHouse')!;
      s.characters[friend].persona.traits = [0.5, 0.4, 0.9, 0.6, 0.2];
      s.characters[friend].lastAction = 'hobby';
      Object.assign(rel(s, h, friend), { affinity: 60 });
      s.characters[h].persona.traits = [0.5, 0.4, 0.5, 0.6, 0.4]; // less sure: leans on backup
      const seed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].find((k) => ask(s, h, match(P, a), k).state.missions[0].partner === friend);
      expect(seed).toBeDefined();
      const t = ask(s, h, match(P, a), seed).state;
      t.world.episode += 1;
      s.characters[P].location = 'living';
      t.characters[P].location = 'living';
      t.characters[h].location = 'living';
      runMissions(t);
      expect(t.approaches.find((x) => x.from === h)?.text).toContain(t.characters[friend].name.split(' ')[0]);
      const beats = reportBeats(t, readyReports(t, [P, h]), [P, h, friend]);
      expect(beats.map((x) => x.speaker)).toEqual([h, friend]);
    });
  });

  it('reads a request typed in the player\'s own words', () => {
    const { s, P, h, a, b } = setup();
    const n = (id: string) => s.characters[id].name.split(' ')[0];
    expect(proposedFavor(s, `Can you play matchmaker for me and ${n(a)}?`, h)).toEqual({ kind: 'match', a: P, b: a });
    expect(proposedFavor(s, `Could you set ${n(a)} up with ${n(b)}?`, h)).toEqual({ kind: 'match', a, b });
    expect(proposedFavor(s, `Can you find out if ${n(a)} likes me?`, h)).toEqual({ kind: 'snoop', a: P, b: a });
    expect(proposedFavor(s, `Snoop around: does ${n(a)} have a thing for ${n(b)}?`, h)).toEqual({ kind: 'snoop', a, b });
    expect(proposedFavor(s, `Check out the new cafe with me`, h)).toBeNull();
    expect(proposedFavor(s, `how was your day?`, h)).toBeNull();
  });
});
