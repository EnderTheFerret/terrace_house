import type { GameState, PlayerAction } from '../model';
import { content } from '../content';
import { addLog, firstName, housemates, isRoom, player, SLOT_MINUTES } from './core';
import { recordActivity } from './living';

type PoolAction = Extract<PlayerAction, { type: 'pool' }>;

export function validatePool(s: GameState, a: PoolAction) {
  const P = s.characters[s.playerId];
  if (!P || !P.isPlayer || P.status !== 'inHouse' || !isRoom(P.location)) throw new Error('the player must be at home to use the pool');
  if (a.mode === 'leave') return;
  if (!content().house.furniture.some((f) => f.type === 'pool')) throw new Error('the house does not have a pool');
  if (s.world.weather === 'typhoon') throw new Error('the pool is closed during the typhoon');
  if (s.world.minutes >= SLOT_MINUTES) throw new Error('start the next block before swimming');
  const ids = [s.playerId, ...(a.with ?? [])];
  if (new Set(ids).size !== ids.length) throw new Error('choose each housemate once');
  if (new Set([...housemates(s).filter((c) => c.swimming).map((c) => c.id), ...ids]).size > 6) throw new Error('the pool fits six people');
  for (const id of ids) {
    const c = s.characters[id];
    if (!c || c.status !== 'inHouse' || !isRoom(c.location) || ['work', 'sleep', 'nap', 'shower'].includes(c.lastAction ?? '')) throw new Error('one of your guests is busy or away');
    if (!c.isPlayer && s.invitations.some((p) => p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot && [p.from, p.to].includes(id))) throw new Error(`${firstName(s, id)} already has a plan in this block`);
    if (!c.isPlayer && !c.swimming && c.persona.routine.jobSlots.some((j) => j.slot === s.world.slot && j.weekdays.includes(s.world.weekday))) throw new Error(`${firstName(s, id)} has a work commitment now`);
  }
}

export function applyPool(s: GameState, a: PoolAction) {
  const P = player(s);
  const ids = a.mode === 'enter' ? [P.id, ...(a.with ?? [])] : housemates(s).filter((c) => c.swimming).map((c) => c.id);
  for (const id of ids) {
    const c = s.characters[id];
    c.location = 'backyard';
    c.swimming = a.mode === 'enter';
    c.lastAction = c.swimming ? 'swim' : 'hobby';
    c.activityUntil = c.swimming ? SLOT_MINUTES : s.world.minutes;
    c.actionTarget = undefined;
    c.actionNode = undefined;
  }
  s.world.playerNode = isRoom(P.location) ? 'house' : P.location;
  const text = a.mode === 'enter' ? `${ids.map((id) => firstName(s, id)).join(', ')} changed into swimwear and entered the pool.` : 'Everyone got out of the pool and changed back into their usual clothes.';
  addLog(s, { kind: 'domestic', text, participants: ids, salience: 0.2 });
  recordActivity(s, text);
}
