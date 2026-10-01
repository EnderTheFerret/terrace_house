// MockLlm content: deterministic template generators for every structured output (beat sheets, lines, deltas,
// commentary, chat). Keyed by beatType × emotion × persona speech. Pure; seeded Rng only.
import type { Beat, BeatSheet, BeatType, Character, Commentary, Depth, Emotion, EventInstance, GameState, Intent, PredictionCond, Reaction, Speech } from '../model';
import type { Rng } from '../rng';
import { clamp, fill, truncate } from '../util';
import { content } from '../content';
import { attracted, firstName, placeName, rel } from '../engine/core';
import { referencesFor } from '../engine/social';
import { pendingCallbacks } from '../engine/predictions';

// ---------------------------------------------------------------- beat sheets

const EMO: Record<BeatType, Emotion[]> = {
  open: ['neutral', 'happy'], smalltalk: ['neutral', 'happy'], probe: ['nervous', 'neutral'], reveal: ['sad', 'nervous', 'tender'],
  deflect: ['awkward', 'nervous'], tease: ['happy', 'excited'], flirt: ['shy', 'happy'], conflict: ['annoyed', 'angry'],
  comfort: ['tender'], silence: ['awkward'], interrupt: ['awkward', 'excited'], confess: ['nervous', 'shy'],
  accept: ['happy', 'tender'], reject: ['sad', 'awkward'], apologize: ['sad', 'nervous'], joke: ['happy'], close: ['neutral', 'tender'],
};

const DEPTH_OF: Partial<Record<BeatType, Depth>> = { reveal: 'vulnerable', confess: 'vulnerable', probe: 'personal', comfort: 'personal', apologize: 'personal' };
const DEPTH_RANK: Record<Depth, number> = { smalltalk: 0, personal: 1, vulnerable: 2 };

const TOPICS: Record<string, string[]> = {
  default: ['the weather', 'work', 'dinner', 'the house', 'weekend plans'],
  'chore-conflict': ['the trash', 'the rota', 'fairness'], dishes: ['the dishes', 'who cooked'], 'late-night-talk': ['not sleeping', 'home', 'what we want'],
  'rooftop-talk': ['the view', 'the future', 'us'], confession: ['us', 'feelings'], farewell: ['leaving', 'what comes next'],
  date: ['the menu', 'childhood', 'types'], jealousy: ['the date', 'who likes who'], gossip: ['someone else', 'secrets'],
  arc: ['the past', 'family', 'the plan'], argument: ['respect', 'the sofa', 'everything'], 'cook-for': ['the food', 'taste'],
};

export interface SheetResult {
  sheet: BeatSheet;
  /** index of the player's choice beat (−1 if none) */
  choiceIndex: number;
}

/** Stage 1: beat sheet from the template skeleton + personas. */
export function mockBeatSheet(s: GameState, rng: Rng, ev: EventInstance): SheetResult {
  const t = content().eventById.get(ev.templateId)!;
  const people = ev.participants.length ? ev.participants : Object.values(ev.roles);
  const outsiders = Object.entries(ev.roles).filter(([r]) => t.roles[r]?.outsider).map(([, id]) => id);
  const player = s.playerId;
  const all = [...people, ...outsiders];
  // the player only speaks at their choice beat (their intent); everyone else carries the scene
  const npcVoices = all.filter((x) => x !== s.playerId);
  const speakers = npcVoices.length ? npcVoices : all;
  const topics = [...(TOPICS[t.type] ?? TOPICS[t.tags[0]] ?? TOPICS.default)];
  const stack: string[] = [topics[0]];
  const beats: Beat[] = [];
  let choiceIndex = -1;
  let turn = 0;
  const skeleton = t.beats.slice(0, 9);
  for (const raw of skeleton) {
    if (beats.length >= 8) break;
    let beatType = raw as BeatType | 'choice';
    // when the player is the confessor, the confession itself is their choice point
    if (beatType === 'confess' && ev.roles.a === player) beatType = 'choice';
    if (beatType === 'choice' && choiceIndex >= 0) continue; // one choice point per scene
    let speaker: string;
    if ((beatType === 'accept' || beatType === 'reject') && ev.roles.b === player && ev.roles.a) {
      speaker = ev.roles.a; // confessor reacts to the player's answer
      beatType = 'close';
    } else if (beatType === 'choice') {
      const chooser = people.includes(player) ? player : people[turn % people.length];
      if (chooser === player) choiceIndex = beats.length;
      speaker = chooser;
      beatType = chooser === player ? 'smalltalk' : 'probe';
    } else if (beatType === 'interrupt' && outsiders.length) speaker = outsiders[0];
    else if (beatType === 'reveal' && ev.arcBeat) speaker = ev.arcBeat.charId;
    else if (beatType === 'confess' && ev.roles.a !== player) speaker = ev.roles.a ?? people[0];
    else if ((beatType === 'accept' || beatType === 'reject') && ev.roles.b !== player) speaker = ev.roles.b ?? people[1] ?? people[0];
    else if (beatType === 'accept' || beatType === 'reject' || beatType === 'confess') speaker = speakers[0];
    else speaker = speakers[turn % speakers.length];
    turn++;
    if (beatType === 'probe' || beatType === 'interrupt') stack.push(rng.pick(topics));
    if (beatType === 'close' && stack.length > 1) stack.pop();
    const ceiling = DEPTH_RANK[ev.depthCeiling];
    const want = DEPTH_OF[beatType as BeatType] ?? 'smalltalk';
    const depth = (Object.keys(DEPTH_RANK) as Depth[])[Math.min(DEPTH_RANK[want], Math.max(ceiling, beatType === 'confess' ? 2 : 0))];
    const c = s.characters[speaker];
    const secret = c?.persona.secret;
    let subtext = '';
    if (c && (beatType === 'deflect' || beatType === 'reveal') && secret) subtext = beatType === 'deflect' ? `hiding something; ${rng.pick(c.persona.tells)}` : 'finally letting part of it out';
    else if (beatType === 'flirt' || beatType === 'tease') subtext = 'wants to be noticed without saying so';
    else if (beatType === 'conflict') subtext = 'feels taken for granted';
    else if (beatType === 'silence') subtext = 'neither wants to speak first';
    else if (beatType === 'smalltalk' && c && attracted(c, s.characters[people.find((p) => p !== speaker) ?? speaker] ?? c)) subtext = 'is really asking something else';
    beats.push({
      speaker,
      intent: raw === 'choice' ? 'player choice' : beatType,
      emotion: rng.pick(EMO[beatType as BeatType] ?? ['neutral']),
      beatType: beatType as BeatType,
      subtext,
      depth,
      topic: stack[stack.length - 1],
    });
  }
  while (beats.length < 2) beats.push({ speaker: people[0], intent: 'close', emotion: 'neutral', beatType: 'close', subtext: '', depth: 'smalltalk', topic: stack[0] });
  return { sheet: { beats }, choiceIndex };
}

// ---------------------------------------------------------------- line bank

const BANK: Record<BeatType, string[]> = {
  open: ['Oh. Hey, {other}.', 'You\'re up early.', 'Didn\'t expect anyone here.', 'Hi. Is this seat taken?', 'Oh, it\'s you.', 'Hey. Busy day?'],
  smalltalk: ['How was work?', 'It\'s been warm lately.', 'Did you eat yet?', 'This {place} is nice at this hour.', 'Are you going out later?', 'I keep forgetting which mug is mine.', 'The trains were packed today.'],
  probe: ['Can I ask you something about {topic}?', 'So... what\'s the deal with {topic}?', 'You seemed quiet earlier. Everything okay?', 'Be honest. What do you think about {topic}?', 'Why did you really come here?'],
  reveal: ['I haven\'t told anyone this. {fact}', 'The truth is, it\'s been harder than I let on.', 'Okay. It\'s about {topic}. I\'ve been carrying it around.', 'I guess... I\'m scared of wasting my time here.', 'My family doesn\'t know half of it.'],
  deflect: ['Ha. Anyway. Did you see the fridge?', 'It\'s nothing. Really.', 'Can we talk about something else?', 'Mm. Long story. Another time.', 'Who wants tea?'],
  tease: ['You\'re blushing.', 'Wow, look at you, all dressed up.', 'Is that your third helping?', 'You always say that.', 'Careful, someone might think you like it here.'],
  flirt: ['You look nice today.', 'I saved you the good seat.', 'It\'s more fun when you\'re around.', 'Walk back with me later?', 'I like talking to you. Is that weird?'],
  conflict: ['You said you\'d do it. Again.', 'I\'m not doing this every week.', 'Do you even notice when other people clean up?', 'That\'s not fair and you know it.', 'Don\'t laugh it off. I\'m serious.'],
  comfort: ['Hey. It\'s okay.', 'I\'m here. Take your time.', 'You don\'t have to have it figured out.', 'That sounds really hard.', 'Thanks for telling me.'],
  silence: ['...', '...Yeah.', 'Mm.', '...', '(stares at the table)'],
  interrupt: ['Wait, sorry, my phone—', 'Oh! Sorry, didn\'t mean to barge in.', 'Hold on. Did you hear that?', 'Sorry, is this a bad time?'],
  confess: ['I like you. I have for a while.', 'I need to say this before I lose my nerve. I have feelings for you.', 'I think I\'m falling for you, {other}.', 'Whatever happens, I wanted you to know. I like you.'],
  accept: ['...Me too. I was waiting for you to say it.', 'Yes. Honestly, yes.', 'I feel the same way.', 'Took you long enough. Yes.'],
  reject: ['I\'m sorry. I don\'t feel the same way.', 'You\'re important to me. Just not like that.', 'I can\'t give you the answer you want.', 'Thank you for telling me. I\'m sorry.'],
  apologize: ['About the other day. I\'m sorry.', 'I was out of line. I know that.', 'I\'ve been thinking. I owe you an apology.', 'I\'m sorry. No excuses.'],
  joke: ['If I burn the rice again, just leave me on the roof.', 'I think the fridge is haunted.', 'New house rule: whoever laughs first does dishes.', 'I\'m basically a professional at doing nothing.'],
  close: ['Okay. Goodnight, {other}.', 'Let\'s do this again.', 'I should sleep. Thanks.', 'See you at breakfast.', 'Alright. Later.'],
};

const HUMOR_JOKES: Record<Speech['humor'], string[]> = {
  dry: ['Great. Another wonderful day in paradise.', 'Fascinating. Truly.', 'I\'ll alert the media.'],
  slapstick: ['I literally walked into the door again!', 'Watch, I\'ll flip this pancake— oh no!', 'Bet I can fit six onigiri in my mouth!'],
  'self-deprecating': ['I\'m a disaster, but a punctual one.', 'Don\'t look at my cooking. It\'s shy.', 'Thirty-one and still can\'t fold a fitted sheet.'],
  teasing: ['Cute. Did you practice that?', 'Wow. Bold of you to show your face after that karaoke.', 'You\'re adorable when you\'re wrong.'],
  none: ['That\'s funny.', 'Ha, okay.', 'I like that.'],
};

const INTENT_LINES: Record<Intent, string[]> = {
  honest: ['Honestly? I\'ve been thinking about {topic} a lot.', 'I\'ll be straight with you.', 'Truthfully, I don\'t know yet. But I want to.'],
  deflect: ['Ha. Let\'s not get into that.', 'Anyway, who\'s hungry?', 'Maybe another time.'],
  flirt: ['You\'re kind of distracting, you know that?', 'I came up here hoping you\'d be here.', 'Save me a seat next time?'],
  support: ['I\'m on your side. Whatever you decide.', 'You\'re not alone in this.', 'Tell me what you need.'],
  joke: ['Okay, but on a scale of one to the rice cooker incident?', 'I\'m going to pretend that was a joke.', 'This house needs a laugh track.'],
  tease: ['Look at you, getting all serious.', 'Is that a smile? Did I see a smile?', 'You\'re a terrible liar.'],
  apologize: ['I\'m sorry. I mean it.', 'That was my fault.', 'I should have said something sooner. Sorry.'],
  confront: ['No. We need to talk about this properly.', 'That\'s not okay with me.', 'Just tell me the truth.'],
  confess: ['I like you. That\'s it. That\'s the sentence.', 'I have feelings for you. I didn\'t plan to.', 'I want more than just being housemates.'],
  decline: ['I\'m sorry. I don\'t see you that way.', 'I can\'t. I hope you understand.', 'You deserve someone who\'s sure.'],
  listen: ['Go on. I\'m listening.', 'Take your time.', 'Mm. Tell me more.'],
};

export interface LineContext {
  /** other participant names, for {other} */
  listener?: string;
  place: string;
  /** per-speaker counters for catchphrase rate cap */
  catchphraseUses: Record<string, number>;
  lineCounts: Record<string, number>;
  fact?: string;
  outcomeHint?: 'accepted' | 'rejected';
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Apply a persona's speech profile to a base line. Deterministic given rng state. */
export function voiceTransform(base: string, sp: Speech, rng: Rng, opts: { allowCatchphrase: boolean; beatType?: BeatType }): string {
  let line = base;
  const isSilence = /^\.{3}$|^\(/.test(line.trim());
  if (isSilence) return line;
  const words = line.split(/\s+/);
  // sentence length: short speakers clip; long speakers elaborate
  if (sp.sentenceLen.mean <= 6 && words.length > sp.sentenceLen.mean + 2) {
    line = words.slice(0, Math.max(3, sp.sentenceLen.mean + 1)).join(' ').replace(/[,.;!?]+$/, '');
    line += '...';
  } else if (sp.sentenceLen.mean >= 11 && words.length < sp.sentenceLen.mean) {
    line = line.replace(/[.!?]*$/, '') + rng.pick([', if that makes sense.', ', and I mean that sincerely.', ', at least that is how I see it.', ', though I could be wrong about that.']);
  }
  // formality
  if (sp.formality >= 0.7) {
    line = line.replace(/\bYeah\b/g, 'Yes').replace(/\bgonna\b/g, 'going to').replace(/\bOkay\b/g, 'Very well');
    if (rng.chance(0.4)) line = rng.pick(['I believe ', 'Perhaps ', 'I suppose ']) + line.charAt(0).toLowerCase() + line.slice(1);
  } else if (sp.formality <= 0.25 && sp.slang.length && rng.chance(0.45)) {
    line = line.replace(/[.!?]*$/, '') + `, ${rng.pick(sp.slang)}.`;
  }
  // fillers
  if (sp.fillers.length && rng.chance(sp.fillerRate)) line = `${cap(rng.pick(sp.fillers).replace(/,$/, ''))}, ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
  // trailing style
  if (sp.trailing === 'ellipsis' && !line.endsWith('...') && rng.chance(0.6)) line = line.replace(/[.!?]*$/, '...');
  else if (sp.trailing === 'exclaim' && rng.chance(0.65)) line = line.replace(/[.?]*$/, '!');
  else if (sp.trailing === 'question' && rng.chance(0.45) && !line.endsWith('?')) line = line.replace(/[.!]*$/, '') + rng.pick(['?', ', right?', ', maybe?']);
  // catchphrase under its rate cap
  if (opts.allowCatchphrase && sp.catchphrase && (opts.beatType === 'close' || opts.beatType === 'joke' || opts.beatType === 'tease') && rng.chance(sp.catchphrase.maxRate * 3)) {
    line = `${line} ${sp.catchphrase.text}`;
  }
  return line.replace(/\s{2,}/g, ' ').trim();
}

/** Stage 2: realize one beat as 1–3 short sentences in the speaker's voice. */
export function mockLine(s: GameState, rng: Rng, beat: Beat, ctx: LineContext, intent?: Intent): string {
  const c = s.characters[beat.speaker];
  const npc = content().npcs.find((n) => n.id === beat.speaker);
  if (!c && npc) {
    const met = s.recurring[npc.id]?.metPlayer ?? 0;
    return fill(rng.pick(met > 0 ? npc.returningLines : npc.lines), { b: ctx.listener ?? 'them' });
  }
  if (!c) return '...';
  let bt = beat.beatType;
  if (bt === 'accept' && ctx.outcomeHint === 'rejected') bt = 'reject';
  let base: string;
  if (intent) base = rng.pick(INTENT_LINES[intent]);
  else if (bt === 'joke' && rng.chance(0.6)) base = rng.pick(HUMOR_JOKES[c.persona.speech.humor]);
  else if (beat.depth === 'smalltalk' && bt === 'open' && rng.chance(0.15)) base = rng.pick(c.persona.speech.exemplars);
  else base = rng.pick(BANK[bt]);
  const refs = referencesFor(s, [beat.speaker]);
  if (bt === 'joke' && refs.length && rng.chance(0.35)) base = `Remember ${rng.pick(refs).text}?`;
  const vars = { other: ctx.listener ?? 'you', place: ctx.place, topic: beat.topic, fact: ctx.fact ?? 'There\'s something I never told anyone.' };
  base = fill(base, vars);
  const lc = (ctx.lineCounts[beat.speaker] = (ctx.lineCounts[beat.speaker] ?? 0) + 1);
  const uses = ctx.catchphraseUses[beat.speaker] ?? 0;
  const cp = c.persona.speech.catchphrase;
  const allow = !!cp && (uses + 1) / Math.max(lc, 10) <= cp.maxRate;
  let line = voiceTransform(base, c.persona.speech, rng, { allowCatchphrase: allow, beatType: bt });
  if (cp && line.includes(cp.text)) ctx.catchphraseUses[beat.speaker] = uses + 1;
  // tells surface as caption cues when deflecting/lying
  if (bt === 'deflect' && c.persona.tells.length && rng.chance(0.5)) line = `${line} [${c.persona.tells[0]}]`;
  return truncate(line, 240);
}

// ---------------------------------------------------------------- captions

export function captionFor(beat: Beat): string | null {
  switch (beat.beatType) {
    case 'silence': return '[awkward silence]';
    case 'interrupt': return '[interrupted]';
    case 'confess': return '[heart pounding]';
    case 'conflict': return beat.emotion === 'angry' ? '[voices rising]' : '[tension]';
    case 'flirt': return '[a little closer]';
    case 'reveal': return '[quietly]';
    case 'joke': return '[laughter]';
    default: return null;
  }
}

// ---------------------------------------------------------------- chat app

const CHAT: Record<string, string[]> = {
  friendly: ['you home?', 'buying snacks, want anything', 'lol the fridge situation', 'saw this and thought of you', 'is the bath free'],
  romantic: ['the sunset from the train today', 'are you awake', 'thanks for earlier. really', 'coffee tomorrow?', 'this song made me think of you'],
  tense: ['we should talk', 'can you not use my shampoo', 'ok', 'whatever', 'fine.'],
  reply: ['haha yes', 'omw', 'ok!', 'sure', 'lol same', 'maybe later', 'thank you', 'yes please'],
};
const STAMPS = ['(thumbs up)', '(cat bowing)', '(sparkles)', '(sweat drop)', '(peace sign)'];

function chatStyle(text: string, sp: Speech, rng: Rng): string {
  let t = text;
  if (sp.chat.punctuation === 'heavy') t = t.replace(/[.?]*$/, '') + rng.pick(['!!', '!!!', '?!', ' lol']);
  else if (sp.chat.punctuation === 'normal') t = cap(t).replace(/([a-z])$/, '$1.');
  if (rng.chance(sp.chat.stampRate)) t = `${t} ${rng.pick(STAMPS)}`;
  return t;
}

export function chatLine(s: GameState, rng: Rng, from: string, to: string): string {
  const c = s.characters[from];
  const r = rel(s, from, to);
  const pool = r.tension > 45 ? CHAT.tense : attracted(c, s.characters[to]) && r.romance > 30 ? CHAT.romantic : CHAT.friendly;
  return chatStyle(rng.pick(pool), c.persona.speech, rng);
}

export function chatReply(s: GameState, rng: Rng, from: string, to: string): string {
  const c = s.characters[from];
  const r = rel(s, from, to);
  return chatStyle(r.tension > 45 ? rng.pick(CHAT.tense) : rng.pick(CHAT.reply), c.persona.speech, rng);
}

// ---------------------------------------------------------------- studio commentary

function situationKey(ev: EventInstance, outcome?: 'accepted' | 'rejected' | 'none'): string {
  if (outcome === 'accepted') return 'confess_yes';
  if (outcome === 'rejected') return 'confess_no';
  const t = ev.tags;
  if (t.includes('departure')) return 'departure';
  if (t.includes('arrival')) return 'arrival';
  if (t.includes('gossip')) return 'gossip';
  if (!ev.isPlayerScene && !t.includes('arc')) return 'npc';
  if (t.includes('cooking')) return 'cooking';
  if (t.includes('domestic')) return 'domestic';
  if (t.includes('conflict') || t.includes('jealousy')) return 'conflict';
  if (t.includes('awkward')) return 'awkward';
  if (t.includes('romance') || t.includes('date')) return 'romance';
  return 'generic';
}

const REACTION_FOR: Record<string, Reaction> = {
  confess_yes: 'aww', confess_no: 'gasp', departure: 'silence', arrival: 'laugh', gossip: 'gasp', npc: 'aww', cooking: 'aww',
  domestic: 'groan', conflict: 'gasp', awkward: 'cringe', romance: 'aww', generic: 'laugh',
};

export interface CommentaryResult {
  commentary: Commentary;
  /** predictions the panel made this time (engine condition + speaker) */
  prediction?: { by: string; condition: PredictionCond };
  calledBack: string[];
}

/** Mock studio commentary; never hints, never mutates state (callers apply prediction/callback bookkeeping). */
export function mockCommentary(
  s: GameState,
  rng: Rng,
  ev: EventInstance,
  outcome: 'accepted' | 'rejected' | 'none' | undefined,
  predictionCond: PredictionCond | null,
): CommentaryResult {
  const panel = content().panel;
  const key = situationKey(ev, outcome);
  const a = ev.participants[0] ?? ev.roles.a;
  const b = ev.participants[1] ?? ev.roles.b ?? a;
  const vars = { a: a ? firstName(s, a) : 'they', b: b ? firstName(s, b) : 'them', ep: s.world.episode + 3 };
  const n = 2 + rng.int(0, 3);
  const speakers = rng.shuffle(panel).slice(0, n);
  const lines: Commentary['lines'] = [];
  const calledBack: string[] = [];
  for (const p of speakers) {
    let pool = p.lines[key] ?? p.lines.generic;
    // bias profile: pet peeves trigger the cutting take, favorites get the warm one
    if (ev.tags.some((t) => p.petPeeves.includes(t)) && p.lines.conflict) pool = [...pool, ...p.lines.conflict];
    let text = fill(rng.pick(pool), vars);
    if (ev.participants.some((id) => p.favorites.includes(id)) && rng.chance(0.3)) text += ` ${rng.pick(['I love them.', 'My favorite, as always.', 'Protect them.'])}`;
    const refs = referencesFor(s, ev.participants);
    if (refs.length && rng.chance(0.15)) text += ` Also, ${rng.pick(refs).text}. Classic.`;
    lines.push({ speaker: p.id, text: truncate(text, 240), reaction: REACTION_FOR[key] ?? 'laugh' });
  }
  // callbacks to resolved predictions (right / wrong)
  for (const pr of pendingCallbacks(s).slice(0, 1)) {
    const p = panel.find((x) => x.id === pr.by)!;
    const pool = pr.resolved ? p.lines.called_it : p.lines.was_wrong;
    lines.push({ speaker: p.id, text: truncate(`${fill(rng.pick(pool), vars)} (${pr.text})`, 240), reaction: pr.resolved ? 'laugh' : 'groan' });
    calledBack.push(pr.id);
  }
  let prediction: CommentaryResult['prediction'];
  if (predictionCond && rng.chance(0.35) && lines.length < 8) {
    const by = rng.pick(speakers).id;
    prediction = { by, condition: predictionCond };
  }
  const commentary: Commentary = { lines: lines.slice(0, 8) };
  if (ev.freeze) commentary.freezeFrame = { caption: rng.pick(content().freezeCaptions) };
  return { commentary, prediction, calledBack };
}

// ---------------------------------------------------------------- misc text

export function teaserLine(s: GameState): string {
  const ids = Object.values(s.characters).filter((c) => c.status === 'inHouse').map((c) => c.id);
  let best: [string, string] | null = null;
  let bv = -1;
  for (const i of ids)
    for (const j of ids) {
      if (i === j) continue;
      const v = rel(s, i, j).tension + Math.max(0, rel(s, i, j).romance - rel(s, j, i).romance);
      if (v > bv) {
        bv = v;
        best = [i, j];
      }
    }
  if (!best) return 'Next time: a quiet week. Or is it?';
  const [i, j] = best;
  return rel(s, i, j).tension >= rel(s, i, j).romance
    ? `Next time: ${firstName(s, i)} and ${firstName(s, j)} can't avoid each other forever.`
    : `Next time: does ${firstName(s, j)} feel the same way about ${firstName(s, i)}?`;
}

export function moodWord(m: number) {
  return m > 0.4 ? 'glowing' : m > 0.1 ? 'good' : m > -0.15 ? 'okay' : m > -0.45 ? 'low' : 'struggling';
}

export function placeLabel(loc: string) {
  return placeName(loc);
}

export const clampMood = (v: number) => clamp(v, -1, 1);

export function playerIntentLine(s: GameState, rng: Rng, intent: Intent, topic: string, listener: string): string {
  const P = s.characters[s.playerId];
  const base = fill(rng.pick(INTENT_LINES[intent]), { topic, other: listener });
  return voiceTransform(base, P.persona.speech, rng, { allowCatchphrase: false });
}

export type { Character };
