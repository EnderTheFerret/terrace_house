// Studio panel commentary + chat-app + premise flavor prompts.
import { content, firstName, pendingCallbacks, placeName, type EventInstance, type GameState, type PredictionCond } from '@shared-roof/shared';
import { TOKEN_BUDGET, assemble, personaCard, RULES } from './common';

const PANEL_RULES = [
  'You write the studio panel of a reality show: five commentators watching the housemates on a monitor.',
  'They react like real people: jokes, gasps, cutting analysis, romance. They NEVER give gameplay advice or hints, and never speak to the housemates.',
  'Each line ≤ 2 sentences. Only the panel may break the fourth wall. PG-13.',
].join('\n');

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

export function flavorPrompt(premise: string): string {
  return `${RULES}\n\nRewrite this scene premise in one or two vivid sentences. Keep every name and fact; do not add events.\nPremise: ${premise}\nOutput the rewritten premise only.`;
}
