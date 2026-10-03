// Broadcast lag (the show's defining mechanic): an episode airs a couple of episodes after it was lived. Housemates
// watch it on the living-room TV and learn what was said behind their backs, hear the panel, and react.
import type { GameState } from '../model';
import { addLog, addMemory, addRel, housemates, knows, learn } from './core';
import { clamp } from '../util';
import { content } from '../content';

export const BROADCAST_LAG = 2;

/** Episode that airs tonight, if any (null before the first broadcast or once it has been watched). */
export function airingTonight(s: GameState): number | null {
  const ep = s.world.episode - BROADCAST_LAG;
  return ep >= 1 && s.world.flags.aired !== ep ? ep : null;
}

/**
 * Air episode `ep`: every housemate in the house learns its on-camera facts (source 'broadcast') and the panel's
 * remarks about them, and reacts. Returns a one-line summary for the watch scene's premise.
 */
export function airEpisode(s: GameState, ep: number): string {
  s.world.flags.aired = ep;
  const watchers = housemates(s);
  // on camera: anything that happened that episode, except private secrets nobody else heard and world trivia
  const aired = Object.values(s.facts)
    .filter((f) => f.createdEp === ep && f.kind !== 'world' && f.sensitivity >= 0.2 && (f.kind !== 'secret' || watchers.some((w) => w.id !== f.subject && knows(s, w.id, f.id))))
    .sort((a, b) => b.sensitivity - a.sensitivity || (a.id < b.id ? -1 : 1))
    .slice(0, 8);
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
  const remarks = s.panelRemarks.filter((r) => r.episode === ep);
  for (const r of remarks) for (const id of r.participants) if (watchers.some((w) => w.id === id)) addMemory(s, id, `heard the panel say on TV: "${r.text}"`, [id], 0.4);
  const caught = aired.filter((f) => f.about && f.about !== f.subject).slice(0, 2).map((f) => f.content);
  const said = remarks.slice(0, 2).map((r) => `the panel: "${r.text}"`);
  const summary = [`Episode ${ep} airs on the living-room TV.`, ...caught.map((c) => `On screen: ${c}.`), ...said].join(' ');
  addLog(s, { kind: 'system', text: `Episode ${ep} aired. ${caught.length ? `The house saw ${caught.length} moment${caught.length > 1 ? 's' : ''} they weren't there for.` : 'Nothing too embarrassing made the cut.'}`, participants: watchers.map((w) => w.id), salience: caught.length ? 0.7 : 0.3 });
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
export function recordRemarks(s: GameState, episode: number, participants: string[], lines: { text: string }[], moment = '') {
  if (moment) coinNickname(s, participants, moment);
  for (const l of lines.slice(0, 2)) s.panelRemarks.push({ episode, participants, text: l.text.slice(0, 160) });
  if (s.panelRemarks.length > 40) s.panelRemarks.splice(0, s.panelRemarks.length - 40);
}
