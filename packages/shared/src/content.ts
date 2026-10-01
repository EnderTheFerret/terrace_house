// Loads and validates all content/*.json once. Pure data, no I/O beyond bundler JSON imports.
import { z } from 'zod';
import castJson from '../../../content/cast.json';
import archetypesJson from '../../../content/archetypes.json';
import arcsJson from '../../../content/arcs.json';
import cityJson from '../../../content/city.json';
import calendarJson from '../../../content/calendar.json';
import recipesJson from '../../../content/recipes.json';
import panelJson from '../../../content/panel.json';
import quirksJson from '../../../content/quirks.json';
import npcsJson from '../../../content/recurring-npcs.json';
import houseJson from '../../../content/house.json';
import jobsJson from '../../../content/jobs.json';
import evCore from '../../../content/events/core.json';
import evDomestic from '../../../content/events/domestic.json';
import evCalendar from '../../../content/events/calendar.json';
import evArcs from '../../../content/events/arcs.json';
import evInteractions from '../../../content/events/interactions.json';
import {
  Arc, Archetype, CalendarEvent, CastEntry, City, EventTemplate, HouseContent, Job, Panelist, Quirk, Quirks, Recipe, RecurringNpc,
} from './contentSchema';

function parse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`content ${label} invalid: ${r.error.message.slice(0, 2000)}`);
  return r.data;
}

const eventFiles: Record<string, unknown> = { core: evCore, domestic: evDomestic, calendar: evCalendar, arcs: evArcs, interactions: evInteractions };

export interface Content {
  cast: CastEntry[];
  archetypes: Archetype[];
  names: { woman: string[]; man: string[]; nonbinary: string[]; family: string[] };
  hometowns: string[];
  appearanceOptions: Record<string, string[]>;
  arcs: Arc[];
  city: City;
  calendar: { startMonth: number; startDay: number; daysPerEpisode: number; events: CalendarEvent[] };
  recipes: Recipe[];
  panel: Panelist[];
  freezeCaptions: string[];
  quirks: Quirk[];
  npcs: RecurringNpc[];
  house: HouseContent;
  jobs: Job[];
  events: EventTemplate[];
  eventById: Map<string, EventTemplate>;
}

function load(): Content {
  const events: EventTemplate[] = [];
  for (const [file, data] of Object.entries(eventFiles)) {
    events.push(...parse(z.object({ events: z.array(EventTemplate) }), data, `events/${file}`).events);
  }
  const ids = new Set<string>();
  for (const e of events) {
    if (ids.has(e.id)) throw new Error(`duplicate event id ${e.id}`);
    ids.add(e.id);
  }
  const arch = parse(
    z.object({
      archetypes: z.array(Archetype).min(12),
      names: z.object({ woman: z.array(z.string()), man: z.array(z.string()), nonbinary: z.array(z.string()), family: z.array(z.string()) }),
      hometowns: z.array(z.string()),
      appearance: z.record(z.string(), z.array(z.string())),
    }),
    archetypesJson,
    'archetypes',
  );
  const content: Content = {
    cast: parse(z.object({ cast: z.array(CastEntry).length(5) }), castJson, 'cast').cast,
    archetypes: arch.archetypes,
    names: arch.names,
    hometowns: arch.hometowns,
    appearanceOptions: arch.appearance,
    arcs: parse(z.object({ arcs: z.array(Arc) }), arcsJson, 'arcs').arcs,
    city: parse(City, cityJson, 'city'),
    calendar: parse(
      z.object({ startMonth: z.number(), startDay: z.number(), daysPerEpisode: z.number(), events: z.array(CalendarEvent) }),
      calendarJson,
      'calendar',
    ),
    recipes: parse(z.object({ recipes: z.array(Recipe).min(8) }), recipesJson, 'recipes').recipes,
    ...(() => {
      const p = parse(z.object({ panelists: z.array(Panelist).length(5), freezeCaptions: z.array(z.string()) }), panelJson, 'panel');
      return { panel: p.panelists, freezeCaptions: p.freezeCaptions };
    })(),
    quirks: parse(Quirks, quirksJson, 'quirks').quirks,
    npcs: parse(z.object({ npcs: z.array(RecurringNpc).min(8) }), npcsJson, 'recurring-npcs').npcs,
    house: parse(HouseContent, houseJson, 'house'),
    jobs: parse(z.object({ jobs: z.array(Job).min(30) }), jobsJson, 'jobs').jobs,
    events,
    eventById: new Map(events.map((e) => [e.id, e])),
  };
  return content;
}

let cached: Content | null = null;
export function content(): Content {
  if (!cached) cached = load();
  return cached;
}

export function eventTemplate(id: string): EventTemplate {
  const t = content().eventById.get(id);
  if (!t) throw new Error(`unknown event template ${id}`);
  return t;
}
