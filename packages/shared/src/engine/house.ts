// House as shared state (Section 5.5G): fridge, dishes, chores with fairness, labeled food, bathroom, noise, aircon.
import type { Character, Fact, GameState } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { clamp } from '../util';
import { addFact, addLog, addRel, firstName, housemates, learn, traitsOf } from './core';
import { publicAct } from './social';
import { isShabbat } from './agents';
import { markLeaving } from './leave';

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
    kitchen: { meatPanClean: true, dairyPanClean: true, kosherShelf: Object.keys(hc.startFridge) },
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
  for (const id of Object.keys(items)) if (!/pork|bacon|shrimp|shellfish/.test(id) && !s.house.kitchen.kosherShelf.includes(id)) s.house.kitchen.kosherShelf.push(id);
}

/** One check per worked shift, independent of how many short actions the player takes. */
export function workCareerTick(s: GameState, rng: Rng, c: Character) {
  const key = `careerShift_${c.id}`;
  if (s.world.flags[key] === s.world.tick || isShabbat(s,c)) return;
  s.world.flags[key] = s.world.tick;
  const roll = rng.next();
  let text: string | undefined;
  if (roll < .035) {
    if (c.isPlayer && s.world.playerJob) s.world.playerJob.wage += 10;
    text = `${firstName(s,c.id)} earned a raise after a good shift.`;
    c.mood = clamp(c.mood + .12,-1,1);
  } else if (roll < .05) {
    s.world.flags[`fired_${c.id}`] = true;
    if (c.isPlayer) s.world.playerJob = null;
    c.mood = clamp(c.mood - .2,-1,1);
    text = `${firstName(s,c.id)} was let go at work. A new direction will take time.`;
  } else if (roll < .09) {
    s.world.flags[`careerOffer_${c.id}`] = s.world.episode;
    text = `${firstName(s,c.id)} received a job offer in another city. Staying means passing it up.`;
    if (!c.isPlayer && rng.chance(.25)) markLeaving(s,c.id,'accepted a job offer outside Tel Aviv');
  } else if (roll < .14) {
    s.world.flags.coworkerVisitor = c.id;
    text = `${firstName(s,c.id)} invited a coworker to visit the house after their shift.`;
  } else if (roll < .3) {
    c.mood = clamp(c.mood - .1,-1,1);
    text = `${firstName(s,c.id)} brought a difficult shift home and could use a quiet conversation.`;
  }
  if (text) addLog(s,{kind:'system',text,participants:[c.id],salience:.45});
}

/**
 * Per-slot house drift + chore resolution. `actions` maps charId → action kind chosen this slot.
 * Chore owner either did a chore (tidy action or conscientious auto-do) or skipped it (resentment).
 */
export function houseTick(s: GameState, rng: Rng, actions: Record<string, string>) {
  const h = s.house;
  const hm = housemates(s);
  const slot = s.world.slot;
  s.world.flags.kashrutHouse = hm.some((c) => c.persona.kashrut !== 'none');
  for (const c of hm) if (actions[c.id] === 'work') workCareerTick(s,rng,c);
  const cooks = Object.values(actions).filter((a) => a === 'cook').length;
  h.dishes = clamp(h.dishes + cooks * 9 + (slot === 'evening' ? 8 : 2), 0, 100);
  h.trash = clamp(h.trash + 3, 0, 100);
  h.laundry = clamp(h.laundry + 2.5, 0, 100);
  // noise: extraverts hanging out at night
  const night = slot === 'evening' || slot === 'lateNight';
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
      if (isShabbat(s,c) && (chore === 'groceries' || chore === 'laundry')) continue;
      if (chore === 'groceries' && slot === 'morning') continue;
      const did = actions[owner] === 'tidy' || rng.chance(0.25 + traitsOf(c).C * 0.55);
      const led = (h.choreLedger[owner] ??= { done: 0, skipped: 0 });
      if (did) {
        if (chore === 'dishes') { h.kitchen.meatPanClean = true; h.kitchen.dairyPanClean = true; s.world.flags.kosherPanViolation = false; }
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
    h.labeledFood.push({ item: rng.pick(['malabi', 'yogurt', 'hummus', 'leftover shakshuka', 'cheesecake']), owner: owner.id });
    if (h.labeledFood.length > 4) h.labeledFood.shift();
  }
  for (const f of h.labeledFood) {
    if (f.eatenBy) continue;
    const eater = hm.find((c) => c.id !== f.owner && c.needs.hunger > 60 && traitsOf(c).C < 0.5 && rng.chance(0.15));
    if (eater) {
      f.eatenBy = eater.id;
      addLog(s, { kind: 'domestic', text: `Someone ate ${firstName(s, f.owner)}'s labeled ${f.item}.`, participants: [f.owner], salience: 0.3 });
      const owner = s.characters[f.owner];
      const angry = owner && (owner.persona.conflictStyle === 'confront' ? `whoever ate my ${f.item}. i know.` : owner.persona.conflictStyle === 'passive-aggressive' ? `it's fine that my ${f.item} is gone. totally fine.` : `um did anyone see my ${f.item}?`);
      if (angry) postGroupChat(s, f.owner, angry, { subject: f.owner, kind: 'event', content: `${firstName(s, f.owner)}'s labeled ${f.item} went missing.`, sensitivity: 0.32 });
    }
  }
  // dinner announcements and general chatter
  if (slot === 'evening') {
    const cook = hm.find((c) => actions[c.id] === 'cook');
    if (cook && rng.chance(0.4)) postGroupChat(s, cook.id, rng.pick(['made too much shakshuka. come eat', 'dinner in 10 if anyone is home', 'there is soup on the stove']));
  }
  if (s.world.weekday === 5 && slot === 'slot3') {
    const host = hm.find((c) => c.persona.keepsShabbat && actions[c.id] === 'cook');
    if (host && s.world.minutes < 120) {
      s.world.flags.fridayDinnerPrepared = s.world.episode;
      addLog(s,{kind:'domestic',text:`${firstName(s,host.id)} prepared Friday dinner before sundown. There is enough for everyone.`,participants:[host.id],salience:.35});
    }
  }
  if (h.dishes > 75 && rng.chance(0.25)) {
    const neat = hm.filter((c) => traitsOf(c).C > 0.7 && !c.isPlayer)[0];
    if (neat) postGroupChat(s, neat.id, 'the sink. please.', { subject: neat.id, kind: 'opinion', content: `${firstName(s, neat.id)} complained about the dishes in the group chat.`, sensitivity: 0.3 });
  }
  // aircon: drift toward the setting preferred by whoever is in the living room
  if (s.world.season === 'summer' || s.world.season === 'winter') {
    const pref = hm.filter((c) => c.location === 'living').map((c) => 22 + traitsOf(c).N * 3 + (c.persona.routine.tastes[4] > 0 ? 1 : 0));
    if (pref.length) h.aircon = Math.round(pref.reduce((a, b) => a + b, 0) / pref.length);
  }
  // A label alone is not food: empty marked ingredient slots cannot start a shelf scene.
  s.world.flags.kosherShelfStock = h.kitchen.kosherShelf.reduce((sum,id) => sum + Math.max(0,h.fridge[id] ?? 0),0);
}

/**
 * Post to the house group chat. Members (only) learn the attached fact with source "groupchat" — the player
 * included, if they haven't been excluded from the chat.
 */
export function postGroupChat(s: GameState, from: string, text: string, fact?: { subject: string; about?: string; kind: Fact['kind']; content: string; sensitivity: number }) {
  if (!s.house.groupChat.members.includes(from) || (s.characters[from] && isShabbat(s,s.characters[from]))) return;
  s.house.groupChat.messages.push({ from, text, tick: s.world.tick, readBy: [], ignoredBy: [] });
  if (s.house.groupChat.messages.length > 80) s.house.groupChat.messages.splice(0, s.house.groupChat.messages.length - 80);
  if (fact) {
    const f = addFact(s, { ...fact, truth: true });
    learn(s, from, f.id, 'witnessed');
    for (const m of s.house.groupChat.members) if (m !== from && !isShabbat(s,s.characters[m])) learn(s, m, f.id, 'groupchat', from, 0.9);
  }
}

/** Groceries cost; NPCs restock when the fridge is near empty. */
export function autoGroceries(s: GameState, buyer: string) {
  if (isShabbat(s,s.characters[buyer])) return;
  const basket = { rice: 3, egg: 6, onion: 2, chicken: 2, carrot: 2, tomato: 3, chickpea: 2, lentils: 2, pita: 3, tahini: 1, eggplant: 2, cucumber: 2, lemon: 2, spice: 1 };
  addGroceries(s, basket);
  s.house.groceryBudget -= 100;
  s.house.choreLedger[buyer] ??= { done: 0, skipped: 0 };
  s.house.choreLedger[buyer].done += 1;
  publicAct(s, buyer, 2);
}
