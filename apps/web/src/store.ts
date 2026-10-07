// Zustand store: screens, game view, scene queue/streaming state, settings.
import { create } from 'zustand';
import { content, type Occasion, type PlayerAction, type PlayerSetup, type PlayerView, type Room } from '@shared-roof/shared';
import { api, streamScene, type Broadcast, type Health, type ImageStatus, type SceneSummary } from './api';
import { blip } from './audio';

export type Screen =
  | 'title' | 'creator' | 'house' | 'map' | 'scene' | 'cooking' | 'practice' | 'phone' | 'board' | 'bible' | 'fridge'
  | 'debug' | 'summary' | 'settings' | 'saves' | 'episode' | 'studio' | 'gallery' | 'sprites' | 'editme' | 'chatlog' | 'guide';

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
  canRetry?: boolean;
  header?: {
    title: string;
    premise: string;
    location: string;
    locationName: string;
    /** what everyone wears here (beach, date, outdoor, daily) */
    occasion: Occasion;
    participants: { id: string; name: string; occasion?: Occasion }[];
    outsiders: { id: string; name: string; appearance: PlayerView['characters'][number]['appearance']; gender: string; portraitSeed: number }[];
    isPlayerScene: boolean;
    eavesdrop: boolean;
    background: ImageStatus;
    chat: boolean;
    broadcast?: Broadcast;
    intro: { id: string; name: string; age: number; occupation: string; hometown: string } | null;
    moveIn?: boolean;
  };
  lines: LiveLine[];
  choice: string[] | null;
  recipients: { id: string; name: string }[];
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
  arrivalPending?: string;
  /** the housemate's answer to an invitation the player made: where they will go together, or why not */
  invite?: Invite | null;
  inviteNote?: string;
  error?: string;
}

/** Where a housemate's invitation points: the first place named in their line. */
const INVITE_PLACES: [RegExp, string][] = [[/\b(beach|shore)\b/i, 'beach'], [/\b(promenade|boardwalk)\b/i, 'riverside'], [/\bpark\b/i, 'park'], [/\b(caf[eé]|coffee)\b/i, 'cafe'], [/\bflea market\b/i, 'arcade'], [/\bmarket\b/i, 'market'], [/\bkaraoke\b/i, 'karaoke'], [/\b(bar|drinks?)\b/i, 'bar'], [/\bgardens?\b/i, 'onsen'], [/\b(port|harbou?r)\b/i, 'lighthouse'], [/\brecords?\b/i, 'records']];
const INVITE_CUE = /\b(wanna|want to|would you like|care to|let'?s|how about|join me|come (with|along|join|on)|you (up|down) for|are you free|fancy|gotta|gonna|hit the|head(ing)? (to|out)|go(ing)? (to|for)|ask(ed)? you out)\b/i;

const INVITE_ROOMS: [RegExp, string][] = [[/\bkitchen\b/i, 'kitchen'], [/\b(living room|lounge)\b/i, 'living'], [/\b(backyard|pool deck)\b/i, 'backyard'], [/\bentrance\b/i, 'entrance']];

export interface Invite { from: string; name: string; guests: string[]; names: string; node: string; activity: 'invite' | 'wander' | 'date' | 'talk'; placeName: string }

/** "asked you out" with no place named: somewhere good for a date */
const DATE_CUE = /\b(ask(ed|ing)? you out|go(ing)? out (with me|together|sometime|tonight|tomorrow)|take you out|go on a date|date with me|be my date|dinner (with me|together|tonight)|grab (a |some )?(bite|dinner|lunch|drinks?|coffee))\b/i;
const DATE_SPOTS = ['cafe', 'riverside', 'beach', 'park', 'bar'];
const PLAYER_NO = /\b(no|nah|sorry|can'?t|not (now|today|really|interested)|pass|busy|rain ?check)\b/i;
const PLAYER_YES = /\b(yes|yeah|yep|sure|ok(ay)?|sounds (good|great|fun)|love to|i'?d love|let'?s)\b/i;

/** The outing `nodeId` as an invitation from housemate `who` (a shared room means "talk there"). */
export function inviteFor(who: { id: string; name: string }, nodeId: string, date = false): Invite | null {
  const first = who.name.split(' ')[0];
  const room = content().house.rooms.find((r) => r.id === nodeId && !r.private);
  if (room) return { from: who.id, name: first, guests: [], names: first, node: room.id, activity: 'talk', placeName: room.name };
  const node = content().city.nodes.find((n) => n.id === nodeId);
  const activity = date && node?.activities.includes('date') ? 'date' : (['invite', 'wander', 'date'] as const).find((a) => node?.activities.includes(a));
  return node && activity ? { from: who.id, name: first, guests: [], names: first, node: node.id, activity, placeName: node.name } : null;
}

/**
 * Someone in the recent talk (a housemate, or you agreeing) proposes going somewhere; the housemate who spoke last
 * is the one who comes. Free-form dialogue has no structured invitation, so this reads the lines.
 */
export function findInvite(lines: LiveLine[], view: PlayerView | null): Invite | null {
  if (!view) return null;
  const recent = lines.slice(-6);
  const talk = recent.map((l) => l.text).join(' ');
  // a housemate whose own last line turned it down stays home
  const turnedDown = (id: string) => /\b(no|nah|can'?t|pass|busy|not (now|today|really))\b/i.test([...recent].reverse().find((l) => l.speaker === id)?.text ?? '');
  const going = view.characters.filter((c) => !c.isPlayer && c.status === 'inHouse' && !turnedDown(c.id) && (recent.some((l) => l.speaker === c.id) || new RegExp(`\\b${c.name.split(' ')[0]}\\b`, 'i').test(talk)));
  const lastSpoke = [...recent].reverse().map((l) => going.find((c) => c.id === l.speaker)).find(Boolean);
  const who = lastSpoke ?? going[0];
  if (!who) return null;
  const company = going.filter((c) => c.id !== who.id).slice(0, 3);
  const names = [who, ...company].map((c) => c.name.split(' ')[0]).join(' and ').replace(/ and (?=.* and )/g, ', ');
  for (const l of [...recent].reverse()) {
    if (!INVITE_CUE.test(l.text) && !DATE_CUE.test(l.text)) continue;
    // a housemate's ask the player then turned down is not an invitation
    if (l.speaker !== view.playerId && recent.slice(recent.lastIndexOf(l) + 1).some((x) => x.speaker === view.playerId && PLAYER_NO.test(x.text) && !PLAYER_YES.test(x.text))) continue;
    const room = content().house.rooms.find(r => r.id === INVITE_ROOMS.find(([re]) => re.test(l.text))?.[1]);
    if (room && !room.private) {
      if (room.id === view.playerLocation) continue;
      return { from: who.id, name: who.name.split(' ')[0], guests: company.map(c => c.id), names, node: room.id, activity: 'talk', placeName: room.name };
    }
    const node = content().city.nodes.find((n) => n.id === INVITE_PLACES.find(([re]) => re.test(l.text))?.[1]);
    const activity = (['invite', 'wander', 'date'] as const).find((a) => node?.activities.includes(a));
    if (node && activity) return { from: who.id, name: who.name.split(' ')[0], guests: company.map((c) => c.id), names, node: node.id, activity, placeName: node.name };
    if (DATE_CUE.test(l.text)) {
      const spot = inviteFor(who, DATE_SPOTS.find((id) => content().city.nodes.find((n) => n.id === id)?.activities.includes('date')) ?? 'cafe', true);
      if (spot) return spot; // a date is the two of you
    }
  }
  return null;
}

const SETTINGS_KEY = 'shared-roof-settings';
export const unreadMessages = (messages: readonly { from: string }[], playerId: string, read = 0) => messages.slice(read).filter(m => m.from !== playerId).length;
export function phoneNotifications(view: PlayerView, read: Record<string, number>): number {
  return unreadMessages(view.groupChat.messages, view.playerId, read.group) + view.chats.reduce((n, t) => n + unreadMessages(t.messages, view.playerId, read[t.with]), 0) + view.invitations.filter(p => p.to === view.playerId && p.status === 'pending' && !read[`plan:${p.id}`]).length;
}
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
  galleryBack: Screen;
  guideBack: Screen;
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
  /** a hang-out the player accepted: illustrate its scene when it ends */
  hangoutCg: boolean;
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
  worldPulse(): Promise<void>;
  nextScene(): Promise<void>;
  playLive(id: string): Promise<void>;
  respond(r: 'join' | 'eavesdrop' | 'ignore'): Promise<void>;
  choose(intent: string, recipient?: string, via?: 'button' | 'key'): Promise<void>;
  submitChoice(choice: Parameters<typeof api.choose>[1]): Promise<void>;
  say(text: string, recipient?: string): Promise<void>;
  inviteTo(node: string, date: boolean, who?: string): Promise<void>;
  endTalk(): Promise<void>;
  hangOut(invite: Invite): Promise<void>;
  resume(): Promise<void>;
  keepListening(): Promise<void>;
  joinAsNewPlayer(player: PlayerSetup): Promise<void>;
  finishSlot(showRecap?: boolean): Promise<void>;
  setView(v: PlayerView): void;
  clearError(): void;
}

const emptyLive = (id: string): LiveScene => ({ id, lines: [], choice: null, recipients: [], canType: false, canEnd: false, canListen: false, respond: false, outcome: null, commentary: null, freeze: null, done: false, streaming: false });

export const useGame = create<State>((set, get) => ({
  screen: 'title',
  back: 'house',
  galleryBack: 'title',
  guideBack: 'title',
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
  hangoutCg: false,
  studioAfter: 'house',
  phoneTab: 'group',
  phoneRead: {},

  setScreen: (screen) => set((st) => ({ screen, back: ['title', 'house', 'map', 'scene'].includes(st.screen) ? st.screen : st.back, ...(['gallery', 'sprites'].includes(screen) && screen !== st.screen ? { galleryBack: st.screen } : {}), ...(screen === 'guide' && screen !== st.screen ? { guideBack: st.screen } : {}) })),
  goBack: () => set((st) => ({ screen: !st.view ? 'title' : st.back === 'scene' && !st.live ? 'house' : st.back })),
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
    set({ busy: true, error: null });
    try {
      const g = await api.load(id);
      set({ view: g.view, scenes: g.scenes, episodeCard: 'start', screen: 'episode', busy: false, live: null, showDigest: false, hangoutCg: false });
      if (g.scenes.some(s => s.rendered && s.phase !== 'done')) {
        set({ episodeCard: null });
        await get().nextScene();
      }
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },

  worldPulse: async () => {
    const { view, screen, busy, scenes } = get();
    if (!view || busy || !['house', 'map'].includes(screen) || scenes.some(s => s.rendered && s.phase !== 'done')) return;
    set({ busy: true });
    try {
      const r = await api.worldPulse();
      if (get().view?.gameId !== view.gameId) return;
      set({ view: r.view, scenes: r.scenes });
      if (r.scenes.some(s => s.rendered && s.phase !== 'done')) await get().nextScene();
      else if (r.view.minutesLeft === 0 && get().screen === screen) await get().finishSlot(false);
    } catch (e) { set({ error: (e as Error).message }); }
    finally { set({ busy: false }); }
  },

  act: async (a) => {
    if (get().busy) return;
    const live = get().live;
    const pending = get().scenes.find(s => s.phase !== 'done' && s.rendered);
    if (pending && a.type !== 'text' && a.type !== 'respondPlan') {
      if (live && !live.done) set({ screen: 'scene' });
      else await get().nextScene();
      return;
    }
    set({ busy: true, error: null });
    try {
      const r = await api.act(a);
      set({ view: r.view, scenes: r.scenes, busy: false });
      if (a.type === 'text' || a.type === 'respondPlan') return;
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
    patch((l) => ({ ...l, streaming: true, choice: null, respond: false, error: undefined }));
    try {
      await streamScene(id, (ev, d) => {
        switch (ev) {
          case 'scene':
            patch((l) => ({ ...l, header: d }));
            break;
          case 'view':
            set({ view: d });
            break;
          case 'arrival-joined':
            set({ view: d.view });
            patch(l => ({ ...l, header: l.header ? { ...l.header, participants: d.participants, intro: d.intro } : l.header }));
            break;
          case 'arrival-pending':
            set({ view: d.view });
            patch(l => ({ ...l, arrivalPending: d.name }));
            break;
          case 'line-start':
            patch((l) => (l.lines.some((x) => x.index === d.index) ? l : { ...l, lines: [...l.lines, { index: d.index, speaker: d.speaker, name: d.name, text: '', caption: d.caption, done: false, emotion: d.emotion }] }));
            break;
          case 'reset':
            patch(l => ({ ...l, lines: l.lines.filter(x => x.index < d.from) }));
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
            patch((l) => ({ ...l, choice: d.intents, recipients: d.recipients ?? [], canRetry: !!d.canRetry, canType: !!d.canType, canEnd: !!d.canEnd, canListen: !!d.canListen }));
            break;
          case 'invite':
            patch((l) => ({ ...l, invite: d.accepted ? inviteFor({ id: d.from, name: d.name }, d.node, d.date) : null, inviteNote: d.accepted ? undefined : `${String(d.name).split(' ')[0]} ${d.reason}.` }));
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
            if (d.view) set({ view: d.view });
            if (d.scenes) set({ scenes: d.scenes });
            patch((l) => ({ ...l, done: true, ...(d.replay ? { lines: (d.transcript ?? []).map((t: any, i: number) => ({ index: i, speaker: t.speaker, name: t.speaker, text: t.text, caption: t.caption, emotion: t.emotion, done: true })), commentary: d.commentary ?? null } : {}) }));
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

  submitChoice: async (choice) => {
    const live = get().live;
    if (!live?.choice || live.streaming) return;
    set((st) => ({ live: st.live ? { ...st.live, choice: null, invite: undefined, inviteNote: undefined } : null }));
    try {
      await api.choose(live.id, choice);
    } catch (e) {
      set({ error: (e as Error).message, live: { ...live, streaming: false } });
      return;
    }
    await get().playLive(live.id);
  },

  choose: (intent, recipient, via = 'button') => get().submitChoice({ intent, recipient, via }),

  say: async (text, recipient) => { if (text.trim()) await get().submitChoice({ text: text.trim(), recipient, via: 'typed' }); },

  inviteTo: (node, date, who) => get().submitChoice({ invite: { node, date, with: who }, via: 'invite' }),

  keepListening: () => get().submitChoice({ listen: true }),

  endTalk: async () => {
    const live = get().live;
    if (!live?.choice) return;
    set((st) => ({ error: null, live: st.live ? { ...st.live, choice: null } : null }));
    try {
      await api.choose(live.id, { done: true });
      await get().playLive(live.id);
      if (!get().live?.done || get().live?.error) return;
      if (get().scenes.some(s => s.phase !== 'done')) await get().nextScene();
      else await get().finishSlot(false);
    } catch (e) {
      set({ error: (e as Error).message });
      await get().playLive(live.id);
    }
  },

  /** Accept a housemate's invitation: leave the conversation, then go there together (travel and activity pass the time). */
  hangOut: async (inv) => {
    const live = get().live;
    if (!live?.choice && !live?.done) return;
    set((st) => ({ error: null, live: st.live ? { ...st.live, choice: null } : null }));
    try {
      // a conversation that already ended (a phone chat that closed, say) only needs the slot finished
      if (!live.done) {
        await api.choose(live.id, { done: true, hangout: true });
        await get().playLive(live.id);
      }
      if (!get().live?.done || get().live?.error) return;
      await get().finishSlot(false);
      if (get().error) return;
      set({ hangoutCg: inv.activity !== 'talk' });
      const go: PlayerAction = inv.activity === 'talk'
        ? { type: 'talk', room: inv.node as Room, target: inv.from, guests: inv.guests }
        : { type: 'goOut', node: inv.node, activity: inv.activity, invite: inv.from, guests: inv.guests.length ? inv.guests : undefined };
      await get().act(go);
      // not enough of this block is left for the trip: let it pass, then go at the start of the next one
      if (/too far for this slot|closed now/.test(get().error ?? '')) {
        set({ error: null });
        await get().act({ type: 'skip' });
        if (!get().error) await get().act(go);
      }
      if (get().error) set({ hangoutCg: false });
    } catch (e) {
      set({ error: (e as Error).message, hangoutCg: false });
      await get().playLive(live.id);
    }
  },

  /** Pick up scenes the server still has open (left mid-conversation, or after a reload). */
  resume: async () => {
    set({ live: null, error: null });
    await get().nextScene();
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

  finishSlot: async (showRecap = true) => {
    set({ busy: true, live: null });
    try {
      const r = await api.endSlot();
      const digest = r.view.digest;
      set({ view: r.view, scenes: [], busy: false, slotDigest: digest, showDigest: showRecap && digest.length > 0 && !r.newEpisode });
      // your character graduated: create the one who moves in next
      const after: Screen = r.seasonOver ? 'summary' : r.view.awaitingPlayer ? 'creator' : r.newEpisode ? 'episode' : r.view.slot === 'morning' || r.view.slot === 'evening' ? 'house' : get().back === 'map' ? 'map' : 'house';
      if (r.newEpisode && !r.seasonOver) set({ episodeCard: 'end' });
      // the show cuts to the studio panel mid-episode and at the end; the studio screen then continues to `after`
      set(r.intermission && (showRecap || r.newEpisode) ? { screen: 'studio', studioAfter: after } : { screen: after });
    } catch (e) {
      set({ error: (e as Error).message, busy: false });
    }
  },
}));
