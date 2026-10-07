// Shared prompt pieces + budgeted assembly. Order: rules → persona → relationship → memories → premise → output.
import {
  firstName, knownFacts, placeName, pairSummaryText, topMemories, referencesFor, TRAIT_NAMES, moodWord, content, TRIPS, outsiderOf, clockLabel, dateLabel, planWhen, isOutdoors, isRoom, knowsPlan, planFactId,
  type Character, type EventInstance, type GameState,
} from '@shared-roof/shared';
import { worldInfoBlock } from './lorebook';

export const approxTokens = (s: string) => Math.ceil(s.length / 4);

export const RULES = [
  'You write dialogue for a calm, slow-paced reality show about six adult housemates (all 20+) sharing a house in Tel Aviv, Israel.',
  'Stay strictly in persona. No AI talk or omniscient commentary about scripts or audience reactions. Housemates can discuss being filmed or their reasons for joining the show when the conversation raises it.',
  'Content rating PG-13: flirting, dates, confessions, hand-holding, at most a kiss. Nothing explicit.',
  'Respect refusals and personal boundaries. Religious practice, kashrut, Shabbat and dietary choices are never a punchline.',
  'Reality-TV register: short conversational lines, hesitations, understatement, awkward silences. 1–3 short sentences per line.',
  'Play the people in the room: respond to what was actually said and let ordinary details carry the conversation. Humor, hesitation and slang fit the moment; do not perform a personality trait in every line.',
  'Use natural dialogue with optional brief actions when the requested format allows them. Avoid motivational slogans and polished summaries of the other person\'s feelings.',
  'Characters only know what is listed as their knowledge. Never reveal facts a speaker does not know.',
  'Use supplied biography and memories; never invent family history or past events. Speakers know their own persona, not another person\'s private background.',
  'Background facts are available context, not topics you must introduce. Never invent a connection, prior meeting, relative, promise, possession or shared experience to make a reply interesting. If something is unknown, leave it unknown or ask naturally.',
  'A speaker may know their own habits and public world information. Another speaker\'s private card is not shared knowledge. Keep dietary, religious and work habits exactly as supplied.',
  'Time is real: the day number, clock, plans and dated memories are given. Refer only to listed events with their stated timing; never invent what happened earlier today, yesterday or "last week", and never claim history from before two people met.',
].join('\n');

const when = (s: GameState, episode: number) => {
  const d = s.world.episode - episode;
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};

/** Day count and how long these people have known each other, so nobody recalls "last week" on move-in day. */
export function dayLine(s: GameState, ids: string[]): string {
  const people = ids.map((id) => s.characters[id]).filter(Boolean);
  const met = Math.max(1, ...people.map((c) => c.arrivedEp));
  const since = s.world.episode - met;
  const today = people.filter((c) => c.arrivedEp >= s.world.episode).map((c) => c.name.split(' ')[0]).join(' and ');
  return `It is day ${s.world.episode} in the house (${dateLabel(s.world.day)}), ${clockLabel(s.world.slot, s.world.minutes)}. ${since <= 0
    ? `${today} moved in today: nobody here shares any history, routine or plan with ${today.includes(' and ') ? 'them' : today} from before today.`
    : `They have lived together for ${since} day${since === 1 ? '' : 's'}; nothing between them happened before day ${met}.`}`;
}

const DOING: Record<string, string> = {
  work: 'at work', sleep: 'asleep', nap: 'napping', shower: 'in the shower', cook: 'cooking', eat: 'eating', snack: 'having a snack', exercise: 'working out',
  hobby: 'on a hobby', goOut: 'out', household: 'doing housework', swim: 'swimming', text: 'on the phone', retreat: 'having time alone', tidy: 'tidying',
};

/** Where a housemate is and what they are doing right now (true state, so nobody guesses). */
export function nowLine(s: GameState, id: string): string {
  const c = s.characters[id];
  return `${firstName(s, id)} (${placeName(c.location)}): ${DOING[c.lastAction ?? ''] ?? 'free'}`;
}

/** Housemates outside this conversation, so "where's Ren?" has a true answer. */
export function elsewhereBlock(s: GameState, ids: string[]): string {
  const away = Object.values(s.characters).filter((c) => c.status === 'inHouse' && !c.isPlayer && !ids.includes(c.id));
  return away.length ? `Elsewhere right now: ${away.map((c) => nowLine(s, c.id)).join('; ')}.` : '';
}

const SLOT_ORDER = ['morning', 'slot1', 'slot2', 'slot3', 'evening', 'lateNight'];

/** A speaker's own plans: upcoming ones, the one happening now, and how today's turned out. */
export function plansBlock(s: GameState, id: string): string {
  const ep = s.world.episode;
  const now = SLOT_ORDER.indexOf(s.world.slot);
  const status = { pending: 'not answered yet', accepted: 'agreed', kept: 'they met as planned', broken: 'it fell through', declined: 'declined or postponed' } as const;
  const rows = s.invitations.filter((p) => (p.from === id || p.to === id) && (
    ['pending', 'accepted'].includes(p.status) ? p.episode > ep || p.episode === ep && SLOT_ORDER.indexOf(p.slot) >= now : p.episode === ep
  )).slice(-4).map((p) => `${firstName(s, p.from)} invited ${firstName(s, p.to)} ${p.date ? 'on a private date ' : ''}to ${placeName(p.node)}${p.performance ? ` for ${p.performance.title}` : ''} ${planWhen(s, p)} (${status[p.status]})`);
  // other people's upcoming plans, only the ones this person was told about or that are open to the house
  const heard = s.invitations.filter((p) => p.from !== id && p.to !== id && p.status === 'accepted' && knowsPlan(s, id, p)
    && (p.episode > ep || p.episode === ep && SLOT_ORDER.indexOf(p.slot) >= now)).slice(-3)
    .map((p) => `${firstName(s, p.from)} and ${firstName(s, p.to)} at ${placeName(p.node)} ${planWhen(s, p)}${!p.date ? ' (house calendar)' : ` (a date; ${s.knowledge[id]?.[planFactId(p)]?.from ? `heard from ${firstName(s, s.knowledge[id][planFactId(p)].from!)}` : 'heard'})`}`);
  return [
    rows.length ? `${firstName(s, id)}'s plans: ${rows.join('; ')}.` : '',
    heard.length ? `${firstName(s, id)} knows of others' plans: ${heard.join('; ')}. Any other dates are private and unknown to them.` : '',
  ].filter(Boolean).join('\n');
}

/** Public knowledge about the house: everyone's move-in introduction, so nobody guesses a job. */
export function housematesBlock(s: GameState): string {
  const mates = Object.values(s.characters).filter((c) => c.status === 'inHouse' && !c.isPlayer)
    .map((c) => `${c.name.split(' ')[0]}: ${c.age}, ${c.occupation}, from ${c.hometown}`);
  return `Housemates as introduced at move-in (public; private lives stay unknown unless listed elsewhere): ${mates.join('; ')}.`;
}

/** The real place and state of the house, so small talk is about what is actually there. */
export function surroundingsLine(s: GameState, loc: string): string {
  const node = content().city.nodes.find((n) => n.id === loc);
  if (node) return `${node.name}: ${node.description}`;
  if (!isRoom(loc)) return '';
  const h = s.house;
  const notes = [
    h.dishes >= 60 && 'dishes are piling up in the sink', h.laundry >= 60 && 'the laundry basket is overflowing', h.trash >= 60 && 'the trash needs taking out',
    h.noise >= 60 && 'the house is noisy', Object.values(h.fridge).reduce((a, b) => a + b, 0) < 3 && 'the fridge is nearly empty',
  ].filter(Boolean);
  return `${isOutdoors(loc) ? 'Outdoors' : 'Indoors'} at home.${notes.length ? ` Around the house: ${notes.join('; ')}.` : ' The house is in decent shape.'}`;
}

/** What housemates may say about the player: their introduction once they have lived together, nothing invented. */
export function aboutPlayer(s: GameState): string {
  const P = s.characters[s.playerId];
  const first = P.name.split(' ')[0];
  const intro = s.world.episode > P.arrivedEp ? ` From move-in introductions: ${P.age}, works as ${P.occupation}, from ${P.hometown}.` : '';
  return `About ${first} (the player):${intro} Anything else about ${first} (family, past, partner, job details, plans, opinions, how their day went) is unknown unless ${first} said it or a speaker's memories list it. Ask instead of assuming.`;
}

/** Compressed persona card (speech params, exemplars, do-not list, needs/mood). */
export function personaCard(s: GameState, c: Character, opts: { compact?: boolean; lastLines?: string[]; examples?: boolean } = {}): string {
  const p = c.persona;
  const sp = p.speech;
  const traits = p.traits.map((t, i) => `${TRAIT_NAMES[i].slice(0, 4)} ${t.toFixed(1)}`).join(', ');
  const lines = [
    `## ${c.name} (id: ${c.id}), ${c.age}, ${c.occupation}`,
    `Voice tendencies (use lightly): ${c.voiceNotes.replace('Fast, slangy, hype-heavy. Turns everything into a bit or a clip. Jokes when things get serious.', 'Sociable, informal and quick to joke. Interested in filming, but capable of a plain practical answer. Sometimes dodges serious feelings with humor.')}`,
    `Food: ${p.diet}; kashrut ${p.kashrut}. Shabbat observance: ${p.keepsShabbat ? 'yes; no work, cooking, phone or driving Friday evening to Saturday evening' : 'no'}. Respect these choices without mocking.`,
    `Speech: ${sp.sentenceLen.mean <= 8 ? 'brief' : 'conversational'} sentences; ${sp.formality >= 0.7 ? 'measured and polite' : sp.formality <= 0.2 ? 'casual' : 'easygoing'}. Humor and hesitation are optional.`,
    'Do not repeat a filler, catchphrase or opening from their recent lines. Their voice is also what they notice, want and avoid.',
    `Wants: ${p.goals.long.text}. Right now: ${p.goals.short.text}. These guide their choices, not topics to recite.`,
  ];
  if (opts.examples !== false) lines.push(`Voice examples (cadence only, not lines to copy): ${sp.exemplars.map(e => `"${e}"`).join(' ')}`);
  if (sp.doNot.length) lines.push(`Do not: ${sp.doNot.join('; ')}.`);
  if (!opts.compact) {
    lines.push(`Own background: ${p.backstory.slice(0, 240)}`);
    if (!c.isPlayer) {
      const [fam, friend, ex] = (['family', 'friend', 'ex'] as const).map((k) => outsiderOf(c, k));
      lines.push(`${c.name.split(' ')[0]}'s own life outside the house: ${fam.who}${fam.name.includes(fam.who) ? '' : ` ${fam.name}`} back in ${c.hometown}; best friend ${friend.name}; an ex, ${ex.name}. These are this speaker's contacts, never the player's. Mention them only if it fits.`);
    }
    lines.push(`Personality: ${traits}; ${p.attachment} attachment; conflict style ${p.conflictStyle}; values ${p.values.slice(0, 3).join(', ')}.`);
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

/** Memories tagged with when they happened, plus today's moments with people outside this scene (true things to bring up). */
export function memoriesBlock(s: GameState, charId: string, involving: string[], k = 3, query = '', recalled: string[] = []): string {
  const own = [...(s.memory[charId] ?? []), ...(s.memoryArchive?.[charId] ?? [])];
  const dated = (text: string) => { const m = own.find((x) => x.text === text); return m ? `${text} (${when(s, m.episode)})` : text; };
  const texts = [...new Set([...recalled, ...topMemories(s, charId, k, involving, query).map((m) => m.text)])].slice(0, k + recalled.length);
  // ponytail: salience < 0.6 marks everyday moments (chores, meals, chats); weightier private ones still surface only by keyword
  const today = (s.memory[charId] ?? []).filter((m) => m.episode === s.world.episode && m.salience < 0.6 && !texts.includes(m.text) && m.participants.some((p) => p !== charId && !involving.includes(p)))
    .sort((a, b) => b.salience - a.salience).slice(0, 2).map((m) => m.text);
  return [
    texts.length ? `${firstName(s, charId)} remembers: ${texts.map(dated).join(' | ')}` : '',
    today.length ? `Earlier today, away from this conversation: ${today.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
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
  return [worldInfoBlock(query), entries.length ? `Game locations and guests (fictional):\n${entries.map((e) => `- ${e}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
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
    `Scene: "${ev.title}" at the ${placeName(ev.location)}, ${s.world.weather}.`,
    dayLine(s, ev.participants),
    surroundingsLine(s, ev.location),
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
  // Preserve the final output instructions when required context alone exceeds the budget.
  while (out.length > maxTokens * 4) {
    const candidates = live.filter(x => x.text.length > 69);
    if (!candidates.length) { out = out.slice(0, maxTokens * 4); break; }
    const priority = Math.min(...candidates.map(x => x.priority));
    const section = candidates.filter(x => x.priority === priority).reduce((a, b) => a.text.length > b.text.length ? a : b);
    const keep = Math.max(64, section.text.length - (out.length - maxTokens * 4) - 5);
    section.text = section.text.slice(0, Math.ceil(keep / 2)) + '[...]' + section.text.slice(-Math.floor(keep / 2));
    out = live.map(x => x.text).join('\n\n');
  }
  return out;
}

// ponytail: chars/4 estimate against Ollama's 8192 num_ctx; group scenes need room for memories and plans, not just cards.
export const TOKEN_BUDGET = { beats: 3000, lines: 3500, deltas: 1000, commentary: 1000, chat: 1400, flavor: 400, summary: 600 } as const;
