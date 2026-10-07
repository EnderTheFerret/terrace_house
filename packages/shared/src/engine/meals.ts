import type { EventInstance, GameState } from '../model';
import { clamp } from '../util';
import { content } from '../content';
import { addLog, addMemory, firstName, housemates, isRoom } from './core';
import { hasJobNow, isShabbat } from './agents';
import { classToday, shiftToday } from './city';
import { addGroceries, consume } from './house';

export function welcomeDinnerDue(s: GameState) {
  return s.world.flags.communalMeals === true && !!s.world.flags.moveIn && s.world.episode === 1 &&
    ['evening', 'lateNight'].includes(s.world.slot) && s.world.flags.mealDinner !== 1;
}

export function communalMeal(s: GameState) {
  const mandatory = welcomeDinnerDue(s);
  const kind = s.world.slot === 'morning' ? 'breakfast' : s.world.slot === 'evening' || mandatory ? 'dinner' : null;
  if (s.world.flags.communalMeals !== true || !kind || s.seasonOver || s.awaitingPlayer ||
    (s.world.episode === 1 && !mandatory) ||
    s.world.flags[kind === 'breakfast' ? 'mealBreakfast' : 'mealDinner'] === s.world.episode ||
    (!mandatory && s.world.minutes >= 60)) return;
  const residents = housemates(s);
  if (mandatory && (Object.values(s.characters).some(c => c.status === 'arriving') ||
    residents.length !== 6 || (s.world.flags.gradualMoveIn && residents.some(c => !s.world.flags[`introduced_${c.id}`])))) return;
  const eligible = residents.filter(c => {
    if (c.actionHousehold && c.activityUntil > s.world.minutes) return false;
    if (mandatory) return true;
    if (s.world.flags[`away_${c.id}`] || String(s.world.flags.trip ?? '').split('|')[1]?.split(',').includes(c.id)) return false;
    if (s.invitations.some(p => p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot && [p.from, p.to].includes(c.id))) return false;
    if (!isShabbat(s, c) && (c.isPlayer ? shiftToday(s.world.playerJob, s.world.weekday, s.world.slot) || classToday(c.occupation, s.world.weekday, s.world.slot) : hasJobNow(s, c) || classToday(c.occupation, s.world.weekday, s.world.slot))) return false;
    const active = c.activityUntil > s.world.minutes;
    if (active && (!isRoom(c.location) || ['sleep', 'nap', 'shower', 'work'].includes(c.lastAction ?? ''))) return false;
    return isRoom(c.location) || (!active && ['work', 'goOut'].includes(c.lastAction ?? ''));
  });
  if (mandatory && eligible.length !== residents.length) return;
  const player = eligible.find(c => c.isPlayer);
  const others = eligible.filter(c => !c.isPlayer).sort((a, b) => b.needs.hunger - a.needs.hunger || a.id.localeCompare(b.id));
  const diners = [...(player ? [player] : []), ...(kind === 'breakfast' ? others.slice(0, 2) : others)];
  if (diners.length < 2) return;
  return { kind, mandatory, participants: diners.map(c => c.id) };
}

export function serveCommunalMeal(s: GameState, ev: EventInstance) {
  if (!ev.tags.includes('communal-meal')) return;
  const breakfast = ev.tags.includes('breakfast');
  const key = breakfast ? 'mealBreakfast' : 'mealDinner';
  if (s.world.flags[key] === ev.episode) return;
  s.world.flags[key] = ev.episode;
  // A ready-to-eat vegan, kosher spread works for every resident, including on Shabbat.
  const recipe = content().recipes.find(r => r.id === 'onigiri-set')!;
  // Unmarked food stays in the fridge; the meal budget covers ready-made kosher portions instead.
  const ingredients = Object.fromEntries(Object.entries(recipe.ingredients).filter(([id]) => s.house.kitchen.kosherShelf.includes(id)).map(([id, n]) => [id, Math.ceil(n * ev.participants.length / recipe.serves)]));
  const missing = Object.fromEntries(Object.entries(ingredients).map(([id, n]) => [id, Math.max(0, n - (s.house.fridge[id] ?? 0))]));
  addGroceries(s, missing);
  consume(s, ingredients);
  s.house.groceryBudget -= ev.participants.length * (breakfast ? 2 : 4);
  s.house.dishes = clamp(s.house.dishes + ev.participants.length * 3, 0, 100);
  const text = `${ev.participants.map(id => firstName(s, id)).join(', ')} shared ${breakfast ? 'breakfast' : 'dinner'}: ready-to-eat ${recipe.name}, with vegan food and kosher preparation for everyone.`;
  for (const id of ev.participants) {
    const c = s.characters[id];
    c.needs.hunger = clamp(c.needs.hunger - 30, 0, 100);
    c.needs.social = clamp(c.needs.social - 8, 0, 100);
    addMemory(s, id, text, ev.participants, ev.tags.includes('welcome-dinner') ? 0.6 : 0.3);
  }
  addLog(s, { kind: 'domestic', text, participants: ev.participants, salience: 0.4 });
}
