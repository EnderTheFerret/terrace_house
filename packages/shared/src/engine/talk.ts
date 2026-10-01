// Free-text talk: the player types what they say; the engine reads an intent from it (so relationships move the
// same way as with the buttons), housemates remember the words, and phone conversations land in the chat thread.
import type { BeatType, Character, GameState, Intent } from '../model';
import { addLog, addMemory, cloneState, firstName } from './core';
import { truncate } from '../util';

export const MAX_TYPED_EXCHANGES = 4;

// ponytail: keyword cues, not an NLU model; the LLM still reads the exact words when writing replies.
const CUES: [Intent, RegExp, number][] = [
  ['confess', /\b(i (really )?(like|love) you|fallen for you|feelings for you|go out with me|be my (girl|boy|)friend|date me|i'?m into you)\b/i, 3],
  ['apologize', /\b(sorry|apologi[sz]e|my (bad|fault)|forgive me)\b/i, 2.5],
  ['decline', /\b(not interested|just friends|don'?t feel the same|no thanks|i'?m not ready|i can'?t (do|date) )/i, 2.2],
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
export function recordChat(s0: GameState, a: string, b: string, lines: { speaker: string; text: string }[]): GameState {
  const s = cloneState(s0);
  const thread = (s.chats[[a, b].sort().join('|')] ??= []);
  for (const l of lines) if (l.speaker === a || l.speaker === b) thread.push({ from: l.speaker, text: truncate(l.text, 200), tick: s.world.tick, readBy: [a, b], ignoredBy: [] });
  if (thread.length > 60) thread.splice(0, thread.length - 60);
  addLog(s, { kind: 'chat', text: `${firstName(s, a)} and ${firstName(s, b)} texted.`, participants: [a, b], salience: 0.2 });
  return s;
}
