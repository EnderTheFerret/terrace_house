// Co-location interactions and remote actions (texts, gossip). Produces scene candidates with engine proposals.
import type { Character, DeltaProposal, GameState } from '../model';
import type { Rng } from '../rng';
import { clamp, uk } from '../util';
import { addFact, addLog, attracted, depthCeiling, firstName, housemates, learn, placeName, rel, traitsOf } from './core';
import type { AgentAction } from './agents';
import { gossipCandidate, keepsSecret, observe, transmit } from './knowledge';
import { mintReference } from './social';
import { chatLine, chatReply } from '../gen/mock';

export type IxType = 'chat' | 'deep' | 'flirt' | 'bicker' | 'awkward' | 'joke' | 'confess' | 'apology' | 'gossip';

export interface Interaction {
  a: string;
  b: string;
  type: IxType;
  location: string;
  salience: number;
  proposal: DeltaProposal;
  factId?: string;
  summary: string;
}

const empty = (): DeltaProposal => ({ affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [], moodDeltas: [] });
const both = (arr: DeltaProposal['affinityDeltas'], a: string, b: string, d1: number, d2 = d1) => {
  arr.push({ from: a, to: b, delta: d1 }, { from: b, to: a, delta: d2 });
};

const BASE_SAL: Record<IxType, number> = { chat: 0.12, joke: 0.22, deep: 0.38, flirt: 0.48, bicker: 0.45, awkward: 0.18, confess: 0.95, apology: 0.5, gossip: 0.42 };

function pickType(s: GameState, rng: Rng, a: Character, b: Character): IxType {
  const r = rel(s, a.id, b.id);
  const rb = rel(s, b.id, a.id);
  const ta = traitsOf(a);
  const depth = depthCeiling(s, a.id, b.id);
  const opts: [IxType, number][] = [
    ['chat', 1],
    ['joke', 0.3 + ta.E * 0.6 + (a.persona.speech.humor !== 'none' ? 0.3 : 0)],
    ['deep', depth === 'smalltalk' ? 0.1 : depth === 'personal' ? 0.6 : 1.0],
    ['flirt', attracted(a, b) && r.romance > 15 ? r.romance / 28 + (s.world.cityEvent === 'typhoon' ? 0.3 : 0) : 0],
    ['bicker', (r.tension + rb.tension) / 2 > 22 ? (r.tension / 28) * (a.persona.conflictStyle === 'confront' ? 1.5 : a.persona.conflictStyle === 'avoid' ? 0.5 : 1) : 0],
    ['awkward', r.tension > 12 && (a.persona.conflictStyle === 'avoid' || a.persona.attachment === 'avoidant') ? 0.6 : r.closeness < 10 ? 0.3 : 0.05],
  ];
  return rng.weighted(
    opts.map((o) => o[0]),
    opts.map((o) => o[1]),
  );
}

/** Engine-resolved proposal for an interaction type. Used directly (log-only) or as the mock LLM proposal. */
export function interactionProposal(s: GameState, rng: Rng, type: IxType, a: string, b: string): DeltaProposal {
  const p = empty();
  const A = s.characters[a];
  const B = s.characters[b];
  switch (type) {
    case 'chat':
      both(p.affinityDeltas, a, b, 1.5);
      both(p.trustDeltas, a, b, 1);
      break;
    case 'joke':
      both(p.affinityDeltas, a, b, 2.5);
      p.moodDeltas.push({ charId: a, delta: 0.05 }, { charId: b, delta: 0.05 });
      both(p.tensionDeltas, a, b, -1.5);
      break;
    case 'deep':
      both(p.trustDeltas, a, b, 4);
      both(p.affinityDeltas, a, b, 2);
      if (attracted(A, B)) p.romanceDeltas.push({ from: a, to: b, delta: 2.5 });
      if (attracted(B, A)) p.romanceDeltas.push({ from: b, to: a, delta: 2.5 });
      break;
    case 'flirt': {
      p.romanceDeltas.push({ from: a, to: b, delta: 3 });
      const receptive = attracted(B, A) ? 0.5 + rel(s, b, a).romance / 30 - rel(s, b, a).tension / 40 : -1;
      p.romanceDeltas.push({ from: b, to: a, delta: clamp(receptive * 2.5 + rng.normal(0, 0.8), -3, 7) });
      if (receptive < 0) p.tensionDeltas.push({ from: b, to: a, delta: 3 });
      p.moodDeltas.push({ charId: b, delta: receptive > 0 ? 0.06 : -0.04 });
      break;
    }
    case 'bicker':
      both(p.tensionDeltas, a, b, 4.5);
      both(p.affinityDeltas, a, b, -2);
      both(p.trustDeltas, a, b, -1);
      p.moodDeltas.push({ charId: a, delta: -0.06 }, { charId: b, delta: -0.06 });
      break;
    case 'awkward':
      both(p.tensionDeltas, a, b, 1);
      break;
    case 'apology':
      p.tensionDeltas.push({ from: b, to: a, delta: -6 });
      both(p.trustDeltas, a, b, 2);
      break;
    case 'gossip':
      both(p.trustDeltas, a, b, 1.5);
      both(p.affinityDeltas, a, b, 1);
      break;
    case 'confess':
      p.romanceDeltas.push({ from: a, to: b, delta: 2 });
      break;
  }
  return p;
}

const SUMMARY: Record<IxType, string> = {
  chat: '{a} and {b} chatted in the {place}.',
  joke: '{a} had {b} laughing in the {place}.',
  deep: '{a} and {b} had a long, real talk in the {place}.',
  flirt: '{a} was flirting with {b} in the {place}.',
  bicker: '{a} and {b} snapped at each other in the {place}.',
  awkward: '{a} and {b} shared an awkward silence in the {place}.',
  confess: '{a} confessed feelings to {b} in the {place}.',
  apology: '{a} apologized to {b} in the {place}.',
  gossip: '{a} whispered something to {b} in the {place}.',
};

/** Resolve co-located NPC–NPC pairs (player-involving pairs are scenes, never auto-resolved). */
export function resolveColocation(s: GameState, rng: Rng, actions: Record<string, AgentAction>, playerId: string): Interaction[] {
  const hm = housemates(s);
  const byLoc = new Map<string, Character[]>();
  for (const c of hm) {
    if (!byLoc.has(c.location)) byLoc.set(c.location, []);
    byLoc.get(c.location)!.push(c);
  }
  const out: Interaction[] = [];
  for (const [loc, group] of [...byLoc.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const npcsHere = group.filter((c) => c.id !== playerId);
    const witnesses = group.map((c) => c.id);
    for (let i = 0; i < npcsHere.length; i++)
      for (let j = i + 1; j < npcsHere.length; j++) {
        let a = npcsHere[i];
        let b = npcsHere[j];
        const aa = actions[a.id];
        const ba = actions[b.id];
        // initiator: whoever acted toward the other
        if (ba && (ba.target === a.id || ba.third === a.id) && !(aa && (aa.target === b.id || aa.third === b.id))) [a, b] = [b, a];
        const act = actions[a.id];
        let type: IxType;
        if (act?.kind === 'confess' && act.target === b.id) type = 'confess';
        else if (act?.kind === 'apologize' && act.target === b.id) type = 'apology';
        else if (act?.kind === 'gossip' && act.third === b.id) type = 'gossip';
        else {
          const sought = (act?.kind === 'seek' && act.target === b.id) || (actions[b.id]?.kind === 'seek' && actions[b.id]?.target === a.id);
          const busy = ['sleep', 'work', 'retreat', 'avoid'].includes(act?.kind ?? '') || ['sleep', 'work', 'retreat', 'avoid'].includes(actions[b.id]?.kind ?? '');
          if (busy && !sought) continue;
          if (!sought && !rng.chance(0.55)) continue;
          type = pickType(s, rng, a, b);
        }
        const proposal = interactionProposal(s, rng, type, a.id, b.id);
        for (const w of witnesses) observe(s, rng, w, a.id, b.id);
        const summary = SUMMARY[type].replace('{a}', firstName(s, a.id)).replace('{b}', firstName(s, b.id)).replace('{place}', placeName(loc));
        const sensitivity = type === 'flirt' ? 0.35 : type === 'bicker' ? 0.32 : type === 'confess' ? 0.7 : type === 'deep' ? 0.15 : 0.1;
        const f = addFact(s, {
          subject: a.id,
          about: b.id,
          kind: type === 'flirt' ? 'romance' : type === 'bicker' ? 'conflict' : type === 'confess' ? 'confession' : 'event',
          content: summary,
          truth: true,
          sensitivity,
        });
        const factId = f.id;
        for (const w of witnesses) learn(s, w, f.id, 'witnessed');
        // gossip happens in person: actual transmission
        if (type === 'gossip') {
          const fact = gossipCandidate(s, a.id, b.id, act?.target);
          if (fact && !keepsSecret(s, rng, a.id, fact)) transmit(s, rng, a.id, b.id, fact, witnesses);
        }
        // deep talks may surface one's own secret when trust is very high
        if (type === 'deep' && depthCeiling(s, a.id, b.id) === 'vulnerable') {
          const sec = a.persona.secret;
          if (sec && rng.chance(0.12 + (a.persona.values.includes('honesty') ? 0.1 : 0))) learn(s, b.id, sec.factId, 'told', a.id, 1);
        }
        if (type === 'joke' && rng.chance(0.08)) mintReference(s, 'inside-joke', `${firstName(s, a.id)}'s bit about the ${placeName(loc)}`, [a.id, b.id]);
        const salience = clamp(BASE_SAL[type] + rng.next() * 0.1 + (rel(s, a.id, b.id).romance + rel(s, b.id, a.id).romance) / 600, 0, 1);
        out.push({ a: a.id, b: b.id, type, location: loc, salience, proposal, factId, summary });
      }
  }
  return out;
}

/** Remote actions: texts (with read-and-ignore) and remote gossip. */
export function resolveRemote(s: GameState, rng: Rng, actions: Record<string, AgentAction>, playerId: string) {
  for (const id of Object.keys(actions).sort()) {
    const a = actions[id];
    if (id === playerId) continue;
    if (a.kind === 'text' && a.target) {
      const key = uk(id, a.target);
      const thread = (s.chats[key] ??= []);
      const text = chatLine(s, rng, id, a.target);
      thread.push({ from: id, text, tick: s.world.tick, readBy: [], ignoredBy: [] });
      const tgt = s.characters[a.target];
      if (a.target !== playerId) {
        const ignore = rng.chance(tgt.persona.speech.chat.readIgnoreProb);
        if (ignore) {
          thread[thread.length - 1].ignoredBy.push(a.target);
          // read-and-ignore stings anxious senders
          if (s.characters[id].persona.attachment === 'anxious') rel(s, id, a.target).tension = clamp(rel(s, id, a.target).tension + 3, 0, 100);
          s.characters[id].mood = clamp(s.characters[id].mood - 0.04, -1, 1);
        } else {
          thread[thread.length - 1].readBy.push(a.target);
          thread.push({ from: a.target, text: chatReply(s, rng, a.target, id), tick: s.world.tick, readBy: [id], ignoredBy: [] });
          rel(s, id, a.target).affinity = clamp(rel(s, id, a.target).affinity + 1, -100, 100);
          rel(s, a.target, id).affinity = clamp(rel(s, a.target, id).affinity + 1, -100, 100);
          if (attracted(s.characters[id], tgt)) rel(s, id, a.target).romance = clamp(rel(s, id, a.target).romance + 0.8, 0, 100);
        }
      }
      if (thread.length > 60) thread.splice(0, thread.length - 60);
    }
    if (a.kind === 'gossip' && a.target && a.third) {
      const listener = s.characters[a.third];
      if (listener && listener.location !== s.characters[id].location) {
        const fact = gossipCandidate(s, id, a.third, a.target);
        if (fact && !keepsSecret(s, rng, id, fact)) transmit(s, rng, id, a.third, fact);
      }
    }
  }
}

export function logInteraction(s: GameState, ix: Interaction) {
  addLog(s, { kind: 'summary', text: ix.summary, participants: [ix.a, ix.b], salience: ix.salience, location: ix.location, factId: ix.factId });
}
