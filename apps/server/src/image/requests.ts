// Image request builders (prompts compiled by shared pure functions; style prefix from config).
import {
  compileAppearancePrompt, compileLocationPrompt, content, hashSeed, sanitizePromptText, GLOBAL_NEGATIVE,
  type Character, type EventInstance, type GameState, type ImageRequest, type Slot,
} from '@shared-roof/shared';
import { config } from '../config';

const size = (k: string) => config.sizes[k] ?? [1024, 1024];

export function portraitRequest(c: Pick<Character, 'id' | 'age' | 'gender' | 'appearance' | 'portraitSeed'>, lowRes = false): ImageRequest {
  const p = compileAppearancePrompt(c, 'portrait', { stylePrefix: config.stylePrefix });
  const [w, h] = size('portrait');
  const scale = lowRes ? 0.5 : 1;
  return {
    kind: 'portrait',
    prompt: p.positive,
    negative: p.negative,
    seed: c.portraitSeed,
    width: Math.round((w * scale) / 16) * 16,
    height: Math.round((h * scale) / 16) * 16,
    subjectKey: `portrait:${c.id}:${c.portraitSeed}:${hashSeed(JSON.stringify(c.appearance)) % 100000}`,
    meta: { appearance: c.appearance, gender: c.gender },
  };
}

export const timeOfDay = (slot: Slot): 'morning' | 'day' | 'evening' | 'night' => (slot === 'morning' ? 'morning' : slot === 'slot3' ? 'evening' : slot === 'evening' ? 'night' : 'day');

export function locationRequest(locId: string, slot: Slot, weather: string): ImageRequest {
  const node = content().city.nodes.find((n) => n.id === locId);
  const room = content().house.rooms.find((r) => r.id === locId);
  const name = node?.name ?? (room ? `share house ${room.name}` : locId);
  const desc = node?.description ?? (room ? `cozy modern japanese share house interior, ${room.name}` : '');
  const tod = timeOfDay(slot);
  // weather variants are rendered as overlays client-side; only rain/snow get their own background
  const w = weather === 'rain' || weather === 'typhoon' || weather === 'snow' ? weather : 'clear';
  const p = compileLocationPrompt(name, desc, tod, w, config.stylePrefix);
  const [W, H] = size('location');
  return { kind: 'location', prompt: p.positive, negative: p.negative, seed: hashSeed(`${locId}:${tod}:${w}`) % 100000, width: W, height: H, subjectKey: `location:${locId}:${tod}${w === 'clear' ? '' : ':' + w}`, meta: { timeOfDay: tod, weather: w } };
}

export function avatarRequest(panelistId: string): ImageRequest {
  const p = content().panel.find((x) => x.id === panelistId)!;
  const [W, H] = size('avatar');
  return {
    kind: 'avatar',
    prompt: `${config.stylePrefix}, adult, age 20+, ${sanitizePromptText(p.appearance)}, tv studio panel guest, sitting at a desk, square avatar, head and shoulders, studio backdrop`,
    negative: GLOBAL_NEGATIVE,
    seed: p.avatarSeed,
    width: W,
    height: H,
    subjectKey: `avatar:${p.id}`,
  };
}

export function freezeRequest(s: GameState, ev: EventInstance): ImageRequest {
  const people = ev.participants.map((id) => s.characters[id]).filter(Boolean).slice(0, 2);
  const who = people.map((c) => compileAppearancePrompt(c, 'scene', { stylePrefix: '' }).positive.replace(/^,\s*/, '')).join('; and ');
  const loc = content().city.nodes.find((n) => n.id === ev.location)?.name ?? `share house ${ev.location}`;
  const [W, H] = size('freeze');
  return {
    kind: 'freeze',
    prompt: `${config.stylePrefix}, adult, age 20+, freeze frame still, ${sanitizePromptText(ev.title)} at ${loc}, ${who}, emotional moment, cinematic composition`,
    negative: GLOBAL_NEGATIVE,
    seed: hashSeed(ev.id) % 100000,
    width: W,
    height: H,
    subjectKey: `freeze:${ev.templateId}:${ev.location}:${ev.participants.join('-')}`,
    meta: { timeOfDay: timeOfDay(ev.slot), people: people.map((c) => ({ appearance: c.appearance, gender: c.gender, seed: c.portraitSeed })) },
  };
}
