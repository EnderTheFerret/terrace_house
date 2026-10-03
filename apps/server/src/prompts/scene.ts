// Scene prompts: beat sheet (stage 1), line realization (stage 2), delta proposal.
import { firstName, type Beat, type EventInstance, type GameState, type Intent } from '@shared-roof/shared';
import { content } from '@shared-roof/shared';
import { RULES, TOKEN_BUDGET, assemble, knowledgeBlock, loreBlock, memoriesBlock, personaCard, relationshipLine, sceneHeader, type Section } from './common';

/** What each player intent means, so the LLM realizes it faithfully. */
export const INTENT_GUIDE: Record<Intent, string> = {
  honest: 'candidly says what they really think or feel about the topic, even if it is a little awkward.',
  deflect: 'sidesteps the topic with a light change of subject.',
  flirt: 'gently flirts: a warm compliment or playful hint of interest (PG-13).',
  support: 'offers sincere reassurance or help.',
  joke: 'lightens the mood with a joke.',
  tease: 'playfully teases the other person.',
  apologize: 'apologizes sincerely and specifically.',
  confront: 'calmly but directly raises the problem.',
  confess: 'confesses romantic feelings plainly.',
  decline: 'kindly but clearly says no.',
  listen: 'mostly listens, inviting them to say more.',
};

function speakers(s: GameState, ev: EventInstance) {
  return ev.participants.map((id) => s.characters[id]).filter(Boolean);
}

function outsiderCards(ev: EventInstance): string {
  const npcs = content().npcs.filter((n) => Object.values(ev.roles).includes(n.id));
  return npcs.map((n) => `## ${n.name} (id: ${n.id}), ${n.role}; ${n.traits.join(', ')}. Example: "${n.lines[0]}"`).join('\n');
}

function contextSections(s: GameState, ev: EventInstance, lastLines: Record<string, string[]> = {}, speakerIds?: string[], query = ev.premise, recalled: Record<string, string[]> = {}): Section[] {
  const cs = speakers(s, ev).filter(c => !speakerIds || speakerIds.includes(c.id));
  const out: Section[] = [{ text: RULES, priority: 100, required: true }];
  for (const c of cs) out.push({ text: personaCard(s, c, { compact: cs.length > 2, lastLines: lastLines[c.id] }), priority: 90, required: true });
  const oc = outsiderCards(ev);
  if (oc) out.push({ text: oc, priority: 85 });
  for (const c of cs) out.push({ text: ev.participants.filter(id => id !== c.id && s.characters[id]).map(id => relationshipLine(s, c.id, id)).join('\n'), priority: 70 });
  for (const c of cs) out.push({ text: knowledgeBlock(s, c.id, ev), priority: 65 });
  for (const c of cs) out.push({ text: memoriesBlock(s, c.id, ev.participants, 3, query, recalled[c.id]), priority: 75 });
  out.push({ text: loreBlock(query), priority: 55 });
  out.push({ text: sceneHeader(s, ev), priority: 95, required: true });
  return out;
}

export function beatSheetPrompt(s: GameState, ev: EventInstance): string {
  const t = content().eventById.get(ev.templateId)!;
  const ids = [...ev.participants, ...content().npcs.filter((n) => Object.values(ev.roles).includes(n.id)).map((n) => n.id)];
  return assemble(
    [
      ...contextSections(s, ev),
      {
        text: [
          `Write a beat sheet of ${Math.min(8, Math.max(4, t.beats.length))} beats for this scene.`,
          `Suggested shape: ${t.beats.filter((b) => b !== 'choice').join(' → ')}.`,
          `speaker must be one of: ${ids.join(', ')}. beatType one of: open, smalltalk, probe, reveal, deflect, tease, flirt, conflict, comfort, silence, interrupt, confess, accept, reject, apologize, joke, close.`,
          'Each beat: speaker, intent (what they try to do), emotion, beatType, subtext (what they mean vs say), depth (smalltalk|personal|vulnerable, never deeper than allowed), topic.',
          'Output JSON only: {"beats":[...]}',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.beats,
  );
}

export function linesPrompt(
  s: GameState,
  ev: EventInstance,
  beats: Beat[],
  transcript: { speaker: string; text: string }[],
  intents: (Intent | undefined)[],
  /** the player's own typed words that line 1 answers */
  replyTo?: string,
  /** memories recalled by meaning per speaker (embeddings), sticky for the scene */
  recalled: Record<string, string[]> = {},
): string {
  const last: Record<string, string[]> = {};
  for (const l of transcript) (last[l.speaker] ??= []).push(l.text);
  const beatLines = beats.map((b, i) => {
    const who = s.characters[b.speaker] ? firstName(s, b.speaker) : b.speaker;
    const intent = intents[i] ? ` PLAYER INTENT "${intents[i]}": ${INTENT_GUIDE[intents[i]!]} Say it in ${who}'s own voice, reacting to the previous line.` : '';
    if (replyTo && i === 0) return `1. ${b.speaker} (${who}) — answer the player's exact words: ${JSON.stringify(replyTo)}. This response overrides the scripted topic and beat. Acknowledge refusals without bargaining, proposing the refused activity again, or speaking for the player.`;
    return `${i + 1}. ${b.speaker} (${who}) — ${b.beatType}, ${b.emotion}, topic "${b.topic}", depth ${b.depth}${b.subtext ? `, subtext: ${b.subtext}` : ''}.${intent}`;
  });
  const sofar = transcript.slice(-6).map((l) => `${l.speaker}: ${l.text}`).join('\n');
  return assemble(
    [
      ...contextSections(s, ev, last, beats.map(b => b.speaker), [ev.premise, ...transcript.slice(-4).map(l => l.text), replyTo ?? ''].join(' '), recalled),
      { text: sofar ? `Conversation so far:\n${sofar}` : '', priority: replyTo ? 99 : 60, required: !!replyTo },
      {
        text: replyTo
          ? `${firstName(s, s.playerId)} just said, in their own words: "${replyTo.replace(/"/g, "'")}". Line 1 answers exactly that, the way this person really would given how they feel about ${firstName(s, s.playerId)}: they may agree, push back, dodge, tease or open up. Never ignore it, never repeat it back verbatim, never speak for ${firstName(s, s.playerId)}.`
          : '',
        priority: 100,
        required: !!replyTo,
      },
      {
        text: [
          'Write exactly one line per beat, in order, each on its own line formatted as `speaker_id: text`.',
          `Allowed speaker ids: ${[...new Set(beats.map(b => b.speaker))].join(', ')}. Use these exact ids, never display names. No extra turns or narration.`,
          beats.some(b => b.speaker === s.playerId) ? '' : `Never write ${s.playerId}'s speech, actions, thoughts or agreement. The player speaks for themselves.`,
          'Each line 1–3 short sentences in that speaker\'s voice. Silence beats can be "..." or a tiny action in parentheses.',
          'Beats:',
          ...beatLines,
          replyTo ? `Return all ${beats.length} required lines. In the first line, explicitly acknowledge the player's request or boundary: ${JSON.stringify(replyTo)}. Then write the remaining listed beats.` : '',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.lines,
  );
}

export function deltaPrompt(s: GameState, ev: EventInstance, transcript: { speaker: string; text: string }[], choices: Record<string, string>): string {
  const ids = ev.participants.join(', ');
  return assemble(
    [
      { text: RULES, priority: 100, required: true },
      { text: sceneHeader(s, ev), priority: 95, required: true },
      ...ev.participants.slice(0, 3).map((a, i) => ({ text: ev.participants.slice(0, 3).filter((b) => b !== a).map((b) => (s.characters[a] && s.characters[b] ? relationshipLine(s, a, b) : '')).join('\n'), priority: 70 - i })),
      { text: `Transcript:\n${transcript.slice(-12).map((l) => `${l.speaker}: ${l.text}`).join('\n')}`, priority: 90, required: true },
      { text: Object.keys(choices).length ? `Chosen intents: ${Object.entries(choices).map(([k, v]) => `${k}=${v}`).join(', ')}` : '', priority: 80 },
      {
        text: [
          'Propose how this scene changed feelings. Use only these ids: ' + ids + '.',
          'Directed deltas from→to, small integers between -15 and 15 (most |delta| ≤ 6). moodDeltas between -0.3 and 0.3.',
          'newMemories: one short memory per participant who would remember this, salience 0..1.',
          'Output JSON only: {"affinityDeltas":[],"romanceDeltas":[],"tensionDeltas":[],"trustDeltas":[],"newMemories":[],"moodDeltas":[]}',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.deltas,
  );
}

/** Parse `speaker_id: text` lines; returns texts aligned to beats (missing → null). */
export function parseLines(raw: string, beats: Beat[]): (string | null)[] {
  const rows = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: (string | null)[] = beats.map(() => null);
  let bi = 0;
  for (const row of rows) {
    if (bi >= beats.length) break;
    const m = row.match(/^\**\s*(?:\d+[.)]\s*)?([\w-]+)\**\s*(?:\([^)]*\))?\s*[:：]\s*(.+)$/);
    if (!m) continue;
    const text = m[2].replace(/^["“]|["”]$/g, '').trim();
    if (!text) continue;
    if (m[1] !== beats[bi].speaker) continue;
    out[bi++] = text;
  }
  return out;
}
