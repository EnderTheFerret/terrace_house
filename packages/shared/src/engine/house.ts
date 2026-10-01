// House as shared state (Section 5.5G): fridge, dishes, chores with fairness, labeled food, bathroom, noise, aircon.
import type { GameState } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { clamp } from '../util';
import { addLog, addRel, firstName, housemates, traitsOf } from './core';
import { publicAct } from './social';

export function initHouse(memberIds: string[]): GameState['house'] {
  const hc = content().house;
  const rota: Record<string, string> = {};
  hc.chores.forEach((c, i) => (rota[c] = memberIds[i % memberIds.length]));
  return {
    fridge: { ...hc.startFridge },
    dishes: 10,
    laundry: 10,
    trash: 10,
    noise: 10,
    aircon: 25,
    choreRota: rota,
    choreLedger: Object.fromEntries(memberIds.map((id) => [id, { done: 0, skipped: 0 }])),
    labeledFood: [],
    bathroomQueue: [],
    rules: [...hc.rules],
    groceryBudget: hc.startGroceryBudget,
    groupChat: { members: [...memberIds], messages: [] },
    reputation: {},
  };
}

/** Rotate chore rota each episode so everyone gets every chore. */
export function rotateChores(s: GameState) {
  const ids = housemates(s).map((c) => c.id);
  const chores = content().house.chores;
  const offset = s.world.episode % ids.length;
  chores.forEach((c, i) => (s.house.choreRota[c] = ids[(i + offset) % ids.length]));
  for (const id of ids) s.house.choreLedger[id] ??= { done: 0, skipped: 0 };
}

/** Consume ingredients; returns false if missing. */
export function consume(s: GameState, ingredients: Record<string, number>): boolean {
  for (const [k, n] of Object.entries(ingredients)) if ((s.house.fridge[k] ?? 0) < n) return false;
  for (const [k, n] of Object.entries(ingredients)) s.house.fridge[k] = (s.house.fridge[k] ?? 0) - n;
  return true;
}

export function addGroceries(s: GameState, items: Record<string, number>) {
  for (const [k, n] of Object.entries(items)) s.house.fridge[k] = Math.max(0, (s.house.fridge[k] ?? 0) + n);
}

/**
 * Per-slot house drift + chore resolution. `actions` maps charId → action kind chosen this slot.
 * Chore owner either did a chore (tidy action or conscientious auto-do) or skipped it (resentment).
 */
export function houseTick(s: GameState, rng: Rng, actions: Record<string, string>) {
  const h = s.house;
  const hm = housemates(s);
  const slot = s.world.slot;
  const cooks = Object.values(actions).filter((a) => a === 'cook').length;
  h.dishes = clamp(h.dishes + cooks * 9 + (slot === 'evening' ? 8 : 2), 0, 100);
  h.trash = clamp(h.trash + 3, 0, 100);
  h.laundry = clamp(h.laundry + 2.5, 0, 100);
  // noise: extraverts hanging out at night
  const night = slot === 'evening';
  const loud = hm.filter((c) => c.location === 'living' && traitsOf(c).E > 0.6).length;
  h.noise = clamp(h.noise * 0.6 + (night ? loud * 18 : loud * 5), 0, 100);
  // bathroom queue: weekday mornings everyone with an early job
  if (slot === 'morning') {
    h.bathroomQueue = hm
      .filter((c) => c.persona.routine.jobSlots.some((j) => j.slot === 'slot1' && j.weekdays.includes(s.world.weekday)) || rng.chance(0.4))
      .map((c) => c.id);
  } else h.bathroomQueue = [];

  // chores happen at morning/evening
  if (slot === 'morning' || slot === 'evening') {
    for (const [chore, owner] of Object.entries(h.choreRota)) {
      const c = s.characters[owner];
      if (!c || c.status !== 'inHouse') continue;
      if (chore === 'groceries' && slot === 'morning') continue;
      const did = actions[owner] === 'tidy' || rng.chance(0.25 + traitsOf(c).C * 0.55);
      const led = (h.choreLedger[owner] ??= { done: 0, skipped: 0 });
      if (did) {
        led.done += 0.5;
        if (chore === 'dishes') h.dishes = clamp(h.dishes - 35, 0, 100);
        if (chore === 'trash') h.trash = clamp(h.trash - 30, 0, 100);
        if (chore === 'laundry') h.laundry = clamp(h.laundry - 30, 0, 100);
        publicAct(s, owner, 0.5);
      } else {
        led.skipped += 0.5;
        // resentment accumulates against the skipper, strongest from conscientious housemates
        for (const o of hm) if (o.id !== owner) addRel(s, o.id, owner, 'tension', 0.6 + traitsOf(o).C * 1.2);
        publicAct(s, owner, -0.8);
      }
    }
  }

  // labeled food: someone labels a treat; a hungry low-C housemate may eat it
  if (slot === 'evening' && rng.chance(0.3) && hm.length > 1) {
    const owner = rng.pick(hm);
    h.labeledFood.push({ item: rng.pick(['pudding', 'yogurt', 'strawberry daifuku', 'leftover curry', 'cheesecake']), owner: owner.id });
    if (h.labeledFood.length > 4) h.labeledFood.shift();
  }
  for (const f of h.labeledFood) {
    if (f.eatenBy) continue;
    const eater = hm.find((c) => c.id !== f.owner && c.needs.hunger > 60 && traitsOf(c).C < 0.5 && rng.chance(0.15));
    if (eater) {
      f.eatenBy = eater.id;
      addLog(s, { kind: 'domestic', text: `Someone ate ${firstName(s, f.owner)}'s labeled ${f.item}.`, participants: [f.owner], salience: 0.3 });
    }
  }
  // aircon: drift toward the setting preferred by whoever is in the living room
  if (s.world.season === 'summer' || s.world.season === 'winter') {
    const pref = hm.filter((c) => c.location === 'living').map((c) => 22 + traitsOf(c).N * 3 + (c.persona.routine.tastes[4] > 0 ? 1 : 0));
    if (pref.length) h.aircon = Math.round(pref.reduce((a, b) => a + b, 0) / pref.length);
  }
}

/** Groceries cost; NPCs restock when the fridge is near empty. */
export function autoGroceries(s: GameState, buyer: string) {
  const basket = { rice: 3, egg: 6, cabbage: 1, onion: 2, pork: 1, chicken: 1, tofu: 2, carrot: 1, noodles: 1, scallion: 1, miso: 1, soy: 1 };
  addGroceries(s, basket);
  s.house.groceryBudget -= 3000;
  s.house.choreLedger[buyer] ??= { done: 0, skipped: 0 };
  s.house.choreLedger[buyer].done += 1;
  publicAct(s, buyer, 2);
}
