import { describe, expect, it } from 'vitest';
import { mulberry32, softmaxSample, hashSeed } from '../rng';
import { createGame, planSlot } from './loop';
import { sanitizeProposal, drama } from './relationships';
import { compactMemory } from './memory';
import { leaveReasons, evaluateLeaves } from './leave';
import { expectedDrama, scoreCandidate, varietyPenalty, pacingScore, candidates } from './director';
import { content, eventTemplate } from '../content';
import { cloneState, housemates, rel } from './core';
import type { MemoryItem } from '../model';
import { dayForEpisode, cityEventFor, chooseTyphoonDay, dateOf } from './calendar';
import { checkDynamics, generateCast, personaLike } from './castgen';
import { addPrediction, expirePredictions, pendingCallbacks, proposeCondition, recordCommentary, resolveOn } from './predictions';

describe('rng', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('state() resumes the sequence', () => {
    const a = mulberry32(7);
    a.next();
    const resumed = mulberry32(a.state());
    expect(resumed.next()).toBe(a.next());
  });
  it('softmax sampling favours higher scores', () => {
    const r = mulberry32(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[softmaxSample(r, [0, 1, 3])]++;
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[0]);
  });
  it('hashSeed is stable', () => expect(hashSeed('ren')).toBe(hashSeed('ren')));
});

describe('content', () => {
  it('loads with ≥25 non-system events and all required templates', () => {
    const c = content();
    expect(c.events.filter((e) => !e.system && !e.arcOnly).length).toBeGreaterThanOrEqual(25);
    for (const id of ['arrival-intro', 'chore-rota-conflict', 'late-night-kitchen', 'backyard-talk', 'shared-car-date', 'job-mishap', 'group-dinner', 'jealousy-after-date', 'confession-scenic', 'farewell-door', 'cook-for-someone', 'silent-breakfast', 'birthday', 'rainy-day', 'group-outing', 'chat-exchange'])
      expect(c.eventById.has(id), id).toBe(true);
    expect(c.events.filter((e) => e.domestic).length).toBeGreaterThanOrEqual(10);
    expect(c.archetypes.length).toBeGreaterThanOrEqual(12);
    expect(c.npcs.length).toBeGreaterThanOrEqual(8);
    expect(c.city.nodes.length).toBeGreaterThanOrEqual(14);
    expect(new Set(c.city.nodes.map((n) => n.district)).size).toBeGreaterThanOrEqual(2);
  });
  it('arc beats reference arc-only events', () => {
    for (const a of content().arcs) for (const b of a.beats) expect(eventTemplate(b.event).arcOnly).toBe(true);
  });
});

describe('calendar', () => {
  it('a year of consecutive episode days hits the local calendar, including a sharav heatwave', () => {
    const typhoon = chooseTyphoonDay(mulberry32(3), 365);
    expect(typhoon).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (let ep = 1; ep <= 365; ep++) {
      const e = cityEventFor(dayForEpisode(ep), typhoon);
      if (e) seen.add(e);
    }
    for (const id of ['purim', 'independence', 'shavuot', 'pride', 'beach-day', 'rosh-hashanah', 'sukkot', 'hanukkah', 'heatwave']) expect(seen.has(id), id).toBe(true);
    expect(dateOf(0)).toEqual({ month: 4, day: 1 });
  });
});

describe('delta clamping', () => {
  it('clamps to ±15, drops unknown ids and self-pairs, merges duplicates', () => {
    const p = sanitizeProposal(
      {
        affinityDeltas: [
          { from: 'a', to: 'b', delta: 40 },
          { from: 'a', to: 'b', delta: 10 },
          { from: 'a', to: 'a', delta: 5 },
          { from: 'x', to: 'b', delta: 5 },
          { from: 'b', to: 'a', delta: -99 },
        ],
        moodDeltas: [{ charId: 'a', delta: 3 }],
      },
      ['a', 'b'],
    );
    expect(p.affinityDeltas).toEqual([
      { from: 'a', to: 'b', delta: 15 },
      { from: 'b', to: 'a', delta: -15 },
    ]);
    expect(p.moodDeltas[0].delta).toBe(0.3);
  });
  it('garbage input yields an empty proposal', () => {
    const p = sanitizeProposal({ affinityDeltas: 'nope' }, ['a']);
    expect(p.affinityDeltas).toEqual([]);
  });
});

describe('memory compaction', () => {
  const mk = (tick: number, salience: number): MemoryItem => ({ episode: 1, tick, text: `m${tick}`, participants: [], salience });
  it('keeps top-k by salience × recency, chronological', () => {
    const items = Array.from({ length: 60 }, (_, i) => mk(i, i % 10 === 0 ? 1 : 0.1));
    const out = compactMemory(items, 60, 10);
    expect(out).toHaveLength(10);
    expect(out.every((m, i) => i === 0 || m.tick >= out[i - 1].tick)).toBe(true);
    // the very salient old memories survive
    expect(out.some((m) => m.tick === 0)).toBe(true);
  });
  it('is identity under budget', () => {
    const items = [mk(1, 0.2), mk(2, 0.3)];
    expect(compactMemory(items, 5, 10)).toBe(items);
  });
});

describe('director scoring', () => {
  const s = createGame({ seed: 5 });
  it('expected drama rises for tension-heavy events on hot pairs', () => {
    const t = eventTemplate('argument-blowup');
    const hot = cloneState(s);
    rel(hot, 'ren', 'kaito').tension = 70;
    const d = expectedDrama(hot, t, { a: 'ren', b: 'kaito' });
    expect(d).toBeGreaterThan(10);
  });
  it('variety penalizes recently used types', () => {
    const t = eventTemplate('backyard-talk');
    const s2 = cloneState(s);
    expect(varietyPenalty(s2, t)).toBe(0);
    s2.history.push({ templateId: t.id, type: t.type, tags: t.tags, episode: 1, tick: 0 });
    expect(varietyPenalty(s2, t)).toBeLessThan(0);
  });
  it('pacing penalizes back-to-back peaks and blocks confessions beyond budget', () => {
    const t = eventTemplate('confession-scenic');
    const s2 = cloneState(s);
    s2.world.episode = 8;
    const base = pacingScore(s2, t);
    s2.history.push({ templateId: 'argument-blowup', type: 'argument', tags: ['peak'], episode: 8, tick: 1 });
    expect(pacingScore(s2, t)).toBeLessThan(base);
    s2.budgets.confessions = 99;
    expect(pacingScore(s2, t)).toBeLessThan(-5);
  });
  it('player focus boosts candidates involving the focus', () => {
    const t = eventTemplate('late-night-kitchen');
    const a = scoreCandidate(s, t, { a: 'player', b: 'ren' }, undefined, 'ren').score;
    const b = scoreCandidate(s, t, { a: 'player', b: 'mio' }, undefined, 'ren').score;
    expect(a).toBeGreaterThan(b);
  });
  it('candidates satisfy preconditions', () => {
    const s2 = cloneState(s);
    s2.world.slot = 'evening';
    const cs = candidates(s2, mulberry32(1), { location: '*house', pool: housemates(s2).filter((c) => !c.isPlayer), isPlayerScene: false, npcOnly: true });
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((c) => c.template.slots.includes('evening'))).toBe(true);
    expect(cs.find((c) => c.template.id === 'argument-blowup')).toBeUndefined(); // tension too low at start
  });
  it('drama scalar is non-negative', () => expect(drama(s)).toBeGreaterThanOrEqual(0));
});

describe('leave conditions', () => {
  it('contract expiry', () => {
    const s = createGame({ seed: 2 });
    s.world.episode = s.characters.ren.contractEp;
    expect(leaveReasons(s, s.characters.ren)).toContain('contract');
  });
  it('low mood streak, unresolved rejection, mutual couple', () => {
    const s = createGame({ seed: 2 });
    s.characters.mio.lowMoodStreak = 3;
    expect(leaveReasons(s, s.characters.mio)).toContain('mood');
    s.world.episode = 6;
    s.world.flags.rejected_kaito = 3;
    s.world.flags.rejectedBy_kaito = 'sora';
    rel(s, 'kaito', 'sora').romance = 70;
    expect(leaveReasons(s, s.characters.kaito)).toContain('rejection');
    s.couples.push({ a: 'ren', b: 'mio', since: 3, status: 'dating' });
    rel(s, 'ren', 'mio').romance = 80;
    rel(s, 'mio', 'ren').romance = 75;
    expect(leaveReasons(s, s.characters.ren)).toContain('couple');
  });
  it('player never auto-leaves; contract leaver is marked', () => {
    const s = createGame({ seed: 2 });
    s.world.episode = 30;
    const marked = evaluateLeaves(s, mulberry32(1));
    expect(marked).not.toContain('player');
    expect(marked.length).toBeGreaterThan(0);
  });
});

describe('cast generator', () => {
  it('produces distinct casts that satisfy the dynamics constraints', () => {
    let ok = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const cast = generateCast(mulberry32(seed), ['woman', 'woman', 'man', 'man', 'man'], null, 24);
      expect(cast).toHaveLength(5);
      expect(new Set(cast.map((c) => c.name)).size).toBe(5);
      for (const c of cast) expect(c.age).toBeGreaterThanOrEqual(20);
      if (checkDynamics(cast.map((c) => ({ gender: c.gender, interestedIn: c.interestedIn, p: personaLike(c.persona) }))).ok) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(16);
  });
});

describe('panel predictions lifecycle', () => {
  it('resolve true on matching events, false on expiry, and are called back once', () => {
    const s = createGame({ seed: 12 });
    const p1 = addPrediction(s, 'otaru', { kind: 'confess', a: 'ren', b: 'mio', byEpisode: 4 }, 'Ren confesses to Mio by ep 4')!;
    const p2 = addPrediction(s, 'saeki', { kind: 'fight', a: 'kaito', b: 'sora', byEpisode: 2 }, 'they blow up')!;
    const p3 = addPrediction(s, 'shiomi', { kind: 'leave', a: 'shun', byEpisode: 9 }, 'Shun leaves')!;
    resolveOn(s, 'confess', 'ren', 'kaito');
    expect(p1.resolved).toBeNull(); // wrong target
    resolveOn(s, 'confess', 'ren', 'mio');
    expect(p1.resolved).toBe(true);
    resolveOn(s, 'fight', 'sora', 'kaito'); // order-insensitive pair
    expect(p2.resolved).toBe(true);
    s.world.episode = 10;
    expirePredictions(s);
    expect(p3.resolved).toBe(false);
    expect(pendingCallbacks(s).map((p) => p.id).sort()).toEqual([p1.id, p2.id, p3.id].sort());
    const s2 = recordCommentary(s, { calledBack: [p1.id] });
    expect(pendingCallbacks(s2).map((p) => p.id)).not.toContain(p1.id);
  });
  it('engine conditions come from state (resolvable), capped in number', () => {
    const s = createGame({ seed: 12 });
    rel(s, 'ren', 'mio').romance = 60;
    const c = proposeCondition(s, mulberry32(3));
    expect(c).not.toBeNull();
    expect(['confess', 'couple', 'fight', 'leave']).toContain(c!.kind);
    for (let i = 0; i < 10; i++) addPrediction(s, 'nagumo', { kind: 'leave', a: 'kaito', byEpisode: 9 }, 'x');
    expect(s.predictions.filter((p) => p.resolved === null).length).toBeLessThanOrEqual(4);
  });
});

describe('planning purity', () => {
  it('planSlot does not mutate its input and is deterministic', () => {
    const s = createGame({ seed: 9 });
    const snap = JSON.stringify(s);
    const a = planSlot(s, { type: 'house', activity: 'hangout' });
    const b = planSlot(s, { type: 'house', activity: 'hangout' });
    expect(JSON.stringify(s)).toBe(snap);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
