import type { Character, EventInstance, GameState, Invitation } from '../model';
import type { Rng } from '../rng';
import { uk } from '../util';
import { addFact, addLog, addMemory, addRel, firstName, housemates, learn, nextId, notePlan, npcs, placeName, rel, SLOT_MINUTES } from './core';
import { hasJobNow, isShabbat, jobNode } from './agents';
import { reachability } from './city';
import { postGroupChat } from './house';

export function performanceKind(c: Character): NonNullable<Invitation['performance']>['kind'] | undefined {
  const occupation = c.occupation.toLowerCase();
  if (/\bdj\b/.test(occupation)) return 'dj';
  if (/\b(actor|actress|theatre performer|theater performer)\b/.test(occupation)) return 'play';
  if (/\b(comedian|stand-up comic)\b/.test(occupation)) return 'comedy';
  if (/\b(musician|singer|guitarist|pianist|drummer)\b/.test(occupation)) return 'concert';
  return undefined;
}

const LABELS = { concert: 'live concert', dj: 'DJ set', play: 'play', comedy: 'stand-up show' };

function occupied(s: GameState, id: string, episode: number) {
  return s.invitations.some(p => p.episode === episode && p.slot === 'evening' && ['pending', 'accepted'].includes(p.status) && [p.from, p.to].includes(id));
}

function canPerform(s: GameState, c: Character, node: string) {
  return c.status === 'inHouse' && !s.world.flags[`away_${c.id}`] && !s.world.flags[`leaving_${c.id}`] && !isShabbat(s, c) && (!hasJobNow(s, c) || jobNode(c) === node);
}

/** Each performer offers at most one show a week, with enough notice to answer on the phone. */
export function offerPerformances(s: GameState, rng: Rng) {
  if (s.world.episode < 2) return;
  for (const host of npcs(s)) {
    const kind = performanceKind(host);
    const last = s.world.flags[`performanceOffer_${host.id}`];
    if (!kind || isShabbat(s, host) || typeof last === 'number' && s.world.episode - last < 7) continue;
    for (let offset = 1; offset <= 7; offset++) {
      const episode = s.world.episode + offset;
      const future = { ...s, world: { ...s.world, episode, weekday: (s.world.weekday + offset) % 7, slot: 'evening' as const, minutes: 0 } };
      const node = 'livehouse';
      if (occupied(s, host.id, episode) || !canPerform(future, host, node)) continue;
      const route = reachability('house', 'evening', 3, false, 0, future.world.weekday).find(r => r.node === node);
      if (!route?.reachable) continue;
      const eligible = housemates(s).filter(c => c.id !== host.id && !s.world.flags[`leaving_${c.id}`] && !s.world.flags[`away_${c.id}`] && !occupied(s, c.id, episode) && !isShabbat(future, c) && !hasJobNow(future, c) && rel(s, host.id, c.id).affinity >= 0);
      if (!eligible.length) continue;
      const audience = rng.chance(0.6) ? 'house' as const : 'personal' as const;
      const guests = audience === 'house' ? eligible : [eligible.sort((a, b) => rel(s, host.id, b.id).affinity + rel(s, host.id, b.id).romance - rel(s, host.id, a.id).affinity - rel(s, host.id, a.id).romance)[0]];
      const performance = { id: nextId(s, 'performance'), kind, title: `${firstName(s, host.id)}'s ${LABELS[kind]}`, audience };
      for (const guest of guests) {
        const accepted = rel(s, guest.id, host.id).trust >= 20 && rel(s, guest.id, host.id).tension < 60 && (s.grudges[`${guest.id}>${host.id}`]?.strength ?? 0) < 40;
        s.invitations.push({ id: nextId(s, 'plan'), from: host.id, to: guest.id, episode, slot: 'evening', node, status: guest.isPlayer ? 'pending' : accepted ? 'accepted' : 'declined', performance });
        notePlan(s, s.invitations.at(-1)!);
        if (guest.isPlayer) (s.chats[uk(host.id, guest.id)] ??= []).push({ from: host.id, text: `I'm performing my ${LABELS[kind]} at ${placeName(node)} on day ${episode}, in the evening. ${audience === 'house' ? 'I invited the house!' : 'I would love you to come.'} Check your plans to accept.`, tick: s.world.tick, readBy: [], ignoredBy: [] });
      }
      if (audience === 'house') postGroupChat(s, host.id, `${performance.title} at ${placeName(node)}, day ${episode}, evening. Come support me! Invitations are in the shared plans.`);
      s.world.flags[`performanceOffer_${host.id}`] = s.world.episode;
      s.invitations = s.invitations.slice(-60);
      break;
    }
  }
}

/** The performer goes even when the player declines; guests keep their other obligations. */
export function startPerformances(s: GameState) {
  const due = s.invitations.filter(p => p.performance && p.episode === s.world.episode && p.slot === s.world.slot);
  for (const id of new Set(due.map(p => p.performance!.id))) {
    const plans = due.filter(p => p.performance!.id === id);
    const p = plans[0];
    const host = s.characters[p.from];
    if (!host || !canPerform(s, host, p.node)) {
      for (const plan of plans) if (['accepted', 'pending'].includes(plan.status)) plan.status = 'declined';
      continue;
    }
    if (!s.world.flags[`performanceStarted_${id}`]) {
      const route = reachability('house', p.slot, 3, false, s.world.minutes, s.world.weekday).find(r => r.node === p.node);
      if (!route?.reachable) {
        for (const plan of plans) if (['accepted', 'pending'].includes(plan.status)) plan.status = 'declined';
        continue;
      }
      s.world.flags[`performanceStarted_${id}`] = true;
      host.location = p.node;
      host.swimming = false;
      host.lastAction = 'work';
      host.actionNode = p.node;
      host.activityUntil = SLOT_MINUTES;
      addLog(s, { kind: 'system', text: `${p.performance!.title} is on at ${placeName(p.node)} tonight.`, participants: [host.id], salience: 0.6 });
    }
    for (const plan of plans.filter(p => p.status === 'accepted')) {
      const guest = s.characters[plan.to];
      if (!guest || guest.status !== 'inHouse' || s.world.flags[`away_${guest.id}`] || s.world.flags[`leaving_${guest.id}`] || isShabbat(s, guest) || hasJobNow(s, guest) || ['work', 'sleep', 'nap', 'shower'].includes(guest.lastAction ?? '')) continue;
      if (guest.isPlayer) continue;
      guest.location = p.node;
      guest.swimming = false;
      guest.lastAction = 'goOut';
      guest.actionNode = p.node;
      guest.activityUntil = SLOT_MINUTES;
    }
  }
}

export function performanceScene(s: GameState): Partial<EventInstance> | null {
  const p = s.invitations.find(p => p.performance && p.to === s.playerId && p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot && s.characters[s.playerId].location === p.node && s.characters[p.from]?.location === p.node && s.world.flags[`performanceStarted_${p.performance.id}`]);
  if (!p) return null;
  const participants = [p.from, ...s.invitations.filter(other => other.performance?.id === p.performance!.id && other.status === 'accepted' && s.characters[other.to]?.status === 'inHouse' && s.characters[other.to].location === p.node).map(other => other.to)];
  return { title: p.performance!.title, type: 'performance', tags: ['light', 'performance', p.performance!.kind], participants: [...new Set(participants)],
    premise: `${firstName(s, p.from)} is the performer in their own ${LABELS[p.performance!.kind]} at ${placeName(p.node)}. The invited housemates watch from the audience: ${participants.slice(1).map(id => firstName(s, id)).join(', ')}. Show the performance, applause and a conversation after the show about what it meant to have them there. For a play, this is a staged theatrical production with roles and a curtain call. Do not turn the audience into performers.` };
}

export function rememberPerformance(s: GameState, p: Invitation) {
  if (!p.performance) return;
  const text = `${firstName(s, p.to)} came to ${p.performance.title} at ${placeName(p.node)}.`;
  addRel(s, p.from, p.to, 'affinity', 3);
  addMemory(s, p.from, text, [p.from, p.to], 0.7);
  addMemory(s, p.to, text, [p.from, p.to], 0.7);
  const fact = addFact(s, { subject: p.from, about: p.to, kind: 'event', content: text, truth: true, sensitivity: 0.2 });
  learn(s, p.from, fact.id, 'self');
  learn(s, p.to, fact.id, 'witnessed');
}
