// Rule-based voice features, voice check (Section 5.5L) and pairwise distinctness.
import type { Speech } from '../model';
import { euclid } from '../util';

export const BANNED_META = [/\bas an ai\b/i, /\blanguage model\b/i, /\bthe (show|camera|panel|audience|producers?)\b/i, /\bfourth wall\b/i, /\bin this scene\b/i, /\bcharacter\b/i, /\bprompt\b/i];
const FORMAL = /\b(i believe|perhaps|i suppose|please|thank you|i'm afraid|would you|shall|indeed|certainly)\b/gi;
const CASUAL = /\b(gonna|wanna|yeah|nah|bro|like|lowkey|dude|kinda|no way|okay okay)\b/gi;

export interface VoiceFeatures {
  wordsPerSentence: number;
  exclaim: number;
  question: number;
  ellipsis: number;
  formal: number;
  casual: number;
  fillers: number;
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
}
export const words = (text: string) => text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));

export function voiceFeatures(text: string, fillers: string[] = []): VoiceFeatures {
  const sents = Math.max(1, sentences(text).length);
  const w = words(text);
  const n = Math.max(1, w.length);
  const fillerHits = fillers.reduce((acc, f) => acc + (text.toLowerCase().split(f.toLowerCase().replace(/[,.]/g, '')).length - 1), 0);
  return {
    wordsPerSentence: w.length / sents,
    exclaim: (text.match(/!/g)?.length ?? 0) / sents,
    question: (text.match(/\?/g)?.length ?? 0) / sents,
    ellipsis: (text.match(/\.\.\.|…/g)?.length ?? 0) / sents,
    formal: (text.match(FORMAL)?.length ?? 0) / n * 10,
    casual: (text.match(CASUAL)?.length ?? 0) / n * 10,
    fillers: fillerHits / sents,
  };
}

export const featureVec = (f: VoiceFeatures) => [f.wordsPerSentence / 6, f.exclaim, f.question, f.ellipsis, f.formal, f.casual, f.fillers];

/** Aggregate features over many lines. */
export function aggregate(lines: string[], fillers: string[] = []): VoiceFeatures {
  const fs = lines.map((l) => voiceFeatures(l, fillers));
  const avg = (k: keyof VoiceFeatures) => fs.reduce((a, f) => a + f[k], 0) / Math.max(1, fs.length);
  return { wordsPerSentence: avg('wordsPerSentence'), exclaim: avg('exclaim'), question: avg('question'), ellipsis: avg('ellipsis'), formal: avg('formal'), casual: avg('casual'), fillers: avg('fillers') };
}

export interface VoiceCheck {
  ok: boolean;
  reasons: string[];
}

/** Cheap post-generation check against the speech profile. */
export function voiceCheck(text: string, speech: Speech, opts: { catchphraseCount?: number; lineCount?: number } = {}): VoiceCheck {
  const reasons: string[] = [];
  if (!text.trim()) reasons.push('empty');
  for (const re of BANNED_META) if (re.test(text)) reasons.push(`meta phrase ${re.source}`);
  const f = voiceFeatures(text, speech.fillers);
  const maxLen = speech.sentenceLen.mean + 3 * speech.sentenceLen.sd + 6;
  if (f.wordsPerSentence > maxLen) reasons.push(`sentences too long (${f.wordsPerSentence.toFixed(1)} > ${maxLen})`);
  if (sentences(text).length > 4) reasons.push('too many sentences');
  if (speech.formality >= 0.7 && f.casual > 1.2) reasons.push('too casual for a formal speaker');
  if (speech.formality <= 0.2 && f.formal > 1.2) reasons.push('too formal for a casual speaker');
  if (speech.catchphrase && opts.lineCount && opts.catchphraseCount !== undefined) {
    const rate = opts.catchphraseCount / Math.max(1, opts.lineCount);
    if (text.includes(speech.catchphrase.text) && rate > speech.catchphrase.maxRate) reasons.push('catchphrase over rate cap');
  }
  return { ok: reasons.length === 0, reasons };
}

/** Pairwise voice-distance matrix from per-character line samples. */
export function voiceDistanceMatrix(samples: Record<string, { lines: string[]; fillers: string[] }>): { ids: string[]; matrix: number[][] } {
  const ids = Object.keys(samples).sort();
  const vecs = ids.map((id) => featureVec(aggregate(samples[id].lines, samples[id].fillers)));
  return { ids, matrix: vecs.map((a) => vecs.map((b) => euclid(a, b))) };
}
