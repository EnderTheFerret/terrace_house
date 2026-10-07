import type { Character, GameState, HouseholdActivity, NeedVec, Room } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { clamp, uk } from '../util';
import { addFact, addLog, addMemory, addRel, clockLabel, firstName, housemates, isRoom, learn, rel, SLOT_MINUTES, traitsOf } from './core';
import type { AgentAction } from './agents';
import { hasJobNow, isShabbat } from './agents';
import { applyCooking, canEat, coopSkill, npcRecipe } from './cooking';
import { consume } from './house';
import { publicAct } from './social';

interface HouseholdDefinition {
  label: string;
  room: Room;
  minutes: number;
  detail: string;
  chore?: 'dishes' | 'laundry' | 'trash' | 'clean' | 'sort' | 'fridge' | 'table' | 'repair';
  needs: Partial<NeedVec>;
  shabbat?: boolean;
}

export const HOUSEHOLD: Record<HouseholdActivity, HouseholdDefinition> = {
  dishes: { label: 'wash dishes', room: 'kitchen', minutes: 15, detail: 'One washes while the other dries; there is room to talk between plates.', chore: 'dishes', needs: { achievement: 6 } },
  laundry: { label: 'fold & sort laundry', room: 'living', minutes: 20, detail: 'Sort the clean laundry and fold it on the sofa, keeping everyone’s clothes separate.', chore: 'laundry', needs: { achievement: 6 } },
  trash: { label: 'take out trash & recycling', room: 'entrance', minutes: 10, detail: 'Separate recycling, tie the bags and take them to the bins together.', chore: 'trash', needs: { achievement: 5 } },
  clean: { label: 'quick house clean', room: 'living', minutes: 25, detail: 'Sweep the shared floor, wipe the coffee table and straighten the sofa. A quick reset is enough.', chore: 'clean', needs: { achievement: 8 } },
  sort: { label: 'sort the shared shelves', room: 'living', minutes: 20, detail: 'Sort books, chargers and stray belongings, asking before moving somebody else’s things.', chore: 'sort', needs: { achievement: 6 } },
  fridge: { label: 'organize the fridge', room: 'kitchen', minutes: 15, detail: 'Group groceries and make a shopping list. Leave labeled food and kosher ingredients separate.', chore: 'fridge', needs: { achievement: 5 } },
  meal: { label: 'cook for the house', room: 'kitchen', minutes: 40, detail: 'Split the chopping and stove work, taste together and chat while the food cooks. Serve whoever is home.', needs: { achievement: 8 }, shabbat: true },
  coffee: { label: 'make coffee & tea', room: 'kitchen', minutes: 10, detail: 'Make a hot drink for each other, then linger at the kitchen counter.', needs: { social: 8, energy: 3 }, shabbat: true },
  table: { label: 'set the table', room: 'kitchen', minutes: 10, detail: 'Bring out plates, water and napkins so the house can sit down together.', chore: 'table', needs: { achievement: 4 } },
  plants: { label: 'water the plants', room: 'backyard', minutes: 15, detail: 'Check the pots, water the dry ones and enjoy a quiet moment outside.', needs: { achievement: 5, privacy: 4 } },
  stretch: { label: 'stretch together', room: 'living', minutes: 20, detail: 'Do a gentle stretch on the living-room floor and compare how the day has gone.', needs: { achievement: 5, energy: 4 } },
  music: { label: 'listen & share music', room: 'living', minutes: 25, detail: 'Take turns choosing songs at a considerate volume and say why they mean something.', needs: { social: 10, privacy: 4 } },
  games: { label: 'play cards or a board game', room: 'living', minutes: 30, detail: 'Play a casual game at the coffee table. Teasing and conversation matter more than winning.', needs: { social: 12, achievement: 4 } },
  study: { label: 'study or work side by side', room: 'living', minutes: 30, detail: 'Bring notebooks or a small personal project, trade advice and talk during short breaks.', needs: { achievement: 12, social: 4 } },
  repair: { label: 'fix a small household thing', room: 'living', minutes: 20, detail: 'Tighten a loose handle or mend a wobbly shelf, holding parts for each other and testing the result.', chore: 'repair', needs: { achievement: 9 } },
};

export function householdProblem(s: GameState, c: Character, id: HouseholdActivity, minutes = HOUSEHOLD[id].minutes, reserved = false): string | undefined {
  const task = HOUSEHOLD[id];
  if (minutes > SLOT_MINUTES - s.world.minutes) return 'There is not enough time left in this block. Try next block.';
  if (task.room === 'backyard' && ['rain', 'typhoon'].includes(s.world.weather)) return 'The plants can wait until the rain clears.';
  if (task.shabbat && (isShabbat(s, c) || isShabbat({ ...s, world: { ...s.world, minutes: s.world.minutes + minutes } }, c))) return 'This activity waits until after Shabbat.';
  if (id === 'meal' && !reserved && housemates(s).some(other => other.id !== c.id && other.actionHousehold === 'meal' && other.actionHouseholdOwner === other.id && other.activityUntil > s.world.minutes)) return 'A meal is already cooking. Join the cook or choose another activity.';
  if (id === 'meal' && !reserved && !content().recipes.some(r => canEat(c, r) && Object.entries(r.ingredients).every(([k, n]) => (s.house.fridge[k] ?? 0) >= n) &&
    (c.persona.kashrut !== 'strict' || r.kosher && Object.keys(r.ingredients).every(k => s.house.kitchen.kosherShelf.includes(k)) &&
      (r.category !== 'meat' || s.house.kitchen.meatPanClean) && (r.category !== 'dairy' || s.house.kitchen.dairyPanClean)))) return 'There are no suitable ingredients ready. Restock or wash the pans first.';
}

export function householdCompanyProblem(s: GameState, from: Character, other: Character): string | undefined {
  if (other.status !== 'inHouse' || !isRoom(other.location) || s.world.flags[`away_${other.id}`] || hasJobNow(s, other) ||
    other.activityUntil > s.world.minutes && ['work', 'sleep', 'nap', 'shower'].includes(other.lastAction ?? '')) return 'They are busy right now.';
  if (rel(s, other.id, from.id).affinity < -15 || rel(s, other.id, from.id).tension >= 45 || (s.grudges[`${other.id}>${from.id}`]?.strength ?? 0) >= 20) return 'They would rather have some space right now.';
}

/** Reserve ingredients once; the result arrives on the activity deadline, including during a conversation. */
export function startHousehold(s: GameState, rng: Rng, c: Character, id: HouseholdActivity, companion?: Character): boolean {
  const task = HOUSEHOLD[id];
  if (householdProblem(s, c, id)) return false;
  let recipe: string | undefined;
  if (id === 'meal') {
    const r = npcRecipe(c, s, rng, companion ? [companion] : []);
    if (!r || !consume(s, r.ingredients)) return false;
    recipe = r.id;
  }
  const people = [c, ...(companion ? [companion] : [])];
  for (const person of people) {
    person.location = task.room;
    person.swimming = false;
    person.lastAction = 'household';
    person.activityUntil = s.world.minutes + task.minutes;
    person.actionHousehold = id;
    person.actionHouseholdOwner = c.id;
    person.actionRecipe = person.id === c.id ? recipe : undefined;
    person.actionCompanion = people.find(p => p.id !== person.id)?.id;
    person.actionTarget = undefined;
    person.actionNode = undefined;
    person.actionThird = undefined;
    delete s.npcPlans[person.id];
  }
  return true;
}

export function joinHousehold(s: GameState, c: Character, owner: Character): boolean {
  if (!owner.actionHousehold || owner.activityUntil <= s.world.minutes || owner.actionCompanion || householdCompanyProblem(s, c, owner)) return false;
  const lead = s.characters[owner.actionHouseholdOwner ?? owner.id];
  if (!lead || lead.id !== owner.id || householdCompanyProblem(s, owner, c)) return false;
  if (householdProblem(s, c, owner.actionHousehold, owner.activityUntil - s.world.minutes, true)) return false;
  if (owner.actionRecipe) {
    const recipe = content().recipes.find(r => r.id === owner.actionRecipe)!;
    if (!canEat(c, recipe) || c.persona.kashrut === 'strict' && (!Object.keys(recipe.ingredients).every(k => s.house.kitchen.kosherShelf.includes(k)) ||
      recipe.category === 'meat' && !s.house.kitchen.meatPanClean || recipe.category === 'dairy' && !s.house.kitchen.dairyPanClean)) return false;
  }
  c.location = owner.location;
  c.swimming = false;
  c.lastAction = 'household';
  c.activityUntil = owner.activityUntil;
  c.actionHousehold = owner.actionHousehold;
  c.actionHouseholdOwner = owner.id;
  c.actionRecipe = undefined;
  c.actionCompanion = owner.id;
  c.actionTarget = undefined;
  c.actionNode = undefined;
  c.actionThird = undefined;
  owner.actionCompanion = c.id;
  delete s.npcPlans[c.id];
  return true;
}

export function completeHouseholds(s: GameState) {
  const due = housemates(s).filter(c => c.actionHousehold && c.actionHouseholdOwner === c.id && c.activityUntil <= s.world.minutes);
  for (const owner of due) {
    const id = owner.actionHousehold!;
    const task = HOUSEHOLD[id];
    const recipe = owner.actionRecipe;
    const participants = housemates(s).filter(c => c.actionHouseholdOwner === owner.id && c.actionHousehold === id && c.location === task.room).map(c => c.id);
    for (const c of housemates(s).filter(c => c.actionHouseholdOwner === owner.id)) {
      c.actionHousehold = undefined;
      c.actionHouseholdOwner = undefined;
      c.actionRecipe = undefined;
      c.actionCompanion = undefined;
    }
    if (!participants.includes(owner.id)) continue;
    const partner = participants.find(p => p !== owner.id);
    if (recipe) {
      const dish = content().recipes.find(r => r.id === recipe)!;
      const safeKitchen = Object.keys(dish.ingredients).every(k => s.house.kitchen.kosherShelf.includes(k)) &&
        (dish.category !== 'meat' || s.house.kitchen.meatPanClean) && (dish.category !== 'dairy' || s.house.kitchen.dairyPanClean);
      const diners = housemates(s).filter(c => c.id !== owner.id && isRoom(c.location) && !['sleep', 'nap', 'shower', 'work'].includes(c.lastAction ?? '') && canEat(c, dish) && (c.persona.kashrut !== 'strict' || safeKitchen));
      diners.sort((a, b) => Number(b.id === partner) - Number(a.id === partner) || b.needs.hunger - a.needs.hunger);
      const cooked = applyCooking(s, { recipeId: recipe, quality: partner ? (coopSkill(owner) + coopSkill(s.characters[partner])) / 2 : coopSkill(owner), cook: owner.id, partner, servedTo: diners.slice(0, Math.max(0, dish.serves - 1)).map(c => c.id), ingredientsReserved: true });
      Object.assign(s, cooked.state);
      s.characters[owner.id].needs.hunger = clamp(s.characters[owner.id].needs.hunger - 30, 0, 100);
    }
    if (id === 'dishes') { s.house.dishes = Math.max(0, s.house.dishes - 40); s.house.kitchen.meatPanClean = s.house.kitchen.dairyPanClean = true; s.world.flags.kosherPanViolation = false; }
    if (id === 'laundry') s.house.laundry = Math.max(0, s.house.laundry - 35);
    if (id === 'trash') s.house.trash = Math.max(0, s.house.trash - 40);
    const text = `${participants.map(p => firstName(s, p)).join(' and ')} ${task.label}${recipe ? ` (${content().recipes.find(r => r.id === recipe)!.name})` : ''}.`;
    const witnesses = housemates(s).filter(c => c.location === task.room && !['sleep', 'nap', 'shower'].includes(c.lastAction ?? '')).map(c => c.id);
    const fact = addFact(s, { subject: owner.id, about: partner, kind: 'event', content: text, truth: true, sensitivity: 0.1 });
    for (const who of witnesses) learn(s, who, fact.id, 'witnessed');
    for (const who of participants) {
      const c = s.characters[who];
      for (const [need, amount] of Object.entries(task.needs)) c.needs[need as keyof NeedVec] = clamp(c.needs[need as keyof NeedVec] - amount, 0, 100);
      c.energy = 100 - c.needs.energy;
      if (task.chore) { (s.house.choreLedger[who] ??= { done: 0, skipped: 0 }).done += 1 / participants.length; publicAct(s, who, 0.5, witnesses); }
      addMemory(s, who, text, participants, 0.3);
    }
    if (partner) {
      const key = `householdBond_${uk(owner.id, partner)}`;
      const block = `${s.world.episode}:${s.world.slot}`;
      if (s.world.flags[key] !== block) {
        s.world.flags[key] = block;
        for (const [a, b] of [[owner.id, partner], [partner, owner.id]]) { addRel(s, a, b, 'closeness', 2); addRel(s, a, b, 'affinity', 0.8); }
      }
    }
    addLog(s, { kind: 'domestic', text, participants, salience: 0.25, location: task.room, factId: fact.id, templateId: `household-${id}` });
    s.timeline.push({ episode: s.world.episode, slot: s.world.slot, clock: clockLabel(s.world.slot, s.world.minutes), text });
    if (s.timeline.length > 60) s.timeline.splice(0, s.timeline.length - 60);
  }
}

export function startNpcHouseholds(s: GameState, rng: Rng, actions: Record<string, AgentAction>) {
  for (const [who, action] of Object.entries(actions)) {
    const c = s.characters[who];
    if (action.kind === 'cook') { action.kind = 'household'; action.household = 'meal'; }
    if (action.kind === 'tidy') { action.kind = 'household'; action.household = 'dishes'; }
    if (action.kind !== 'household') continue;
    if (c.actionHousehold && c.activityUntil > s.world.minutes) continue;
    const cook = action.household === 'meal' && !action.target ? housemates(s).find(other => other.id !== c.id && other.actionHousehold === 'meal' && other.actionHouseholdOwner === other.id && other.activityUntil > s.world.minutes) : undefined;
    const ok = action.target ? !!s.characters[action.target] && joinHousehold(s, c, s.characters[action.target]) : cook ? joinHousehold(s, c, cook) : startHousehold(s, rng, c, action.household ?? 'clean');
    if (!ok) actions[who] = { kind: 'retreat' };
    else { action.household = c.actionHousehold; action.duration = c.activityUntil - s.world.minutes; }
  }
}

export function householdUtility(s: GameState, c: Character, id: HouseholdActivity): number {
  const task = HOUSEHOLD[id];
  const backlog = id === 'dishes' ? s.house.dishes : id === 'laundry' ? s.house.laundry : id === 'trash' ? s.house.trash : 0;
  const repeat = s.log.some(l => l.episode === s.world.episode && l.slot === s.world.slot && l.templateId === `household-${id}` && l.participants.includes(c.id));
  const hobby = c.persona.routine.hobbies.join(' ').toLowerCase();
  return Object.entries(task.needs).reduce((sum, [need, amount]) => sum + c.needs[need as keyof NeedVec] / 100 * amount / 15, 0) +
    (task.chore ? traitsOf(c).C * 0.35 + backlog / 85 : 0) +
    (id === 'meal' ? c.needs.hunger / 65 + (c.persona.values.includes('family') ? 0.2 : 0) : 0) +
    (id === 'music' && /music|guitar/.test(hobby) || id === 'plants' && /garden|plant/.test(hobby) || id === 'study' && /read|art|writ/.test(hobby) ? 0.4 : 0) -
    (repeat ? 1.2 : 0.2);
}
