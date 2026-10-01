// Shared prompt pieces + budgeted assembly. Order: rules → persona → relationship → memories → premise → output.
import {
  firstName, knownFacts, placeName, rel, topMemories, referencesFor, TRAIT_NAMES, moodWord,
  type Character, type EventInstance, type GameState,
} from '@shared-roof/shared';

export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export const RULES = [
  'You write dialogue for a calm, slow-paced reality show about six adult housemates (all 20+) sharing a house in a Japanese coastal city.',
  'Stay strictly in persona. No meta commentary, no narration about cameras, scripts, AI or the audience.',
  'Content rating PG-13: flirting, dates, confessions, hand-holding, at most a kiss. Nothing explicit.',
  'Reality-TV register: short conversational lines, hesitations, understatement, awkward silences. 1–3 short sentences per line.',
  'Characters only know what is listed as their knowledge. Never reveal facts a speaker does not know.',
].join('\n');

/** Compressed persona card (speech params, exemplars, do-not list, needs/mood). */
export function personaCard(s: GameState, c: Character, opts: { compact?: boolean; lastLines?: string[] } = {}): string {
  const p = c.persona;
  const sp = p.speech;
  const traits = p.traits.map((t, i) => `${TRAIT_NAMES[i].slice(0, 4)} ${t.toFixed(1)}`).join(', ');
  const lines = [
    `## ${c.name} (id: ${c.id}), ${c.age}, ${c.occupation}`,
    `Voice: ${c.voiceNotes}`,
    `Speech: ~${sp.sentenceLen.mean} words/sentence, formality ${sp.formality.toFixed(1)}, humor ${sp.humor}${sp.fillers.length ? `, fillers: ${sp.fillers.join(' / ')}` : ''}${sp.catchphrase ? `, catchphrase (rare): "${sp.catchphrase.text}"` : ''}.`,
    `Examples: ${sp.exemplars.map((e) => `"${e}"`).join(' ')}`,
  ];
  if (sp.doNot.length) lines.push(`Do not: ${sp.doNot.join('; ')}.`);
  if (!opts.compact) {
    lines.push(`Personality: ${traits}; ${p.attachment} attachment; conflict style ${p.conflictStyle}; values ${p.values.slice(0, 3).join(', ')}.`);
    lines.push(`Wants: ${p.goals.long.text}. Right now: ${p.goals.short.text}. Tells when hiding something: ${p.tells.join(', ') || 'none'}.`);
    lines.push(`Mood: ${moodWord(c.mood)}. Most pressing need: ${pressingNeed(c)}.`);
  }
  if (opts.lastLines?.length) lines.push(`Their last lines: ${opts.lastLines.slice(-2).map((l) => `"${l}"`).join(' ')}`);
  return lines.join('\n');
}

export function pressingNeed(c: Character): string {
  return Object.entries(c.needs).sort((a, b) => b[1] - a[1])[0][0];
}

export function relationshipLine(s: GameState, a: string, b: string): string {
  const summary = s.pairSummary[`${a}>${b}`];
  if (summary) return summary;
  const r = rel(s, a, b);
  return `${firstName(s, a)}→${firstName(s, b)}: affinity ${Math.round(r.affinity)}, romance ${Math.round(r.romance)}, tension ${Math.round(r.tension)}, trust ${Math.round(r.trust)}.`;
}

export function memoriesBlock(s: GameState, charId: string, involving: string[], k = 3): string {
  const ms = topMemories(s, charId, k, involving.length > 1 ? involving.slice(0, 2) : undefined);
  return ms.length ? `${firstName(s, charId)} remembers: ${ms.map((m) => m.text).join(' | ')}` : '';
}

/** What a speaker knows that matters here (beliefs, never ground truth they don't know). */
export function knowledgeBlock(s: GameState, charId: string, ev: EventInstance): string {
  const refs = ev.factRefs[charId] ?? [];
  const facts = refs.map((id) => s.facts[id]).filter(Boolean);
  const extra = knownFacts(s, charId)
    .filter((f) => !refs.includes(f.id) && f.subject !== charId && ev.participants.includes(f.subject) && f.sensitivity >= 0.3)
    .slice(0, 1);
  const all = [...facts, ...extra];
  if (!all.length) return '';
  const tag = (fid: string) => s.knowledge[charId]?.[fid]?.source ?? 'rumor';
  return `${firstName(s, charId)} knows: ${all.map((f) => `${f.content} [${tag(f.id)}]`).join(' | ')}`;
}

export function sceneHeader(s: GameState, ev: EventInstance): string {
  const refs = referencesFor(s, ev.participants).slice(0, 2);
  return [
    `Scene: "${ev.title}" at the ${placeName(ev.location)}, ${s.world.slot}, ${s.world.weather}, episode ${s.world.episode}.`,
    `Premise: ${ev.premise}`,
    `Conversation depth allowed: ${ev.depthCeiling}.`,
    refs.length ? `Shared references they might recall: ${refs.map((r) => r.text).join('; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface Section {
  text: string;
  /** lower = dropped first when over budget; required sections are never dropped */
  priority: number;
  required?: boolean;
}

/** Assemble sections in the given order, dropping the lowest-priority optional ones until within maxTokens. */
export function assemble(sections: Section[], maxTokens: number): string {
  const live = sections.filter((x) => x.text.trim());
  const total = () => live.reduce((a, x) => a + approxTokens(x.text) + 1, 0);
  while (total() > maxTokens) {
    const optional = live.filter((x) => !x.required);
    if (!optional.length) break;
    const drop = optional.reduce((m, x) => (x.priority < m.priority ? x : m));
    live.splice(live.indexOf(drop), 1);
  }
  let out = live.map((x) => x.text).join('\n\n');
  // hard cap: truncate from the middle of the longest required section
  if (approxTokens(out) > maxTokens) out = out.slice(0, maxTokens * 4);
  return out;
}

export const TOKEN_BUDGET = { beats: 1100, lines: 1500, deltas: 1000, commentary: 1000, chat: 500, flavor: 400, summary: 600 } as const;
