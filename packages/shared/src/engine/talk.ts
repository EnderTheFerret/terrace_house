// Free-text talk: the player types what they say; the engine reads an intent from it (so relationships move the
// same way as with the buttons), housemates remember the words, and phone conversations land in the chat thread.
import type { BeatType, Character, Emotion, GameState, Intent } from '../model';
import { addLog, addMemory, cloneState, firstName, rel } from './core';
import { truncate } from '../util';

export const MAX_TYPED_EXCHANGES = 4;

const EVERYONE = /\b(guys|everyone|everybody|you all|y'?all|all of you|you two|both of you)\b/i;

/** Named people answer in mention order; other available listeners chime in according to personality. */
export function typedResponders(s: GameState, participants: string[], transcript: { speaker: string }[], text: string): string[] {
  const others = [...new Set(participants)].filter((id) => id !== s.playerId && s.characters[id] && !['sleep', 'nap', 'cook', 'text'].includes(s.characters[id].lastAction ?? ''));
  if (!others.length) return [];
  const named = others.map(id => ({ id, at: text.search(new RegExp(`\\b${firstName(s, id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at).map(x => x.id);
  const last = [...transcript].reverse().find((l) => others.includes(l.speaker))?.speaker;
  if (named.length) return named;
  if (EVERYONE.test(text)) return [last ?? others[0], ...others.filter(id => id !== (last ?? others[0]))];
  const first = last ?? others[0];
  const seed = [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  // ponytail: reproducible rolls from text; use the saved RNG if autonomous group turns are added.
  return [first, ...others.filter(id => {
    if (id === first) return false;
    const c = s.characters[id];
    const feelings = rel(s, id, first);
    const chance = Math.max(0, Math.min(0.8, c.persona.traits[2] * 0.35 + c.mood * 0.1 + (feelings.affinity + feelings.romance) / 1000));
    const roll = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, seed) % 1000 / 1000;
    return roll < chance;
  })];
}

// ponytail: keyword cues, not an NLU model; the LLM still reads the exact words when writing replies.
const CUES: [Intent, RegExp, number][] = [
  ['confess', /\b(i (really )?(like|love) you|fallen for you|feelings for you|go out with me|be my (girl|boy|)friend|date me|i'?m into you)\b/i, 3],
  ['apologize', /\b(sorry|apologi[sz]e|my (bad|fault)|forgive me)\b/i, 2.5],
  ['decline', /\b(not interested|just friends|don'?t feel the same|no thanks|no[,!]|(?:do not|don'?t) want (?:to |a |any |go on a )*(?:date|kiss|romance)|i'?m not ready|i can'?t (do|date) )/i, 2.2],
  ['confront', /\b(why did you|what the hell|not (ok|okay|fair)|you always|you never|seriously\?|unacceptable|lied|liar|stop it|i'?m (angry|upset|mad))\b/i, 2],
  ['flirt', /\b(cute|pretty|handsome|beautiful|gorgeous|date|kiss|miss(ed)? you|thinking about you|you look (really |so |super )?(nice|good|great|amazing|cute)|just (the two of )?us)\b/i, 1.8],
  ['support', /\b(you'?ve got this|i'?m here|here for you|proud of you|it'?s (ok|okay)|don'?t worry|you can do it|on your side|need anything|i believe in you)\b/i, 1.8],
  ['joke', /\b(haha+|lol|lmao|joke|kidding|funny)\b|😂/i, 1.5],
  ['tease', /\b(blushing|admit it|oh really|sure you are|nice try|busted|caught you)\b|😏/i, 1.5],
  ['deflect', /\b(anyway|whatever|never ?mind|let'?s not|change the subject|doesn'?t matter|forget it)\b/i, 1.5],
  ['listen', /\b(tell me|go on|what happened|how (are|do) you feel|are you (ok|okay|alright)|what'?s wrong|i'?m listening)\b/i, 1.5],
  ['honest', /\b(honestly|to be honest|the truth|actually|i think|i feel|i'?ve been)\b/i, 1],
];

/** Read an intent from typed text, restricted to the intents this scene offers. */
export function classifyIntent(text: string, offered: readonly Intent[]): Intent {
  let best: Intent | null = null;
  let bestScore = 0;
  for (const [intent, re, w] of CUES) {
    if (!offered.includes(intent)) continue;
    const hits = text.match(new RegExp(re.source, 'gi'))?.length ?? 0;
    if (hits * w > bestScore) {
      bestScore = hits * w;
      best = intent;
    }
  }
  if (best) return best;
  const fallback: Intent[] = text.trim().endsWith('?') ? ['listen', 'honest'] : ['honest', 'listen', 'joke'];
  return fallback.find((i) => offered.includes(i)) ?? offered[0];
}

/** How a housemate answers what the player just said, as a beat type. */
export function replyBeatType(intent: Intent, listener: Character): BeatType {
  switch (intent) {
    case 'flirt': return 'flirt';
    case 'joke': return 'joke';
    case 'tease': return 'tease';
    case 'deflect': return 'probe';
    case 'listen': return 'reveal';
    case 'confess':
    case 'decline': return 'silence';
    case 'confront':
      return listener.persona.conflictStyle === 'avoid' ? 'deflect' : listener.persona.traits[3] > 0.7 || listener.persona.conflictStyle === 'mediate' ? 'apologize' : 'conflict';
    default: return 'comfort'; // honest, support, apologize
  }
}

/** Listeners remember what the player said to them (it feeds later dialogue through their memories). */
export function recordPlayerWords(s0: GameState, listeners: string[], words: string[]): GameState {
  const s = cloneState(s0);
  const P = s.playerId;
  const said = truncate(words.join(' / '), 180);
  for (const id of listeners) if (id !== P && s.characters[id]) addMemory(s, id, `${firstName(s, P)} told me: "${said}"`, [P, id], 0.55);
  return s;
}

/** A finished phone conversation becomes part of the private chat thread. */
/** Store a phone exchange. `photoFrom`: that person's last line comes with a photo of them (they were asked for one). */
export function recordChat(s0: GameState, a: string, b: string, lines: { speaker: string; text: string }[], photoFrom?: string): GameState {
  const s = cloneState(s0);
  const thread = (s.chats[[a, b].sort().join('|')] ??= []);
  const last = photoFrom ? lines.map((l) => l.speaker).lastIndexOf(photoFrom) : -1;
  lines.forEach((l, i) => { if (l.speaker === a || l.speaker === b) thread.push({ from: l.speaker, text: truncate(l.text, 200), tick: s.world.tick, readBy: [a, b], ignoredBy: [], ...(i === last ? { photo: true, at: s.characters[l.speaker]?.location } : {}) }); });
  if (thread.length > 60) thread.splice(0, thread.length - 60);
  addLog(s, { kind: 'chat', text: `${firstName(s, a)} and ${firstName(s, b)} texted.`, participants: [a, b], salience: 0.2 });
  return s;
}

/**
 * Local emotion read of a line (no model download; SillyTavern uses a DistilBERT classifier for this). Ordered most
 * specific first; null = nothing clear, keep the beat's emotion.
 * ponytail: English keyword lexicon; swap for an ONNX classifier only if typed lines routinely misread.
 */
const FEEL: [Emotion, RegExp][] = [
  ['angry', /\b(hate|furious|angry|pissed|shut up|how dare|disgusting|liar)\b/i],
  ['tender', /\b(love you|miss(ed)? you|care about you|adore|my heart|sweetheart|beautiful|handsome)\b/i],
  ['sad', /\b(sad|cry(ing)?|lonely|miss home|hurts?|sorry for your|lost my|heartbroken|depressed)\b|:\(/i],
  ['nervous', /\b(nervous|scared|afraid|worried|anxious|what if|freaking out)\b/i],
  ['excited', /\b(can't wait|amazing|awesome|let's go|so excited|incredible|yes!+)\b|!!/i],
  ['annoyed', /\b(annoying|seriously\?|ugh|whatever|again\?|stop it|my food|your mess|dishes)\b/i],
  ['awkward', /\b(awkward|um+|uh+|weird|cringe|anyway)\b|\.\.\./i],
  ['shy', /\b(cute|pretty|blush|date with me|go out with me|like you)\b/i],
  ['happy', /\b(haha|lol|thanks?|thank you|great|nice|glad|happy|fun|funny)\b|:\)/i],
];
export const feltEmotion = (text: string): Emotion | null => FEEL.find(([, re]) => re.test(text))?.[0] ?? null;

/** How a housemate's face reacts to what was just said to them. */
const REACTION: Partial<Record<Emotion, Emotion>> = { angry: 'annoyed', tender: 'shy', sad: 'tender', nervous: 'nervous', excited: 'excited', annoyed: 'awkward', awkward: 'awkward', shy: 'shy', happy: 'happy' };
export const reactionTo = (text: string): Emotion | null => { const f = feltEmotion(text); return f ? REACTION[f] ?? null : null; };