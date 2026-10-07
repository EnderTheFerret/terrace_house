// Scene prompts: beat sheet (stage 1), line realization (stage 2), delta proposal.
import { firstName, guestCharacter, outsiderOf, type Beat, type EventInstance, type GameState, type Intent } from '@shared-roof/shared';
import { content } from '@shared-roof/shared';
import { RULES, TOKEN_BUDGET, aboutPlayer, assemble, elsewhereBlock, housematesBlock, knowledgeBlock, loreBlock, memoriesBlock, nowLine, personaCard, plansBlock, relationshipLine, sceneHeader, type Section } from './common';

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

function outsiderCards(s: GameState, ev: EventInstance): string {
  const npcs = content().npcs.filter((n) => Object.values(ev.roles).includes(n.id));
  return npcs.map((n) => `## ${guestCharacter(s, n.id)?.name ?? n.name} (id: ${n.id}), adult guest, ${n.role}; ${n.traits.join(', ')}. Example: "${n.lines[0]}"`).join('\n');
}

function contextSections(s: GameState, ev: EventInstance, lastLines: Record<string, string[]> = {}, speakerIds?: string[], query = ev.premise, recalled: Record<string, string[]> = {}): Section[] {
  const cs = speakers(s, ev).filter(c => !speakerIds || speakerIds.includes(c.id));
  const out: Section[] = [{ text: RULES, priority: 100, required: true }];
  for (const c of cs) {
    let card = personaCard(s, c, { compact: !!speakerIds || cs.length > 2, lastLines: lastLines[c.id], examples: !speakerIds });
    if (speakerIds) {
      if (/\b(?:your (?:job|work|career)|work|job|hospital|restaurant|surf(?:ing)?|music|cooking|breakfast)\b/i.test(query)) card += `\n${firstName(s, c.id)}'s own background: ${c.persona.backstory.slice(0, 240)}`;
      if (/\b(?:where (?:are you|did you grow up)|your hometown)\b/i.test(query)) card += `\n${firstName(s, c.id)}'s hometown: ${c.hometown}.`;
      if (/\b(?:your (?:family|sister|brother|parents?|ex|best friend))\b/i.test(query)) {
        const family = outsiderOf(c, 'family');
        card += `\n${firstName(s, c.id)}'s own contacts: ${family.who} ${family.name}; best friend ${outsiderOf(c, 'friend').name}; ex ${outsiderOf(c, 'ex').name}. These are this speaker's contacts, never the player's.`;
      }
    }
    out.push({ text: card, priority: 90, required: true });
  }
  const oc = outsiderCards(s, ev);
  if (oc) out.push({ text: oc, priority: 85 });
  for (const c of cs) out.push({ text: ev.participants.filter(id => id !== c.id && s.characters[id]).map(id => relationshipLine(s, c.id, id)).join('\n'), priority: 70 });
  for (const c of cs) out.push({ text: knowledgeBlock(s, c.id, ev), priority: 65 });
  for (const c of cs) out.push({ text: memoriesBlock(s, c.id, ev.participants, 3, query, recalled[c.id]), priority: 75 });
  for (const c of cs) out.push({ text: plansBlock(s, c.id), priority: 80 });
  if (ev.participants.includes(s.playerId)) out.push({ text: aboutPlayer(s), priority: 92, required: true });
  out.push({ text: elsewhereBlock(s, ev.participants), priority: 60 });
  out.push({ text: housematesBlock(s), priority: 82 });
  if (ev.location !== 'phone') out.push({ text: `What they were doing when this started: ${cs.map(c => nowLine(s, c.id)).join('; ')}.`, priority: 88 });
  if (ev.location === 'phone') out.push({ text: `This is a text conversation; they are not in the same room. ${ev.participants.filter(id => s.characters[id]).map(id => nowLine(s, id)).join('; ')}.`, priority: 94, required: true });
  out.push({ text: loreBlock(query), priority: 55 });
  out.push({ text: sceneHeader(s, ev), priority: 95, required: true });
  if (ev.tags.includes('household')) out.push({ text: ev.participants.some(id => s.characters[id]?.actionHousehold)
    ? 'The household activity is still underway. Let practical small moments sit alongside the conversation; follow the player’s topic.'
    : 'The household activity has finished. Continue talking during the break or over the finished meal; do not restart the task or cook another meal.', priority: 96, required: true });
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
          'In group scenes, give multiple housemates turns addressing and reacting to each other. Do not make every turn a question to the player.',
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
    if (replyTo) return `${i + 1}. ${b.speaker} (${who}) — ${b.intent}; ${i === 0 ? `answer the player's exact words: ${JSON.stringify(replyTo)}` : 'react to the player and the preceding housemate, adding your own response'}.${last[b.speaker]?.length ? ` Your previous turn was ${JSON.stringify(last[b.speaker].at(-1))}. Connect your answer to that statement rather than starting over.` : ''} This response overrides the scripted topic and beat. Acknowledge refusals without bargaining, proposing the refused activity again, or speaking for the player.`;
    return `${i + 1}. ${b.speaker} (${who}) — ${b.beatType}, ${b.emotion}, intent "${b.intent}", topic "${b.topic}", depth ${b.depth}${b.subtext ? `, subtext: ${b.subtext}` : ''}.${intent}`;
  });
  const sofar = transcript.slice(-12).map((l) => `${l.speaker}: ${l.text}`).join('\n');
  return assemble(
    [
      ...contextSections(s, ev, last, beats.map(b => b.speaker), [ev.premise, ...transcript.slice(-4).map(l => l.text), replyTo ?? ''].join(' '), recalled),
      { text: sofar ? `Conversation so far (continue this exchange; the premise describes how it began):\n${sofar}` : '', priority: 99, required: !!sofar },
      {
        text: replyTo
          ? `Continue the latest turn from ${firstName(s, s.playerId)}. Answer what they are asking in relation to what you just said. When challenged about an earlier claim, explain, qualify or retract it; if avoiding the question, make that evasion clear. Do not reverse your position without acknowledging why, substitute a slogan for an answer, or invent a past event to justify yourself. Private motives guide the response but need not be confessed. Housemates may disagree, tease or set boundaries without becoming hostile by default. Never speak for the player.`
          : '',
        priority: 100,
        required: !!replyTo,
      },
      {
        text: [
          `The player is ${firstName(s, s.playerId)} (id: ${s.playerId}). In the player's words, "my" means the player's own life, not a housemate's. A question about the player's sister does not identify her name or establish a prior meeting.`,
          'Write exactly one line per beat, in order, each on its own line formatted as `speaker_id: text`.',
          `Allowed speaker ids: ${[...new Set(beats.map(b => b.speaker))].join(', ')}. Use these exact ids, never display names. Put physical actions and narration in *asterisks*, separate from spoken words. Narration may describe other participants but never becomes this speaker's speech. Keep the full reply on one line, with no backticks or extra turns.`,
          beats.some(b => b.speaker === s.playerId) ? '' : `Never write ${s.playerId}'s speech, actions, thoughts or agreement. The player speaks for themselves.`,
          replyTo
            ? 'Use one or two spoken sentences, plus at most one brief physical action. Finish the thought; brevity must not remove the explanation that connects it to the previous turn. A personal anecdote or new question is optional. Use only supplied facts for personal details; do not invent a flatmate, invitation, audition, possession or past incident.'
            : 'Use one or two spoken sentences, plus an optional brief action. Silence beats can be "...".',
          'Housemates can address each other. Each later beat reacts to the preceding speaker rather than restarting the topic or always addressing the player.',
          'Answer practical offers with a concrete preference or choice. Prefer specific reactions to stock praise like "a total vibe", "that is a move" or "that was actually funny". Slang and jokes are optional, even for an outgoing speaker.',
          'Beats:',
          ...beatLines,
          replyTo ? `Return all ${beats.length} required lines. Answer a practical question, react to a joke, or give your own opinion as appropriate. Only an actual refusal needs a boundary acknowledgment. Each housemate adds something rather than repeating the same acknowledgment.` : '',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.lines,
  );
}

export function deltaPrompt(s: GameState, ev: EventInstance, transcript: { speaker: string; text: string; recipient?: string }[], choices: Record<string, string>): string {
  const ids = ev.participants.join(', ');
  return assemble(
    [
      { text: 'Evaluate relationship changes after a conversation between adult housemates. Return JSON matching the schema, rather than dialogue.', priority: 100, required: true },
      { text: sceneHeader(s, ev), priority: 95, required: true },
      ...ev.participants.slice(0, 3).map((a, i) => ({ text: ev.participants.slice(0, 3).filter((b) => b !== a).map((b) => (s.characters[a] && s.characters[b] ? relationshipLine(s, a, b) : '')).join('\n'), priority: 70 - i })),
      { text: `Transcript:\n${transcript.filter((l, i) => i >= transcript.length - 12 || l.speaker === s.playerId).map((l) => `${l.speaker}${l.recipient ? ` (to ${l.recipient})` : ''}: ${l.text}`).join('\n')}`, priority: 100, required: true },
      { text: Object.keys(choices).length ? `Chosen intents: ${Object.entries(choices).map(([k, v]) => `${k}=${v}`).join(', ')}` : '', priority: 80 },
      {
        text: [
          'Propose how this scene changed feelings. Use only these ids: ' + ids + '.',
          'Directed deltas from→to, small integers between -15 and 15 (most |delta| ≤ 6). moodDeltas between -0.3 and 0.3.',
          'Read the transcript: a sincere compliment, kindness or shared laugh raises the listener\'s affinity toward the speaker (about +2 to +4); rudeness or dismissal lowers it. Do not return empty arrays for a real exchange.',
          `The player is ${s.playerId}. For the player's words, include the addressed housemate's affinity toward ${s.playerId} (from=housemate_id, to=${s.playerId}). A housemate appreciates being complimented; do not report only the player's feelings about being welcomed. Respect explicit (to id) addressees.`,
          'Judge the words actually spoken, even when they contradict the premise or chosen intents. An insult such as "I hate you" warrants negative affinity from its listener toward its speaker, not a friendly arrival bonus.',
          'newMemories: one short memory per participant who would remember this, salience 0..1.',
          'Return all six fields: affinityDeltas, romanceDeltas, tensionDeltas, trustDeltas, newMemories, moodDeltas. Populate affinityDeltas with actual {"from":"listener_id","to":"speaker_id","delta":signed_number} entries for this exchange. Unchanged fields may be empty arrays.',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.deltas + Math.ceil(transcript.filter(l => l.speaker === s.playerId).reduce((n, l) => n + l.text.length, 0) / 4),
  );
}

/** Remove roleplay markup without deleting actions or the end of a reply. */
const spoken = (t: string) => t.replace(/[*`"“”]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Parse `speaker_id: text` lines; returns texts aligned to beats (missing → null). Tolerates bold/backticked or capitalised
 * ids, `*actions*`, quote wrapping, narration paragraphs, and a speaker's quoted words continuing on the next paragraph.
 */
export function parseLines(raw: string, beats: Beat[], keepMarkup = false): (string | null)[] {
  const rows = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: (string | null)[] = beats.map(() => null);
  let bi = 0;
  let open = -1; // the beat whose words a quoted, unlabeled paragraph would continue
  for (const row of rows) {
    const m = row.match(/^[`*\s]*(?:\d+[.)]\s*)?([\w-]+)[`*]*\s*(?:\([^)]*\))?\s*[:：]\s*(.+)$/);
    if (m) {
      open = -1;
      if (bi >= beats.length) continue;
      const text = keepMarkup ? m[2].trim() : spoken(m[2]);
      if (!text) continue;
      if (m[1].toLowerCase() !== beats[bi].speaker.toLowerCase()) { open = -1; continue; }
      out[bi] = text;
      open = bi++;
    } else if (!m && open >= 0) {
      const more = keepMarkup ? row : spoken(row);
      if (more) out[open] = keepMarkup ? `${out[open]} ${more}` : spoken(`${out[open]} ${more}`);
    }
  }
  return out;
}
