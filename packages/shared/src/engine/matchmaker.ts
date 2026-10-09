// "Play matchmaker" and "snoop around": the player asks a housemate they are close to either to push two people together
// (you and someone, or two housemates) or to find out whether someone likes them (or whether two housemates have a thing).
// Whether the helper agrees is closeness plus personality (a shy one won't); how smoothly it goes depends on the love
// triangle: a helper with feelings of their own, a target already in love with or taken by somebody else, a pair where
// one half is secretly into the player.
import { SLOTS, type BeatType, type Emotion, type GameState, type Mission } from '../model';
import { clamp, uk } from '../util';
import { addLog, addMemory, addRel, attracted, cloneState, firstName, isCouple, isRoom, nextId, rel } from './core';

export type Favor = { kind: 'match' | 'snoop'; a: string; b: string };
type Stakes = {
  helperCrush?: string;
  helperLikesPlayer?: boolean;
  /** `of` is the target `id` (a rival in love with them, or their partner) stands in the way for */
  rival?: { of: string; id: string; taken: boolean };
  /** in a pair of housemates, the one who has feelings for the player */
  crushOnPlayer?: string;
};
export type FavorDecision = { accept: boolean; reason: string; honest: boolean; hurt: boolean; stakes: Stakes };

/** Calibration knobs. */
const CLOSE_AFFINITY = 20;
const CLOSE_TRUST = 35;
const CRUSH = 25;
const MATCH_BOLDNESS = 0.42;
const SNOOP_NOSINESS = 0.35;
const SNOOP_BOLDNESS = 0.3;

const roll = (seed: string) => [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 17) % 1000 / 1000;
const flagKey = (h: string, f: Favor) => `favor_${h}_${f.kind}_${[f.a, f.b].sort().join('|')}`;
const BUSY = ['work', 'sleep', 'nap', 'shower'];

/** Shy, anxious or avoidant people won't play cupid; the extraverted, steady and warm will. */
export const boldness = (s: GameState, id: string) => {
  const c = s.characters[id];
  const [, , E, A, N] = c.persona.traits;
  return E * 0.6 + (1 - N) * 0.25 + A * 0.15 - (c.persona.attachment === 'avoidant' ? 0.1 : 0) + c.mood * 0.05;
};
/** Nosiness: who is happy to pry. Gossips and sociable people snoop; the careful and private don't. */
export const nosiness = (s: GameState, id: string) => {
  const c = s.characters[id];
  const [, C, E] = c.persona.traits;
  return c.persona.gossipiness * 0.5 + E * 0.3 + (1 - C) * 0.2;
};

function stakesOf(s: GameState, h: string, f: Favor): Stakes {
  const P = s.playerId;
  const npcs = [f.a, f.b].filter((id) => id !== P);
  const out: Stakes = {};
  out.helperCrush = npcs.find((id) => s.characters[id] && attracted(s.characters[h], s.characters[id]) && rel(s, h, id).romance >= CRUSH);
  out.helperLikesPlayer = [f.a, f.b].includes(P) && attracted(s.characters[h], s.characters[P]) && rel(s, h, P).romance >= CRUSH;
  for (const t of npcs) {
    const other = t === f.a ? f.b : f.a;
    const rivals = Object.keys(s.characters)
      .filter((id) => id !== t && id !== other && id !== h && id !== P && s.characters[id].status === 'inHouse' && (isCouple(s, t, id) || rel(s, t, id).romance >= 30))
      .sort((x, y) => Number(isCouple(s, t, y)) - Number(isCouple(s, t, x)) || rel(s, t, y).romance - rel(s, t, x).romance);
    if (rivals[0] && !out.rival) out.rival = { of: t, id: rivals[0], taken: isCouple(s, t, rivals[0]) };
  }
  if (!npcs.includes(P) && npcs.length === 2) out.crushOnPlayer = npcs.find((id) => attracted(s.characters[id], s.characters[P]) && rel(s, id, P).romance >= CRUSH);
  return out;
}

/** Would `h` do it? Seeded wobble, so the same words get the same answer. */
export function favorDecision(s: GameState, h: string, f: Favor, seed: string): FavorDecision {
  const c = s.characters[h];
  const P = s.playerId;
  const no = (reason: string, stakes: Stakes = {}): FavorDecision => ({ accept: false, reason, honest: true, hurt: false, stakes });
  if (!c || c.status !== 'inHouse') return no('is not around');
  if ([f.a, f.b].includes(h) || f.a === f.b) return no('cannot do that one');
  if ([f.a, f.b].some((id) => !s.characters[id] || s.characters[id].status !== 'inHouse')) return no('does not know where they are');
  if (BUSY.includes(c.lastAction ?? '')) return no(`is busy (${c.lastAction})`);
  if (Number(s.world.flags[flagKey(h, f)] ?? -1) === s.world.episode) return no('already did that today');
  const r = rel(s, h, P);
  if (r.affinity < CLOSE_AFFINITY || r.trust < CLOSE_TRUST) return no("isn't close enough to you for that");
  const stakes = stakesOf(s, h, f);
  const A = c.persona.traits[3];
  const closeness = clamp((r.affinity - CLOSE_AFFINITY) / 800, 0, 0.1);
  const wobble = (roll(`${seed}:${h}:will`) - 0.5) * 0.12;
  if (f.kind === 'match' && boldness(s, h) + closeness + wobble < MATCH_BOLDNESS) return no(c.persona.attachment === 'avoidant' ? "doesn't get involved in other people's love lives" : 'is too shy to play matchmaker', stakes);
  if (f.kind === 'snoop' && boldness(s, h) + closeness + wobble < SNOOP_BOLDNESS) return no('is too shy to go asking around', stakes);
  if (f.kind === 'snoop' && nosiness(s, h) + closeness + wobble < SNOOP_NOSINESS) return no("doesn't pry into other people's business", stakes);
  // a love triangle in the way
  if (stakes.helperLikesPlayer) {
    if (A < 0.7 || roll(`${seed}:${h}:sacrifice`) > 0.5) return no(`has feelings for you and can't ${f.kind === 'match' ? 'set you up with someone else' : 'go looking for who else likes you'}`, stakes);
    return { accept: true, reason: 'agrees, though it stings', honest: true, hurt: true, stakes };
  }
  if (f.kind === 'match' && stakes.rival?.taken && A >= 0.5) return no(`won't come between ${firstName(s, stakes.rival.of)} and ${firstName(s, stakes.rival.id)}`, stakes);
  const sabotage = !!stakes.helperCrush && roll(`${seed}:${h}:lie`) < 0.65 - A * 0.5;
  return { accept: true, reason: 'is on it', honest: !sabotage, hurt: false, stakes };
}

const nm = (s: GameState, id: string) => (id === s.playerId ? 'you' : firstName(s, id));
type Feel = 'smitten' | 'interested' | 'warm' | 'neutral' | 'friends' | 'cold';
function feel(s: GameState, from: string, to: string): Feel {
  const r = rel(s, from, to);
  if (!attracted(s.characters[from], s.characters[to])) return r.affinity >= 15 ? 'friends' : 'cold';
  return r.romance >= 45 ? 'smitten' : r.romance >= 20 ? 'interested' : r.affinity >= 20 ? 'warm' : r.affinity <= -15 ? 'cold' : 'neutral';
}
const PHRASE: Record<Feel, (to: string) => string> = {
  smitten: (to) => `is crazy about ${to}`,
  interested: (to) => `is clearly interested in ${to}`,
  warm: (to) => `gets along really well with ${to}`,
  neutral: (to) => `doesn't think about ${to} that way`,
  friends: (to) => `only sees ${to} as a friend`,
  cold: (to) => `isn't keen on ${to}`,
};
const POSITIVE: Feel[] = ['smitten', 'interested', 'warm'];

const taskOf = (s: GameState, f: Favor) => {
  const P = s.playerId;
  const who = [f.a, f.b].map((id) => nm(s, id)).join(' and ');
  return f.kind === 'match' ? `play matchmaker between ${who}` : `find out ${f.a === P || f.b === P ? `whether ${nm(s, f.a === P ? f.b : f.a)} likes you` : `whether ${nm(s, f.a)} and ${nm(s, f.b)} have a thing`}`;
};

/** Do the favor now on a copy; returns the new state, a line for the screen, and what the helper should say. */
export function applyFavor(s0: GameState, h: string, f: Favor, d: FavorDecision, seed: string, boost = false): { state: GameState; note: string; brief: string } {
  const s = cloneState(s0);
  return { state: s, ...runFavor(s, h, f, d, seed, boost) };
}

/** `boost`: a second housemate helped, so a push lands harder and a snoop reads people better. */
function runFavor(s: GameState, h: string, f: Favor, d: FavorDecision, seed: string, boost: boolean): { note: string; brief: string } {
  const P = s.playerId;
  const c = s.characters[h];
  const H = firstName(s, h);
  const st = d.stakes;
  const exposed = roll(`${seed}:out`) < clamp(c.persona.gossipiness * 1.2, 0, 1);
  const bits: string[] = [];
  let note = '';

  if (d.hurt) {
    addRel(s, h, P, 'tension', 5);
    addRel(s, h, P, 'affinity', -3);
    addMemory(s, h, `${firstName(s, P)} asked me to ${f.kind === 'match' ? 'set them up' : 'check who likes them'} even though I have feelings for them.`, [h, P], 0.7);
    bits.push('it visibly stings you to do this, because you have feelings for the player yourself');
  }

  if (f.kind === 'match') {
    const withP = f.a === P || f.b === P;
    const pitch = (to: string, about: string, gain: number) => {
      const inf = clamp((rel(s, to, h).affinity + rel(s, to, h).trust) / 200, 0, 1);
      const g = gain * (boost ? 1.3 : 1);
      addRel(s, to, about, 'affinity', (rel(s, to, about).affinity < -10 ? 0 : 2 + 3 * inf) * g);
      addRel(s, to, about, 'romance', (1.5 + 2.5 * inf) * g);
      addMemory(s, to, `${H} put in a good word about ${firstName(s, about)}.`, [to, h, about], 0.5);
    };
    if (!d.honest) {
      bits.push(`you say yes but quietly do nothing, because you have feelings for ${nm(s, st.helperCrush!)} yourself; let it show only faintly`);
      note = `${H} says they'll help… but something feels off.`;
    } else if (withP) {
      const t = f.a === P ? f.b : f.a;
      const ok = attracted(s.characters[t], s.characters[P]);
      pitch(t, P, ok ? 1 : 0.3);
      const after = rel(s, t, P);
      bits.push(!ok ? `${firstName(s, t)} isn't looking for that kind of thing with the player, though you tried` : after.affinity < 0 ? `${firstName(s, t)} wasn't receptive` : `you talked the player up to ${firstName(s, t)}, who warmed to the idea`);
      note = `${H} put in a good word for you with ${firstName(s, t)}.`;
    } else {
      const chemistry = attracted(s.characters[f.a], s.characters[f.b]) && attracted(s.characters[f.b], s.characters[f.a]);
      pitch(f.a, f.b, chemistry ? 1 : 0.3);
      pitch(f.b, f.a, chemistry ? 1 : 0.3);
      bits.push(chemistry ? `you nudged ${nm(s, f.a)} and ${nm(s, f.b)} toward each other and they seemed open to it` : `you tried, but there is no spark between ${nm(s, f.a)} and ${nm(s, f.b)}`);
      note = `${H} nudged ${nm(s, f.a)} and ${nm(s, f.b)} toward each other.`;
    }
    // the triangle: somebody else is already in the way, and may hear about it
    if (st.rival && d.honest) {
      const rv = st.rival;
      bits.push(`you know ${firstName(s, rv.of)} ${rv.taken ? 'is with' : 'has eyes for'} ${firstName(s, rv.id)}`);
      if (exposed) {
        addRel(s, rv.id, P, 'tension', 6);
        addRel(s, rv.id, P, 'affinity', -2);
        addMemory(s, rv.id, `I heard ${firstName(s, P)} is getting people to push ${firstName(s, rv.of)} toward them or someone else. I care about ${firstName(s, rv.of)}.`, [rv.id, P, rv.of], 0.7);
        addLog(s, { kind: 'gossip', text: `Word got to ${firstName(s, rv.id)} that ${H} was pushing ${firstName(s, rv.of)} toward someone.`, participants: [rv.id, h, rv.of], salience: 0.5 });
        bits.push(`word got around to ${firstName(s, rv.id)}`);
      }
    }
    if (st.crushOnPlayer && d.honest && exposed) {
      const x = st.crushOnPlayer;
      addRel(s, x, P, 'tension', 5);
      addRel(s, x, P, 'trust', -5);
      addRel(s, x, P, 'romance', -3);
      addMemory(s, x, `${firstName(s, P)} had me set up with ${nm(s, x === f.a ? f.b : f.a)}. I thought they liked me.`, [x, P], 0.75);
      bits.push(`${firstName(s, x)}, who likes the player, heard about it and is hurt`);
    }
    addLog(s, { kind: 'gossip', text: `${H} played matchmaker for ${nm(s, f.a).replace('you', firstName(s, P))} and ${nm(s, f.b).replace('you', firstName(s, P))}.`, participants: [h, f.a, f.b], salience: 0.35 });
  } else {
    const pair = f.a === P || f.b === P ? [f.a === P ? f.b : f.a, P] : [f.a, f.b];
    const dirs = f.a === P || f.b === P ? [[pair[0], P]] : [[f.a, f.b], [f.b, f.a]];
    const [x] = pair;
    const insight = clamp((rel(s, h, x).affinity + rel(s, h, x).trust) / 200 + c.persona.traits[2] * 0.2 + (boost ? 0.25 : 0), 0, 1);
    if (insight < 0.3 && roll(`${seed}:read`) < 0.5) {
      bits.push(`you couldn't get a read on ${nm(s, x)}`);
      note = `${H} couldn't tell what ${nm(s, x)} is thinking.`;
    } else {
      const lines = dirs.map(([from, to]) => {
        let level = feel(s, from, to);
        if (!d.honest && POSITIVE.includes(level)) level = 'neutral';
        return `${nm(s, from)} ${PHRASE[level](nm(s, to))}`;
      });
      bits.push(!d.honest ? `you have feelings for ${nm(s, st.helperCrush!)} yourself, so you downplay it and say only this (not the whole truth): ${lines.join('; ')}` : `what you found out: ${lines.join('; ')}`);
      note = `${H} found out: ${lines.join('; ')}.`;
      if (st.rival && d.honest) bits.push(`you also noticed ${firstName(s, st.rival.of)} ${st.rival.taken ? 'is with' : 'seems to have a thing for'} ${firstName(s, st.rival.id)}`);
      if (st.crushOnPlayer && d.honest) bits.push(`and ${firstName(s, st.crushOnPlayer)} keeps asking about the player`);
      if (!d.honest) addMemory(s, h, `I downplayed what I found out for ${firstName(s, P)} because of my own feelings.`, [h], 0.6);
    }
    // being asked around about can reach the one asked about
    const discreet = c.persona.traits[1] * 0.5 + (1 - c.persona.gossipiness) * 0.5;
    if (roll(`${seed}:notice`) > discreet + 0.35) {
      for (const t of pair.filter((id) => id !== P)) {
        addMemory(s, t, `${H} was asking around about ${f.a === P || f.b === P ? 'whether I like ' + firstName(s, P) : `me and ${nm(s, t === f.a ? f.b : f.a)}`}.`, [t, h], 0.55);
        if (f.a === P || f.b === P) attracted(s.characters[t], s.characters[P]) ? addRel(s, t, P, 'romance', 1.5) : addRel(s, t, P, 'tension', 2);
      }
      bits.push('and they might have noticed you asking around');
    }
    addLog(s, { kind: 'gossip', text: `${H} did some snooping for ${firstName(s, P)}.`, participants: [h, f.a, f.b], salience: 0.3 });
  }
  return { note: note || `${H} ${d.reason}.`, brief: `tell the player how the favor they asked for (${f.kind === 'match' ? 'play matchmaker' : 'snoop around'}) went: ${bits.join('; ')}; say it in your own voice, briefly` };
}

/** The block after this one. */
const nextBlock = (s: GameState) => {
  const i = SLOTS.indexOf(s.world.slot);
  return i === SLOTS.length - 1 ? { ep: s.world.episode + 1, slot: SLOTS[0] } : { ep: s.world.episode, slot: SLOTS[i + 1] };
};
const isDue = (s: GameState, m: Mission) => s.world.episode > m.dueEpisode || (s.world.episode === m.dueEpisode && SLOTS.indexOf(s.world.slot) >= SLOTS.indexOf(m.dueSlot));

/** A willing, friendly housemate the helper brings along (backup for the less sure). Same personality bar, lowered a little. */
function pickPartner(s: GameState, h: string, f: Favor, seed: string): string | undefined {
  if (roll(`${seed}:recruit`) >= 0.4 + (1 - boldness(s, h)) * 0.6) return undefined;
  return Object.values(s.characters)
    .filter((c) => !c.isPlayer && c.status === 'inHouse' && ![h, f.a, f.b].includes(c.id) && !BUSY.includes(c.lastAction ?? '') && rel(s, h, c.id).affinity >= 15
      && (f.kind === 'match' ? boldness(s, c.id) >= MATCH_BOLDNESS - 0.1 : boldness(s, c.id) >= SNOOP_BOLDNESS && nosiness(s, c.id) >= SNOOP_NOSINESS))
    .sort((x, y) => rel(s, h, y.id).affinity - rel(s, h, x.id).affinity || (x.id < y.id ? -1 : 1))[0]?.id;
}

/**
 * The helper agreed: it takes time and happens off screen. Queues the mission for the next block (maybe with a second
 * housemate along); `brief` is what the helper says now, `note` the line for the screen.
 */
export function queueFavor(s0: GameState, h: string, f: Favor, d: FavorDecision, seed: string): { state: GameState; note: string; brief: string } {
  const s = cloneState(s0);
  const P = s.playerId;
  const partner = pickPartner(s, h, f, seed);
  const when = nextBlock(s);
  s.missions.push({ id: nextId(s, 'mission'), kind: f.kind, a: f.a, b: f.b, helper: h, ...(partner ? { partner } : {}), dueEpisode: when.ep, dueSlot: when.slot, honest: d.honest, hurt: d.hurt, seed, status: 'pending', note: '', brief: '' });
  s.missions = [...s.missions.filter((m) => m.status !== 'told'), ...s.missions.filter((m) => m.status === 'told').slice(-5)];
  s.world.flags[flagKey(h, f)] = s.world.episode;
  const task = taskOf(s, f).replace(/\byou\b/g, firstName(s, P));
  addMemory(s, h, `${firstName(s, P)} asked me to ${task}. I said I would look into it${partner ? ` with ${firstName(s, partner)}` : ''}.`, [h, P], 0.5);
  if (partner) addMemory(s, partner, `${firstName(s, h)} asked me to help ${firstName(s, P)}: ${task}.`, [partner, h, P], 0.4);
  const who = `${firstName(s, h)}${partner ? ` and ${firstName(s, partner)}` : ''}`;
  return {
    state: s,
    note: `${who} will look into it and get back to you.`,
    brief: `agree to ${taskOf(s, f)}${partner ? ` with ${firstName(s, partner)}'s help` : ''}; it will take a little while, so say you will look into it and come find the player with news; do not say what you found yet${d.hurt ? '; it stings a little because you have feelings for the player' : ''}`,
  };
}

const textTo = (s: GameState, from: string, text: string) => (s.chats[uk(from, s.playerId)] ??= []).push({ from, text, tick: s.world.tick, readBy: [], ignoredBy: [] });

/** Called as the hours pass: missions that are due get done, and the helper (and partner) comes up to the player with the news. */
export function runMissions(s: GameState) {
  const P = s.playerId;
  for (const m of s.missions) {
    if (m.status !== 'pending' || !isDue(s, m)) continue;
    const c = s.characters[m.helper];
    if (!c || c.status !== 'inHouse' || [m.a, m.b].some((id) => !s.characters[id] || s.characters[id].status !== 'inHouse')) { m.status = 'told'; continue; } // they left: nothing to report
    if (BUSY.includes(c.lastAction ?? '') || !isRoom(c.location)) continue; // try again next hour
    const f: Favor = { kind: m.kind, a: m.a, b: m.b };
    const partner = m.partner && s.characters[m.partner]?.status === 'inHouse' ? m.partner : undefined;
    const done = runFavor(s, m.helper, f, { accept: true, reason: '', honest: m.honest, hurt: m.hurt, stakes: stakesOf(s, m.helper, f) }, m.seed, !!partner);
    m.status = 'ready';
    m.note = done.note;
    m.brief = done.brief + (partner ? `; ${firstName(s, partner)} helped and is with you` : '');
    const who = `${firstName(s, m.helper)}${partner ? ` and ${firstName(s, partner)}` : ''}`;
    if (!isRoom(s.characters[P].location)) { textTo(s, m.helper, `Update on what you asked: ${m.note}`); m.status = 'told'; }
    else if (!s.approaches.some((x) => x.from === m.helper) && s.approaches.length < 3) s.approaches.push({ id: nextId(s, 'approach'), from: m.helper, text: `${who}: we looked into it. Got a minute?` });
  }
}

/** The block is ending and the player never heard in person: the news arrives as a text instead. */
export function missionsToTexts(s: GameState) {
  for (const m of s.missions) if (m.status === 'ready') { textTo(s, m.helper, `Update on what you asked: ${m.note}`); m.status = 'told'; }
}

/** News waiting for the player from anyone in this conversation. */
export const readyReports = (s: GameState, participants: string[]) => s.missions.filter((m) => m.status === 'ready' && participants.includes(m.helper));

/** The scene's opening lines when the helper (and partner) tell the player what they found. */
export function reportBeats(s: GameState, ms: Mission[], participants: string[]): { speaker: string; intent: string; emotion: Emotion; beatType: BeatType }[] {
  return ms.flatMap((m) => [
    { speaker: m.helper, intent: m.brief, emotion: (m.hurt ? 'sad' : m.honest ? 'happy' : 'awkward') as Emotion, beatType: 'reveal' as BeatType },
    ...(m.partner && participants.includes(m.partner) ? [{ speaker: m.partner, intent: `back up ${firstName(s, m.helper)}: add a short thought of your own about what you two found out for the player`, emotion: 'neutral' as Emotion, beatType: 'smalltalk' as BeatType }] : []),
  ]);
}

/** The player has heard: stop waiting, and drop the helper's request for a minute. */
export function tellMissions(s0: GameState, ids: string[]): GameState {
  const s = cloneState(s0);
  for (const m of s.missions) if (ids.includes(m.id)) { m.status = 'told'; s.approaches = s.approaches.filter((x) => x.from !== m.helper); }
  return s;
}

/** What the helper says when they won't. */
export const refusalBrief = (s: GameState, h: string, f: Favor, d: FavorDecision) =>
  `turn down the player's request to ${f.kind === 'match' ? 'play matchmaker' : 'snoop around'} kindly because ${firstName(s, h)} ${d.reason}; do not agree${d.stakes.helperLikesPlayer ? '; let slip a little of how you feel about the player' : ''}`;

const MATCH_CUE = /\b(?:play(?:ing)? (?:the )?(?:matchmaker|cupid)|matchmak\w*|set (?:me|them|him|her|\w+) up|put in a good word|hook (?:me|them) up|wing ?(?:man|woman)|get (?:me|them) together)\b/i;
const SNOOP_CUE = /\b(?:snoop\w*|check(?:ing)? (?:out|if|whether)|find out|(?:feel|sound) \w+ out|ask(?:ing)? around|sniff)\b/i;
const LOVE_CUE = /\b(?:like[sd]? (?:me|him|her|them|each other)|into (?:me|him|her|them)|a thing|feelings|interested|chance|crush|romantic|attracted)\b/i;

/**
 * A favor asked in the player's own words ("can you play matchmaker for me and Dana?", "find out if Dana likes me").
 * Needs the helper's name out of the targets: whoever else is named, or "me" with one name.
 * ponytail: English keyword reading; the button is the reliable route.
 */
export function proposedFavor(s: GameState, text: string, helper: string): Favor | null {
  const kind = MATCH_CUE.test(text) ? 'match' : SNOOP_CUE.test(text) && LOVE_CUE.test(text) ? 'snoop' : null;
  if (!kind) return null;
  const named = Object.values(s.characters)
    .filter((c) => !c.isPlayer && c.id !== helper && c.status === 'inHouse')
    .map((c) => ({ id: c.id, at: text.search(new RegExp(`\\b${firstName(s, c.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')) }))
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at)
    .map((x) => x.id);
  if (named.length >= 2) return { kind, a: named[0], b: named[1] };
  if (named.length === 1 && /\b(?:me|my)\b/i.test(text)) return { kind, a: s.playerId, b: named[0] };
  return null;
}
