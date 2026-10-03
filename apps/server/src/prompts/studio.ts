// Studio panel commentary + chat-app + premise flavor prompts.
import { content, firstName, intermissionTopics, pendingCallbacks, placeName, type EventInstance, type GameState, type PredictionCond } from '@shared-roof/shared';
import { TOKEN_BUDGET, assemble, personaCard, RULES } from './common';

const PANEL_RULES = [
  'You write the studio panel of a reality show: five commentators watching the housemates on a monitor.',
  'They react like real people: jokes, gasps, cutting analysis, romance. They NEVER give gameplay advice or hints, and never speak to the housemates.',
  'Each line ≤ 2 sentences. Only the panel may break the fourth wall. PG-13.',
].join('\n');

/** Nicknames the panel already coined: reused all season, never a second one for the same person. */
const nicknames = (s: GameState) => {
  const n = Object.entries(s.panelNicknames).filter(([id]) => s.characters[id]?.status === 'inHouse').map(([id, k]) => `- ${firstName(s, id)} is "${k.name}" (coined by ${k.by}, episode ${k.episode})`);
  return n.length ? `Nicknames the panel uses for housemates (reuse them; do not invent another for these people):\n${n.join('\n')}` : '';
};

export function commentaryPrompt(
  s: GameState,
  ev: EventInstance,
  transcript: { speaker: string; text: string }[],
  outcome: string | undefined,
  predictionCond: PredictionCond | null,
): string {
  const panel = content().panel.map((p) => `- ${p.id} (${p.name}, ${p.role}): ${p.persona} Favorites: ${p.favorites.join(', ') || 'none'}. Pet peeves: ${p.petPeeves.join(', ')}.`).join('\n');
  const callbacks = pendingCallbacks(s).slice(0, 1).map((p) => `Earlier ${p.by} predicted "${p.text}" — it turned out ${p.resolved ? 'RIGHT' : 'WRONG'}. Have them react to that.`);
  const pred = predictionCond
    ? `Optionally one panelist makes a prediction (set "prediction":{"text":...}) about: ${predictionCond.kind} — ${firstName(s, predictionCond.a)}${predictionCond.b ? ' & ' + firstName(s, predictionCond.b) : ''} by episode ${predictionCond.byEpisode}.`
    : 'No prediction this time.';
  return assemble(
    [
      { text: PANEL_RULES, priority: 100, required: true },
      { text: `Panelists:\n${panel}`, priority: 95, required: true },
      { text: `The scene they just watched: "${ev.title}" at the ${placeName(ev.location)}. ${ev.premise}${outcome ? ` Outcome: confession ${outcome}.` : ''}`, priority: 95, required: true },
      { text: `Transcript:\n${transcript.slice(-10).map((l) => `${s.characters[l.speaker] ? firstName(s, l.speaker) : l.speaker}: ${l.text}`).join('\n')}`, priority: 80 },
      { text: callbacks.join('\n'), priority: 70 },
      { text: nicknames(s), priority: 75 },
      {
        text: [
          '2–4 panelists speak. reaction is one of laugh, gasp, cringe, aww, silence, groan.',
          ev.freeze ? 'Also give a freezeFrame caption (≤ 6 words, lowercase).' : '',
          pred,
          'Output JSON only: {"lines":[{"speaker":"<panelist id>","text":"...","reaction":"laugh"}],"freezeFrame":{"caption":"..."},"prediction":{"text":"..."}}',
        ].filter(Boolean).join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.commentary,
  );
}

/** Intermission: the show cuts to the studio mid-episode / at the end, and the panel talks over recent footage. */
export function intermissionPrompt(s: GameState, at: 'mid' | 'end', since: number): string {
  const panel = content().panel.map((p) => `- ${p.id} (${p.name}, ${p.role}): ${p.persona}`).join('\n');
  const topics = intermissionTopics(s, since).map((l) => `- ${l.text}`).join('\n') || '- a quiet stretch; nothing big happened';
  return assemble(
    [
      { text: PANEL_RULES, priority: 100, required: true },
      { text: `Panelists:\n${panel}`, priority: 95, required: true },
      { text: `${at === 'mid' ? 'The host pauses the tape halfway through the episode.' : 'The episode just ended; the host wraps up.'} What the panel just watched:\n${topics}`, priority: 95, required: true },
      { text: nicknames(s), priority: 80 },
      {
        text: [
          `nagumo speaks first${at === 'end' ? ' and last (a one-line sign-off)' : ''}. 3–6 lines total; panelists riff on each other, use nicknames for housemates. reaction is one of laugh, gasp, cringe, aww, silence, groan.`,
          'Output JSON only: {"lines":[{"speaker":"<panelist id>","text":"...","reaction":"laugh"}]}',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.commentary,
  );
}

export function chatPrompt(s: GameState, from: string, to: string, thread: { from: string; text: string }[]): string {
  const c = s.characters[from];
  const sp = c.persona.speech.chat;
  return assemble(
    [
      { text: RULES, priority: 100, required: true },
      { text: personaCard(s, c, { compact: true }), priority: 90, required: true },
      { text: `Chat-app style: stamps ${sp.stampRate > 0.4 ? 'often' : 'rarely'}, punctuation ${sp.punctuation}.`, priority: 80 },
      { text: `Recent messages:\n${thread.slice(-6).map((m) => `${firstName(s, m.from)}: ${m.text}`).join('\n')}`, priority: 70 },
      { text: `Write ${c.name}'s next private chat message to ${firstName(s, to)}. One short message, lowercase is fine. Output the message text only.`, priority: 100, required: true },
    ],
    TOKEN_BUDGET.chat,
  );
}

/** One visual line for a freeze-frame (SillyTavern's "Scenario" image mode): staging, not dialogue. */
export function shotPrompt(s: GameState, ev: EventInstance, transcript: { speaker: string; text: string }[]): string {
  const who = ev.participants.map((id) => firstName(s, id)).join(', ');
  return [
    `A reality show freeze-frame of "${ev.title}" at the ${placeName(ev.location)} with ${who}.`,
    `What just happened: ${ev.premise}`,
    `Last lines:\n${transcript.slice(-4).map((l) => `${s.characters[l.speaker] ? firstName(s, l.speaker) : l.speaker}: ${l.text}`).join('\n')}`,
    'Describe the single frame in one sentence (max 35 words): who stands or sits where, their poses and expressions, one key prop. Use the names. No dialogue, no camera talk, nothing explicit.',
  ].join('\n\n');
}

export function flavorPrompt(premise: string): string {
  return `${RULES}\n\nRewrite this scene premise in one or two vivid sentences. Keep every name and fact; do not add events.\nPremise: ${premise}\nOutput the rewritten premise only.`;
}
