// Season epilogues per housemate (template-based; real mode may rewrite via LLM).
import type { Character, GameState } from '../model';
import { firstName, rel } from './core';

export function epilogueFor(s: GameState, c: Character): string {
  const n = firstName(s, c.id);
  const cp = s.couples.find((x) => (x.a === c.id || x.b === c.id) && x.status !== 'broken');
  const partner = cp ? firstName(s, cp.a === c.id ? cp.b : cp.a) : null;
  const arc = s.arcs[c.id];
  const arcLine = arc?.outcome === 'complete' ? ` ${n} saw their story through.` : arc && arc.done.length ? ` ${n}'s story was left half-told.` : '';
  const closest = Object.entries(s.rel[c.id] ?? {})
    .filter(([id]) => s.characters[id] && id !== partner)
    .sort((a, b) => b[1].affinity - a[1].affinity)[0]?.[0];
  const friend = closest ? ` Still texts ${firstName(s, closest)} every week.` : '';
  if (partner) {
    if (cp?.status === 'left-together') return `${n} and ${partner} left together. Last seen sharing one umbrella at the station.${arcLine}`;
    return c.status === 'left'
      ? `${n} ${c.leftReason ?? 'left the house'} in episode ${c.leftEp}. Still dating ${partner}, who made their own decision about staying.${arcLine}`
      : `${n} stayed until the final episode, still dating ${partner}.${arcLine}`;
  }
  if (c.status === 'left') return `${n} ${c.leftReason ?? 'left the house'} in episode ${c.leftEp}.${arcLine}${friend}`;
  const fond = closest && rel(s, c.id, closest).affinity > 40 ? friend : ' Says the house changed them, a little.';
  return `${n} stayed until the final episode.${arcLine}${fond}`;
}
