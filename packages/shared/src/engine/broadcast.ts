// Three lived days make one broadcast episode; it airs three days after its final recorded day. Housemates
// watch it on the living-room TV and learn what was said behind their backs, hear the panel, and react.
import type { GameState } from '../model';
import { addLog, addMemory, addRel, housemates, knows, learn } from './core';
import { clamp } from '../util';
import { content } from '../content';

export const BROADCAST_DAYS = 3;
export const BROADCAST_LAG = 3;
export const broadcastDays = (episode: number) => ({ start: (episode - 1) * BROADCAST_DAYS + 1, end: episode * BROADCAST_DAYS, airs: episode * BROADCAST_DAYS + BROADCAST_LAG });
export const airedBroadcast = (s: GameState) => s.world.flags.broadcastDays === BROADCAST_DAYS && typeof s.world.flags.aired === 'number' ? s.world.flags.aired : 0;

/** Episode that airs tonight, if any (null before the first broadcast or once it has been watched). */
export function airingTonight(s: GameState): number | null {
  if (s.world.slot !== 'evening' || s.seasonOver) return null;
  const ep = airedBroadcast(s) + 1;
  return s.world.episode >= broadcastDays(ep).airs ? ep : null;
}

export function broadcastPanel(s: GameState, ep: number) {
  if (s.world.flags.broadcastPanelEpisode === ep && typeof s.world.flags.broadcastPanel === 'string') {
    try { return JSON.parse(s.world.flags.broadcastPanel) as GameState['panelRemarks']; } catch { /* Older saves retain their recorded remarks. */ }
  }
  const range = broadcastDays(ep);
  return s.panelRemarks.filter(r => r.episode >= range.start && r.episode <= range.end);
}

export function broadcastHighlights(s: GameState, ep: number) {
  if (s.world.flags.broadcastHighlightsEpisode === ep && typeof s.world.flags.broadcastHighlights === 'string') {
    try { return JSON.parse(s.world.flags.broadcastHighlights) as { day: number; text: string; participants: string[]; salience: number; factId?: string }[]; } catch { /* Older saves can rebuild the edit from retained events. */ }
  }
  const range = broadcastDays(ep);
  const watchers = housemates(s);
  const facts = Object.values(s.facts).filter(f => f.kind !== 'world' && f.sensitivity >= 0.2 && (f.kind !== 'secret' || watchers.some(w => w.id !== f.subject && knows(s, w.id, f.id))));
  return Array.from({ length: BROADCAST_DAYS }, (_, i) => range.start + i).flatMap(day => {
    const moments = [
      ...facts.filter(f => f.createdEp === day).map(f => ({ day, text: f.content, participants: [f.subject, ...(f.about ? [f.about] : [])], salience: f.sensitivity, factId: f.id })),
      ...s.log.filter(l => l.episode === day && ['scene', 'arrival', 'departure', 'arc', 'couple', 'confession'].includes(l.kind)).map(l => ({ day, text: l.text, participants: l.participants, salience: l.salience, factId: l.factId })),
    ].sort((a, b) => b.salience - a.salience);
    return moments.filter((m, i) => moments.findIndex(other => other.text === m.text) === i).slice(0, 3);
  });
}

/**
 * Air episode `ep`: every housemate in the house learns its on-camera facts (source 'broadcast') and the panel's
 * remarks about them, and reacts. Returns a one-line summary for the watch scene's premise.
 */
export function airEpisode(s: GameState, ep: number, viewerIds = housemates(s).map(c => c.id)): string {
  s.world.flags.broadcastDays = BROADCAST_DAYS;
  s.world.flags.aired = ep;
  const watchers = housemates(s).filter(c => viewerIds.includes(c.id));
  const range = broadcastDays(ep);
  const highlights = broadcastHighlights(s, ep);
  s.world.flags.broadcastHighlightsEpisode = ep;
  s.world.flags.broadcastHighlights = JSON.stringify(highlights);
  // on camera: anything that happened that episode, except private secrets nobody else heard and world trivia
  const aired = Object.values(s.facts)
    .filter((f) => highlights.some(moment => moment.factId === f.id))
    .sort((a, b) => b.sensitivity - a.sensitivity || (a.id < b.id ? -1 : 1));
  for (const f of aired) for (const w of watchers) {
    if (!learn(s, w.id, f.id, 'broadcast')) continue;
    if (f.subject === w.id) {
      // seeing yourself on TV: the more sensitive, the more it stings
      if (f.sensitivity >= 0.6) w.mood = clamp(w.mood - 0.08, -1, 1);
      continue;
    }
    if (f.about !== w.id || !s.characters[f.subject]) continue;
    // said about me, behind my back
    if (f.kind === 'romance' || f.kind === 'confession') {
      addRel(s, w.id, f.subject, 'closeness', 2);
      addMemory(s, w.id, `saw on the broadcast: ${f.content}`, [w.id, f.subject], 0.6);
    } else {
      addRel(s, w.id, f.subject, 'tension', 4);
      addRel(s, w.id, f.subject, 'trust', -3);
      addMemory(s, w.id, `found out from the broadcast: ${f.content}`, [w.id, f.subject], 0.7);
    }
  }
  for (const moment of highlights) for (const w of watchers) addMemory(s, w.id, `watched day ${moment.day} on episode ${ep}: ${moment.text}`, [...new Set([w.id, ...moment.participants])], Math.max(0.4, moment.salience));
  const remarks = broadcastPanel(s, ep);
  s.world.flags.broadcastPanelEpisode = ep;
  s.world.flags.broadcastPanel = JSON.stringify(remarks);
  for (const r of remarks) for (const w of watchers) addMemory(s, w.id, `heard ${content().panel.find(p => p.id === r.speaker)?.name ?? 'the panel'} say on TV: "${r.text}"`, [...new Set([w.id, ...r.participants])], 0.4);
  const said = Array.from({ length: BROADCAST_DAYS }, (_, i) => range.start + i).flatMap(day => remarks.filter(r => r.episode === day).slice(0, 1).map(r => `Day ${day}, the panel: "${r.text}"`));
  const summary = [`Episode ${ep}, covering days ${range.start}–${range.end}, airs on day ${s.world.episode} on the living-room TV.`, ...highlights.map(m => `Day ${m.day}, on screen: ${m.text}.`), ...said].join(' ');
  addLog(s, { kind: 'system', text: `Episode ${ep} aired, covering days ${range.start}–${range.end}. The house watched ${highlights.length} highlights.`, participants: watchers.map((w) => w.id), salience: highlights.length ? 0.7 : 0.3 });
  return summary;
}

const NICKNAMES: [RegExp, string][] = [
  [/confess/i, 'Confession'], [/date/i, 'Date Night'], [/fight|conflict|bicker|confront/i, 'Thunder'], [/cook|kitchen|dinner/i, 'Chef'],
  [/flirt|romance/i, 'Smooth'], [/farewell|cry|sad|homesick/i, 'Tissues'], [/awkward/i, 'Awkward'], [/joke|prank/i, 'Comedian'],
];

/**
 * The panel coins a nickname for a housemate from a memorable moment (once per person, by the panel's nickname-giver)
 * and reuses it for the rest of the season.
 */
export function coinNickname(s: GameState, participants: string[], moment: string) {
  const prefix = NICKNAMES.find(([re]) => re.test(moment))?.[1];
  const who = participants.find((id) => s.characters[id] && !s.panelNicknames[id]);
  if (!prefix || !who) return;
  const panel = content().panel;
  const by = (panel.find((p) => /nickname/i.test(p.persona)) ?? panel[0]).id;
  s.panelNicknames[who] = { name: `${prefix} ${s.characters[who].name.split(' ')[0]}`, by, episode: s.world.episode };
}

/** Store the panel's lines about a scene so they can reach the house when that episode airs. */
export function recordRemarks(s: GameState, episode: number, participants: string[], lines: { speaker?: string; text: string }[], moment = '') {
  if (moment) coinNickname(s, participants, moment);
  for (const l of lines) s.panelRemarks.push({ episode, participants, ...(l.speaker ? { speaker: l.speaker } : {}), text: l.text });
  const airedThrough = airedBroadcast(s) * BROADCAST_DAYS;
  const old = s.panelRemarks.filter(r => r.episode <= airedThrough).slice(-20);
  s.panelRemarks = [...old, ...s.panelRemarks.filter(r => r.episode > airedThrough)];
}
