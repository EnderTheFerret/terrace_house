import { describe, expect, it, vi } from 'vitest';
import { findInvite, phoneNotifications, useGame, type LiveLine, type LiveScene } from './store';
import { api, type SceneSummary } from './api';

const view = { playerId: 'me', characters: [{ id: 'kai', name: 'Kai Cohen', isPlayer: false, status: 'inHouse' }, { id: 'ron', name: 'Ron Levi', isPlayer: false, status: 'inHouse' }, { id: 'me', name: 'Me', isPlayer: true, status: 'inHouse' }] } as never;
const line = (speaker: string, text: string): LiveLine => ({ index: 0, speaker, name: speaker, text, caption: null, done: true });

it('clears read notifications and does not badge outgoing messages', () => {
  const phone = { playerId: 'me', groupChat: { messages: [{ from: 'me' }, { from: 'kai' }] }, chats: [{ with: 'kai', messages: [{ from: 'me' }, { from: 'kai' }] }], invitations: [{ id: 'p1', to: 'me', status: 'pending' }] } as never;
  expect(phoneNotifications(phone, {})).toBe(3);
  expect(phoneNotifications(phone, { group: 2, kai: 2, 'plan:p1': 1 })).toBe(0);
  expect(phoneNotifications(phone, { group: 1, kai: 1, 'plan:p1': 1 })).toBe(2);
});

describe('phone replies during an unfinished scene', () => {
  it.each([false, true])('registers a plan response without leaving the phone or replacing the conversation (accept=%s)', async (accept) => {
    const original = useGame.getState();
    const scene = { id: 'conversation-plan', rendered: true, phase: 'awaiting-choice' } as SceneSummary;
    const live = { id: scene.id, lines: [line('kai', 'Bring some pita.')], done: false } as LiveScene;
    const updated = { ...view as object, invitations: [{ id: 'plan-1', status: accept ? 'accepted' : 'declined' }] } as never;
    const action = vi.spyOn(api, 'act').mockResolvedValue({ view: updated, scenes: [scene] });
    const nextScene = vi.fn(async () => {});
    try {
      useGame.setState({ view, scenes: [scene], live, screen: 'phone', busy: false, error: null, nextScene });
      const response = { type: 'respondPlan' as const, id: 'plan-1', accept };
      await useGame.getState().act(response);
      expect(action).toHaveBeenCalledWith(response);
      expect(useGame.getState()).toMatchObject({ view: updated, screen: 'phone', scenes: [scene], live, busy: false, error: null });
      expect(nextScene).not.toHaveBeenCalled();
      action.mockRejectedValueOnce(new Error('invitation is no longer pending'));
      await useGame.getState().act(response);
      expect(useGame.getState()).toMatchObject({ screen: 'phone', live, error: 'invitation is no longer pending', busy: false });
    } finally {
      useGame.setState(original, true);
      vi.restoreAllMocks();
    }
  });
  it('keeps instant texts on the phone and opens restored save scenes directly', async () => {
    const original = useGame.getState();
    const nextScene = vi.fn(async () => {});
    const scene = { id: 'restored', rendered: true, phase: 'awaiting-choice' } as SceneSummary;
    try {
      vi.spyOn(api, 'act').mockResolvedValue({ view, scenes: [] });
      vi.spyOn(api, 'load').mockResolvedValue({ view, scenes: [scene] });
      useGame.setState({ view, scenes: [], live: null, screen: 'phone', busy: false, error: null, nextScene });
      await useGame.getState().act({ type: 'text', target: 'kai', text: 'Want to hang out?' });
      expect(useGame.getState().screen).toBe('phone');
      expect(nextScene).not.toHaveBeenCalled();
      await useGame.getState().loadSave(1);
      expect(useGame.getState()).toMatchObject({ scenes: [scene], episodeCard: null, live: null, busy: false });
      expect(nextScene).toHaveBeenCalledOnce();
    } finally {
      useGame.setState(original, true);
      vi.restoreAllMocks();
    }
  });
  it.each([false, true])('sends texts beside an unfinished scene (phone=%s) and keeps rejected replies retryable', async (chat) => {
    const original = useGame.getState();
    const scene = { id: 'conversation-1', chat, rendered: true, phase: 'awaiting-choice', participants: ['me', 'kai'] } as SceneSummary;
    const live: LiveScene = { id: scene.id, choice: ['support'], lines: [], streaming: false, done: false, recipients: [], canType: true, canEnd: true, canListen: false, respond: false, outcome: null, commentary: null, freeze: null };
    const action = vi.spyOn(api, 'act').mockResolvedValue({ view, scenes: [scene] });
    const choose = vi.spyOn(api, 'choose');
    const nextScene = vi.fn(async () => {});
    try {
      useGame.setState({ view, scenes: [scene], live, screen: 'phone', busy: false, error: null, nextScene });
      for (const target of ['kai', 'ron']) {
        const text = { type: 'text' as const, target, text: 'Bring some pita, please.' };
        await useGame.getState().act(text);
        expect(action).toHaveBeenLastCalledWith(text);
        expect(useGame.getState()).toMatchObject({ screen: 'phone', busy: false, error: null, scenes: [scene], live });
      }
      expect(choose).not.toHaveBeenCalled();
      expect(nextScene).not.toHaveBeenCalled();
      await useGame.getState().act({ type: 'favor', target: 'kai', kind: 'coffee' });
      expect(action).toHaveBeenCalledTimes(2);
      expect(useGame.getState().screen).toBe('scene');
      useGame.setState({ screen: 'phone' });
      action.mockRejectedValueOnce(new Error('connection lost'));
      await useGame.getState().act({ type: 'text', target: 'kai', text: 'Try again' });
      expect(useGame.getState()).toMatchObject({ screen: 'phone', error: 'connection lost', busy: false, live });
      await useGame.getState().act({ type: 'text', target: 'kai', text: 'Try again' });
      expect(useGame.getState().error).toBeNull();
      useGame.setState({ live: { ...live, canType: false }, screen: 'phone' });
      await useGame.getState().act({ type: 'text', target: 'kai', text: 'One more?' });
      expect(action).toHaveBeenCalledTimes(5);
      expect(choose).not.toHaveBeenCalled();
      expect(useGame.getState().screen).toBe('phone');
    } finally {
      useGame.setState(original, true);
      vi.restoreAllMocks();
    }
  });
});

describe('findInvite', () => {
  it('offers a shared room when a housemate suggests moving the conversation there', () => {
    expect(findInvite([line('kai', "Let's head to the kitchen for coffee.")], view)).toMatchObject({ from: 'kai', node: 'kitchen', activity: 'talk' });
    expect(findInvite([line('kai', 'Want to go to the living room?')], view)).toMatchObject({ node: 'living', activity: 'talk' });
    expect(findInvite([line('kai', 'The kitchen was nice yesterday')], view)).toBeNull();
    expect(findInvite([line('kai', "Let's head to the bedroom")], view)).toBeNull();
    expect(findInvite([line('kai', "Let's have coffee in the kitchen.")], { ...view as object, playerLocation: 'kitchen' } as never)).toBeNull();
  });
  it('turns a housemate asking you out into a go-there offer', () => {
    expect(findInvite([line('kai', 'Wanna go for a morning run at the beach?')], view)).toMatchObject({ from: 'kai', name: 'Kai', node: 'beach' });
  });
  it('finds the invite a few lines back, and when you are the one proposing', () => {
    expect(findInvite([line('kai', 'we gotta hit the beach road!'), line('me', 'sure.'), line('kai', 'ha, that is the spirit')], view)).toMatchObject({ from: 'kai', node: 'beach' });
    expect(findInvite([line('kai', 'hey'), line('me', "let's go to the beach")], view)).toMatchObject({ from: 'kai', node: 'beach' });
  });
  it('takes everyone who agreed along, not those who said no', () => {
    const talk = [line('kai', 'we gotta hit the beach road!'), line('me', 'I will bring Ron'), line('ron', 'sure, count me in')];
    expect(findInvite(talk, view)).toMatchObject({ from: 'ron', guests: ['kai'], names: 'Ron and Kai' });
    expect(findInvite([...talk, line('kai', 'nah, I have work')], view)).toMatchObject({ from: 'ron', guests: [] });
  });
  it('offers a date when a housemate asks you out without naming a place, unless you turned them down', () => {
    expect(findInvite([line('kai', 'I was hoping to ask you out sometime.')], view)).toMatchObject({ from: 'kai', activity: 'date', guests: [] });
    expect(findInvite([line('kai', 'Would you go out with me tonight?'), line('me', 'sorry, no, I am busy')], view)).toBeNull();
    expect(findInvite([line('kai', 'Want to go out with me tonight?'), line('me', 'no way, that sounds great, yes')], view)).toMatchObject({ from: 'kai', activity: 'date' });
  });
  it('ignores your own lines, small talk and invitations without a place', () => {
    expect(findInvite([line('me', 'wanna go to the beach?')], view)).toBeNull(); // nobody to go with
    expect(findInvite([line('kai', 'the beach was nice yesterday')], view)).toBeNull();
    expect(findInvite([line('kai', 'wanna hang out sometime?')], view)).toBeNull();
  });
});
