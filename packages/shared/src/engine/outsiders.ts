// People from a housemate's life outside the house (family, an old friend, an ex): occasional visits and calls,
// never new housemates. Who they are is fixed per housemate (hash), so the same sister keeps calling all season.
import type { Character } from '../model';
import { hashSeed } from '../rng';

const NAMES = ['Noa', 'Yael', 'Tamar', 'Shira', 'Maya', 'Dana', 'Itai', 'Omer', 'Yonatan', 'Eitan', 'Lior', 'Amit', 'Gal', 'Roni'];
const pick = <T>(xs: T[], key: string) => xs[hashSeed(key) % xs.length];

export type OutsiderKind = 'family' | 'friend' | 'ex';

export function outsiderOf(c: Pick<Character, 'id' | 'name' | 'hometown'>, kind: OutsiderKind) {
  const name = pick(NAMES, `${c.id}:${kind}:name`);
  const who = kind === 'family' ? pick(['mother', 'father', 'older sister', 'younger brother', 'grandmother'], `${c.id}:family`) : kind === 'friend' ? 'best friend from home' : 'ex';
  return { name: kind === 'family' && ['mother', 'father', 'grandmother'].includes(who) ? `${c.name.split(' ')[0]}'s ${who}` : name, who };
}

/** Title + premise for an outsider moment; `at` is where it happens (entrance for visits, the pool deck for calls). */
export function outsiderMoment(c: Pick<Character, 'id' | 'name' | 'hometown'>, kind: OutsiderKind, leaving: boolean): { title: string; premise: string; at: string } {
  const o = outsiderOf(c, kind);
  const first = c.name.split(' ')[0];
  if (kind === 'family') return {
    title: `a call from ${first}'s ${o.who}`, at: 'backyard',
    premise: `${first} steps out to the pool deck to take a call from their ${o.who}${o.who.includes(o.name) ? '' : ` (${o.name})`} back in ${c.hometown}${leaving ? ', who has opinions about the decision to leave the house' : ', who wants to know if they are eating properly and whether there is "someone"'}. Afterwards someone from the house finds them there.`,
  };
  if (kind === 'friend') return {
    title: `${o.name} at the door`, at: 'entrance',
    premise: `${o.name}, ${first}'s ${o.who}, turns up at the door with pastries and zero warning, curious to meet the people from the show. They have their own read on ${first} and the house.`,
  };
  return {
    title: `${first}'s ex`, at: 'living',
    premise: `${first}'s phone lights up: a message from their ${o.who}, ${o.name}, out of nowhere ("saw you on TV..."). ${first} doesn't know what to do with it, and someone from the house notices.`,
  };
}
