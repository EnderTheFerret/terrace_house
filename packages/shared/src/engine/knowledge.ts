// Beliefs, knowledge and gossip (Section 5.5E).
import type { Fact, GameState } from '../model';
import type { Rng } from '../rng';
import { clamp } from '../util';
import { addFact, addLog, addRel, belief, ch, firstName, knows, learn, rel, traitsOf } from './core';

/** Observer witnesses an interaction between a and b: update noisy belief of a→b and b→a. */
export function observe(s: GameState, rng: Rng, observer: string, a: string, b: string) {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    if (x === observer) continue; // own feelings are known directly
    const actor = ch(s, x);
    const obs = ch(s, observer);
    const t = traitsOf(actor);
    // expressiveness: extraverts and secure people show more; avoidant actors hide
    const expressive = clamp(0.3 + t.E * 0.5 - (actor.persona.attachment === 'avoidant' ? 0.25 : 0), 0.1, 1);
    const noise = (1 - expressive) * 30;
    const truth = rel(s, x, y);
    let romSignal = truth.romance + rng.normal(0, noise);
    let affSignal = truth.affinity + rng.normal(0, noise);
    // anxious observers over-read small signals aimed at themselves
    if (y === observer && obs.persona.attachment === 'anxious') {
      romSignal += 8 + 12 * traitsOf(obs).N;
      affSignal += 6;
    }
    // avoidant observers discount signals aimed at themselves
    if (y === observer && obs.persona.attachment === 'avoidant') romSignal -= 6;
    const be = belief(s, observer, x, y);
    const alpha = 0.3;
    be.romance = clamp(be.romance + alpha * (romSignal - be.romance), 0, 100);
    be.affinity = clamp(be.affinity + alpha * (affSignal - be.affinity), -100, 100);
    be.conf = clamp(be.conf + 0.08, 0, 1);
  }
}

const DISTORT: Record<string, string[]> = {
  romance: ['{s} is basically dating someone in secret', '{s} told someone they love them', '{s} has feelings for two people'],
  conflict: ['{s} said they want {a} out of the house', '{s} and {a} almost came to blows', '{s} has hated {a} from day one'],
  secret: ['{s} has been lying to everyone since day one', '{s} is only here for the cameras', '{s} has a whole other life nobody knows about'],
  event: ['{s} made a scene and stormed off', '{s} cried for an hour afterwards', 'everyone took sides over what {s} did'],
  confession: ['{s} confessed and got laughed at', '{s} confessed to someone else first', '{s} confessed while drunk'],
  couple: ['{s} and {a} are already talking about moving in together', '{s} and {a} are only together for the show', '{s} and {a} already broke up once'],
  opinion: ['{s} thinks everyone here is fake', '{s} said the house would be better without some people', '{s} is planning to leave soon'],
  world: ['{s} is about to quit', '{s} got a big offer elsewhere', '{s} is broke'],
};

/** Create a distorted child fact (rumor). */
export function distortFact(s: GameState, rng: Rng, f: Fact): Fact {
  const tpl = rng.pick(DISTORT[f.kind] ?? DISTORT.event);
  const content = tpl.replace('{s}', firstName(s, f.subject)).replace('{a}', f.about ? firstName(s, f.about) : 'someone');
  return addFact(s, {
    subject: f.subject,
    about: f.about,
    kind: f.kind,
    content: content.charAt(0).toUpperCase() + content.slice(1) + '.',
    truth: false,
    sensitivity: clamp(f.sensitivity + 0.1, 0, 1),
    parentId: f.id,
  });
}

/** Distortion probability p_d for a teller. */
export function distortionP(s: GameState, teller: string) {
  const c = ch(s, teller);
  const t = traitsOf(c);
  return clamp(0.05 + c.persona.gossipiness * 0.35 + (c.persona.attachment === 'anxious' ? 0.1 : 0) + t.N * 0.1, 0, 0.6);
}

/** Pick a juicy fact teller knows about subject that listener doesn't know. */
export function gossipCandidate(s: GameState, teller: string, listener: string, subject?: string): Fact | null {
  const k = s.knowledge[teller] ?? {};
  let best: Fact | null = null;
  for (const fid of Object.keys(k).sort()) {
    const f = s.facts[fid];
    if (!f || f.sensitivity < 0.3) continue;
    if (f.subject === teller || f.subject === listener) continue; // don't gossip about self or to the subject
    if (subject && f.subject !== subject) continue;
    if (!s.characters[f.subject]) continue;
    if (knows(s, listener, f.id) || (f.parentId && knows(s, listener, f.parentId))) continue;
    if (!best || f.sensitivity > best.sensitivity) best = f;
  }
  return best;
}

/**
 * Should teller keep this secret? Checked against trust toward the subject and values.
 * Loyal / honest people keep secrets of people they trust; gossipy people don't.
 */
export function keepsSecret(s: GameState, rng: Rng, teller: string, f: Fact): boolean {
  const c = ch(s, teller);
  const vals = c.persona.values.slice(0, 3);
  let keep = 0.35;
  if (vals.includes('loyalty')) keep += 0.25;
  if (vals.includes('harmony')) keep += 0.1;
  keep += (rel(s, teller, f.subject).trust - 50) / 200;
  keep += rel(s, teller, f.subject).affinity / 300;
  keep -= c.persona.gossipiness * 0.5;
  keep -= rel(s, teller, f.subject).tension / 250; // grudges loosen lips
  return rng.chance(clamp(keep, 0.05, 0.95));
}

/**
 * Teller shares a fact with listener (and any overhearers). Returns the fact the listener received.
 * Always records the source chain: listener.from = teller, teller must know the original.
 */
export function transmit(
  s: GameState,
  rng: Rng,
  teller: string,
  listener: string,
  f: Fact,
  overhearers: string[] = [],
): Fact | null {
  if (!knows(s, teller, f.id)) return null; // knowledge invariant: can't share what you don't know
  let told = f;
  let source: 'told' | 'rumor' = s.knowledge[teller][f.id].source === 'self' || s.knowledge[teller][f.id].source === 'witnessed' ? 'told' : 'rumor';
  if (rng.chance(distortionP(s, teller))) {
    told = distortFact(s, rng, f);
    learn(s, teller, told.id, 'self', undefined, 0.5); // teller "knows" the version they told
    source = 'rumor';
  }
  const conf = clamp((s.knowledge[teller][f.id]?.confidence ?? 0.5) * (source === 'told' ? 0.85 : 0.6), 0.1, 1);
  const fresh = learn(s, listener, told.id, source, teller, conf);
  for (const o of overhearers) if (o !== teller && o !== listener) learn(s, o, told.id, 'overheard', teller, conf * 0.7);
  if (!fresh) return null;
  // listener's opinion of the subject shifts with sensitive news
  addRel(s, listener, told.subject, 'trust', -4 * told.sensitivity);
  // romance news updates the listener's beliefs about who likes whom (low-confidence)
  if (told.about && (told.kind === 'romance' || told.kind === 'couple' || told.kind === 'confession')) {
    const be = belief(s, listener, told.subject, told.about);
    be.romance = Math.max(be.romance, told.kind === 'couple' ? 75 : 55);
    be.conf = Math.max(be.conf, 0.3);
  }
  addRel(s, teller, listener, 'closeness', 2);
  addRel(s, listener, teller, 'closeness', 1);
  // rumor reaches subject: they resent the teller (if they learn who said it)
  if (listener === told.subject) {
    addRel(s, told.subject, teller, 'tension', 6 + 8 * told.sensitivity);
    addRel(s, told.subject, teller, 'trust', -8);
  }
  addLog(s, {
    kind: 'gossip',
    text: `${firstName(s, teller)} told ${firstName(s, listener)}: "${told.content}"`,
    participants: [teller, listener],
    salience: 0.3 + told.sensitivity * 0.4,
    factId: told.id,
  });
  return told;
}

/** Reveal a character's secret to a set of characters (witnessed). */
export function revealSecret(s: GameState, ownerId: string, to: string[]) {
  const owner = s.characters[ownerId];
  const sec = owner?.persona.secret;
  if (!sec || !s.facts[sec.factId]) return;
  for (const id of to) if (id !== ownerId) learn(s, id, sec.factId, 'witnessed');
  owner.mood = clamp(owner.mood - sec.exposureCost * 0.3, -1, 1);
  s.world.flags[`secretOut_${ownerId}`] = s.world.episode;
}

/** Number of people (besides owner) who know owner's secret. */
export function secretSpread(s: GameState, ownerId: string): number {
  const fid = s.characters[ownerId]?.persona.secret?.factId;
  if (!fid) return 0;
  return Object.keys(s.knowledge).filter((id) => id !== ownerId && knows(s, id, fid)).length;
}

/** All facts a character knows, newest first. */
export function knownFacts(s: GameState, charId: string): Fact[] {
  const k = s.knowledge[charId] ?? {};
  return Object.keys(k)
    .map((id) => s.facts[id])
    .filter(Boolean)
    .sort((a, b) => k[b.id].learnedAt - k[a.id].learnedAt);
}

/** Drop old low-sensitivity event facts (and their knowledge entries) to bound state size. */
export function pruneFacts(s: GameState) {
  const parents = new Set(Object.values(s.facts).map((f) => f.parentId).filter(Boolean));
  const airedThrough = s.world.flags.broadcastDays === 3 && typeof s.world.flags.aired === 'number' ? s.world.flags.aired * 3 : 0;
  for (const f of Object.values(s.facts)) {
    if (f.kind === 'event' && f.sensitivity < 0.3 && f.createdEp <= airedThrough && s.world.episode - f.createdEp >= 3 && !parents.has(f.id)) {
      delete s.facts[f.id];
      for (const k of Object.values(s.knowledge)) delete k[f.id];
    }
  }
}
