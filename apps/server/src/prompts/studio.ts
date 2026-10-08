// Studio panel commentary + chat-app + premise flavor prompts.
import { attracted, content, firstName, intermissionTopics, isCouple, pendingCallbacks, placeName, rel, SLOTS, type EventInstance, type Footage, type GameState, type PredictionCond } from '@shared-roof/shared';
import { TOKEN_BUDGET, aboutPlayer, assemble, dayLine, housematesBlock, memoriesBlock, nowLine, personaCard, plansBlock, relationshipLine, RULES } from './common';

const PANEL_RULES = [
  'You write the studio panel of a Terrace House-style reality show: five commentators on a sofa, rewatching the housemates\' footage together.',
  'They talk to EACH OTHER, not to the camera: like friends gossiping over a rewatch. They tease, interrupt, pile on a joke, and openly disagree about what someone meant.',
  'Everything they say is about the footage they were shown: they quote or closely paraphrase what a housemate actually said ("when she said \'...\'"), read the motive behind it, and judge it. No generic remark that could fit any scene, and never invent a line or event that is not in the footage.',
  'They NEVER give gameplay advice or hints, and never speak to the housemates. Each line ≤ 2 sentences. Only the panel may break the fourth wall. PG-13.',
].join('\n');

/** Panel talk is a conversation: who answers whom. */
const PANEL_FLOW = 'After the first line, each panelist answers what the previous one just said (agree, tease, push back, often by name: "Saeki, come on"), then adds their own read. Include at least one real disagreement about a housemate\'s motive, played to the panelists\' personalities.';

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
      { text: `Transcript (what they actually said):\n${transcript.slice(-12).map((l) => `${s.characters[l.speaker] ? firstName(s, l.speaker) : l.speaker}: ${l.text}`).join('\n')}`, priority: 80 },
      { text: callbacks.join('\n'), priority: 70 },
      { text: nicknames(s), priority: 75 },
      {
        text: [
          `3–5 lines from 2–4 panelists about THIS scene; at least one line quotes a specific line from the transcript. ${PANEL_FLOW} reaction is one of laugh, gasp, cringe, aww, silence, groan.`,
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
export function intermissionPrompt(s: GameState, at: 'mid' | 'end', since: number, footage: Footage[] = []): string {
  const panel = content().panel.map((p) => `- ${p.id} (${p.name}, ${p.role}): ${p.persona} Favorites: ${p.favorites.join(', ') || 'none'}.`).join('\n');
  const topics = intermissionTopics(s, since, 5).map((l) => `- ${l.text}`).join('\n');
  // later clips are dropped first when the budget is tight, so the strongest footage comes first
  const clips = footage.slice(0, 4).map((f, i) => ({
    text: `Clip ${i + 1}: "${f.title}" at the ${f.place}\n${f.lines.slice(-8).map((l) => `${l.name}: ${l.text}`).join('\n')}`,
    priority: 90 - i,
    required: i === 0,
  }));
  return assemble(
    [
      { text: PANEL_RULES, priority: 100, required: true },
      { text: `Panelists:\n${panel}`, priority: 95, required: true },
      { text: `${at === 'mid' ? 'The host pauses the tape halfway through the episode.' : 'The episode just ended; the host wraps up.'} Here is the footage the panel just watched.`, priority: 100, required: true },
      ...clips,
      { text: topics ? `Other things that happened in the house:\n${topics}` : clips.length ? '' : 'A quiet stretch; nothing big happened. The panel talks about the quiet itself and who is avoiding whom.', priority: 85, required: !clips.length },
      { text: nicknames(s), priority: 80 },
      {
        text: [
          `nagumo speaks first, naming the moment to discuss${at === 'end' ? ', and last (a one-line sign-off)' : ''}. 5–8 lines total, covering the clips${topics ? ' and events' : ''} above in order of how juicy they are.`,
          `${PANEL_FLOW} At least two lines quote or closely paraphrase something a housemate said in a clip. Use the nicknames for housemates.`,
          'reaction is one of laugh, gasp, cringe, aww, silence, groan.',
          'Output JSON only: {"lines":[{"speaker":"<panelist id>","text":"...","reaction":"laugh"}]}',
        ].join('\n'),
        priority: 100,
        required: true,
      },
    ],
    TOKEN_BUDGET.intermission,
  );
}

/** "[today]" / "[yesterday]" for a message tick: the world tick advances once per time block, six blocks a day. */
function sent(s: GameState, tick?: number): string {
  if (tick === undefined) return '';
  const day = Math.floor((SLOTS.indexOf(s.world.slot) - (s.world.tick - tick)) / SLOTS.length);
  return day >= 0 ? '[today]' : day === -1 ? '[yesterday]' : `[${-day} days ago]`;
}

export function chatPrompt(s: GameState, from: string, to: string, thread: { from: string; text: string; tick?: number }[], note?: string): string {
  const c = s.characters[from];
  const sp = c.persona.speech.chat;
  return assemble(
    [
      { text: RULES, priority: 100, required: true },
      { text: personaCard(s, c, { compact: true }), priority: 90, required: true },
      { text: `Chat-app style: stamps ${sp.stampRate > 0.4 ? 'often' : 'rarely'}, punctuation ${sp.punctuation}.`, priority: 80 },
      { text: `${dayLine(s, [from, to])}\n${nowLine(s, from)}; they are texting, not in the same room as ${firstName(s, to)}.`, priority: 95, required: true },
      { text: plansBlock(s, from), priority: 85 },
      { text: housematesBlock(s), priority: 72 },
      { text: to === s.playerId ? aboutPlayer(s) : '', priority: 88, required: true },
      { text: memoriesBlock(s, from, [from, to], 3, thread.slice(-2).map((m) => m.text).join(' ')), priority: 75 },
      { text: `Recent messages:\n${thread.slice(-6).map((m) => `${sent(s, m.tick)} ${firstName(s, m.from)}: ${m.text}`).join('\n')}`, priority: 90, required: true },
      { text: `Write ${c.name}'s reply to ${firstName(s, to)}'s latest text: ${thread.at(-1)?.text ?? 'hello'}. One brief message for a casual chat or simple request, such as hanging out. Reply directly; do not narrate a scene, write a whole conversation, or speak for the sender. Lowercase is fine. Output the message text only.${note ? ` ${note}` : ''}`, priority: 100, required: true },
    ],
    TOKEN_BUDGET.chat,
  );
}

/** Interaction types worth writing out as a real exchange; the rest stay one-line summaries. */
export const OVERHEARD_TYPES = ['bicker', 'flirt', 'confess', 'deep', 'apology', 'chat', 'joke', 'awkward', 'gossip', 'help', 'household', 'cold', 'jealousy'];

/**
 * Two housemates' background exchange. The engine already decided the type and how it ends; the model only voices it,
 * low-key, so a petty snap stays petty and a rejection stays polite.
 */
export function overheardPrompt(s: GameState, a: string, b: string, type: string, place: string, summary?: string): string {
  const [A, B] = [s.characters[a], s.characters[b]];
  const [an, bn] = [firstName(s, a), firstName(s, b)];
  const warm = attracted(B, A) && rel(s, b, a).romance > 10;
  // what each of the four lines does; the engine's outcome is baked in so the words match what actually happens
  const petty = ['the dishes left in the sink', 'music played too loud', 'someone eating their food', 'the bathroom taking forever', 'a plan that got changed without asking'][(s.world.tick + a.length) % 5];
  const beats: Record<string, string[]> = {
    household: [`${an} starts a small conversation while they help around the house`, `${bn} answers and shares the practical work`, `${an} adds a detail from their day`, `${bn} answers warmly without turning it into a romance`],
    help: [`${an} notices ${bn} has had a tiring day and checks in`, `${bn} shares one ordinary difficulty`, `${an} offers a small practical kindness`, `${bn} appreciates it; the problem is not magically solved`],
    cold: [`${an} answers ${bn} briefly and keeps distance`, `${bn} notices and asks if something is wrong`, `${an} declines a longer talk without cruelty`, `${bn} gives them space; the tension remains`],
    jealousy: [`${an} admits a jealous worry from the supplied known event, without treating it as proof`, `${bn} responds in character`, `${an} explains the worry without inventing cheating or an unseen event`, `${bn} answers; it remains unresolved`],
    joke: [`${an} makes a specific small joke`, `${bn} plays along`, `${an} builds on it`, `${bn} laughs and adds their own twist`],
    gossip: [`${an} starts a quiet conversation`, `${bn} answers`, `${an} adds only something from their own known facts, or keeps it vague`, `${bn} responds without learning an invented secret`],
    awkward: [`${an} tries small talk`, `${bn} gives a hesitant answer`, `${an} tries again`, `${bn} answers briefly; it stays awkward`],
    bicker: [`${an} snaps at ${bn} about ${petty}, annoyed but not shouting`, `${bn} gets defensive and answers back`, `${an} pushes back, sharper`, `${bn} ends it curtly; nothing is resolved`],
    flirt: [`${an} gives ${bn} a real, specific compliment or teases them`, warm ? `${bn} is a little flustered and plays along` : `${bn} notices and kindly deflects`, warm ? `${an} lingers, a bit bolder` : `${an} laughs it off, a little embarrassed`, `${bn} answers; it stays light and open`],
    confess: [`${an} says there is something they need to say`, `${bn} waits, guessing what it is`, `${an} says plainly that they have feelings for ${bn}`, isCouple(s, a, b) ? `${bn} says they feel the same` : `${bn} is kind but says they do not feel the same way`],
    deep: [`${an} admits something they rarely say out loud, about ${A.persona.goals.long.text.replace(/\.$/, '')}`, `${bn} asks one gentle question`, `${an} answers more honestly than expected`, `${bn} shares something small of their own`],
    apology: [`${an} says sorry to ${bn} for something small they did`, `${bn} is a bit stiff about it`, `${an} explains briefly and means it`, `${bn} accepts and the tension eases`],
  };
  const plan = beats[type] ?? [`${an} starts talking to ${bn}`, `${bn} answers`, `${an} adds more`, `${bn} replies`];
  return [
    RULES,
    personaCard(s, A, { compact: true }),
    personaCard(s, B, { compact: true }),
    `How they stand: ${relationshipLine(s, a, b)}`,
    ...(type === 'gossip' ? [`Only discuss facts both already know: ${Object.keys(s.knowledge[a] ?? {}).filter(id => s.knowledge[b]?.[id] && s.facts[id]?.kind !== 'secret').slice(-3).map(id => s.facts[id]?.content).join(' | ') || 'none; keep this an ordinary quiet chat'}. Do not disclose a secret or introduce a new allegation.`] : []),
    ...(summary ? [`The recorded moment you are voicing: ${summary}. Match it exactly; do not invent its cause or outcome.`] : []),
    dayLine(s, [a, b]),
    `Scene: ${an} and ${bn} are alone together in the ${place}. Keep it low-key and true to their personalities, with no big plot twist. The player is not part of this; do not mention them.`,
    `Write exactly 4 lines, one per step, each on its own line as \`speaker_id: text\`:\n${plan.map((p, i) => `${i + 1}. ${i % 2 ? b : a} (${i % 2 ? bn : an}): ${p}`).join('\n')}`,
    `Use only the ids ${a} and ${b}. Each line is 1–2 short sentences of only the words said aloud: no asterisks, stage directions, narration, quotation marks or backticks, and never end after fewer than 4 lines.`,
  ].join('\n\n');
}

/** Who gets a staged action: the last speaker, plus the player when they spoke or acted in the last few lines. */
export function shotIds(s: GameState, ev: EventInstance, transcript: { speaker: string }[]): string[] {
  const speaker = transcript.findLast((l) => ev.participants.includes(l.speaker) && s.characters[l.speaker])?.speaker ?? ev.participants[0];
  const player = ev.participants.includes(s.playerId) && transcript.slice(-4).some((l) => l.speaker === s.playerId) ? s.playerId : undefined;
  return [...new Set([speaker, player])].filter((id): id is string => !!id && !!s.characters[id]);
}

/** One short action for the current speaker (and the player's own typed action); the game supplies everyone else's body language. */
export function shotPrompt(s: GameState, ev: EventInstance, transcript: { speaker: string; text: string }[]): string {
  const who = [...new Set(ev.participants)].filter((id) => s.characters[id]).slice(0, 6).map((id) => `${id}: ${firstName(s, id)}`).join(', ');
  const swimmers = ev.participants.filter((id) => s.characters[id]?.swimming).map((id) => firstName(s, id));
  const ids = shotIds(s, ev, transcript);
  return [
    `A reality show freeze-frame of "${ev.title}" at the ${placeName(ev.location)} with ${who}.`,
    `What just happened: ${ev.premise}`,
    ...(swimmers.length ? [`In the pool water: ${swimmers.join(', ')}. Everyone else is out of the water.`] : []),
    `Last lines:\n${transcript.slice(-4).map((l) => `${s.characters[l.speaker] ? firstName(s, l.speaker) : l.speaker}: ${l.text}`).join('\n')}`,
    `Output JSON only: {${ids.map((id) => `"${id}":"short action"`).join(',')}}. For each listed person describe their expression, posture and action from the last lines, max 100 characters. Match the scene activity: seated around the table and eating at meals, dancing at a club, talking and sipping coffee at a cafe, seated for sofa conversations, cooking at a counter, or moving during physical activities. Preserve the scene's positions and clothes. Do not add swimming or new clothing. Use props established by the scene activity or dialogue; do not invent unrelated props${ids.length > 1 ? `; ${firstName(s, s.playerId)}'s own typed action (such as lighting a cigarette or waving) must be shown as written` : ''}. Omit names, other people, dialogue and camera talk. Nothing explicit.`,
  ].join('\n\n');
}

export function flavorPrompt(premise: string): string {
  return `${RULES}\n\nRewrite this scene premise in one or two vivid sentences. Keep every name and fact; do not add events.\nPremise: ${premise}\nOutput the rewritten premise only.`;
}
