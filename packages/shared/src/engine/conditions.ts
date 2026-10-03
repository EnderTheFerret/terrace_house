// Declarative precondition evaluation for events and arc beats.
import type { Cond } from '../contentSchema';
import type { GameState } from '../model';
import type { Rng } from '../rng';
import { birthdayDay, isWeekend } from './calendar';
import { asym, departing, flag, isCouple, knows, milestoneOf, rel } from './core';
import { fill } from '../util';

export type Binding = Record<string, string>;

export function fridgeTotal(s: GameState) {
  return Object.values(s.house.fridge).reduce((a, b) => a + b, 0);
}

export function topChoreSkipper(s: GameState, ids: string[]): string | null {
  let best: string | null = null;
  let bestV = 1; // must have skipped at least 2 more than done
  for (const id of ids) {
    const l = s.house.choreLedger[id];
    if (!l) continue;
    const v = l.skipped - l.done;
    if (v > bestV) {
      bestV = v;
      best = id;
    }
  }
  return best;
}

const inRange = (v: number, c: Cond) => (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);

/** Evaluate one condition. `rng` only used by `chance`. Unknown role names fail closed. */
export function evalCond(s: GameState, c: Cond, b: Binding, rng: Rng | null, houseIds: string[]): boolean {
  const r = (name: string | undefined) => (name ? b[name] : undefined);
  if (c.weather && !c.weather.includes(s.world.weather)) return false;
  if (c.season && !c.season.includes(s.world.season)) return false;
  if (c.cityEvent && s.world.cityEvent !== c.cityEvent) return false;
  if (c.typhoon !== undefined && (s.world.cityEvent === 'heatwave' || s.world.cityEvent === 'typhoon') !== c.typhoon) return false;
  if (c.rel) {
    const from = r(c.from);
    const to = r(c.to);
    if (!from || !to) return false;
    if (!inRange(rel(s, from, to)[c.rel], c)) return false;
  }
  if (c.asym) {
    const [x, y] = c.asym.map(r);
    if (!x || !y || !inRange(asym(s, x, y), c)) return false;
  }
  if (c.house) {
    let v: number;
    switch (c.house) {
      case 'fridgeTotal':
        v = fridgeTotal(s);
        break;
      case 'labeledEaten':
        v = s.house.labeledFood.filter((f) => f.eatenBy).length;
        break;
      case 'bathroomQueue':
        v = s.house.bathroomQueue.length;
        break;
      default:
        v = s.house[c.house];
    }
    if (!inRange(v, c)) return false;
  }
  if (c.flag) {
    const v = flag(s, fill(c.flag, b));
    if (c.is === undefined ? !v : v !== c.is) return false;
  }
  if (c.notFlag && flag(s, fill(c.notFlag, b))) return false;
  if (c.episodeMin !== undefined && s.world.episode < c.episodeMin) return false;
  if (c.episodeMax !== undefined && s.world.episode > c.episodeMax) return false;
  if (c.weekend !== undefined && isWeekend(s.world.weekday) !== c.weekend) return false;
  if (c.knowsSecretOf) {
    const [x, y] = c.knowsSecretOf.map(r);
    const sec = y && s.characters[y]?.persona.secret?.factId;
    if (!x || !sec || !knows(s, x, sec)) return false;
  }
  if (c.couple) {
    const [x, y] = c.couple.map(r);
    if (!x || !y || !isCouple(s, x, y)) return false;
  }
  if (c.notCouple) {
    const [x, y] = c.notCouple.map(r);
    if (!x || !y || isCouple(s, x, y)) return false;
  }
  if (c.carFree && s.world.carUsedBy !== null) return false;
  if (c.mood) {
    const x = r(c.mood);
    if (!x || !inRange(s.characters[x].mood, c)) return false;
  }
  if (c.milestone) {
    const [x, y] = c.milestone.map(r);
    if (!x || !y || milestoneOf(s, x, y) !== (c.is ?? 0)) return false;
  }
  if (c.lastDate) {
    const [x, y] = c.lastDate.map(r);
    const ld = flag(s, `lastDate`) as string | undefined;
    const at = flag(s, `lastDateTick`) as number | undefined;
    if (!x || !y || !ld || at === undefined || s.world.tick - at > 6) return false;
    if (ld !== `${x}|${y}` && ld !== `${y}|${x}`) return false;
  }
  if (c.birthday) {
    const x = r(c.birthday);
    if (!x) return false;
    const bd = birthdayDay(x);
    if (!(bd >= s.world.day && bd < s.world.day + 15)) return false;
    if (flag(s, `birthday_${x}`)) return false;
  }
  if (c.choreSkipper) {
    const x = r(c.choreSkipper);
    if (!x || topChoreSkipper(s, houseIds) !== x) return false;
  }
  if (c.newArrival) {
    const x = r(c.newArrival);
    if (!x || !flag(s, `new_${x}`) || flag(s, `introduced_${x}`)) return false;
  }
  if (c.leaving) {
    const x = r(c.leaving);
    if (!x || !departing(s, x)) return false;
  }
  if (c.grudge) {
    const [x, y] = c.grudge.map(r);
    const g = x && y ? s.grudges[`${x}>${y}`] : undefined;
    if (!g || !inRange(g.strength, c)) return false;
  }
  if (c.knowsAbout) {
    const [x, y] = c.knowsAbout.map(r);
    if (!x || !y) return false;
    const k = s.knowledge[x] ?? {};
    const has = Object.keys(k).some((fid) => {
      const f = s.facts[fid];
      return f && f.subject === y && f.sensitivity >= 0.3;
    });
    if (!has) return false;
  }
  if (c.homesick) {
    const x = r(c.homesick);
    if (!x || s.characters[x].persona.homesickness < 0.4) return false;
  }
  if (c.needAbove) {
    const x = r(c.needAbove.role);
    const need = c.needAbove.need as keyof GameState['characters'][string]['needs'];
    if (!x || (s.characters[x].needs[need] ?? 0) < c.needAbove.value) return false;
  }
  if (c.ateFoodOf) {
    const [eater, owner] = c.ateFoodOf.map(r);
    if (!eater || !owner || !s.house.labeledFood.some((f) => f.owner === owner && f.eatenBy === eater)) return false;
  }
  if (c.chance !== undefined) {
    if (!rng || !rng.chance(c.chance)) return false;
  }
  return true;
}

export function evalAll(s: GameState, conds: Cond[], b: Binding, rng: Rng | null, houseIds: string[]) {
  // evaluate deterministic conditions first, chance last (so rng use is stable)
  const det = conds.filter((c) => c.chance === undefined);
  const ch = conds.filter((c) => c.chance !== undefined);
  return det.every((c) => evalCond(s, c, b, null, houseIds)) && ch.every((c) => evalCond(s, c, b, rng, houseIds));
}
