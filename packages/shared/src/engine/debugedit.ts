// Author debug edits: put a character somewhere else or tweak their state. Logged and replayed like any other edit.
import type { Character, GameState, Slot } from '../model';
import { clamp } from '../util';
import { content } from '../content';
import { addRel, isRoom } from './core';
import { hasJobNow, jobNode, type AgentAction } from './agents';
import { scheduleActivity } from './living';

export interface DebugEdit {
  id: string;
  /** a house room id or a city node id */
  location?: string;
  mood?: number;
  energy?: number;
  swimming?: boolean;
  /** 0 sober … 3 very drunk */
  drunk?: number;
  /** 0 none, 1 hungover, 2 badly hungover */
  hangover?: number;
  /** drop whatever they were doing so the next block's plans can pick them up */
  idle?: boolean;
}

/** What someone who is now at `place` is plausibly doing; once it ends they choose their next action as usual. */
function actionAt(s: GameState, c: Character, place: string): AgentAction {
  if (!isRoom(place)) return place === jobNode(c) && hasJobNow(s, c) ? { kind: 'work', node: place } : { kind: 'goOut', node: place };
  if (place === 'kitchen') return { kind: 'snack' };
  if (['bathroom', 'smallBathroom'].includes(place)) return { kind: 'shower' };
  if (/^(bedroom|balcony)/.test(place)) return { kind: 'retreat' };
  if (place === 'backyard') return { kind: 'exercise' };
  return { kind: 'hobby', room: place as AgentAction['room'] };
}

export interface DebugPlan {
  id: string;
  /** delete the plan, undoing what settling it did (trust, closeness, its "kept/missed" log line) */
  remove?: boolean;
  episode?: number;
  slot?: Slot;
}

/** Fix a calendar entry that should not exist or landed on the wrong day. Logged and replayed like any other edit. */
export function debugPlan(s0: GameState, e: DebugPlan): GameState {
  const s = structuredClone(s0);
  const i = s.invitations.findIndex((p) => p.id === e.id);
  if (i < 0) throw new Error('unknown plan');
  const p = s.invitations[i];
  if (e.remove) {
    if (p.status === 'kept' || p.status === 'broken') for (const [x, y] of [[p.from, p.to], [p.to, p.from]]) {
      addRel(s, x, y, 'trust', p.status === 'kept' ? -4 : 5);
      if (p.status === 'kept') addRel(s, x, y, 'closeness', -4);
    }
    s.invitations.splice(i, 1);
    s.log = s.log.filter((l) => !(l.episode === p.episode && /their plan at/.test(l.text) && l.participants.includes(p.from) && l.participants.includes(p.to)));
    return s;
  }
  if (e.episode !== undefined) p.episode = e.episode;
  if (e.slot) p.slot = e.slot;
  return s;
}

export function debugEdit(s0: GameState, e: DebugEdit): GameState {
  const s = structuredClone(s0);
  const c = s.characters[e.id];
  if (!c) throw new Error('unknown character');
  if (e.location !== undefined) {
    if (!isRoom(e.location) && !content().city.nodes.some((n) => n.id === e.location)) throw new Error('unknown location');
    c.location = e.location;
    if (c.isPlayer) {
      s.world.playerNode = isRoom(e.location) ? 'house' : e.location;
      c.lastAction = undefined;
      c.activityUntil = 0;
      if (e.location !== 'backyard') c.swimming = false;
    } else scheduleActivity(s, c, actionAt(s, c, e.location));
  }
  if (e.mood !== undefined) c.mood = clamp(e.mood, -1, 1);
  if (e.energy !== undefined) c.energy = clamp(e.energy, 0, 100);
  if (e.swimming !== undefined) c.swimming = e.swimming;
  if (e.drunk !== undefined) { c.drunk = clamp(Math.round(e.drunk), 0, 3); c.drunkPeak = Math.max(c.drunkPeak ?? 0, c.drunk); }
  if (e.hangover !== undefined) c.hangover = clamp(Math.round(e.hangover), 0, 2);
  if (e.idle) { c.lastAction = undefined; c.activityUntil = 0; }
  return s;
}
