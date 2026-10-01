// Zustand store: screens, game view, scene queue/streaming state, settings.
import { create } from 'zustand';
import type { PlayerAction, PlayerSetup, PlayerView } from '@shared-roof/shared';
import { api, streamScene, type Health, type ImageStatus, type SceneSummary } from './api';
import { blip } from './audio';

export type Screen =
  | 'title' | 'creator' | 'house' | 'map' | 'scene' | 'cooking' | 'practice' | 'phone' | 'board' | 'bible' | 'fridge'
  | 'debug' | 'summary' | 'settings' | 'saves' | 'episode';

export interface Settings {
  captions: boolean;
  reducedMotion: boolean;
  images: boolean;
  sound: boolean;
  textScale: number;
  author: boolean;
  typewriter: boolean;
}

export interface LiveLine {
  index: number;
  speaker: string;
  name: string;
  text: string;
  caption: string | null;
  done: boolean;
  emotion?: string;
}

export interface LiveScene {
  id: string;
  header?: {
    title: string;
    premise: string;
    location: string;
    locationName: string;
    participants: { id: string; name: string }[];
    outsiders: { id: string; name: string }[];
    isPlayerScene: boolean;
    eavesdrop: boolean;
    background: ImageStatus;
    chat: boolean;
    intro: { id: string; name: string; age: number; occupation: string; hometown: string } | null;
  };
  lines: LiveLine[];
  choice: string[] | null;
  respond: boolean;
  outcome: { confession?: string; leaving?: string[]; cues: string[] } | null;
  commentary: { lines: { speaker: string; text: string; reaction: string }[]; prediction?: { text: string }; predictionBy?: string } | null;
  freeze: { caption: string; image: ImageStatus } | null;
  done: boolean;
  streaming: boolean;
  error?: string;
}

const SETTINGS_KEY = 'shared-roof-settings';
const defaults: Settings = { captions: true, reducedMotion: false, images: true, sound: true, textScale: 1, author: false, typewriter: true };
function loadSettings(): Settings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

interface State {
  screen: Screen;
  back: Screen;
  view: PlayerView | null;
  scenes: SceneSummary[];
  live: LiveScene | null;
  health: Health | null;
  settings: Settings;
  busy: boolean;
  error: string | null;
  episodeCard: 'end' | 'start' | null;
  showDigest: boolean;
  slotDigest: PlayerView['digest'];
  practiceRecipe: string | null;
  setScreen(s: Screen): void;
  goBack(): void;
  setSettings(p: Partial<Settings>): void;
  refreshHealth(): Promise<void>;
  boot(): Promise<void>;
  newGame(body: { seed?: number; player?: PlayerSetup; randomizeCast?: boolean }): Promise<void>;
  loadSave(id: number): Promise<void>;
  act(a: PlayerAction): Promise<void>;
  nextScene(): Promise<void>;
  playLive(id: string): Promise<void>;
  respond(r: 'join' | 'eavesdrop' | 'ignore'): Promise<void>;
  choose(intent: string): Promise<void>;
  finishSlot(): Promise<void>;
  setView(v: PlayerView): void;
  clearError(): void;
}

const emptyLive = (id: string): LiveScene => ({ id, lines: [], choice: null, respond: false, outcome: null, commentary: null, freeze: null, done: false, streaming: false });

export const useGame = create<State>((set, get) => ({
  screen: 'title',
  back: 'house',
  view: null,
  scenes: [],
  live: null,
  health: null,
  settings: loadSettings(),
  busy: false,
  error: null,
  episodeCard: null,
  showDigest: false,
  slotDigest: [],
  practiceRecipe: null,

  setScreen: (screen) => set((st) => ({ screen, back: ['house', 'map'].includes(st.screen) ? st.screen : st.back })),
  goBack: () => set((st) => ({ screen: st.view ? st.back : 'title' })),
  setSettings: (p) => {
    const settings = { ...get().settings, ...p };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },
  clearError: () => set({ error: null }),
  setView: (view) => set({ view }),

  refreshHealth: async () => {
    try {
      set({ health: await api.health() });
    } catch {
      set({ health: null });
    }
  },

  boot: async () => {
    void get().refreshHealth();
    try {
      const g = await api.game();
      set({ view: g.view, scenes: g.scenes });
    } catch {
      /* no game yet */
    }
  },

  newGame: async (body) => {
    set({ busy: true, error: null });
    try {
      const g = await api.newGame(body);
      set({ view: g.view, scenes: [], episodeCard: 'start', screen: 'episode', busy: false });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },

  loadSave: async (id) => {
    set({ busy: true });
    try {
      const g = await api.load(id);
      set({ view: g.view, scenes: [], screen: 'house', busy: false, live: null });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },

  act: async (a) => {
    if (get().busy) return;
    set({ busy: true, error: null });
    try {
      const r = await api.act(a);
      set({ view: r.view, scenes: r.scenes, busy: false });
      await get().nextScene();
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },

  /** Advance to the next scene that needs the player (rendered and not done), or finish the slot. */
  nextScene: async () => {
    const next = get().scenes.find((s) => s.rendered && s.phase !== 'done' && s.id !== get().live?.id);
    if (!next) return get().finishSlot();
    set({ live: emptyLive(next.id), screen: 'scene' });
    if (next.phase === 'awaiting-response') set({ live: { ...emptyLive(next.id), respond: true } });
    else await get().playLive(next.id);
  },

  playLive: async (id) => {
    const patch = (fn: (l: LiveScene) => LiveScene) => set((st) => (st.live && st.live.id === id ? { live: fn(st.live) } : {}));
    patch((l) => ({ ...l, streaming: true, choice: null, respond: false }));
    try {
      await streamScene(id, (ev, d) => {
        switch (ev) {
          case 'scene':
            patch((l) => ({ ...l, header: d }));
            break;
          case 'line-start':
            patch((l) => (l.lines.some((x) => x.index === d.index) ? l : { ...l, lines: [...l.lines, { index: d.index, speaker: d.speaker, name: d.name, text: '', caption: d.caption, done: false, emotion: d.emotion }] }));
            break;
          case 'token':
            if (get().settings.sound) blip(d.index);
            patch((l) => ({ ...l, lines: l.lines.map((x) => (x.index === d.index ? { ...x, text: x.text + d.token } : x)) }));
            break;
          case 'line-end':
            patch((l) => {
              const has = l.lines.some((x) => x.index === d.index);
              const line = { index: d.index, speaker: d.speaker, name: l.lines.find((x) => x.index === d.index)?.name ?? d.speaker, text: d.text, caption: d.caption, done: true };
              return { ...l, lines: has ? l.lines.map((x) => (x.index === d.index ? { ...x, text: d.text, caption: d.caption, done: true } : x)) : [...l.lines, line] };
            });
            break;
          case 'choice':
            patch((l) => ({ ...l, choice: d.intents }));
            break;
          case 'respond':
            patch((l) => ({ ...l, respond: true }));
            break;
          case 'outcome':
            patch((l) => ({ ...l, outcome: d }));
            break;
          case 'freeze':
            patch((l) => ({ ...l, freeze: { caption: d.caption, image: d.image } }));
            break;
          case 'commentary':
            patch((l) => ({ ...l, commentary: d }));
            break;
          case 'done':
            patch((l) => ({ ...l, done: true, ...(d.replay ? { lines: (d.transcript ?? []).map((t: any, i: number) => ({ index: i, speaker: t.speaker, name: t.speaker, text: t.text, caption: t.caption, done: true })), commentary: d.commentary ?? null } : {}) }));
            set((st) => ({ scenes: st.scenes.map((s) => (s.id === id ? { ...s, phase: 'done' } : s)) }));
            break;
          case 'error':
            patch((l) => ({ ...l, error: d.message }));
            break;
        }
      });
    } catch (e) {
      patch((l) => ({ ...l, error: (e as Error).message }));
    }
    patch((l) => ({ ...l, streaming: false }));
  },

  respond: async (r) => {
    const live = get().live;
    if (!live) return;
    const { scene } = await api.respond(live.id, r);
    set((st) => ({ scenes: st.scenes.map((s) => (s.id === live.id && scene ? scene : s)) }));
    if (r === 'ignore') {
      set({ live: null });
      return get().nextScene();
    }
    await get().playLive(live.id);
  },

  choose: async (intent) => {
    const live = get().live;
    if (!live?.choice) return;
    set((st) => ({ live: st.live ? { ...st.live, choice: null } : null }));
    await api.choose(live.id, intent);
    await get().playLive(live.id);
  },

  finishSlot: async () => {
    set({ busy: true, live: null });
    try {
      const r = await api.endSlot();
      const digest = r.view.digest;
      set({ view: r.view, scenes: [], busy: false, slotDigest: digest, showDigest: digest.length > 0 && !r.newEpisode });
      if (r.seasonOver) set({ screen: 'summary' });
      else if (r.newEpisode) set({ episodeCard: 'end', screen: 'episode' });
      else set({ screen: r.view.slot === 'morning' || r.view.slot === 'evening' ? 'house' : get().back === 'map' ? 'map' : 'house' });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },
}));
