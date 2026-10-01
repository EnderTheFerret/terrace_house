// Thin client for the server API + SSE scene streaming.
import type { PlayerAction, PlayerSetup, PlayerView } from '@shared-roof/shared';

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

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  health: () => req<Health>('GET', '/api/health'),
  game: () => req<{ view: PlayerView; scenes: SceneSummary[] }>('GET', '/api/game'),
  newGame: (body: { seed?: number; player?: PlayerSetup; randomizeCast?: boolean }) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', '/api/game/new', body),
  act: (action: PlayerAction) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', '/api/game/action', { action }),
  endSlot: () => req<{ view: PlayerView; newEpisode: boolean; seasonOver: boolean; intermission: 'mid' | 'end' | null }>('POST', '/api/game/end-slot'),
  intermission: () => req<{ at: 'mid' | 'end'; lines: { speaker: string; text: string; reaction: string }[] }>('POST', '/api/studio/intermission'),
  respond: (id: string, response: 'join' | 'eavesdrop' | 'ignore') => req<{ scene: SceneSummary }>('POST', `/api/scene/${id}/respond`, { response }),
  choose: (id: string, choice: { intent?: string; text?: string; done?: boolean }) => req<{ ok: boolean }>('POST', `/api/scene/${id}/choose`, choice),
  newPlayer: (player: PlayerSetup) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', '/api/game/new-player', { player }),
  cooking: (body: { recipeId: string; quality: number; partner?: string; servedTo: string[] }) =>
    req<{ view: PlayerView; receptions: { charId: string; r: number; verdict: string }[]; improvised: boolean }>('POST', '/api/game/cooking', body),
  saves: () => req<{ saves: { id: number; slot: number; name: string; episode: number; created_at: string }[] }>('GET', '/api/saves'),
  save: (slot: number, name?: string) => req<{ id: number }>('POST', '/api/saves', { slot, name }),
  load: (id: number) => req<{ view: PlayerView; scenes: SceneSummary[] }>('POST', `/api/saves/${id}/load`),
  portrait: (body: { id?: string; age: number; gender: string; appearance: unknown; portraitSeed: number; lowRes?: boolean }) => req<ImageStatus>('POST', '/api/image/portrait', body),
  charPortrait: (id: string) => req<ImageStatus>('GET', `/api/image/character/${id}`),
  location: (location: string, slot: string, weather: string) => req<ImageStatus>('POST', '/api/image/location', { location, slot, weather }),
  panel: () => req<Record<string, ImageStatus>>('GET', '/api/image/panel'),
  imageStatus: (key: string) => req<ImageStatus>('GET', `/api/image/status/${key}`),
  debug: () => req<any>('GET', '/api/debug'),
};

/** Stream one scene segment. Returns when the server sends `end`. */
export function streamScene(id: string, on: (event: string, data: any) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/scene/${id}/stream`);
    const events = ['scene', 'line-start', 'token', 'line-end', 'choice', 'respond', 'outcome', 'commentary', 'freeze', 'done', 'error'];
    for (const ev of events) es.addEventListener(ev, (e) => on(ev, JSON.parse((e as MessageEvent).data)));
    es.addEventListener('end', () => {
      es.close();
      resolve();
    });
    es.onerror = () => {
      es.close();
      reject(new Error('stream interrupted'));
    };
    signal?.addEventListener('abort', () => {
      es.close();
      resolve();
    });
  });
}

/** Poll an image until it settles (with a cap). */
export async function waitImage(st: ImageStatus, onReady: (s: ImageStatus) => void, signal?: AbortSignal) {
  let cur = st;
  for (let i = 0; i < 600 && !signal?.aborted; i++) {
    if (cur.status === 'ready') return onReady(cur);
    if (cur.status === 'failed' || cur.status === 'cancelled') return;
    await new Promise((r) => setTimeout(r, i < 10 ? 400 : 1500));
    try {
      cur = await api.imageStatus(cur.key);
    } catch {
      return;
    }
  }
}
