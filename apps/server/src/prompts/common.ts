// Shared prompt pieces + budgeted assembly. Order: rules → persona → relationship → memories → premise → output.
import {
  firstName, knownFacts, placeName, pairSummaryText, topMemories, referencesFor, TRAIT_NAMES, moodWord, content, TRIPS, outsiderOf,
  type Character, type EventInstance, type GameState,
} from '@shared-roof/shared';

export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export const RULES = [
  'You write dialogue for a calm, slow-paced reality show about six adult housemates (all 20+) sharing a house in Tel Aviv, Israel.',
  'Stay strictly in persona. No meta commentary, no narration about cameras, scripts, AI or the audience.',
  'Content rating PG-13: flirting, dates, confessions, hand-holding, at most a kiss. Nothing explicit.',
  'Respect refusals and personal boundaries. Religious practice, kashrut, Shabbat and dietary choices are never a punchline.',
  'Reality-TV register: short conversational lines, hesitations, understatement, awkward silences. 1–3 short sentences per line.',
  'Characters only know what is listed as their knowledge. Never reveal facts a speaker does not know.',
  'Use supplied biography and memories; never invent family history or past events. Speakers know their own persona, not another person\'s private background.',
].join('\n');

/** Compressed persona card (speech params, exemplars, do-not list, needs/mood). */
export function personaCard(s: GameState, c: Character, opts: { compact?: boolean; lastLines?: string[] } = {}): string {
  const p = c.persona;
  const sp = p.speech;
  const traits = p.traits.map((t, i) => `${TRAIT_NAMES[i].slice(0, 4)} ${t.toFixed(1)}`).join(', ');
  const lines = [
    `## ${c.name} (id: ${c.id}), ${c.age}, ${c.occupation}`,
    `Voice: ${c.voiceNotes}`,
    `Food: ${p.diet}; kashrut ${p.kashrut}. Shabbat observance: ${p.keepsShabbat ? 'yes; no work, cooking, phone or driving Friday evening to Saturday evening' : 'no'}. Respect these choices without mocking.`,
    `Speech: ~${sp.sentenceLen.mean} words/sentence, formality ${sp.formality.toFixed(1)}, humor ${sp.humor}${sp.fillers.length ? `, fillers: ${sp.fillers.join(' / ')}` : ''}${sp.catchphrase ? `, catchphrase (rare): "${sp.catchphrase.text}"` : ''}.`,
    `Examples: ${sp.exemplars.map((e) => `"${e}"`).join(' ')}`,
  ];
  if (sp.doNot.length) lines.push(`Do not: ${sp.doNot.join('; ')}.`);
  if (!opts.compact) {
    lines.push(`Own background: ${p.backstory.slice(0, 240)}`);
    if (!c.isPlayer) {
      const [fam, friend, ex] = (['family', 'friend', 'ex'] as const).map((k) => outsiderOf(c, k));
      lines.push(`Life outside the house: their ${fam.who}${fam.name.includes(fam.who) ? '' : ` ${fam.name}`} back in ${c.hometown}; best friend ${friend.name}; an ex, ${ex.name}. Mention them only if it fits.`);
    }
    lines.push(`Personality: ${traits}; ${p.attachment} attachment; conflict style ${p.conflictStyle}; values ${p.values.slice(0, 3).join(', ')}.`);
    lines.push(`Wants: ${p.goals.long.text}. Right now: ${p.goals.short.text}. Tells when hiding something: ${p.tells.join(', ') || 'none'}.`);
    lines.push(`Mood: ${moodWord(c.mood)}. Most pressing need: ${pressingNeed(c)}.`);
    const diary = s.diaries[c.id]?.at(-1);
    if (diary) lines.push(`Their diary after episode ${diary.episode}: ${diary.text.slice(0, 300)}`);
  }
  if (opts.lastLines?.length) lines.push(`Their last lines: ${opts.lastLines.slice(-2).map((l) => `"${l}"`).join(' ')}`);
  return lines.join('\n');
}

/**
 * End-of-episode diary prompt (SillyTavern Summarize shape): only this housemate's own memories and knowledge, so the
 * knowledge invariant holds. Keeps situation, events, revealed facts, relationships, promises, secrets and open hooks.
 */
export function diaryPrompt(s: GameState, id: string, episode: number): string {
  const c = s.characters[id];
  const today = (s.memory[id] ?? []).filter((m) => m.episode === episode).map((m) => `- ${m.text}`);
  const known = knownFacts(s, id).filter((f) => f.createdEp === episode).slice(0, 8).map((f) => `- ${f.content}`);
  const last = s.diaries[id]?.at(-1)?.text;
  const others = Object.values(s.characters).filter((o) => o.status === 'inHouse' && o.id !== id);
  return assemble(
    [
      { text: RULES, priority: 100, required: true },
      { text: personaCard(s, c, { compact: true }), priority: 95, required: true },
      { text: last ? `${c.name.split(' ')[0]}'s previous diary entry: ${last}` : '', priority: 60 },
      { text: `What ${c.name.split(' ')[0]} lived through in episode ${episode}:\n${today.join('\n') || '- a quiet day'}${known.length ? `\nWhat they learned:\n${known.join('\n')}` : ''}`, priority: 95, required: true },
      { text: `How they currently see the others:\n${others.map((o) => `- ${o.name.split(' ')[0]}: ${pairSummaryText(s, id, o.id)}`).join('\n')}`, priority: 80 },
      {
        text: [
          `Write ${c.name.split(' ')[0]}'s private diary entry for tonight, first person, in their voice, 3-5 sentences: what happened to me, how I feel, what I plan next.`,
          'Then one line per housemate: how I see them now (feelings, promises, secrets I hold about them, unresolved things).',
          'Use only the events and facts listed above. Invent nothing. No style notes.',
          'Output JSON only: {"diary":"...","pairs":[{"name":"<first name>","summary":"..."}]}',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.summary + 400,
  );
}

export function pressingNeed(c: Character): string {
  return Object.entries(c.needs).sort((a, b) => b[1] - a[1])[0][0];
}

export function relationshipLine(s: GameState, a: string, b: string): string {
  return pairSummaryText(s, a, b);
}

export function memoriesBlock(s: GameState, charId: string, involving: string[], k = 3, query = '', recalled: string[] = []): string {
  const texts = [...new Set([...recalled, ...topMemories(s, charId, k, involving, query).map((m) => m.text)])].slice(0, k + recalled.length);
  return texts.length ? `${firstName(s, charId)} remembers: ${texts.join(' | ')}` : '';
}

/**
 * World lorebook (SillyTavern World Info): a place or a recurring outsider enters the prompt only when someone
 * mentions it, which keeps prompts inside the token budget.
 */
export function loreBlock(query: string): string {
  const q = query.toLowerCase();
  const hit = (name: string) => name.toLowerCase().split(/[\s(),]+/).some((w) => w.length >= 5 && q.includes(w));
  const entries = [
    ...content().city.nodes.filter((n) => n.id !== 'house' && hit(n.name)).map((n) => `${n.name}: ${n.description}`),
    ...content().npcs.filter((n) => hit(n.name)).map((n) => `${n.name}: ${n.role}; ${n.traits.join(', ')}`),
    ...Object.values(TRIPS).filter((t) => hit(t.name)).map((t) => `${t.name}: ${t.blurb}`),
  ].slice(0, 3);
  return entries.length ? `World notes (mentioned just now):\n${entries.map((e) => `- ${e}`).join('\n')}` : '';
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
