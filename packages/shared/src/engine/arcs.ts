// Personal arcs (Section 5.5F): condition-triggered state machines; beats feed the director as forced candidates.
import type { Arc } from '../contentSchema';
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { evalAll, type Binding } from './conditions';
import { flag, housemates, rel } from './core';
import { jobOf, jobNode, jobSchedule } from './agents';
import { addLog } from './core';
import { postGroupChat } from './house';
import { hashSeed } from '../rng';

const CATEGORY: Record<string,string> = { craft:'trades', fitness:'creative', education:'office', 'public service':'office', events:'service', beauty:'service', travel:'service', delivery:'service' };

export function careerCategory(c: Character, s?: GameState): string | undefined {
  const contract = c.isPlayer && s?.world.playerJob;
  if (contract) return contract.nodeId === 'grill' ? 'food' : contract.nodeId === 'livehouse' ? 'creative' : 'service';
  const category = jobOf(c.occupation)?.category;
  return category ? CATEGORY[category] ?? category : undefined;
}

function careerArc(c: Character, s?: GameState): Arc | undefined {
  const category = careerCategory(c,s);
  const arcs = content().arcs.filter((a) => a.category === category);
  return arcs.length ? arcs[hashSeed(c.id + c.occupation + (s?.world.playerJob?.nodeId ?? '')) % arcs.length] : undefined;
}

export function arcFor(c: Character): Arc | undefined {
  const arcs = content().arcs;
  const own = arcs.find((a) => a.charId === c.id);
  if (own) return own;
  const career = careerArc(c);
  if (career) return career;
  const tplId = c.archetypeId ? content().archetypes.find((a) => a.id === c.archetypeId)?.arcTemplate : undefined;
  return tplId ? arcs.find((a) => a.template === tplId) : undefined;
}

export function initArc(s: GameState, c: Character) {
  const arc = c.isPlayer ? careerArc(c,s) : arcFor(c);
  if (arc) s.arcs[c.id] = { arcId: arc.id, act: 1, done: [], pending: null };
}

export function refreshJobArc(s: GameState, c: Character) {
  const arc = careerArc(c,s);
  if (arc && s.arcs[c.id]?.arcId !== arc.id) s.arcs[c.id] = { arcId:arc.id, act:1, done:[], pending:null };
}

export interface ArcBeatCandidate {
  charId: string;
  beatId: string;
  templateId: string;
  binding: Binding;
  location: string;
}

/** Eligible next arc beats this slot (≤1 per character per episode). `available` = ids free to take part. */
export function arcCandidates(s: GameState, rng: Rng, available: Set<string>): ArcBeatCandidate[] {
  const out: ArcBeatCandidate[] = [];
  const hm = housemates(s);
  const ids = hm.map((c) => c.id);
  for (const c of hm) {
    const st = s.arcs[c.id];
    if (!st || st.outcome || !available.has(c.id)) continue;
    if (flag(s, `arcEp_${c.id}`) === s.world.episode || flag(s, `leaving_${c.id}`)) continue;
    const arc = content().arcs.find((a) => a.id === st.arcId);
    if (!arc) continue;
    const beat = arc.beats.find((b) => !st.done.includes(b.id));
    if (!beat) continue;
    const tpl = content().eventById.get(beat.event);
    if (!tpl || !tpl.slots.includes(s.world.slot)) continue;
    const relEp = s.world.episode - c.arrivedEp + 1;
    const minEp = Math.max(0, ...beat.pre.filter((p) => p.episodeMin !== undefined).map((p) => p.episodeMin!));
    if (relEp < minEp) continue;
    // partner "b": the available housemate self trusts most
    const location = tpl.location === 'workplace' ? (c.isPlayer && s.world.playerJob ? s.world.playerJob.nodeId : jobNode(c)) : tpl.location;
    if (tpl.location === 'workplace' && c.location !== location) continue;
    const houseBeat = content().house.rooms.some((r) => r.id === location);
    if (tpl.location !== 'workplace' && (c.lastAction === 'work' || (houseBeat ? !content().house.rooms.some((r) => r.id === c.location) : c.location !== location))) continue;
    // A workplace scene must have someone actually visiting; other beats remain shared house conversations.
    const others = hm.filter((o) => o.id !== c.id && available.has(o.id) && (tpl.location === 'workplace' ? o.location === location : o.lastAction !== 'work' && (houseBeat ? content().house.rooms.some((r) => r.id === o.location) : o.location === location))).sort((x, y) => rel(s, c.id, y.id).trust + rel(s, c.id, y.id).affinity * 0.3 - (rel(s, c.id, x.id).trust + rel(s, c.id, x.id).affinity * 0.3) || (x.id < y.id ? -1 : 1));
    const b = others[0];
    if (!b) continue;
    const binding: Binding = { self: c.id, b: b.id };
    for (const [role, spec] of Object.entries(tpl.roles)) if (spec.outsider) binding[role] = spec.outsider;
    const rest = beat.pre.filter((p) => p.episodeMin === undefined);
    if (!evalAll(s, rest, binding, rng, ids)) continue;
    out.push({ charId: c.id, beatId: beat.id, templateId: tpl.id, binding, location });
  }
  return out;
}

export function completeBeat(s: GameState, charId: string, beatId: string) {
  const st = s.arcs[charId];
  if (!st || st.done.includes(beatId)) return;
  st.done.push(beatId);
  const arc = content().arcs.find((a) => a.id === st.arcId);
  const beat = arc?.beats.find((b) => b.id === beatId);
  if (beat) st.act = Math.min(3, beat.act + 1);
  if (arc && st.done.length >= arc.beats.length) st.outcome = 'complete';
  s.world.flags[`arcEp_${charId}`] = s.world.episode;
}

/**
 * Careers change mid-season, as on the show: a housemate who is unhappy, or whose story has run its course, quits,
 * goes back to school or starts something of their own. Occupation, work schedule and career arc follow; the house
 * hears about it in the group chat. At most one per episode; the player changes their own job in town.
 */
export function careerChanges(s: GameState, rng: Rng): string | null {
  for (const c of rng.shuffle(housemates(s).filter((h) => !h.isPlayer && !flag(s, `leaving_${h.id}`) && !flag(s, `careerChanged_${h.id}`)))) {
    const restless = c.mood < -0.2 || s.arcs[c.id]?.outcome === 'complete';
    if (!rng.chance(restless ? 0.08 : 0.025)) continue;
    const jobs = content().jobs.filter((j) => j.title.toLowerCase() !== c.occupation.toLowerCase());
    const [how, next] = rng.pick([
      ['went back to school', 'grad student'],
      ['started something of their own', 'startup founder'],
      ['switched fields', jobs.length ? rng.pick(jobs).title : 'barista'],
    ] as const);
    const before = c.occupation;
    c.occupation = next;
    const job = jobOf(next);
    c.persona.routine.jobSlots = job ? jobSchedule(rng, job) : [];
    s.world.flags[`careerChanged_${c.id}`] = s.world.episode;
    const arc = careerArc(c, s);
    if (arc) s.arcs[c.id] = { arcId: arc.id, act: 1, done: [], pending: null };
    addLog(s, { kind: 'arc', text: `${c.name.split(' ')[0]} quit being a ${before} and ${how}: now a ${next}.`, participants: [c.id], salience: 0.7 });
    postGroupChat(s, c.id, `big news: no more ${before} life. I ${how.replace('their', 'my')} (${next}!)`, { subject: c.id, kind: 'event', content: `${c.name} left their job as a ${before} and became a ${next}.`, sensitivity: 0.2 });
    return c.id;
  }
  return null;
}