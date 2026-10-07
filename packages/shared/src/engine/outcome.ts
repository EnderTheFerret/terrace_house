// Scene outcomes: engine proposals from intents, effect application, confessions. The LLM may propose deltas,
// but they always pass through sanitizeProposal (clamp ±15, valid ids) before applyProposal.
import type { EventTemplate } from '../contentSchema';
import type { Character, DeltaProposal, EventInstance, GameState, Intent } from '../model';
import type { Rng } from '../rng';
import { clamp, fill } from '../util';
import { content } from '../content';
import {
  addFact, addLog, addMemory, addRel, attracted, coupleOf, firstName, housemates, learn, placeName, rel, traitsOf,
milestoneOf, } from './core';
import { applyProposal, sanitizeProposal } from './relationships';
import { gossipCandidate, keepsSecret, observe, revealSecret, transmit } from './knowledge';
import { addGrudge, apologize, mintReference, publicAct } from './social';
import { invitePartnerToLeave, markLeaving } from './leave';
import { resolveOn } from './predictions';
import { completeBeat } from './arcs';
import { interactionProposal, type IxType } from './interactions';
import { addGroceries } from './house';

export type SceneChoices = Record<string, Intent>;

/** How a recipient's values color their reception of an intent (−0.4..+0.4). */
export function receptiveness(c: Character, intent: Intent): number {
  const vals = c.persona.values.slice(0, 3);
  let b = 0;
  if (vals.includes('honesty')) b += intent === 'honest' ? 0.3 : intent === 'confront' ? 0.15 : intent === 'deflect' ? -0.3 : 0;
  if (vals.includes('harmony')) b += intent === 'support' || intent === 'apologize' ? 0.25 : intent === 'confront' ? -0.3 : 0;
  if (vals.includes('fun')) b += intent === 'joke' ? 0.3 : intent === 'tease' ? 0.2 : 0;
  if (vals.includes('loyalty')) b += intent === 'support' ? 0.15 : 0;
  if (vals.includes('freedom')) b += intent === 'tease' ? 0.1 : 0;
  if (c.persona.attachment === 'avoidant' && intent === 'flirt') b -= 0.15;
  if (c.persona.attachment === 'anxious' && (intent === 'support' || intent === 'flirt')) b += 0.15;
  return clamp(b, -0.4, 0.4);
}

/** NPC chooses an intent at a choice beat from persona + relationship. */
export function npcIntent(s: GameState, rng: Rng, c: Character, t: EventTemplate, others: string[]): Intent {
  const opts = t.intents;
  const other = others[0] ? s.characters[others[0]] : undefined;
  const r = other ? rel(s, c.id, other.id) : null;
  const tr = traitsOf(c);
  const w = opts.map((i) => {
    let v = 1;
    if (i === 'honest') v += c.persona.values.indexOf('honesty') >= 0 && c.persona.values.indexOf('honesty') < 3 ? 1 : 0;
    if (i === 'joke' || i === 'tease') v += c.persona.conflictStyle === 'deflect-with-humor' ? 1.2 : tr.E * 0.6;
    if (i === 'deflect') v += c.persona.conflictStyle === 'avoid' || c.persona.attachment === 'avoidant' ? 1 : 0;
    if (i === 'confront') v += c.persona.conflictStyle === 'confront' ? 1.2 : r && r.tension > 50 && c.persona.conflictStyle === 'passive-aggressive' ? 1 : 0;
    if (i === 'support' || i === 'listen') v += tr.A;
    if (i === 'flirt') v += other && attracted(c, other) && r ? r.romance / 40 : -0.8;
    if (i === 'apologize') v += r && rel(s, others[0], c.id).tension > 30 ? 1 : -0.5;
    if (i === 'confess') v += r && r.romance >= 55 ? 2 : -2;
    if (i === 'decline') v += r && r.romance < 40 ? 1.5 : -1;
    return Math.max(0.05, v);
  });
  return rng.weighted(opts, w);
}

const IX_TYPES: Record<string, IxType> = {
  'ix-chat': 'chat', 'ix-deep': 'deep', 'ix-flirt': 'flirt', 'ix-bicker': 'bicker', 'ix-awkward': 'awkward',
  'ix-joke': 'joke', 'ix-confess': 'confess', 'ix-apology': 'apology', 'ix-gossip': 'gossip',
};

/** Engine (mock) delta proposal: template drama profile scaled by chosen intents and recipients' receptiveness. */
export function engineProposal(s: GameState, rng: Rng, ev: EventInstance, choices: SceneChoices): DeltaProposal {
  const t = content().eventById.get(ev.templateId)!;
  const ix = ev.tags.includes('interaction-help') ? 'help' : ev.tags.includes('interaction-household') ? 'household' : ev.tags.includes('interaction-cold') ? 'cold' : ev.tags.includes('interaction-jealousy') ? 'jealousy' : IX_TYPES[t.id];
  if (ix) return interactionProposal(s, rng, ix, ev.roles.a, ev.roles.b);
  const b = ev.roles;
  const p: DeltaProposal = { affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [], moodDeltas: [] };
  const mult = (field: 'affinity' | 'romance' | 'tension' | 'trust', from: string, to: string, d: number) => {
    let m = 1;
    // the recipient of an intent is "from" (their feelings toward the chooser "to" change)
    const intent = choices[to];
    if (intent) {
      const recv = s.characters[from] ? receptiveness(s.characters[from], intent) : 0;
      const table: Record<Intent, Partial<Record<typeof field, number>>> = {
        honest: { trust: 1.4, romance: 1.1 },
        deflect: { affinity: 0.5, romance: 0.4, trust: 0.4 },
        flirt: { romance: s.characters[from] && s.characters[to] && attracted(s.characters[from], s.characters[to]) && rel(s, from, to).romance > 15 ? 1.7 : 0.4 },
        support: { affinity: 1.4, trust: 1.3, tension: 0.5 },
        joke: { affinity: 1.15, romance: 0.8, tension: 0.6 },
        tease: { romance: 1.25, affinity: 1.0 },
        apologize: { tension: 0.3, trust: 1.2 },
        confront: { tension: 1.6, trust: 0.8 },
        confess: { romance: 1.3 },
        decline: { romance: 0.2, affinity: 0.8 },
        listen: { trust: 1.3, affinity: 1.1 },
      };
      m *= table[intent][field] ?? 1;
      if (d > 0 && field !== 'tension') m *= 1 + recv;
      if (d > 0 && field === 'tension') m *= 1 - recv * 0.5;
    }
    return d * m;
  };
  for (const [x, y, d] of t.drama.affinity) if (b[x] && b[y]) p.affinityDeltas.push({ from: b[x], to: b[y], delta: mult('affinity', b[x], b[y], d) + rng.normal(0, 0.6) });
  for (const [x, y, d] of t.drama.romance) if (b[x] && b[y]) p.romanceDeltas.push({ from: b[x], to: b[y], delta: mult('romance', b[x], b[y], d) + rng.normal(0, 0.5) });
  for (const [x, y, d] of t.drama.tension) if (b[x] && b[y]) p.tensionDeltas.push({ from: b[x], to: b[y], delta: mult('tension', b[x], b[y], d) });
  for (const [x, y, d] of t.drama.trust) if (b[x] && b[y]) p.trustDeltas.push({ from: b[x], to: b[y], delta: mult('trust', b[x], b[y], d) });
  for (const [x, d] of t.drama.mood) if (b[x]) p.moodDeltas.push({ charId: b[x], delta: d });
  // intent side effects on every other participant
  for (const [chooser, intent] of Object.entries(choices)) {
    for (const other of ev.participants) {
      if (other === chooser) continue;
      if (intent === 'confront') p.tensionDeltas.push({ from: other, to: chooser, delta: 4 }, { from: chooser, to: other, delta: 2 });
      if (intent === 'apologize') p.tensionDeltas.push({ from: other, to: chooser, delta: -5 });
      if (intent === 'support') p.affinityDeltas.push({ from: other, to: chooser, delta: 2 });
      if (intent === 'honest') p.trustDeltas.push({ from: other, to: chooser, delta: 2 });
      if (intent === 'deflect') p.trustDeltas.push({ from: other, to: chooser, delta: -1.5 });
      if (intent === 'flirt' && s.characters[other] && s.characters[chooser] && !attracted(s.characters[other], s.characters[chooser]))
        p.tensionDeltas.push({ from: other, to: chooser, delta: 2 });
    }
  }
  const sal = clamp((t.peak ? 0.7 : 0.35) + (ev.isPlayerScene ? 0.1 : 0), 0, 1);
  for (const id of ev.participants) {
    const others = ev.participants.filter((x) => x !== id).map((x) => firstName(s, x));
    p.newMemories.push({ charId: id, text: `${t.title}${others.length ? ' with ' + others.join(' and ') : ''} (${placeName(ev.location)})`, salience: sal });
  }
  return p;
}

/** Deterministic preview of a confession answer (used to keep dialogue consistent with the resolution). */
export function confessionPreview(s: GameState, a: string, b: string, choices: SceneChoices): 'accepted' | 'rejected' | 'none' {
  const A = s.characters[a];
  const B = s.characters[b];
  if (!A || !B) return 'none';
  if (A.isPlayer && choices[a] && !['confess', 'honest', 'flirt'].includes(choices[a])) return 'none';
  if (B.isPlayer) return choices[b] ? (choices[b] !== 'decline' && choices[b] !== 'deflect' ? 'accepted' : 'rejected') : rel(s, b, a).romance >= 50 ? 'accepted' : 'rejected';
  const need = B.persona.attachment === 'avoidant' ? 62 : B.persona.attachment === 'anxious' ? 50 : 55;
  return !coupleOf(s, b) && rel(s, b, a).romance >= need && attracted(B, A) ? 'accepted' : 'rejected';
}

/** Resolve a confession. Returns outcome or 'none' if the confessor backed out. */
export function resolveConfession(s: GameState, rng: Rng, a: string, b: string, choices: SceneChoices): 'accepted' | 'rejected' | 'none' {
  const A = s.characters[a];
  const B = s.characters[b];
  if (!A || !B) return 'none';
  if (A.isPlayer && choices[a] && !['confess', 'honest', 'flirt'].includes(choices[a])) return 'none';
  let accept: boolean;
  if (B.isPlayer) accept = choices[b] ? choices[b] !== 'decline' && choices[b] !== 'deflect' : rel(s, b, a).romance >= 50;
  else {
    const need = B.persona.attachment === 'avoidant' ? 62 : B.persona.attachment === 'anxious' ? 50 : 55;
    const partner = coupleOf(s, b);
    accept = !partner && rel(s, b, a).romance >= need && attracted(B, A);
  }
  s.world.flags[`confessed_${a}_${b}`] = s.world.episode;
  s.budgets.confessions++;
  resolveOn(s, 'confess', a, b);
  const witnesses = housemates(s).filter((c) => c.location === A.location).map((c) => c.id);
  if (accept) {
    s.couples.push({ a, b, since: s.world.episode, status: 'dating' });
    addRel(s, a, b, 'romance', 10);
    addRel(s, b, a, 'romance', 10);
    A.mood = clamp(A.mood + 0.3, -1, 1);
    B.mood = clamp(B.mood + 0.25, -1, 1);
    const f = addFact(s, { subject: a, about: b, kind: 'couple', content: `${firstName(s, a)} and ${firstName(s, b)} are dating.`, truth: true, sensitivity: 0.6 });
    for (const w of new Set([a, b, ...witnesses])) learn(s, w, f.id, 'witnessed');
    addLog(s, { kind: 'couple', text: `${firstName(s, a)} confessed to ${firstName(s, b)} — and ${firstName(s, b)} said yes.`, participants: [a, b], salience: 1, factId: f.id });
    resolveOn(s, 'couple', a, b);
    // Accepting a relationship and deciding to graduate are separate decisions.
    const leaver = [a, b].find((id) => typeof s.world.flags[`leaving_${id}`] === 'number');
    if (leaver) invitePartnerToLeave(s, leaver);
    // jealousy: anyone else with strong feelings for either
    for (const c of housemates(s)) {
      if (c.id === a || c.id === b) continue;
      for (const [x, y] of [[a, b], [b, a]] as const)
        if (rel(s, c.id, x).romance >= 45) {
          addRel(s, c.id, y, 'tension', 8);
          c.mood = clamp(c.mood - 0.15, -1, 1);
        }
    }
    return 'accepted';
  }
  A.mood = clamp(A.mood - 0.4, -1, 1);
  s.world.flags[`rejected_${a}`] = s.world.episode;
  s.world.flags[`rejectedBy_${a}`] = b;
  addRel(s, a, b, 'tension', 8);
  addGrudge(s, a, b, 12, 'rejected confession');
  const f = addFact(s, { subject: a, about: b, kind: 'confession', content: `${firstName(s, a)} confessed to ${firstName(s, b)} and was turned down.`, truth: true, sensitivity: 0.7 });
  for (const w of new Set([a, b, ...witnesses])) learn(s, w, f.id, 'witnessed');
  addLog(s, { kind: 'confession', text: `${firstName(s, a)} confessed to ${firstName(s, b)}, who gently said no.`, participants: [a, b], salience: 0.95, factId: f.id });
  return 'rejected';
}

export interface EffectResult {
  confession?: 'accepted' | 'rejected' | 'none';
  leaving?: string[];
  secretRevealed?: string;
}

export function applyEffects(s: GameState, rng: Rng, ev: EventInstance, choices: SceneChoices): EffectResult {
  const t = content().eventById.get(ev.templateId)!;
  const b = ev.roles;
  const res: EffectResult = {};
  const vars: Record<string, string> = {};
  for (const [r, id] of Object.entries(b)) vars[r] = s.characters[id] ? id : id;
  const names: Record<string, string> = { place: placeName(ev.location) };
  for (const [r, id] of Object.entries(b)) names[r] = s.characters[id] ? firstName(s, id) : id;
  for (const e of t.effects) {
    if (e.flag) s.world.flags[fill(e.flag, vars)] = e.value ?? true;
    if (e.revealSecretOf && b[e.revealSecretOf]) {
      revealSecret(s, b[e.revealSecretOf], ev.participants);
      res.secretRevealed = b[e.revealSecretOf];
    }
    if (e.couple) {
      const [x, y] = e.couple.map((r) => b[r]);
      if (x && y && !coupleOf(s, x) && !coupleOf(s, y)) s.couples.push({ a: x, b: y, since: s.world.episode, status: 'dating' });
    }
    if (e.leave && b[e.leave] && !s.characters[b[e.leave]].isPlayer) {
      // arc decisions: staying is more likely when someone in the house is worth staying for
      const id = b[e.leave];
      const anchor = Math.max(0, ...housemates(s).filter((c) => c.id !== id).map((c) => rel(s, id, c.id).romance));
      const pLeave = clamp((e.leaveChance ?? 1) - anchor / 200, 0.05, 1);
      if (rng.chance(pLeave)) {
        markLeaving(s, id, e.leaveReason ?? 'left the house');
        (res.leaving ??= []).push(id);
        const partner = invitePartnerToLeave(s, id);
        if (partner) res.leaving.push(partner);
      }
    }
      if (e.house) for (const [k, v] of Object.entries(e.house)) {
      const key = k as 'dishes' | 'laundry' | 'trash' | 'noise' | 'groceryBudget';
      s.house[key] = key === 'groceryBudget' ? s.house[key] + v : clamp(s.house[key] + v, 0, 100);
    }
    if (e.fridge) addGroceries(s, e.fridge);
    if (e.reputation && b[e.reputation.role]) publicAct(s, b[e.reputation.role], e.reputation.delta);
    if (e.homesick && b[e.homesick.role]) {
      const c = s.characters[b[e.homesick.role]];
      c.persona.homesickness = clamp(c.persona.homesickness + e.homesick.delta, 0, 1);
    }
    if (e.reference) mintReference(s, e.reference.kind, fill(e.reference.text, names), ev.participants);
    if (e.fact && b[e.fact.subject]) {
      const f = addFact(s, {
        subject: b[e.fact.subject],
        about: e.fact.about ? b[e.fact.about] : undefined,
        kind: e.fact.kind as never,
        content: fill(e.fact.content, names),
        truth: true,
        sensitivity: e.fact.sensitivity,
      });
      for (const id of ev.participants) learn(s, id, f.id, 'witnessed');
    }
    if (e.confession) {
      const [x, y] = e.confession.map((r) => b[r]);
      if (x && y) res.confession = resolveConfession(s, rng, x, y, choices);
    }
    if (e.apology) {
      const [x, y] = e.apology.map((r) => b[r]);
      if (x && y) apologize(s, rng, x, y);
    }
    if (e.date) {
      const [x, y] = e.date.map((r) => b[r]);
      if (x && y) {
        s.world.flags.lastDate = `${x}|${y}`;
        s.world.flags.lastDateTick = s.world.tick;
      }
    }
    if (e.milestone) {
      const [x, y] = e.milestone.map((r) => b[r]);
      if (x && y) {
        const level = milestoneOf(s, x, y) + 1;
        s.world.flags[`ms_${[x, y].sort().join('|')}`] = level;
        const what = ['', 'went on their first date', 'went on a second date', 'held hands', 'kissed'][level];
        if (what) {
          const f = addFact(s, { subject: x, about: y, kind: 'romance', content: `${firstName(s, x)} and ${firstName(s, y)} ${what}`, truth: true, sensitivity: 0.3 + level * 0.1 });
          learn(s, x, f.id, 'self');
          learn(s, y, f.id, 'self');
        }
      }
    }
    if (e.groupChatKick && b[e.groupChatKick]) s.house.groupChat.members = s.house.groupChat.members.filter((m) => m !== b[e.groupChatKick!]);
  }
  return res;
}

export interface SceneResolution {
  proposal: DeltaProposal;
  effects: EffectResult;
  noticed?: boolean;
}

/**
 * Apply a finished scene: sanitized proposal + template effects + knowledge/beliefs + arc progress + history.
 * `response` is the player's reaction to a visible NPC–NPC conversation (eavesdrop risks being noticed).
 */
export function applySceneOutcome(
  s: GameState,
  rng: Rng,
  ev: EventInstance,
  rawProposal: unknown,
  choices: SceneChoices,
  response?: 'join' | 'eavesdrop' | 'ignore',
): SceneResolution {
  const t = content().eventById.get(ev.templateId)!;
  const participants = ev.participants.filter((id) => s.characters[id]);
  const proposal = sanitizeProposal(rawProposal, participants);
  applyProposal(s, proposal, participants);
  const effects = applyEffects(s, rng, ev, choices);
  // gossip scenes actually pass a fact along (a tells b, optionally about c); listener may decline to hear it
  if (t.type === 'gossip' && ev.roles.a && ev.roles.b && choices[ev.roles.b] !== 'deflect') {
    const fact = gossipCandidate(s, ev.roles.a, ev.roles.b, ev.roles.c);
    if (fact) transmit(s, rng, ev.roles.a, ev.roles.b, fact, ev.location === 'phone' ? [] : housemates(s).filter((c) => c.location === ev.location).map((c) => c.id));
  }
  if (ev.templateId === 'former-housemate') {
    for (const [teller, listener] of [[ev.roles.a, ev.roles.b], [ev.roles.b, ev.roles.a]]) {
      if (choices[listener] === 'deflect') continue;
      const fact = gossipCandidate(s, teller, listener);
      if (fact && (fact.kind !== 'secret' || !keepsSecret(s, rng, teller, fact))) transmit(s, rng, teller, listener, fact, participants);
    }
    for (const id of participants) addMemory(s, id, ev.premise, participants, 0.6);
  }
  // scene becomes a fact witnessed by participants (and co-located housemates)
  const witnesses = new Set(participants);
  if (ev.location !== 'phone')
    for (const c of housemates(s)) if (c.location === ev.location) witnesses.add(c.id);
  const sensitivity = t.peak ? 0.55 : t.tags.includes('conflict') || t.tags.includes('romance') ? 0.35 : 0.15;
  const f = addFact(s, {
    subject: participants[0] ?? s.playerId,
    about: participants[1],
    kind: t.tags.includes('conflict') ? 'conflict' : t.tags.includes('romance') ? 'romance' : 'event',
    content: `${ev.title}: ${participants.map((id) => firstName(s, id)).join(' & ')} at the ${placeName(ev.location)}.`,
    truth: true,
    sensitivity,
  });
  for (const w of witnesses) learn(s, w, f.id, 'witnessed');
  let noticed = false;
  if (response === 'eavesdrop') {
    learn(s, s.playerId, f.id, 'overheard', participants[0], 0.8);
    noticed = rng.chance(0.3);
    if (noticed)
      for (const id of participants) {
        addRel(s, id, s.playerId, 'trust', -6);
        addRel(s, id, s.playerId, 'tension', 3);
      }
  }
  for (const w of witnesses) for (let i = 0; i < participants.length; i++) for (let j = i + 1; j < participants.length; j++) observe(s, rng, w, participants[i], participants[j]);
  if (ev.arcBeat) {
    completeBeat(s, ev.arcBeat.charId, ev.arcBeat.beatId);
    addLog(s, { kind: 'arc', text: `${firstName(s, ev.arcBeat.charId)}: ${t.title}.`, participants, salience: 0.8, templateId: t.id });
  }
  if (t.tags.includes('argument') || (t.tags.includes('conflict') && t.peak)) {
    if (participants.length >= 2) {
      resolveOn(s, 'fight', participants[0], participants[1]);
      addGrudge(s, participants[1], participants[0], 15, t.title);
      addGrudge(s, participants[0], participants[1], 10, t.title);
    }
  }
  if (ev.isPlayerScene) {
    for (const id of participants) if (id !== s.playerId) s.recentPlayerTargets = [id, ...s.recentPlayerTargets.filter((x) => x !== id)].slice(0, 3);
  }
  if (t.tags.includes('birthday') || t.type === 'birthday') s.world.flags[`birthday_${ev.roles.a}`] = true;
  s.history.push({ templateId: t.id, type: t.type, tags: t.tags, episode: s.world.episode, tick: s.world.tick });
  if (s.history.length > 200) s.history.splice(0, s.history.length - 200);
  addLog(s, { kind: 'scene', text: ev.premise, participants, salience: ev.salience, location: ev.location, factId: f.id, templateId: t.id });
  for (const id of participants) if (!proposal.newMemories.some((m) => m.charId === id)) addMemory(s, id, ev.premise, participants, Math.min(1, ev.salience));
  return { proposal, effects, noticed };
}
