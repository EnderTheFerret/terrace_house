import { describe, expect, it } from 'vitest';
import { createGame, finishSlot, planSlot } from './loop';
import { addTalkPlan, applyPlanRead, planFromWords, proposedPlan } from './living';
import { projectForPlayer } from './view';
import { GameState } from '../model';

const calm = () => {
  const s = createGame({ seed: 7, moveInDay: false });
  s.world.weekday = 6; // Saturday
  for (const c of Object.values(s.characters)) { c.lastAction = undefined; c.persona.keepsShabbat = false; s.world.flags[`introduced_${c.id}`] = true; } // everyone has met by now
  return s;
};

describe('house meetings agreed in conversation', () => {
  it('reads "house meeting Tuesday evening?" as a meeting for everyone at home, not an outing', () => {
    const s = calm();
    expect(proposedPlan(s, 'Want a house meeting Tuesday evening?')).toEqual({ node: 'living', episode: s.world.episode + 3, slot: 'evening', meeting: '' });
    expect(proposedPlan(s, "Let's have a house meeting with everyone tomorrow at 20:00")).toMatchObject({ node: 'living', meeting: '' });
    // an ordinary plan with others is still only told, not an invitation
    expect(proposedPlan(s, "I'm going to the beach with the others tomorrow morning.")).toBeNull();
  });

  it('keeps a model-reported meeting at home, whatever place it named, and carries its topic', () => {
    const s = calm();
    expect(planFromWords(s, '', 'Tuesday at 20:00', false, 'the grocery budget')).toMatchObject({ node: 'living', slot: 'evening', meeting: 'the grocery budget' });
    expect(planFromWords(s, 'kitchen', 'Tuesday at 20:00', false, 'the sink')).toMatchObject({ node: 'kitchen', meeting: 'the sink' });
    expect(planFromWords(s, 'beach', 'Tuesday at 20:00', false, 'the sink')).toMatchObject({ node: 'living' });
    expect(planFromWords(s, 'beach', 'Tuesday at 20:00')).toMatchObject({ node: 'beach' }); // no meeting: unchanged
    expect(planFromWords(s, '', 'Tuesday at 20:00')).toBeNull();
  });

  it('books it on the calendar and tells the house group chat', () => {
    const s = calm();
    const plan = planFromWords(s, '', 'Tuesday at 20:00', false, 'the grocery budget')!;
    const next = applyPlanRead(s, s.playerId, 'ren', { plan });
    const p = next.invitations.at(-1)!;
    expect(p).toMatchObject({ node: 'living', slot: 'evening', status: 'accepted', meeting: { topic: 'the grocery budget' } });
    expect(next.house.groupChat.messages.at(-1)).toMatchObject({ from: 'ren' });
    expect(next.house.groupChat.messages.at(-1)!.text).toMatch(/House meeting .*living room: the grocery budget/);
    expect(GameState.safeParse(next).success).toBe(true);
    expect(projectForPlayer(next).invitations.at(-1)!.meeting).toEqual({ topic: 'the grocery budget' });
  });

  it('on the day, everyone who is home gathers in the living room for it, and it counts as kept', () => {
    const s = calm();
    s.world.slot = 'evening';
    const withMeeting = addTalkPlan(s, s.playerId, 'ren', { node: 'living', episode: s.world.episode, slot: 'evening', meeting: 'the grocery budget' });
    const { state, plan } = planSlot(withMeeting, { type: 'idle' });
    const scene = plan.scenes.find((sc) => sc.event.isPlayerScene)!.event;
    expect(scene.templateId).toBe('house-meeting-called');
    expect(scene.location).toBe('living');
    expect(scene.premise).toMatch(/grocery budget/);
    expect(scene.participants).toContain(s.playerId);
    expect(scene.participants).toContain('ren');
    expect(scene.participants.length).toBeGreaterThanOrEqual(4);
    expect(scene.participants.every((id) => state.characters[id].location === 'living')).toBe(true);
    // held once: asking again for the same block does not make a second meeting
    expect(state.world.flags[`meetingHeld_${withMeeting.invitations.at(-1)!.id}`]).toBe(true);
    const id = withMeeting.invitations.at(-1)!.id;
    expect(finishSlot(state).invitations.find((p) => p.id === id)!.status).toBe('kept');
  });

  it('a meeting nobody can lead (player out of the house) still happens without them and is missed', () => {
    const s = calm();
    s.world.slot = 'evening';
    s.characters[s.playerId].location = 'beach';
    s.world.playerNode = 'beach';
    const withMeeting = addTalkPlan(s, s.playerId, 'ren', { node: 'living', episode: s.world.episode, slot: 'evening', meeting: 'the sink' });
    const { state, plan } = planSlot(withMeeting, { type: 'idle' });
    expect(plan.scenes.some((sc) => sc.event.templateId === 'house-meeting-called' && !sc.event.participants.includes(s.playerId))).toBe(true);
    const id = withMeeting.invitations.at(-1)!.id;
    expect(finishSlot(state).invitations.find((p) => p.id === id)!.status).toBe('broken');
  });
});
