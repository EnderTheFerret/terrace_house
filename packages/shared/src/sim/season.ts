// Headless season simulation with the in-process mock pipeline. Used by tests, `npm run sim` and replay checks.
import type { EventInstance, GameState, Intent, PlayerAction, SceneResponse } from '../model';
import { playerBudget } from '../engine/budget';
import { mulberry32 } from '../rng';
import { autoChoices, createGame, finishSlot, planSlot, proposeOutcome, resolveScene, type NewGameOptions, type PlannedScene } from '../engine/loop';
import { proposeCondition, recordCommentary } from '../engine/predictions';
import { mockCommentary } from '../gen/mock';
import { withRng } from '../engine/core';
import { reachability } from '../engine/city';
import { isShabbat } from '../engine/agents';

export interface SimEvent {
  ep: number;
  slot: string;
  templateId: string;
  participants: string[];
  rendered: boolean;
  outcome?: string;
}

export interface Policy {
  action(s: GameState): PlayerAction;
  respond?(s: GameState, sc: PlannedScene): SceneResponse;
  intent?(s: GameState, ev: EventInstance): Intent | undefined;
}

export const idlePolicy: Policy = { action: () => ({ type: 'idle' }), respond: () => 'ignore' };

/** A simple active policy: hang out, go on dates with the highest-romance housemate, text, cook. */
export function activePolicy(seed: number): Policy {
  const rng = mulberry32(seed ^ 0x5eed);
  return {
    action(s) {
      const P = s.characters[s.playerId];
      const others = Object.values(s.characters).filter((c) => c.status === 'inHouse' && !c.isPlayer);
      if (!others.length) return { type: 'idle' };
      const fav = others.sort((a, b) => (s.rel[P.id]?.[b.id]?.romance ?? 0) - (s.rel[P.id]?.[a.id]?.romance ?? 0))[0];
      const slot = s.world.slot;
      const home = others.filter((c) => !['work', 'goOut', 'sleep', 'nap', 'shower'].includes(c.lastAction ?? ''));
      if (slot === 'morning') return home.length && rng.chance(0.5) ? { type: 'talk', target: rng.pick(home).id } : { type: 'house', activity: 'hangout' };
      if (slot === 'evening' || slot === 'lateNight') return rng.chance(0.4) && !isShabbat(s, P) ? { type: 'house', activity: 'cook' } : { type: 'house', activity: 'hangout' };
      if (['heatwave', 'typhoon'].includes(s.world.weather) || isShabbat(s, P)) return { type: 'house', activity: 'hangout' };
      const r = rng.next();
      const reachable = reachability('house', slot, playerBudget(s), s.world.carUsedBy === null, s.world.minutes, s.world.weekday).filter((r) => r.reachable && r.afford === 'ok');
      const dates = reachable.filter((r) => ['cafe', 'arcade'].includes(r.node));
      if (r < 0.35 && dates.length && !['work', 'sleep', 'nap', 'shower'].includes(fav.lastAction ?? '') && !isShabbat(s, fav)) return { type: 'goOut', node: rng.pick(dates).node, activity: 'date', invite: fav.id };
      if (r < 0.5 && reachable.some((r) => r.node === 'konbini')) return { type: 'goOut', node: 'konbini', activity: 'work' };
      if (r < 0.65) return { type: 'text', target: fav.id };
      return { type: 'house', activity: rng.pick(['hangout', 'backyard', 'hobby'] as const) };
    },
    respond: () => (rng.chance(0.5) ? 'join' : 'eavesdrop'),
    intent: (_s, ev) => rng.pick(ev.intents),
  };
}

export interface SimResult {
  state: GameState;
  events: SimEvent[];
  slots: number;
}

export interface SimHooks {
  /** called with the state right after planning, for each planned scene (invariant checks) */
  onPlanned?(s: GameState, sc: PlannedScene): void;
  onSlotEnd?(s: GameState): void;
}

export function runSlot(s0: GameState, policy: Policy, events: SimEvent[], hooks: SimHooks = {}): GameState {
  const { state: planned, plan } = planSlot(s0, policy.action(s0));
  let s = planned;
  for (const sc of plan.scenes) {
    hooks.onPlanned?.(s, sc);
    const response = sc.visible ? (policy.respond?.(s, sc) ?? 'ignore') : undefined;
    const silent = !sc.render || response === 'ignore';
    const playerIntent = !silent && (sc.event.isPlayerScene || response === 'join') ? policy.intent?.(s, sc.event) : undefined;
    const ac = autoChoices(s, sc.event, playerIntent);
    s = ac.state;
    const po = proposeOutcome(s, sc.event, ac.choices);
    s = po.state;
    const rs = resolveScene(s, sc.event, po.proposal, ac.choices, response);
    s = rs.state;
    if (!silent) {
      // studio commentary bookkeeping (predictions lifecycle)
      const st = structuredClone(s);
      const cm = withRng(st, (rng) => mockCommentary(st, rng, sc.event, rs.result.effects.confession, proposeCondition(st, rng)));
      s = recordCommentary(st, cm);
    }
    events.push({ ep: sc.event.episode, slot: sc.event.slot, templateId: sc.event.templateId, participants: sc.event.participants, rendered: !silent, outcome: rs.result.effects.confession });
  }
  s = finishSlot(s);
  hooks.onSlotEnd?.(s);
  return s;
}

export function simulateSeason(opts: NewGameOptions & { policy?: Policy; hooks?: SimHooks }): SimResult {
  let s = createGame({ ...opts, seasonLength: opts.seasonLength ?? 24 });
  const policy = opts.policy ?? idlePolicy;
  const events: SimEvent[] = [];
  let slots = 0;
  const max = (opts.seasonLength || 24) * 6 + 10;
  while (!s.seasonOver && slots < max) {
    s = runSlot(s, policy, events, opts.hooks);
    slots++;
  }
  return { state: s, events, slots };
}
