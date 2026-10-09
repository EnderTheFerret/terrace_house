// People from a housemate's life outside the house (family, an old friend, an ex): occasional visits and calls,
// never new housemates. Who they are is fixed per housemate (hash), so the same sister keeps calling all season.
import type { Character, GameState } from '../model';
import { hashSeed, mulberry32, type Rng } from '../rng';
import { content } from '../content';
import { fromArchetype } from './castgen';
import { firstName, rel } from './core';
import { outfitFor } from '../wardrobe';

const NAMES = ['Noa', 'Yael', 'Tamar', 'Shira', 'Maya', 'Dana', 'Itai', 'Omer', 'Yonatan', 'Eitan', 'Lior', 'Amit', 'Gal', 'Roni'];
const pick = <T>(xs: T[], key: string) => xs[hashSeed(key) % xs.length];

/** Stable random guest per season; never enters the household or consumes its RNG. */
export function guestCharacter(s: Pick<GameState, 'seed'>, id: string): Character | undefined {
  const npc = content().npcs.find(n => n.id === id);
  if (!npc) return undefined;
  const rng = mulberry32(hashSeed(`${s.seed}:guest:${id}`));
  // roll even when content fixes it, so guests whose roll already matched keep their look
  const rolled = /mother|sister/i.test(npc.role) ? 'woman' : /father|brother/i.test(npc.role) ? 'man' : rng.pick(['woman', 'man'] as const);
  const gender = npc.gender ?? rolled;
  const c = fromArchetype(null, rng, rng.pick(content().archetypes), gender, new Set(), 0, 9999);
  return { ...c, id, name: id === 'classmate' ? c.name : npc.name, occupation: npc.role, location: npc.location, status: 'left' };
}

/** Complete everyday clothing for a guest's role, separate from their identity portrait. */
export function guestOutfit(c: Pick<Character, 'id' | 'gender' | 'appearance' | 'occupation' | 'location'>, day = 0): string {
  if (c.location === 'university' || /student|classmate/i.test(c.occupation)) {
    return 'casual cotton T-shirt, open cardigan, straight-leg blue jeans and white sneakers';
  }
  if (['grill', 'market', 'cafe'].includes(c.location) && /owner|chef|boss/i.test(c.occupation)) {
    return 'plain cotton shirt, canvas work apron over dark trousers and closed-toe shoes';
  }
  if (/brand manager/i.test(c.occupation)) return 'light blazer over a plain shirt, tailored trousers and loafers';
  // Skip the signature turn: random appearance options can name only a top.
  return `${outfitFor(c, 'daily', day % 3 + 1)}, casual shoes`;
}

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

/** Former residents remain in the save, including characters previously played by the player. */
export const pastResidents = (s: GameState) => Object.values(s.characters).filter((c) => c.status === 'left' && c.leftEp !== undefined);

export function returningResident(s: GameState, rng: Rng, hosts: Character[]) {
  if (s.world.slot !== 'evening' || !hosts.length || s.world.flags.residentVisitEp === s.world.episode) return null;
  const guests = pastResidents(s).filter((c) => s.world.episode - Math.max(c.leftEp!, Number(s.world.flags[`visited_${c.id}`] ?? 0)) >= 3);
  if (!guests.length || !rng.chance(0.3)) return null;
  const guest = rng.pick(guests);
  const host = [...hosts].sort((a, b) => {
    const score = (c: Character) => (c.arrivedEp <= guest.leftEp! ? 100 : 0) + rel(s, guest.id, c.id).affinity + rel(s, guest.id, c.id).trust;
    return score(b) - score(a) || a.id.localeCompare(b.id);
  })[0];
  s.world.flags[`visited_${guest.id}`] = s.world.episode;
  s.world.flags.residentVisitEp = s.world.episode;
  const familiar = host.arrivedEp <= guest.leftEp!;
  return {
    guest, host,
    title: `${firstName(s, guest.id)} visits the house`,
    premise: `${guest.name}, who lived here from episode ${guest.arrivedEp} to ${guest.leftEp} (${guest.leftReason ?? 'graduated'}), rings the doorbell for a visit, not a move-in. ${familiar ? `${host.name} welcomes them back` : `${host.name} meets them for the first time`}. They sit in the living room, catch up on life outside and how the house has changed. Old relationships and memories still matter; use only what each person knows. New residents introduce themselves.`,
  };
}
