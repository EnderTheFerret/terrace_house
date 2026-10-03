// Zustand store: screens, game view, scene queue/streaming state, settings.
import { create } from 'zustand';
import type { Occasion, PlayerAction, PlayerSetup, PlayerView } from '@shared-roof/shared';
import { api, streamScene, type Health, type ImageStatus, type SceneSummary } from './api';
import { blip } from './audio';

export type Screen =
  | 'title' | 'creator' | 'house' | 'map' | 'scene' | 'cooking' | 'practice' | 'phone' | 'board' | 'bible' | 'fridge'
  | 'debug' | 'summary' | 'settings' | 'saves' | 'episode' | 'studio';

export interface Settings {
  captions: boolean;
  reducedMotion: boolean;
  images: boolean;
  sound: boolean;
  textScale: number;
  author: boolean;
  typewriter: boolean;
  /** move-in day tutorial tips (the day itself always happens) */
  tutorial: boolean;
  tipsSeen: string[];
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
    /** what everyone wears here (beach, date, outdoor, daily) */
    occasion: Occasion;
    participants: { id: string; name: string; occasion?: Occasion }[];
    outsiders: { id: string; name: string }[];
    isPlayerScene: boolean;
    eavesdrop: boolean;
    background: ImageStatus;
    chat: boolean;
    intro: { id: string; name: string; age: number; occupation: string; hometown: string } | null;
  };
  lines: LiveLine[];
  choice: string[] | null;
  /** the player may type their own words / end a typed conversation */
  canType: boolean;
  canEnd: boolean;
  /** the player can stay quiet and let the group keep talking */
  canListen: boolean;
  respond: boolean;
  outcome: { confession?: string; leaving?: string[]; cues: string[] } | null;
  commentary: { lines: { speaker: string; text: string; reaction: string }[]; prediction?: { text: string }; predictionBy?: string } | null;
  freeze: { caption: string; image: ImageStatus } | null;
  done: boolean;
  streaming: boolean;
  error?: string;
}

const SETTINGS_KEY = 'shared-roof-settings';
const defaults: Settings = { captions: true, reducedMotion: false, images: true, sound: true, textScale: 1, author: false, typewriter: true, tutorial: true, tipsSeen: [] };
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
  studioAfter: Screen;
  phoneTab: string;
  phoneRead: Record<string, number>;
  setScreen(s: Screen): void;
  goBack(): void;
  setSettings(p: Partial<Settings>): void;
  refreshHealth(): Promise<void>;
  boot(): Promise<void>;
  newGame(body: { seed?: number; player?: PlayerSetup; randomizeCast?: boolean; seasonLength?: number }): Promise<void>;
  loadSave(id: number): Promise<void>;
  act(a: PlayerAction): Promise<void>;
  nextScene(): Promise<void>;
  playLive(id: string): Promise<void>;
  respond(r: 'join' | 'eavesdrop' | 'ignore'): Promise<void>;
  choose(intent: string): Promise<void>;
  say(text: string): Promise<void>;
  endTalk(): Promise<void>;
  keepListening(): Promise<void>;
  joinAsNewPlayer(player: PlayerSetup): Promise<void>;
  finishSlot(): Promise<void>;
  setView(v: PlayerView): void;
  clearError(): void;
}

const emptyLive = (id: string): LiveScene => ({ id, lines: [], choice: null, canType: false, canEnd: false, canListen: false, respond: false, outcome: null, commentary: null, freeze: null, done: false, streaming: false });

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
  studioAfter: 'house',
  phoneTab: 'group',
  phoneRead: {},

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
      set({ view: g.view, scenes: [], episodeCard: 'start', screen: 'episode', busy: false, phoneTab: 'group', phoneRead: {} });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },

  loadSave: async (id) => {
    set({ busy: true });
    try {
      const g = await api.load(id);
      // the episode card holds until every housemate's sprite sheet is ready
      set({ view: g.view, scenes: [], episodeCard: 'start', screen: 'episode', busy: false, live: null });
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
            patch((l) => ({ ...l, choice: d.intents, canType: !!d.canType, canEnd: !!d.canEnd, canListen: !!d.canListen }));
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
    await api.choose(live.id, { intent });
    await get().playLive(live.id);
  },

  say: async (text) => {
    const live = get().live;
    if (!live?.choice || !text.trim()) return;
    set((st) => ({ live: st.live ? { ...st.live, choice: null } : null }));
    try {
      await api.choose(live.id, { text: text.trim() });
    } catch (e) {
      set({ error: (e as Error).message });
    }
    await get().playLive(live.id);
  },

  keepListening: async () => {
    const live = get().live;
    if (!live?.choice) return;
    set((st) => ({ live: st.live ? { ...st.live, choice: null } : null }));
    await api.choose(live.id, { listen: true });
    await get().playLive(live.id);
  },

  endTalk: async () => {
    const live = get().live;
    if (!live?.choice) return;
    set((st) => ({ live: st.live ? { ...st.live, choice: null } : null }));
    await api.choose(live.id, { done: true });
    await get().playLive(live.id);
  },

  joinAsNewPlayer: async (player) => {
    set({ busy: true, error: null });
    try {
      const g = await api.newPlayer(player);
      set({ view: g.view, scenes: [], episodeCard: 'start', screen: 'episode', busy: false, live: null });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },

  finishSlot: async () => {
    set({ busy: true, live: null });
    try {
      const r = await api.endSlot();
      const digest = r.view.digest;
      set({ view: r.view, scenes: [], busy: false, slotDigest: digest, showDigest: digest.length > 0 && !r.newEpisode });
      // your character graduated: create the one who moves in next
      const after: Screen = r.seasonOver ? 'summary' : r.view.awaitingPlayer ? 'creator' : r.newEpisode ? 'episode' : r.view.slot === 'morning' || r.view.slot === 'evening' ? 'house' : get().back === 'map' ? 'map' : 'house';
      if (r.newEpisode && !r.seasonOver) set({ episodeCard: 'end' });
      // the show cuts to the studio panel mid-episode and at the end; the studio screen then continues to `after`
      set(r.intermission ? { screen: 'studio', studioAfter: after } : { screen: after });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },
}));
