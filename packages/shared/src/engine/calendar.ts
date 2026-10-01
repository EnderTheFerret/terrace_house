// Calendar: episode → date, weekday, season, weather and city events.
import type { GameState, Season, Weather } from '../model';
import { content } from '../content';
import type { Rng } from '../rng';

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Weekday of the season's first day (fixed for determinism; 0 = Sunday). */
const START_WEEKDAY = 3;

export function dayForEpisode(ep: number): number {
  return (ep - 1) * content().calendar.daysPerEpisode;
}

export function dateOf(day: number): { month: number; day: number } {
  const cal = content().calendar;
  let m = cal.startMonth - 1;
  let d = cal.startDay - 1 + day;
  while (d >= MONTH_DAYS[m]) {
    d -= MONTH_DAYS[m];
    m = (m + 1) % 12;
  }
  return { month: m + 1, day: d + 1 };
}

export const weekdayOf = (day: number) => (START_WEEKDAY + day) % 7;
export const isWeekend = (weekday: number) => weekday === 0 || weekday === 6;
export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function seasonOf(month: number): Season {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

/** City event active on a given day (typhoon handled by typhoonDay). */
export function cityEventFor(day: number, typhoonDay: number): string | null {
  if (day === typhoonDay) return 'typhoon';
  const { month, day: dom } = dateOf(day);
  const ev = content().calendar.events.find((e) => e.id !== 'typhoon' && e.month === month && dom >= e.dayFrom && dom <= e.dayTo);
  return ev?.id ?? null;
}

/** Pick the typhoon day: the in-season day (of an episode) that falls in the typhoon month. */
export function chooseTyphoonDay(rng: Rng, seasonLength: number): number {
  const ty = content().calendar.events.find((e) => e.id === 'typhoon')!;
  const candidates: number[] = [];
  for (let ep = 1; ep <= seasonLength; ep++) {
    const day = dayForEpisode(ep);
    const d = dateOf(day);
    if (d.month === ty.month && d.day >= ty.dayFrom && d.day <= ty.dayTo) candidates.push(day);
  }
  return candidates.length ? rng.pick(candidates) : -1;
}

const WEATHER_P: Record<Season, [Weather, number][]> = {
  spring: [['sunny', 0.5], ['cloudy', 0.3], ['rain', 0.2]],
  summer: [['sunny', 0.6], ['cloudy', 0.15], ['rain', 0.25]],
  autumn: [['sunny', 0.45], ['cloudy', 0.35], ['rain', 0.2]],
  winter: [['sunny', 0.45], ['cloudy', 0.35], ['rain', 0.1], ['snow', 0.1]],
};

/** Set date-derived world fields at the start of an episode. */
export function applyCalendar(s: GameState, rng: Rng) {
  const day = dayForEpisode(s.world.episode);
  const { month } = dateOf(day);
  s.world.day = day;
  s.world.weekday = weekdayOf(day);
  s.world.season = seasonOf(month);
  s.world.cityEvent = cityEventFor(day, s.world.typhoonDay);
  if (s.world.cityEvent === 'typhoon') s.world.weather = 'typhoon';
  else {
    const opts = WEATHER_P[s.world.season];
    s.world.weather = rng.weighted(
      opts.map((o) => o[0]),
      opts.map((o) => o[1]),
    );
  }
}

export function dateLabel(day: number) {
  const d = dateOf(day);
  return `${WEEKDAY_NAMES[weekdayOf(day)]} ${MONTH_NAMES[d.month - 1]} ${d.day}`;
}

export function birthdayDay(charId: string): number {
  // deterministic pseudo birthday as season-day offset
  let h = 0;
  for (const c of charId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
