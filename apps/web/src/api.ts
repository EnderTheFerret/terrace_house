// Thin client for the server API + SSE scene streaming.
import type { Emotion, Occasion, PlayerAction, PlayerSetup, PlayerView } from '@shared-roof/shared';

export interface OutfitRef { occasion: Occasion; day: number }

export interface SceneSummary {
  id: string;
  title: string;
  premise: string;
  location: string;
  locationName: string;
  participants: string[];
  isPlayerScene: boolean;
  visible: boolean;
  rendered: boolean;
  phase: 'new' | 'awaiting-response' | 'awaiting-choice' | 'post' | 'done';
  arc: boolean;
  chat: boolean;
}

export interface Health {
  llm: 'ok' | 'down';
  image: 'ok' | 'down';
  mode: 'mock' | 'real';
  model: string;
  imageBackend: string;
  imagesOffline: boolean;
}

export interface ImageStatus {
  key: string;
  status: 'ready' | 'queued' | 'running' | 'failed' | 'cancelled';
  url?: string;
  placeholder?: boolean;
}

export interface Activity { label: string; startedAt: number; estimatedMs: number }
export interface ServerActivity {
  text: Activity[];
  image: (Activity & { characterId?: string; progress?: number; queued: number; waiting?: string }) | null;
}
export const pendingRequests = new Map<symbol, Activity>();

function track(label: string, estimatedMs = 5000) {
  const key = Symbol();
  pendingRequests.set(key, { label, startedAt: Date.now(), estimatedMs });
  window.dispatchEvent(new Event('game-activity'));
  return () => { pendingRequests.delete(key); window.dispatchEvent(new Event('game-activity')); };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const label = method === 'POST' ?
    path === '/api/game/new' ? 'Preparing housemates' :
    path === '/api/appearance/describe' ? 'Interpreting appearance' :
    path === '/api/studio/intermission' ? 'Generating panel commentary' :
    path === '/api/game/end-slot' ? 'Advancing the day' :
    path.startsWith('/api/image/') || path.endsWith('/image') || path === '/api/game/appearance-palette' ? null :
    path.endsWith('/choose') ? 'Sending your response' :
    path.includes('/saves') ? 'Saving or loading game' : 'Processing interaction' : null;
  const finish = label ? track(label) : () => {};
  try {
    const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
    return j as T;
  } finally { finish(); }
}

export const api = {
  health: () => req<Health>('GET', '/api/health'),
  activity: (signal?: AbortSignal) => fetch('/api/activity', { signal }).then(async r => { if (!r.ok) throw new Error('activity unavailable'); return await r.json() as ServerActivity; }),
  game: () => req<{ view: PlayerView; scenes: SceneSummary[] }>('GET', '/api/game'),
  newGame: (body: { seed?: number; player?: PlayerSetup; randomizeCast?: boolean; seasonLength?: number }) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', '/api/game/new', body),
  act: (action: PlayerAction) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', '/api/game/action', { action }),
  endSlot: () => req<{ view: PlayerView; newEpisode: boolean; seasonOver: boolean; intermission: 'mid' | 'end' | null }>('POST', '/api/game/end-slot'),
  intermission: () => req<{ at: 'mid' | 'end'; lines: { speaker: string; text: string; reaction: string }[] }>('POST', '/api/studio/intermission'),
  respond: (id: string, response: 'join' | 'eavesdrop' | 'ignore') => req<{ scene: SceneSummary }>('POST', `/api/scene/${id}/respond`, { response }),
  choose: (id: string, choice: { intent?: string; text?: string; done?: boolean; listen?: boolean }) => req<{ ok: boolean }>('POST', `/api/scene/${id}/choose`, choice),
  sceneImage: (id: string) => req<ImageStatus>('POST', `/api/scene/${id}/image`),
  newPlayer: (player: PlayerSetup) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', '/api/game/new-player', { player }),
  cooking: (body: { recipeId: string; quality: number; partner?: string; servedTo: string[]; utensil?: 'meat' | 'dairy' | 'parve' }) =>
    req<{ view: PlayerView; receptions: { charId: string; r: number; verdict: string }[]; improvised: boolean }>('POST', '/api/game/cooking', body),
  saves: () => req<{ saves: { id: number; slot: number; name: string; episode: number; created_at: string }[] }>('GET', '/api/saves'),
  save: (slot: number, name?: string) => req<{ id: number }>('POST', '/api/saves', { slot, name }),
  load: (id: number) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', `/api/saves/${id}/load`),
  portrait: (body: { id?: string; age: number; gender: string; appearance: unknown; appearanceText?: string; portraitSeed: number; lowRes?: boolean }) => req<ImageStatus>('POST', '/api/image/portrait', body),
  mapAppearance: (text: string, appearance: unknown) => req<{ appearance: PlayerSetup['appearance']; appearanceText: string }>('POST', '/api/appearance/describe', { text, appearance }),
  savePalette: (id: string, portraitSeed: number, palette: NonNullable<PlayerSetup['appearance']['palette']>) => req<{ updated: boolean }>('POST', '/api/game/appearance-palette', { id, portraitSeed, palette }),
  charPortrait: (id: string) => req<ImageStatus>('GET', `/api/image/character/${id}`),
  broadcast: () => req<{ episode: number | null; scenes: { title: string; location: string; mine: boolean; lines: { name: string; text: string }[] }[] }>('GET', '/api/broadcast'),
  feedPhoto: (id: string) => req<ImageStatus>('GET', `/api/image/feed/${encodeURIComponent(id)}`),
  selfie: (from: string, tick: number) => req<ImageStatus>('GET', `/api/image/selfie/${encodeURIComponent(from)}/${tick}`),
  charSprite: (id: string, day: number, occasion = 'daily') => req<ImageStatus>('GET', `/api/image/character/${encodeURIComponent(id)}/sprite?day=${day}&occasion=${occasion}`),
  expression: (id: string, emotion: Emotion, outfit?: OutfitRef) => req<ImageStatus>('POST', `/api/image/character/${id}/expression`, { emotion, ...outfit }),
  /** visual-novel figure (background removed) in the occasion's outfit with an expression; 409 while a step is drawn */
  stand: (id: string, o: OutfitRef, emotion: Emotion) => req<ImageStatus>('GET', `/api/image/character/${encodeURIComponent(id)}/stand?occasion=${o.occasion}&day=${o.day}&emotion=${emotion}`),
  /** the approved portrait re-dressed for an occasion; 409 until the base portrait exists */
  outfitPortrait: (id: string, o: OutfitRef) => req<ImageStatus>('GET', `/api/image/character/${encodeURIComponent(id)}/outfit?occasion=${o.occasion}&day=${o.day}`),
  location: (location: string, slot: string, weather: string) => req<ImageStatus>('POST', '/api/image/location', { location, slot, weather }),
  panel: () => req<Record<string, ImageStatus>>('GET', '/api/image/panel'),
  imageStatus: (key: string) => req<ImageStatus>('GET', `/api/image/status/${key}`),
  debug: () => req<any>('GET', '/api/debug'),
};

/** Stream one scene segment. Returns when the server sends `end`. */
export function streamScene(id: string, on: (event: string, data: any) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = track('Generating response', 8000);
    const es = new EventSource(`/api/scene/${id}/stream`);
    const events = ['scene', 'line-start', 'token', 'line-end', 'choice', 'respond', 'outcome', 'commentary', 'freeze', 'done', 'error'];
    for (const ev of events) es.addEventListener(ev, (e) => on(ev, JSON.parse((e as MessageEvent).data)));
    es.addEventListener('end', () => {
      es.close();
      finish();
      resolve();
    });
    es.onerror = (event) => {
      if (event instanceof MessageEvent) return; // server error payload is handled above; only transport errors interrupt SSE
      es.close();
      finish();
      reject(new Error('stream interrupted'));
    };
    signal?.addEventListener('abort', () => {
      es.close();
      finish();
      resolve();
    });
  });
}

/** Poll an image until it settles (with a cap). */
export async function waitImage(st: ImageStatus, onReady: (s: ImageStatus) => void, signal?: AbortSignal) {
  let cur = st;
  for (let i = 0; i < 600 && !signal?.aborted; i++) {
    if (cur.status === 'ready') return onReady(cur);
    if (cur.status === 'failed' || cur.status === 'cancelled') return onReady(cur);
    await new Promise((r) => setTimeout(r, i < 10 ? 400 : 1500));
    try {
      cur = await api.imageStatus(cur.key);
    } catch {
      if (!signal?.aborted) onReady({ ...cur, status: 'failed' });
      return;
    }
  }
  if (!signal?.aborted) onReady({ ...cur, status: 'failed' });
}
